import { describe, it, expect } from 'vitest';
import { ALL_SAMPLES, SAMPLE_CATEGORIES } from '../types';
import { SAMPLE_NAMES } from '../components/SamplePicker';

/**
 * These tests ensure sample definitions stay in sync across:
 * - types.ts (SAMPLE_CATEGORIES, ALL_SAMPLES) - source of truth for IDs
 * - samples.ts (createSamples) - actual audio generation
 * - SamplePicker.tsx (SAMPLE_NAMES) - UI display names
 *
 * Note: Melodic sounds (bass, lead, pad, etc.) were moved to synth presets.
 * SAMPLE_CATEGORIES now only contains one-shot samples: drums and FX.
 */
describe('Sample ID parity', () => {
  // Get all sample IDs from types.ts
  const allSampleIds = [...ALL_SAMPLES];

  // Get all category sample IDs flattened
  const categorySampleIds = [
    ...SAMPLE_CATEGORIES.drums,
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
    // 8 drums + 2 fx = 10 one-shot samples
    // (melodic sounds like bass, lead, pad are now synth presets)
    expect(allSampleIds.length).toBe(10);
    expect(SAMPLE_CATEGORIES.drums.length).toBe(8);
    expect(SAMPLE_CATEGORIES.fx.length).toBe(2);
  });
});
