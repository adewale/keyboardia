import { describe, it, expect } from 'vitest';
import { SYNTH_PRESETS } from '../audio/synth';
import { isSampledInstrument } from '../audio/sampled-instrument';

/**
 * Import the synth categories from sample-constants.
 */
import { SYNTH_CATEGORIES, SYNTH_NAMES } from './sample-constants';

describe('SamplePicker synth preset coverage', () => {
  // Get all preset keys from the engine
  const enginePresets = Object.keys(SYNTH_PRESETS);

  // Get all presets exposed in the UI (flattened from categories)
  const uiPresets = Object.values(SYNTH_CATEGORIES)
    .flat()
    .map(id => id.replace('synth:', ''));

  // Filter out sampled instruments (like piano) which don't need SYNTH_PRESETS entries
  const synthOnlyUiPresets = uiPresets.filter(preset => !isSampledInstrument(preset));

  it('should expose ALL synth engine presets in the UI', () => {
    const missingFromUI = enginePresets.filter(preset => !uiPresets.includes(preset));

    expect(missingFromUI).toEqual([]);

    if (missingFromUI.length > 0) {
      throw new Error(
        `The following synth presets are defined in synth.ts but NOT exposed in SamplePicker.tsx:\n` +
        `  ${missingFromUI.join(', ')}\n\n` +
        `Add them to SYNTH_CATEGORIES in SamplePicker.tsx`
      );
    }
  });

  it('should not have UI presets that do not exist in the engine (except sampled instruments)', () => {
    // Sampled instruments (like piano) don't need SYNTH_PRESETS entries - they use samples
    const missingFromEngine = synthOnlyUiPresets.filter(preset => !enginePresets.includes(preset));

    expect(missingFromEngine).toEqual([]);

    if (missingFromEngine.length > 0) {
      throw new Error(
        `The following presets are in SamplePicker.tsx but NOT defined in synth.ts:\n` +
        `  ${missingFromEngine.join(', ')}\n\n` +
        `Either add them to SYNTH_PRESETS in synth.ts or remove them from SamplePicker.tsx`
      );
    }
  });

  it('should have display names for all UI presets', () => {
    const allUiPresetIds = Object.values(SYNTH_CATEGORIES).flat();
    const missingNames = allUiPresetIds.filter(id => !SYNTH_NAMES[id]);

    expect(missingNames).toEqual([]);

    if (missingNames.length > 0) {
      throw new Error(
        `The following presets are missing display names in SYNTH_NAMES:\n` +
        `  ${missingNames.join(', ')}`
      );
    }
  });

  it('should have correct preset count (sanity check)', () => {
    // If someone adds presets, this test reminds them to verify UI coverage
    // Phase 22: 32 synth presets (5 core + 7 keys + 6 genre + 8 ambient + 4 electronic + 2 bass)
    // NOTE: Sampled instruments (piano) are now in SAMPLED_CATEGORIES, not SYNTH_CATEGORIES
    expect(enginePresets.length).toBe(32);
    expect(synthOnlyUiPresets.length).toBe(32);
    expect(uiPresets.length).toBe(32); // synths only, sampled instruments are in SAMPLED_CATEGORIES
  });
});
