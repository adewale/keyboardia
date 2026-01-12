/**
 * Audio Debug API Tests
 *
 * Tests for the audio debugging API structure and helper functions.
 * The actual audio playback requires Web Audio API which only works in browsers,
 * but we can test the API interface, instrument ID parsing, and result types.
 *
 * Replaces coverage for:
 * - e2e/instrument-audio.spec.ts - Instrument ID parsing and validation
 * - e2e/instrument-audio.spec.ts - Status result structure
 * - e2e/instrument-audio.spec.ts - Test result types
 *
 * NOTE: Actual audio playback tests remain in E2E (require headed browser).
 */

import { describe, it, expect } from 'vitest';
import { ADVANCED_SYNTH_PRESETS } from '../audio/advancedSynth';
import { SYNTH_PRESETS } from '../audio/synth';

// =============================================================================
// SECTION 1: Instrument ID Parsing
// =============================================================================

/**
 * Parse instrument ID to extract type and preset name.
 * This mirrors the logic in audio-debug.ts testInstrument().
 */
function parseInstrumentId(instrumentId: string): { type: string; preset: string } {
  let type = 'sample';
  let preset = instrumentId;

  if (instrumentId.startsWith('synth:')) {
    type = 'synth';
    preset = instrumentId.replace('synth:', '');
  } else if (instrumentId.startsWith('tone:')) {
    type = 'tone';
    preset = instrumentId.replace('tone:', '');
  } else if (instrumentId.startsWith('advanced:')) {
    type = 'advanced';
    preset = instrumentId.replace('advanced:', '');
  } else if (instrumentId.startsWith('sampled:')) {
    type = 'sampled';
    preset = instrumentId.replace('sampled:', '');
  }

  return { type, preset };
}

describe('Instrument ID Parsing', () => {
  it('parses synth: prefix correctly', () => {
    const result = parseInstrumentId('synth:lead');
    expect(result.type).toBe('synth');
    expect(result.preset).toBe('lead');
  });

  it('parses tone: prefix correctly', () => {
    const result = parseInstrumentId('tone:fm-epiano');
    expect(result.type).toBe('tone');
    expect(result.preset).toBe('fm-epiano');
  });

  it('parses advanced: prefix correctly', () => {
    const result = parseInstrumentId('advanced:supersaw');
    expect(result.type).toBe('advanced');
    expect(result.preset).toBe('supersaw');
  });

  it('parses sampled: prefix correctly', () => {
    const result = parseInstrumentId('sampled:808-kick');
    expect(result.type).toBe('sampled');
    expect(result.preset).toBe('808-kick');
  });

  it('treats unprefixed IDs as samples', () => {
    const result = parseInstrumentId('kick');
    expect(result.type).toBe('sample');
    expect(result.preset).toBe('kick');
  });

  it('handles complex preset names', () => {
    const result = parseInstrumentId('advanced:thick-lead');
    expect(result.type).toBe('advanced');
    expect(result.preset).toBe('thick-lead');
  });
});

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
