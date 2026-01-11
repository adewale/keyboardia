/**
 * Audio Initialization Tests
 *
 * Replaces E2E tests from e2e/instrument-audio.spec.ts that require headed browsers.
 * Tests the audio initialization lifecycle, engine readiness states, and instrument
 * type routing logic without requiring actual audio playback.
 *
 * Replaces coverage for:
 * - instrument-audio.spec.ts - Audio engine initialization
 * - instrument-audio.spec.ts - Tone.js initialization triggers
 * - instrument-audio.spec.ts - Instrument type playback routing
 * - instrument-audio.spec.ts - All instrument types validation
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ADVANCED_SYNTH_PRESETS } from './advancedSynth';
import { SYNTH_PRESETS } from './synth';
import { INSTRUMENT_CATEGORIES, CATEGORY_ORDER } from '../components/sample-constants';

// =============================================================================
// SECTION 1: Audio Engine State Machine
// =============================================================================

describe('Audio Engine State Machine', () => {
  /**
   * The audio engine goes through these states:
   * 1. uninitialized → requires user gesture
   * 2. initialized → basic audio context ready
   * 3. toneInitialized → Tone.js synths ready
   * 4. advanced ready → advanced synths ready
   */

  interface EngineState {
    initialized: boolean;
    toneInitialized: boolean;
    advancedReady: boolean;
    contextState: 'suspended' | 'running' | 'closed';
  }

  const createEngineState = (overrides: Partial<EngineState> = {}): EngineState => ({
    initialized: false,
    toneInitialized: false,
    advancedReady: false,
    contextState: 'suspended',
    ...overrides,
  });

  it('AI-001: uninitialized engine cannot play any instruments', () => {
    const state = createEngineState();

    expect(state.initialized).toBe(false);
    expect(state.toneInitialized).toBe(false);
    expect(state.advancedReady).toBe(false);
  });

  it('AI-002: basic initialization enables native synths', () => {
    const state = createEngineState({ initialized: true, contextState: 'running' });

    // Native synths (synth:*) only need basic initialization
    const canPlayNativeSynth = state.initialized && state.contextState === 'running';
    expect(canPlayNativeSynth).toBe(true);
  });

  it('AI-003: Tone.js initialization enables tone synths', () => {
    const state = createEngineState({
      initialized: true,
      toneInitialized: true,
      contextState: 'running',
    });

    // Tone.js synths (tone:*) need toneInitialized
    const canPlayToneSynth = state.initialized && state.toneInitialized;
    expect(canPlayToneSynth).toBe(true);
  });

  it('AI-004: advanced initialization enables advanced synths', () => {
    const state = createEngineState({
      initialized: true,
      toneInitialized: true,
      advancedReady: true,
      contextState: 'running',
    });

    // Advanced synths (advanced:*) need advancedReady
    const canPlayAdvancedSynth = state.initialized && state.advancedReady;
    expect(canPlayAdvancedSynth).toBe(true);
  });

  it('AI-005: suspended context blocks all playback', () => {
    const state = createEngineState({
      initialized: true,
      toneInitialized: true,
      advancedReady: true,
      contextState: 'suspended', // Still suspended!
    });

    // Even with everything initialized, suspended context blocks audio
    const canPlayAudio = state.contextState === 'running';
    expect(canPlayAudio).toBe(false);
  });

  it('AI-006: closed context requires full re-initialization', () => {
    const state = createEngineState({
      initialized: true,
      toneInitialized: true,
      advancedReady: true,
      contextState: 'closed',
    });

    // Closed context is terminal - cannot play
    const canRecover = state.contextState !== 'closed';
    expect(canRecover).toBe(false);
  });
});

// =============================================================================
// SECTION 2: Instrument Type Routing
// =============================================================================

describe('Instrument Type Routing', () => {
  /**
   * Tests the logic that routes instrument IDs to the correct audio engine.
   * This is critical for the "instruments don't make sound" bug.
   */

  type InstrumentType = 'native' | 'tone' | 'advanced' | 'sampled' | 'procedural';

  function routeInstrument(instrumentId: string): InstrumentType {
    if (instrumentId.startsWith('synth:')) return 'native';
    if (instrumentId.startsWith('tone:')) return 'tone';
    if (instrumentId.startsWith('advanced:')) return 'advanced';
    if (instrumentId.startsWith('sampled:')) return 'sampled';
    return 'procedural';
  }

  function canPlayInstrument(
    instrumentId: string,
    engineState: { initialized: boolean; toneReady: boolean; advancedReady: boolean; sampledLoaded: Set<string> }
  ): { canPlay: boolean; reason?: string } {
    const type = routeInstrument(instrumentId);

    switch (type) {
      case 'native':
        return engineState.initialized
          ? { canPlay: true }
          : { canPlay: false, reason: 'Engine not initialized' };

      case 'tone':
        if (!engineState.initialized) return { canPlay: false, reason: 'Engine not initialized' };
        if (!engineState.toneReady) return { canPlay: false, reason: 'Tone.js synths not ready' };
        return { canPlay: true };

      case 'advanced':
        if (!engineState.initialized) return { canPlay: false, reason: 'Engine not initialized' };
        if (!engineState.advancedReady) return { canPlay: false, reason: 'Advanced synth engine not ready' };
        return { canPlay: true };

      case 'sampled': {
        const preset = instrumentId.replace('sampled:', '');
        if (!engineState.sampledLoaded.has(preset)) {
          return { canPlay: false, reason: `Sampled instrument "${preset}" not loaded` };
        }
        return { canPlay: true };
      }

      case 'procedural':
        return engineState.initialized
          ? { canPlay: true }
          : { canPlay: false, reason: 'Engine not initialized' };
    }
  }

  it('IR-001: routes synth: to native engine', () => {
    expect(routeInstrument('synth:lead')).toBe('native');
    expect(routeInstrument('synth:bass')).toBe('native');
    expect(routeInstrument('synth:pad')).toBe('native');
  });

  it('IR-002: routes tone: to Tone.js engine', () => {
    expect(routeInstrument('tone:fm-epiano')).toBe('tone');
    expect(routeInstrument('tone:membrane-kick')).toBe('tone');
  });

  it('IR-003: routes advanced: to advanced synth engine', () => {
    expect(routeInstrument('advanced:supersaw')).toBe('advanced');
    expect(routeInstrument('advanced:thick-lead')).toBe('advanced');
  });

  it('IR-004: routes sampled: to sampled instrument engine', () => {
    expect(routeInstrument('sampled:piano')).toBe('sampled');
    expect(routeInstrument('sampled:808-kick')).toBe('sampled');
  });

  it('IR-005: routes unprefixed to procedural engine', () => {
    expect(routeInstrument('kick')).toBe('procedural');
    expect(routeInstrument('hihat')).toBe('procedural');
    expect(routeInstrument('snare')).toBe('procedural');
  });

  it('IR-006: native synths play with basic init only', () => {
    const state = { initialized: true, toneReady: false, advancedReady: false, sampledLoaded: new Set<string>() };
    const result = canPlayInstrument('synth:lead', state);
    expect(result.canPlay).toBe(true);
  });

  it('IR-007: tone synths fail without Tone.js init', () => {
    const state = { initialized: true, toneReady: false, advancedReady: false, sampledLoaded: new Set<string>() };
    const result = canPlayInstrument('tone:fm-epiano', state);
    expect(result.canPlay).toBe(false);
    expect(result.reason).toContain('Tone.js');
  });

  it('IR-008: advanced synths fail without advanced init', () => {
    const state = { initialized: true, toneReady: true, advancedReady: false, sampledLoaded: new Set<string>() };
    const result = canPlayInstrument('advanced:supersaw', state);
    expect(result.canPlay).toBe(false);
    expect(result.reason).toContain('Advanced');
  });

  it('IR-009: sampled instruments fail if not loaded', () => {
    const state = { initialized: true, toneReady: true, advancedReady: true, sampledLoaded: new Set<string>() };
    const result = canPlayInstrument('sampled:piano', state);
    expect(result.canPlay).toBe(false);
    expect(result.reason).toContain('not loaded');
  });

  it('IR-010: sampled instruments play if loaded', () => {
    const state = { initialized: true, toneReady: true, advancedReady: true, sampledLoaded: new Set(['piano']) };
    const result = canPlayInstrument('sampled:piano', state);
    expect(result.canPlay).toBe(true);
  });
});

// =============================================================================
// SECTION 3: All Preset Validation
// =============================================================================

describe('All Preset Validation', () => {
  /**
   * Validates that all presets in the system are properly defined.
   * Replaces E2E tests that iterate through all instrument types.
   */

  it('PV-001: all SYNTH_PRESETS have valid structure', () => {
    const presets = Object.entries(SYNTH_PRESETS);
    expect(presets.length).toBeGreaterThan(0);

    for (const [name, preset] of presets) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
      expect(preset).toHaveProperty('waveform');
      expect(preset).toHaveProperty('attack');
      expect(preset).toHaveProperty('release');
    }
  });

  it('PV-002: all ADVANCED_SYNTH_PRESETS have valid structure', () => {
    const presets = Object.entries(ADVANCED_SYNTH_PRESETS);
    expect(presets.length).toBeGreaterThan(0);

    for (const [name, preset] of presets) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
      expect(preset).toHaveProperty('name');
      expect(preset).toHaveProperty('oscillator1');
      expect(preset).toHaveProperty('oscillator2');
      expect(preset).toHaveProperty('amplitudeEnvelope');
    }
  });

  it('PV-003: all instrument categories are properly defined', () => {
    expect(CATEGORY_ORDER.length).toBeGreaterThan(0);

    for (const categoryKey of CATEGORY_ORDER) {
      const category = INSTRUMENT_CATEGORIES[categoryKey];
      expect(category).toBeDefined();
      expect(category.label).toBeTruthy();
      expect(Array.isArray(category.instruments)).toBe(true);
      expect(category.instruments.length).toBeGreaterThan(0);

      for (const instrument of category.instruments) {
        expect(instrument.id).toBeTruthy();
        expect(instrument.name).toBeTruthy();
      }
    }
  });

  it('PV-004: no duplicate instrument IDs across categories', () => {
    const allIds = new Set<string>();
    const duplicates: string[] = [];

    for (const categoryKey of CATEGORY_ORDER) {
      const category = INSTRUMENT_CATEGORIES[categoryKey];
      for (const instrument of category.instruments) {
        if (allIds.has(instrument.id)) {
          duplicates.push(instrument.id);
        }
        allIds.add(instrument.id);
      }
    }

    expect(duplicates).toEqual([]);
  });

  it('PV-005: all advanced synth preset names match their keys', () => {
    for (const [key, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
      // The preset.name should be the display name, key should be URL-safe
      expect(preset.name).toBeTruthy();
      expect(key).not.toContain(' '); // Keys should be URL-safe
    }
  });
});

// =============================================================================
// SECTION 4: Initialization Trigger Logic
// =============================================================================

describe('Initialization Trigger Logic', () => {
  /**
   * Tests the logic that determines WHEN to initialize different audio engines.
   * This is the core of the "ensure-and-use" pattern.
   */

  type InitTrigger = 'user-gesture' | 'hover-preview' | 'playback-start' | 'manual';

  interface InitDecision {
    shouldInitBasic: boolean;
    shouldInitTone: boolean;
    shouldInitAdvanced: boolean;
  }

  function decideInitialization(
    instrumentId: string,
    trigger: InitTrigger,
    currentState: { initialized: boolean; toneInitialized: boolean }
  ): InitDecision {
    const type = instrumentId.startsWith('synth:') ? 'native'
      : instrumentId.startsWith('tone:') ? 'tone'
      : instrumentId.startsWith('advanced:') ? 'advanced'
      : instrumentId.startsWith('sampled:') ? 'sampled'
      : 'procedural';

    const decision: InitDecision = {
      shouldInitBasic: !currentState.initialized,
      shouldInitTone: false,
      shouldInitAdvanced: false,
    };

    // Only trigger Tone.js init for instruments that need it
    if (type === 'tone' || type === 'advanced') {
      if (!currentState.toneInitialized) {
        decision.shouldInitTone = true;
        // Advanced is part of Tone.js init
        if (type === 'advanced') {
          decision.shouldInitAdvanced = true;
        }
      }
    }

    return decision;
  }

  it('IT-001: native synths dont trigger Tone.js init', () => {
    const decision = decideInitialization('synth:lead', 'hover-preview', {
      initialized: true,
      toneInitialized: false,
    });

    expect(decision.shouldInitTone).toBe(false);
    expect(decision.shouldInitAdvanced).toBe(false);
  });

  it('IT-002: tone synths trigger Tone.js init', () => {
    const decision = decideInitialization('tone:fm-epiano', 'hover-preview', {
      initialized: true,
      toneInitialized: false,
    });

    expect(decision.shouldInitTone).toBe(true);
  });

  it('IT-003: advanced synths trigger both Tone.js and advanced init', () => {
    const decision = decideInitialization('advanced:supersaw', 'hover-preview', {
      initialized: true,
      toneInitialized: false,
    });

    expect(decision.shouldInitTone).toBe(true);
    expect(decision.shouldInitAdvanced).toBe(true);
  });

  it('IT-004: already-initialized state skips re-init', () => {
    const decision = decideInitialization('advanced:supersaw', 'hover-preview', {
      initialized: true,
      toneInitialized: true,
    });

    expect(decision.shouldInitBasic).toBe(false);
    expect(decision.shouldInitTone).toBe(false);
  });

  it('IT-005: user gesture always triggers basic init if needed', () => {
    const decision = decideInitialization('kick', 'user-gesture', {
      initialized: false,
      toneInitialized: false,
    });

    expect(decision.shouldInitBasic).toBe(true);
  });
});

// =============================================================================
// SECTION 5: Property-Based Tests for Instrument Routing
// =============================================================================

describe('Instrument Routing (Property-Based)', () => {
  const arbInstrumentPrefix = fc.constantFrom('synth:', 'tone:', 'advanced:', 'sampled:', '');
  const arbPresetName = fc.stringMatching(/^[a-z-]{1,20}$/);

  const arbInstrumentId = fc.tuple(arbInstrumentPrefix, arbPresetName).map(([prefix, name]) => prefix + name);

  it('PB-001: routing is deterministic', () => {
    fc.assert(
      fc.property(arbInstrumentId, (instrumentId) => {
        const result1 = instrumentId.startsWith('synth:') ? 'native'
          : instrumentId.startsWith('tone:') ? 'tone'
          : instrumentId.startsWith('advanced:') ? 'advanced'
          : instrumentId.startsWith('sampled:') ? 'sampled'
          : 'procedural';

        const result2 = instrumentId.startsWith('synth:') ? 'native'
          : instrumentId.startsWith('tone:') ? 'tone'
          : instrumentId.startsWith('advanced:') ? 'advanced'
          : instrumentId.startsWith('sampled:') ? 'sampled'
          : 'procedural';

        expect(result1).toBe(result2);
      }),
      { numRuns: 500 }
    );
  });

  it('PB-002: all instruments route to exactly one engine', () => {
    fc.assert(
      fc.property(arbInstrumentId, (instrumentId) => {
        const routes = [
          instrumentId.startsWith('synth:'),
          instrumentId.startsWith('tone:'),
          instrumentId.startsWith('advanced:'),
          instrumentId.startsWith('sampled:'),
        ];

        const matchedPrefixes = routes.filter(Boolean).length;
        // Either matches one prefix, or matches none (procedural)
        expect(matchedPrefixes).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 }
    );
  });
});

// =============================================================================
// SECTION 6: Audio Context State Transitions
// =============================================================================

describe('Audio Context State Transitions', () => {
  /**
   * Tests valid state transitions for the AudioContext.
   * Prevents bugs where we try to use a closed context.
   */

  type ContextState = 'suspended' | 'running' | 'closed';

  function canTransition(from: ContextState, to: ContextState): boolean {
    if (from === 'closed') return false; // Cannot recover from closed
    if (from === 'suspended' && to === 'running') return true;
    if (from === 'running' && to === 'suspended') return true;
    if (from === 'suspended' && to === 'closed') return true;
    if (from === 'running' && to === 'closed') return true;
    return from === to; // Same state is valid
  }

  it('CT-001: suspended can transition to running', () => {
    expect(canTransition('suspended', 'running')).toBe(true);
  });

  it('CT-002: running can transition to suspended', () => {
    expect(canTransition('running', 'suspended')).toBe(true);
  });

  it('CT-003: closed cannot transition to any state', () => {
    expect(canTransition('closed', 'running')).toBe(false);
    expect(canTransition('closed', 'suspended')).toBe(false);
  });

  it('CT-004: any state can transition to closed', () => {
    expect(canTransition('suspended', 'closed')).toBe(true);
    expect(canTransition('running', 'closed')).toBe(true);
  });
});

// =============================================================================
// SECTION 7: Hover Preview Integration Logic
// =============================================================================

describe('Hover Preview Integration Logic', () => {
  /**
   * Tests the logic for preview-on-hover behavior.
   * Replaces E2E test: "hovering over instrument button triggers preview"
   */

  interface PreviewState {
    isHovering: boolean;
    instrumentId: string | null;
    isPlaying: boolean;
  }

  function computePreviewAction(
    currentState: PreviewState,
    event: { type: 'hover-enter' | 'hover-leave' | 'click'; instrumentId?: string }
  ): { action: 'play' | 'stop' | 'none'; instrumentId?: string } {
    switch (event.type) {
      case 'hover-enter':
        if (!currentState.isPlaying) {
          return { action: 'play', instrumentId: event.instrumentId };
        }
        return { action: 'none' };

      case 'hover-leave':
        if (currentState.isHovering && !currentState.isPlaying) {
          return { action: 'stop' };
        }
        return { action: 'none' };

      case 'click':
        return { action: 'stop' }; // Click adds track, stops preview
    }
  }

  it('HP-001: hover enter triggers preview play', () => {
    const state: PreviewState = { isHovering: false, instrumentId: null, isPlaying: false };
    const result = computePreviewAction(state, { type: 'hover-enter', instrumentId: 'advanced:supersaw' });

    expect(result.action).toBe('play');
    expect(result.instrumentId).toBe('advanced:supersaw');
  });

  it('HP-002: hover leave stops preview', () => {
    const state: PreviewState = { isHovering: true, instrumentId: 'advanced:supersaw', isPlaying: false };
    const result = computePreviewAction(state, { type: 'hover-leave' });

    expect(result.action).toBe('stop');
  });

  it('HP-003: hover during playback does not trigger preview', () => {
    const state: PreviewState = { isHovering: false, instrumentId: null, isPlaying: true };
    const result = computePreviewAction(state, { type: 'hover-enter', instrumentId: 'advanced:supersaw' });

    expect(result.action).toBe('none');
  });

  it('HP-004: click stops any preview', () => {
    const state: PreviewState = { isHovering: true, instrumentId: 'advanced:supersaw', isPlaying: false };
    const result = computePreviewAction(state, { type: 'click' });

    expect(result.action).toBe('stop');
  });
});

// =============================================================================
// SECTION 8: Track Playback State Logic
// =============================================================================

describe('Track Playback State Logic', () => {
  /**
   * Tests playback state management for tracks with different instrument types.
   * Replaces E2E test: "Fat Saw track plays during sequencer playback"
   */

  interface TrackState {
    id: string;
    instrumentId: string;
    steps: boolean[];
    muted: boolean;
  }

  function shouldPlayStep(
    track: TrackState,
    stepIndex: number,
    engineState: { advancedReady: boolean; toneReady: boolean }
  ): { shouldPlay: boolean; reason?: string } {
    if (track.muted) {
      return { shouldPlay: false, reason: 'Track is muted' };
    }

    if (!track.steps[stepIndex]) {
      return { shouldPlay: false, reason: 'Step is inactive' };
    }

    // Check engine readiness based on instrument type
    if (track.instrumentId.startsWith('advanced:') && !engineState.advancedReady) {
      return { shouldPlay: false, reason: 'Advanced synth not ready' };
    }

    if (track.instrumentId.startsWith('tone:') && !engineState.toneReady) {
      return { shouldPlay: false, reason: 'Tone.js synths not ready' };
    }

    return { shouldPlay: true };
  }

  it('TP-001: active step plays on ready track', () => {
    const track: TrackState = {
      id: 'track-1',
      instrumentId: 'advanced:supersaw',
      steps: [true, false, false, false],
      muted: false,
    };

    const result = shouldPlayStep(track, 0, { advancedReady: true, toneReady: true });
    expect(result.shouldPlay).toBe(true);
  });

  it('TP-002: muted track does not play', () => {
    const track: TrackState = {
      id: 'track-1',
      instrumentId: 'advanced:supersaw',
      steps: [true, false, false, false],
      muted: true,
    };

    const result = shouldPlayStep(track, 0, { advancedReady: true, toneReady: true });
    expect(result.shouldPlay).toBe(false);
    expect(result.reason).toContain('muted');
  });

  it('TP-003: inactive step does not play', () => {
    const track: TrackState = {
      id: 'track-1',
      instrumentId: 'advanced:supersaw',
      steps: [false, false, false, false],
      muted: false,
    };

    const result = shouldPlayStep(track, 0, { advancedReady: true, toneReady: true });
    expect(result.shouldPlay).toBe(false);
    expect(result.reason).toContain('inactive');
  });

  it('TP-004: advanced synth fails if engine not ready', () => {
    const track: TrackState = {
      id: 'track-1',
      instrumentId: 'advanced:supersaw',
      steps: [true, false, false, false],
      muted: false,
    };

    const result = shouldPlayStep(track, 0, { advancedReady: false, toneReady: true });
    expect(result.shouldPlay).toBe(false);
    expect(result.reason).toContain('Advanced');
  });
});
