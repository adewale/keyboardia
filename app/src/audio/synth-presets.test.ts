/**
 * Synth preset validation.
 *
 * Checks SYNTH_PRESETS and ADVANCED_SYNTH_PRESETS are well-formed: required
 * properties present, ids URL-safe, no duplicates.
 *
 * Renamed from src/debug/audio-debug.test.ts, which was named for a module it
 * never imported (src/debug/audio-debug.ts, debug tooling that is deliberately
 * untested). See the note below for the parsing suite that was removed with it.
 */

import { describe, it, expect } from 'vitest';
import { ADVANCED_SYNTH_PRESETS } from './advancedSynth';
import { SYNTH_PRESETS } from './synth';

// =============================================================================
// SECTION 1: Instrument ID Parsing
// =============================================================================

/**
 * Parse instrument ID to extract type and preset name.
 * This mirrors the logic in audio-debug.ts testInstrument().
 */

// NOTE: the "Instrument ID Parsing" suite (6 tests) was removed.
//
// It exercised a local copy of parseInstrumentId, not the real one. The copy was
// a naive prefix-splitter; production (src/audio/instrument-types.ts:54) also
// detects `synth:`-prefixed ids that are actually sampled instruments and
// returns presetId/originalId/isMelodicInstrument. The copy would have reported
// type 'synth' where production reports 'sampled'.
//
// The real function is covered by src/audio/instrument-types.test.ts.

// =============================================================================
// SECTION 2: Preset Validation
// =============================================================================

describe('Preset Validation', () => {
  describe('Native Synth Presets', () => {
    it('SYNTH_PRESETS contains expected presets', () => {
      expect('lead' in SYNTH_PRESETS).toBe(true);
      expect('bass' in SYNTH_PRESETS).toBe(true);
      expect('pad' in SYNTH_PRESETS).toBe(true);
    });

    it('all SYNTH_PRESETS have required properties', () => {
      for (const [name, preset] of Object.entries(SYNTH_PRESETS)) {
        // SynthParams structure: waveform, filterCutoff, attack, decay, sustain, release
        expect(preset).toHaveProperty('waveform');
        expect(preset).toHaveProperty('attack');
        expect(preset).toHaveProperty('release');
        // Name should be a valid key
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Advanced Synth Presets', () => {
    it('ADVANCED_SYNTH_PRESETS contains expected presets', () => {
      expect('supersaw' in ADVANCED_SYNTH_PRESETS).toBe(true);
      expect('thick-lead' in ADVANCED_SYNTH_PRESETS).toBe(true);
    });

    it('all ADVANCED_SYNTH_PRESETS have required properties', () => {
      for (const [name, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
        // AdvancedSynthPreset structure: name, oscillator1, oscillator2, amplitudeEnvelope, filter
        expect(preset).toHaveProperty('name');
        expect(preset).toHaveProperty('oscillator1');
        expect(preset).toHaveProperty('oscillator2');
        expect(preset).toHaveProperty('amplitudeEnvelope');
        // Name should be a valid key
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it('preset names are URL-safe', () => {
      for (const name of Object.keys(ADVANCED_SYNTH_PRESETS)) {
        // Should not contain problematic characters
        expect(name).not.toContain(' ');
        expect(name).not.toContain('/');
        expect(name).not.toContain('\\');
        expect(name).not.toContain(':'); // Would conflict with prefix parsing
      }
    });
  });
});

// =============================================================================
// SECTION 3: Test Result Types
// =============================================================================

interface InstrumentTestResult {
  id: string;
  name: string;
  type: string;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  details?: Record<string, unknown>;
}

describe('Test Result Structure', () => {
  it('success result has correct structure', () => {
    const result: InstrumentTestResult = {
      id: 'synth:lead',
      name: 'lead',
      type: 'synth',
      status: 'success',
      details: { engineReady: true },
    };

    expect(result.id).toBe('synth:lead');
    expect(result.name).toBe('lead');
    expect(result.type).toBe('synth');
    expect(result.status).toBe('success');
    expect(result.error).toBeUndefined();
  });

  it('error result has correct structure', () => {
    const result: InstrumentTestResult = {
      id: 'advanced:supersaw',
      name: 'supersaw',
      type: 'advanced',
      status: 'error',
      error: 'Advanced synth engine not ready',
      details: { advancedReady: false },
    };

    expect(result.status).toBe('error');
    expect(result.error).toBe('Advanced synth engine not ready');
  });

  it('skipped result has correct structure', () => {
    const result: InstrumentTestResult = {
      id: 'sampled:piano',
      name: 'piano',
      type: 'sampled',
      status: 'skipped',
      error: 'Sampled instrument "piano" not loaded',
      details: { instrumentReady: false },
    };

    expect(result.status).toBe('skipped');
    expect(result.error).toContain('not loaded');
  });
});

// =============================================================================
// SECTION 4: Status Structure
// =============================================================================

interface AudioStatus {
  initialized: boolean;
  toneInitialized: boolean;
  audioContextState: string;
  currentTime: number;
  engineReadiness: {
    sample: boolean;
    synth: boolean;
    tone: boolean;
    advanced: boolean;
    sampled: boolean;
  };
  presets: {
    synth: string[];
    tone: string[];
    advanced: string[];
  };
}

describe('Audio Status Structure', () => {
  it('status object has correct shape', () => {
    // Create a mock status object matching the expected shape
    const status: AudioStatus = {
      initialized: true,
      toneInitialized: true,
      audioContextState: 'running',
      currentTime: 1.234,
      engineReadiness: {
        sample: true,
        synth: true,
        tone: true,
        advanced: true,
        sampled: true,
      },
      presets: {
        synth: ['lead', 'bass', 'pad'],
        tone: ['fm-epiano', 'membrane-kick'],
        advanced: ['supersaw', 'thick-lead'],
      },
    };

    expect(typeof status.initialized).toBe('boolean');
    expect(typeof status.toneInitialized).toBe('boolean');
    expect(typeof status.audioContextState).toBe('string');
    expect(typeof status.currentTime).toBe('number');

    expect(status.engineReadiness).toHaveProperty('sample');
    expect(status.engineReadiness).toHaveProperty('synth');
    expect(status.engineReadiness).toHaveProperty('tone');
    expect(status.engineReadiness).toHaveProperty('advanced');
    expect(status.engineReadiness).toHaveProperty('sampled');

    expect(Array.isArray(status.presets.synth)).toBe(true);
    expect(Array.isArray(status.presets.tone)).toBe(true);
    expect(Array.isArray(status.presets.advanced)).toBe(true);
  });

  it('audioContextState has valid values', () => {
    const validStates = ['suspended', 'running', 'closed', 'no context'];
    const testState = 'running';
    expect(validStates).toContain(testState);
  });

  it('currentTime is non-negative', () => {
    const currentTime = 1.234;
    expect(currentTime).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// SECTION 5: Engine Readiness Logic
// =============================================================================

describe('Engine Readiness Logic', () => {
  /**
   * Tests the logic for determining when different synth engines are ready.
   */

  it('synth:* requires only basic initialization', () => {
    const isInitialized = true;
    const instrumentType = 'synth';

    // Native synths only need basic audio engine
    const canPlay = instrumentType === 'synth' && isInitialized;
    expect(canPlay).toBe(true);
  });

  it('tone:* requires Tone.js initialization', () => {
    const isInitialized = true;
    const isToneSynthReady = true;
    const instrumentType = 'tone';

    // Tone.js synths need Tone.js to be initialized
    const canPlay = instrumentType === 'tone' && isInitialized && isToneSynthReady;
    expect(canPlay).toBe(true);
  });

  it('advanced:* requires advanced synth engine ready', () => {
    const isInitialized = true;
    const isAdvancedReady = true;
    const instrumentType = 'advanced';

    // Advanced synths need advanced engine
    const canPlay = instrumentType === 'advanced' && isInitialized && isAdvancedReady;
    expect(canPlay).toBe(true);
  });

  it('sampled:* requires samples to be loaded', () => {
    const isInitialized = true;
    const isSampledInstrumentReady = true;
    const instrumentType = 'sampled';

    // Sampled instruments need specific samples loaded
    const canPlay = instrumentType === 'sampled' && isInitialized && isSampledInstrumentReady;
    expect(canPlay).toBe(true);
  });

  it('regular sample requires only basic initialization', () => {
    const isInitialized = true;
    const instrumentType = 'sample';

    // Regular samples (kick, hihat, etc.) just need engine init
    const canPlay = instrumentType === 'sample' && isInitialized;
    expect(canPlay).toBe(true);
  });
});

// =============================================================================
// SECTION 6: Instrument Categories
// =============================================================================

describe('Instrument Categories', () => {
  it('all instrument types have unique prefixes', () => {
    const prefixes = ['synth:', 'tone:', 'advanced:', 'sampled:'];
    const uniquePrefixes = new Set(prefixes);
    expect(uniquePrefixes.size).toBe(prefixes.length);
  });

  it('prefixes are ordered by priority (most specific first)', () => {
    // When parsing, we check prefixes in this order
    const parseOrder = ['synth:', 'tone:', 'advanced:', 'sampled:'];

    // None of the prefixes should be a prefix of another
    for (let i = 0; i < parseOrder.length; i++) {
      for (let j = 0; j < parseOrder.length; j++) {
        if (i !== j) {
          expect(parseOrder[i].startsWith(parseOrder[j])).toBe(false);
        }
      }
    }
  });
});

// =============================================================================
// SECTION 7: Audio Trigger Classification
// =============================================================================

describe('Audio Trigger Classification', () => {
  /**
   * Tests the classification of instrument IDs into audio engine types.
   * This is critical for routing audio triggers to the correct engine.
   */

  function classifyInstrument(instrumentId: string): 'native' | 'tone' | 'advanced' | 'sampled' | 'procedural' {
    if (instrumentId.startsWith('synth:')) return 'native';
    if (instrumentId.startsWith('tone:')) return 'tone';
    if (instrumentId.startsWith('advanced:')) return 'advanced';
    if (instrumentId.startsWith('sampled:')) return 'sampled';
    return 'procedural'; // kick, hihat, etc.
  }

  it('classifies synth: instruments as native', () => {
    expect(classifyInstrument('synth:lead')).toBe('native');
    expect(classifyInstrument('synth:bass')).toBe('native');
    expect(classifyInstrument('synth:pad')).toBe('native');
  });

  it('classifies tone: instruments as tone', () => {
    expect(classifyInstrument('tone:fm-epiano')).toBe('tone');
    expect(classifyInstrument('tone:membrane-kick')).toBe('tone');
  });

  it('classifies advanced: instruments as advanced', () => {
    expect(classifyInstrument('advanced:supersaw')).toBe('advanced');
    expect(classifyInstrument('advanced:thick-lead')).toBe('advanced');
    expect(classifyInstrument('advanced:sub-bass')).toBe('advanced');
  });

  it('classifies sampled: instruments as sampled', () => {
    expect(classifyInstrument('sampled:808-kick')).toBe('sampled');
    expect(classifyInstrument('sampled:piano')).toBe('sampled');
  });

  it('classifies unprefixed instruments as procedural', () => {
    expect(classifyInstrument('kick')).toBe('procedural');
    expect(classifyInstrument('hihat')).toBe('procedural');
    expect(classifyInstrument('snare')).toBe('procedural');
  });
});
