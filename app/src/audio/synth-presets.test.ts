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
