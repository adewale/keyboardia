import { beforeAll, describe, it, expect } from 'vitest';
import { INSTRUMENT_CATEGORIES } from '../components/sample-constants';
import { FakeAudioContext } from './__fakes__/FakeWebAudio';
import { createSynthesizedSamples } from './samples';

/**
 * Phase 23: Percussion Expansion Tests
 *
 * Tests for the 6 World/Latin percussion samples:
 * - shaker: High-frequency filtered noise burst
 * - conga: Pitched membrane with slap transient
 * - tambourine: Metallic jingles + noise
 * - clave: Two-tone wooden click
 * - cabasa: Ultra-short noise burst
 * - woodblock: Resonant filtered click
 *
 * NOTE: Audio buffer generation and ADSR envelope tests are now in
 * src/audio/synthesis.test.ts, which tests ALL 22 instruments using
 * pure synthesis functions that don't require AudioContext.
 *
 * See: specs/ROADMAP.md Phase 23
 * See: specs/research/INSTRUMENT-EXPANSION.md
 */

// The 6 new percussion samples from Phase 23
const PHASE_23_PERCUSSION = ['shaker', 'conga', 'tambourine', 'clave', 'cabasa', 'woodblock'] as const;

describe('Phase 23: Percussion Expansion', () => {
  let synthesizedSampleIds: Set<string>;

  beforeAll(async () => {
    const samples = await createSynthesizedSamples(new FakeAudioContext().asAudioContext());
    synthesizedSampleIds = new Set(samples.keys());
  });

  describe('Sample ID Registration', () => {
    it('synthesizes all 6 percussion samples', () => {
      for (const sample of PHASE_23_PERCUSSION) {
        expect(synthesizedSampleIds.has(sample), `${sample} was not synthesized`).toBe(true);
      }
    });

    it('should have display names for all 6 percussion samples', () => {
      for (const sample of PHASE_23_PERCUSSION) {
        const instrument = INSTRUMENT_CATEGORIES.drums.instruments.find(item => item.id === sample);
        expect(instrument?.name.trim()).toBeTruthy();
      }
    });
  });

  describe('UI Registration', () => {
    // Get all drum instruments from the UI
    const drumInstruments = INSTRUMENT_CATEGORIES.drums.instruments.map(i => i.id);

    it('should have all 6 percussion samples in SamplePicker drums category', () => {
      for (const sample of PHASE_23_PERCUSSION) {
        expect(drumInstruments).toContain(sample);
      }
    });

    it('should have correct type for all percussion samples', () => {
      for (const sample of PHASE_23_PERCUSSION) {
        const instrument = INSTRUMENT_CATEGORIES.drums.instruments.find(i => i.id === sample);
        expect(instrument?.type).toBe('sample');
      }
    });
  });

});
