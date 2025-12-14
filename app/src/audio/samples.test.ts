import { describe, it, expect } from 'vitest';
import { ALL_SAMPLES, SAMPLE_CATEGORIES } from '../types';
import { SAMPLE_NAMES } from '../components/sample-constants';

/**
 * These tests ensure sample definitions stay in sync across:
 * - types.ts (SAMPLE_CATEGORIES, ALL_SAMPLES) - source of truth for IDs
 * - samples.ts (createSamples) - actual audio generation
 * - SamplePicker.tsx (SAMPLE_NAMES) - UI display names
 *
 * If you add a new sample, you must update all three locations.
 */
describe('Sample ID parity', () => {
  // Get all sample IDs from types.ts
  const allSampleIds = [...ALL_SAMPLES];

  // Get all category sample IDs flattened
  const categorySampleIds = [
    ...SAMPLE_CATEGORIES.drums,
    ...SAMPLE_CATEGORIES.bass,
    ...SAMPLE_CATEGORIES.synth,
    ...SAMPLE_CATEGORIES.fx,
  ];

  it('ALL_SAMPLES should match SAMPLE_CATEGORIES flattened', () => {
    expect(allSampleIds.sort()).toEqual([...categorySampleIds].sort());
  });

  it('every sample should have a display name in SAMPLE_NAMES', () => {
    const missingNames = allSampleIds.filter(id => !SAMPLE_NAMES[id]);

    expect(missingNames).toEqual([]);

    if (missingNames.length > 0) {
      throw new Error(
        `The following samples are missing display names in SamplePicker.tsx:\n` +
        `  ${missingNames.join(', ')}\n\n` +
        `Add entries to SAMPLE_NAMES for these samples.`
      );
    }
  });

  it('SAMPLE_NAMES should not have extra entries not in ALL_SAMPLES', () => {
    // Filter out synth: prefixed names (those are synth presets, not samples)
    const sampleNameIds = Object.keys(SAMPLE_NAMES).filter(id => !id.startsWith('synth:'));
    const extraNames = sampleNameIds.filter(id => !allSampleIds.includes(id as typeof ALL_SAMPLES[number]));

    expect(extraNames).toEqual([]);

    if (extraNames.length > 0) {
      throw new Error(
        `SAMPLE_NAMES has entries that don't exist in ALL_SAMPLES:\n` +
        `  ${extraNames.join(', ')}\n\n` +
        `Either add these to SAMPLE_CATEGORIES in types.ts or remove from SAMPLE_NAMES.`
      );
    }
  });

  it('should have expected sample count', () => {
    // 8 drums + 2 bass + 4 synth + 2 fx = 16 samples
    expect(allSampleIds.length).toBe(16);
    expect(SAMPLE_CATEGORIES.drums.length).toBe(8);
    expect(SAMPLE_CATEGORIES.bass.length).toBe(2);
    expect(SAMPLE_CATEGORIES.synth.length).toBe(4);
    expect(SAMPLE_CATEGORIES.fx.length).toBe(2);
  });
});
