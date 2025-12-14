import { describe, it, expect } from 'vitest';
import { SYNTH_PRESETS } from '../audio/synth';

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

  it('should not have UI presets that do not exist in the engine', () => {
    const missingFromEngine = uiPresets.filter(preset => !enginePresets.includes(preset));

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
    // Current count: 19 presets (5 core + 4 keys + 6 genre + 4 ambient)
    expect(enginePresets.length).toBe(19);
    expect(uiPresets.length).toBe(19);
  });
});
