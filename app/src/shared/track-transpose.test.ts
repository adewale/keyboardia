import { describe, expect, it } from 'vitest';
import { recommendedTrackTranspose } from './track-transpose';
import { INSTRUMENT_GROUPS } from './instrument-catalog';
import { INSTRUMENT_RANGES, getInstrumentRange } from '../audio/instrument-ranges';
import { SCHEDULER_BASE_MIDI_NOTE } from '../audio/constants';
import { MAX_TRANSPOSE, MIN_TRANSPOSE } from './constants';

const C2 = 36;
const C3 = 48;

const catalog = Object.entries(INSTRUMENT_GROUPS).flatMap(([category, group]) =>
  group.instruments.map((instrument) => ({ category, ...instrument })),
);

/** The MIDI note a new track plays for an untouched step (pitch 0). */
function defaultNote(sampleId: string): number {
  return SCHEDULER_BASE_MIDI_NOTE + recommendedTrackTranspose(sampleId);
}

describe('recommendedTrackTranspose', () => {
  it('reads the live catalogue', () => {
    expect(catalog.length).toBeGreaterThan(50);
    expect(catalog.filter((instrument) => instrument.category === 'bass').length).toBeGreaterThan(10);
  });

  it('starts every C4-anchored bass instrument at C3 or lower, inside its playable range', () => {
    // Procedural `sample` voices play pitch 0 at their recorded pitch (A1/E1),
    // so only engines that play pitch 0 at C4 need an offset.
    const basses = catalog.filter(
      (instrument) => instrument.category === 'bass' && instrument.type !== 'sample',
    );
    const tooHigh = basses
      .filter((instrument) => defaultNote(instrument.id) > C3)
      .map((instrument) => instrument.id);
    expect(tooHigh).toEqual([]);

    for (const { id } of basses) {
      const range = getInstrumentRange(id);
      expect(defaultNote(id), id).toBeGreaterThanOrEqual(range.minMidi);
      expect(defaultNote(id), id).toBeLessThanOrEqual(range.maxMidi);
    }
  });

  it('leaves procedural bass samples at their native pitch', () => {
    expect(recommendedTrackTranspose('bass')).toBe(0);
    expect(recommendedTrackTranspose('subbass')).toBe(0);
  });

  it('starts the synthesized kick at C2', () => {
    expect(defaultNote('tone:membrane-kick')).toBe(C2);
  });

  it('puts the default note inside the sweet spot of every instrument with a declared range', () => {
    const outside = catalog.flatMap(({ id }) => {
      const range = INSTRUMENT_RANGES[id];
      if (!range) return [];
      const low = range.optimalMin ?? range.minMidi;
      const high = range.optimalMax ?? range.maxMidi;
      const note = defaultNote(id);
      return note < low || note > high ? [`${id}: ${note} outside [${low}, ${high}]`] : [];
    });
    expect(outside).toEqual([]);
  });

  it('only moves basses and the synthesized kick', () => {
    const moved = catalog
      .filter((instrument) => recommendedTrackTranspose(instrument.id) !== 0)
      .filter((instrument) => instrument.category !== 'bass')
      .map((instrument) => instrument.id);
    expect(moved).toEqual(['tone:membrane-kick']);
  });

  it('returns whole octaves within the transpose control', () => {
    for (const { id } of catalog) {
      const transpose = recommendedTrackTranspose(id);
      expect(Math.abs(transpose % 12), id).toBe(0);
      expect(transpose, id).toBeGreaterThanOrEqual(MIN_TRANSPOSE);
      expect(transpose, id).toBeLessThanOrEqual(MAX_TRANSPOSE);
    }
  });

  it('defaults unknown and user-recorded sources to no transpose', () => {
    expect(recommendedTrackTranspose('recording-123')).toBe(0);
    expect(recommendedTrackTranspose('slice-123-0')).toBe(0);
    expect(recommendedTrackTranspose('not-an-instrument')).toBe(0);
  });
});
