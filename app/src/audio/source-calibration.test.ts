import { describe, expect, it } from 'vitest';
import { INSTRUMENT_GROUPS } from '../shared/instrument-catalog';
import { ADVANCED_SYNTH_PRESETS } from './advancedSynth';
import { SYNTH_PRESETS } from './synth';
import {
  ADVANCED_SOURCE_GAIN_DB,
  SYNTH_SOURCE_GAIN_DB,
  TONE_SOURCE_GAIN_DB,
  getSourceCalibration,
} from './source-calibration';
import { TONE_SYNTH_PRESETS } from './toneSynths';

describe('catalogue-wide source calibration', () => {
  it('covers every selectable instrument without arrangement-aware rules', () => {
    const ids = Object.values(INSTRUMENT_GROUPS).flatMap(group => group.instruments.map(instrument => instrument.id));
    expect(ids).toHaveLength(99);
    expect(ids.map(id => [id, getSourceCalibration(id)]).filter(([, calibration]) => calibration === null)).toEqual([]);
  });

  it('has exact preset-table coverage for every synthesis engine', () => {
    expect(Object.keys(SYNTH_SOURCE_GAIN_DB).sort()).toEqual(Object.keys(SYNTH_PRESETS).sort());
    expect(Object.keys(TONE_SOURCE_GAIN_DB).sort()).toEqual(Object.keys(TONE_SYNTH_PRESETS).sort());
    expect(Object.keys(ADVANCED_SOURCE_GAIN_DB).sort()).toEqual(Object.keys(ADVANCED_SYNTH_PRESETS).sort());
  });

  it('contains only fixed finite attenuation/trim values', () => {
    for (const table of [SYNTH_SOURCE_GAIN_DB, TONE_SOURCE_GAIN_DB, ADVANCED_SOURCE_GAIN_DB]) {
      expect(Object.values(table).every(gainDb => Number.isFinite(gainDb) && gainDb <= 0 && gainDb >= -18)).toBe(true);
    }
  });
});
