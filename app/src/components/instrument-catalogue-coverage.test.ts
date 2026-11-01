import { describe, it, expect } from 'vitest';
import { SYNTH_PRESETS } from '../audio/synth';
import { getSampledInstrumentId } from '../audio/instrument-types';

/**
 * Import the synth categories from sample-constants.
 */
import {
  INSTRUMENT_CATEGORIES,
  CATEGORY_ORDER,
  getInstrumentName,
  VALID_SAMPLE_IDS,
} from './sample-constants';

describe('SamplePicker synth preset coverage', () => {
  // Get all preset keys from the engine
  const enginePresets = Object.keys(SYNTH_PRESETS);

  // Read the picker catalogue production renders, not a parallel test-only table.
  const categories = Object.values(INSTRUMENT_CATEGORIES) as unknown as readonly {
    instruments: readonly { id: string; name: string; type: string }[];
  }[];
  const uiSynths = categories
    .flatMap(category => category.instruments)
    .filter(instrument => instrument.type === 'synth');
  const uiPresets = uiSynths.map(instrument => instrument.id.replace('synth:', ''));

  it('should expose ALL synth engine presets in the UI', () => {
    const missingFromUI = enginePresets.filter(preset => !uiPresets.includes(preset));

    expect(missingFromUI).toEqual([]);

    if (missingFromUI.length > 0) {
      throw new Error(
        `The following synth presets are defined in synth.ts but NOT exposed in SamplePicker.tsx:\n` +
        `  ${missingFromUI.join(', ')}\n\n` +
        `Add them to INSTRUMENT_CATEGORIES in sample-constants.ts`
      );
    }
  });

  it('should not have UI synths that do not exist in the engine', () => {
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
    const missingNames = uiSynths.filter(instrument => !instrument.name.trim());

    expect(missingNames).toEqual([]);

    if (missingNames.length > 0) {
      throw new Error(
        `The following presets are missing display names in SYNTH_NAMES:\n` +
        `  ${missingNames.map(instrument => instrument.id).join(', ')}`
      );
    }
  });

  it('has exactly the same preset IDs in the engine and picker', () => {
    expect(new Set(uiPresets)).toEqual(new Set(enginePresets));
  });
});

/**
 * Phase 23: Mid-playback sampled instrument preloading (Bug #008)
 *
 * When a sampled instrument is selected from the picker, it should be
 * identified for preloading. This test ensures getSampledInstrumentId()
 * correctly identifies sampled instruments in the picker.
 *
 * See: docs/DEBUGGING-LESSONS-LEARNED.md #008
 */
describe('SamplePicker sampled instrument preloading', () => {
  // Collect all instrument IDs from the picker
  const allInstrumentIds = CATEGORY_ORDER.flatMap(categoryKey => {
    const category = INSTRUMENT_CATEGORIES[categoryKey as keyof typeof INSTRUMENT_CATEGORIES];
    return category.instruments.map(i => i.id);
  });

  // Find sampled instruments in the picker
  const sampledInstrumentsInPicker = allInstrumentIds.filter(
    id => getSampledInstrumentId(id) !== null
  );

  it('should correctly identify sampled instruments for preloading', () => {
    // Piano is the main sampled instrument - verify it's correctly identified
    expect(getSampledInstrumentId('synth:piano')).toBe('piano');
    expect(getSampledInstrumentId('sampled:piano')).toBe('piano');
  });

  it('should NOT identify synth presets as sampled instruments', () => {
    // Synths should not trigger preloading
    expect(getSampledInstrumentId('synth:lead')).toBeNull();
    expect(getSampledInstrumentId('synth:pad')).toBeNull();
    expect(getSampledInstrumentId('synth:bass')).toBeNull();
  });

  it('should NOT identify drum samples as sampled instruments', () => {
    // Regular samples should not trigger preloading
    expect(getSampledInstrumentId('kick')).toBeNull();
    expect(getSampledInstrumentId('snare')).toBeNull();
    expect(getSampledInstrumentId('hihat')).toBeNull();
  });

  it('should have at least one sampled instrument in the picker', () => {
    // Sanity check - we should have sampled instruments available
    expect(sampledInstrumentsInPicker.length).toBeGreaterThan(0);
  });

  it('should include piano in the picker as a sampled instrument', () => {
    // Piano should be available and identified as sampled
    const pianoIds = sampledInstrumentsInPicker.filter(
      id => getSampledInstrumentId(id) === 'piano'
    );
    expect(pianoIds.length).toBeGreaterThan(0);
  });

  it('does not offer quarantined sampled instruments for new tracks but preserves legacy parsing', () => {
    expect(allInstrumentIds).not.toContain('sampled:rhodes-ep');
    expect(allInstrumentIds).not.toContain('synth:rhodes-ep');
    expect(getSampledInstrumentId('sampled:rhodes-ep')).toBe('rhodes-ep');
    expect(getSampledInstrumentId('synth:rhodes-ep')).toBe('rhodes-ep');
    expect(VALID_SAMPLE_IDS.has('sampled:rhodes-ep')).toBe(false);
    expect(VALID_SAMPLE_IDS.has('synth:rhodes-ep')).toBe(false);
    expect(getInstrumentName('sampled:rhodes-ep')).toContain('choose synth:rhodes');
    expect(allInstrumentIds).toContain('synth:rhodes');
  });
});
