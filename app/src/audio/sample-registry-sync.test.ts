import { describe, it, expect } from 'vitest';

// Source of truth imports from audio engine
import { SAMPLED_INSTRUMENTS } from './sampled-instrument';
import { SYNTH_PRESETS } from './synth';
import { TONE_SYNTH_PRESETS } from './toneSynths';
import { ADVANCED_SYNTH_PRESETS } from './advancedSynth';

// UI constants that should stay in sync
import {
  VALID_SAMPLE_IDS,
  INSTRUMENT_CATEGORIES,
} from '../components/sample-constants';

/**
 * Sample Registry Synchronization Tests
 *
 * These tests ensure that the UI's VALID_SAMPLE_IDS and INSTRUMENT_CATEGORIES
 * stay in sync with the actual audio engine's instrument definitions.
 *
 * BACKGROUND: The session-api.ts CLI tool previously maintained a hardcoded
 * list of valid sample IDs that got out of sync with the actual instruments.
 * This caused validation failures for valid samples like 'sampled:steel-drums'.
 *
 * These tests verify:
 * 1. All audio engine instruments are represented in the UI catalog
 * 2. All UI catalog entries have corresponding audio engine definitions
 * 3. Naming conventions are consistent (prefixes match types)
 *
 * @see scripts/session-api.ts - Uses VALID_SAMPLE_IDS for validation
 * @see src/components/sample-constants.ts - Source of truth for UI
 */

// Procedural samples defined in samples.ts (synthesized at runtime)
const PROCEDURAL_SAMPLES = [
  'kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat',
  'shaker', 'conga', 'tambourine', 'clave', 'cabasa', 'woodblock',
  'bass', 'subbass',
  'lead', 'pluck', 'chord', 'pad',
  'zap', 'noise',
] as const;

describe('Sample Registry Synchronization', () => {
  describe('Sampled Instruments (sampled:*)', () => {
    it('all SAMPLED_INSTRUMENTS are in VALID_SAMPLE_IDS', () => {
      const missing: string[] = [];

      for (const instrumentId of SAMPLED_INSTRUMENTS) {
        const prefixedId = `sampled:${instrumentId}`;
        if (!VALID_SAMPLE_IDS.has(prefixedId)) {
          missing.push(prefixedId);
        }
      }

      expect(missing).toEqual([]);
    });

    it('all sampled:* entries in VALID_SAMPLE_IDS exist in SAMPLED_INSTRUMENTS', () => {
      const orphaned: string[] = [];

      for (const sampleId of VALID_SAMPLE_IDS) {
        if (sampleId.startsWith('sampled:')) {
          const instrumentId = sampleId.replace('sampled:', '');
          if (!SAMPLED_INSTRUMENTS.includes(instrumentId as typeof SAMPLED_INSTRUMENTS[number])) {
            orphaned.push(sampleId);
          }
        }
      }

      expect(orphaned).toEqual([]);
    });

    it('SAMPLED_INSTRUMENTS count matches sampled:* entries in VALID_SAMPLE_IDS', () => {
      const sampledInValidIds = Array.from(VALID_SAMPLE_IDS).filter(id => id.startsWith('sampled:'));
      expect(sampledInValidIds.length).toBe(SAMPLED_INSTRUMENTS.length);
    });
  });

  describe('Synth Presets (synth:*)', () => {
    it('all SYNTH_PRESETS are in VALID_SAMPLE_IDS', () => {
      const missing: string[] = [];

      for (const presetId of Object.keys(SYNTH_PRESETS)) {
        const prefixedId = `synth:${presetId}`;
        if (!VALID_SAMPLE_IDS.has(prefixedId)) {
          missing.push(prefixedId);
        }
      }

      expect(missing).toEqual([]);
    });

    it('all synth:* entries in VALID_SAMPLE_IDS exist in SYNTH_PRESETS', () => {
      const orphaned: string[] = [];

      for (const sampleId of VALID_SAMPLE_IDS) {
        if (sampleId.startsWith('synth:')) {
          const presetId = sampleId.replace('synth:', '');
          if (!(presetId in SYNTH_PRESETS)) {
            orphaned.push(sampleId);
          }
        }
      }

      expect(orphaned).toEqual([]);
    });
  });

  describe('Tone.js Synths (tone:*)', () => {
    it('all TONE_SYNTH_PRESETS are in VALID_SAMPLE_IDS', () => {
      const missing: string[] = [];

      for (const presetId of Object.keys(TONE_SYNTH_PRESETS)) {
        const prefixedId = `tone:${presetId}`;
        if (!VALID_SAMPLE_IDS.has(prefixedId)) {
          missing.push(prefixedId);
        }
      }

      expect(missing).toEqual([]);
    });

    it('all tone:* entries in VALID_SAMPLE_IDS exist in TONE_SYNTH_PRESETS', () => {
      const orphaned: string[] = [];

      for (const sampleId of VALID_SAMPLE_IDS) {
        if (sampleId.startsWith('tone:')) {
          const presetId = sampleId.replace('tone:', '');
          if (!(presetId in TONE_SYNTH_PRESETS)) {
            orphaned.push(sampleId);
          }
        }
      }

      expect(orphaned).toEqual([]);
    });

    it('TONE_SYNTH_PRESETS count matches tone:* entries in VALID_SAMPLE_IDS', () => {
      const toneInValidIds = Array.from(VALID_SAMPLE_IDS).filter(id => id.startsWith('tone:'));
      expect(toneInValidIds.length).toBe(Object.keys(TONE_SYNTH_PRESETS).length);
    });
  });

  describe('Advanced Synths (advanced:*)', () => {
    it('all ADVANCED_SYNTH_PRESETS are in VALID_SAMPLE_IDS', () => {
      const missing: string[] = [];

      for (const presetId of Object.keys(ADVANCED_SYNTH_PRESETS)) {
        const prefixedId = `advanced:${presetId}`;
        if (!VALID_SAMPLE_IDS.has(prefixedId)) {
          missing.push(prefixedId);
        }
      }

      expect(missing).toEqual([]);
    });

    it('all advanced:* entries in VALID_SAMPLE_IDS exist in ADVANCED_SYNTH_PRESETS', () => {
      const orphaned: string[] = [];

      for (const sampleId of VALID_SAMPLE_IDS) {
        if (sampleId.startsWith('advanced:')) {
          const presetId = sampleId.replace('advanced:', '');
          if (!(presetId in ADVANCED_SYNTH_PRESETS)) {
            orphaned.push(sampleId);
          }
        }
      }

      expect(orphaned).toEqual([]);
    });

    it('ADVANCED_SYNTH_PRESETS count matches advanced:* entries in VALID_SAMPLE_IDS', () => {
      const advancedInValidIds = Array.from(VALID_SAMPLE_IDS).filter(id => id.startsWith('advanced:'));
      expect(advancedInValidIds.length).toBe(Object.keys(ADVANCED_SYNTH_PRESETS).length);
    });
  });

  describe('Procedural Samples (no prefix)', () => {
    it('all procedural samples are in VALID_SAMPLE_IDS', () => {
      const missing: string[] = [];

      for (const sampleId of PROCEDURAL_SAMPLES) {
        if (!VALID_SAMPLE_IDS.has(sampleId)) {
          missing.push(sampleId);
        }
      }

      expect(missing).toEqual([]);
    });

    it('no phantom procedural samples in VALID_SAMPLE_IDS', () => {
      // Get all non-prefixed entries from VALID_SAMPLE_IDS
      const nonPrefixedIds = Array.from(VALID_SAMPLE_IDS).filter(id =>
        !id.startsWith('sampled:') &&
        !id.startsWith('synth:') &&
        !id.startsWith('tone:') &&
        !id.startsWith('advanced:')
      );

      const orphaned = nonPrefixedIds.filter(id =>
        !PROCEDURAL_SAMPLES.includes(id as typeof PROCEDURAL_SAMPLES[number])
      );

      expect(orphaned).toEqual([]);
    });
  });

  describe('INSTRUMENT_CATEGORIES completeness', () => {
    it('all VALID_SAMPLE_IDS are in some INSTRUMENT_CATEGORIES', () => {
      const allCategoryIds = new Set<string>();

      for (const category of Object.values(INSTRUMENT_CATEGORIES)) {
        for (const instrument of category.instruments) {
          allCategoryIds.add(instrument.id);
        }
      }

      const missing: string[] = [];
      for (const sampleId of VALID_SAMPLE_IDS) {
        if (!allCategoryIds.has(sampleId)) {
          missing.push(sampleId);
        }
      }

      expect(missing).toEqual([]);
    });

    it('all INSTRUMENT_CATEGORIES entries are in VALID_SAMPLE_IDS', () => {
      const orphaned: string[] = [];

      for (const category of Object.values(INSTRUMENT_CATEGORIES)) {
        for (const instrument of category.instruments) {
          if (!VALID_SAMPLE_IDS.has(instrument.id)) {
            orphaned.push(instrument.id);
          }
        }
      }

      expect(orphaned).toEqual([]);
    });

    it('INSTRUMENT_CATEGORIES total count matches VALID_SAMPLE_IDS size', () => {
      let categoryCount = 0;
      for (const category of Object.values(INSTRUMENT_CATEGORIES)) {
        categoryCount += category.instruments.length;
      }

      expect(categoryCount).toBe(VALID_SAMPLE_IDS.size);
    });
  });

  describe('Naming Convention Enforcement', () => {
    it('all sampled instruments use sampled: prefix in VALID_SAMPLE_IDS', () => {
      for (const instrumentId of SAMPLED_INSTRUMENTS) {
        // Should NOT exist without prefix
        expect(VALID_SAMPLE_IDS.has(instrumentId)).toBe(false);
        // Should exist with prefix
        expect(VALID_SAMPLE_IDS.has(`sampled:${instrumentId}`)).toBe(true);
      }
    });

    it('all synth presets use synth: prefix in VALID_SAMPLE_IDS', () => {
      // Some synth preset names intentionally overlap with procedural samples
      // (e.g., 'bass', 'lead', 'pad', 'pluck' exist as both)
      const intentionalOverlaps = new Set(PROCEDURAL_SAMPLES);

      for (const presetId of Object.keys(SYNTH_PRESETS)) {
        // Synth version with prefix should always exist
        expect(VALID_SAMPLE_IDS.has(`synth:${presetId}`)).toBe(true);

        // Non-prefixed version should only exist if it's a procedural sample
        if (VALID_SAMPLE_IDS.has(presetId)) {
          expect(intentionalOverlaps.has(presetId as typeof PROCEDURAL_SAMPLES[number])).toBe(true);
        }
      }
    });

    it('no duplicate IDs across categories', () => {
      const allIds: string[] = [];

      for (const category of Object.values(INSTRUMENT_CATEGORIES)) {
        for (const instrument of category.instruments) {
          allIds.push(instrument.id);
        }
      }

      const uniqueIds = new Set(allIds);
      expect(allIds.length).toBe(uniqueIds.size);
    });
  });

  describe('Count Verification', () => {
    it('total instrument count is documented', () => {
      // This test documents the current count and will fail if counts change
      // Update this test when adding new instruments
      expect(SAMPLED_INSTRUMENTS.length).toBe(27);
      expect(Object.keys(SYNTH_PRESETS).length).toBeGreaterThanOrEqual(19);
      expect(Object.keys(TONE_SYNTH_PRESETS).length).toBe(11);
      expect(Object.keys(ADVANCED_SYNTH_PRESETS).length).toBe(8);
      expect(PROCEDURAL_SAMPLES.length).toBe(22);

      // Total should be sum of all sources
      // Note: This is a sanity check, exact count may vary
      expect(VALID_SAMPLE_IDS.size).toBeGreaterThanOrEqual(80);
    });
  });
});
