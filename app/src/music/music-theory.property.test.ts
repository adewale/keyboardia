import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NOTE_NAMES,
  SCALES,
  getRootIndex,
  getScaleNotes,
  getTransposedRoot,
  isInScale,
  pitchToNoteName,
  type ScaleId,
} from './music-theory';

const noteName = fc.constantFrom(...NOTE_NAMES);
const scaleId = fc.constantFrom(...Object.keys(SCALES) as ScaleId[]);

describe('music-theory production properties', () => {
  it('scale membership is periodic across octaves', () => {
    fc.assert(fc.property(
      fc.integer({ min: -96, max: 96 }),
      fc.integer({ min: -8, max: 8 }),
      noteName,
      scaleId,
      (pitch, octaves, root, scale) => {
        expect(isInScale(pitch + octaves * 12, root, scale))
          .toBe(isInScale(pitch, root, scale));
      },
    ));
  });

  it('every declared scale contains its root exactly once', () => {
    fc.assert(fc.property(noteName, scaleId, (root, scale) => {
      const notes = getScaleNotes(getRootIndex(root), scale);
      expect(notes).toContain(getRootIndex(root));
      expect(new Set(notes).size).toBe(notes.length);
    }));
  });

  it('transposition composes and reverses modulo twelve', () => {
    fc.assert(fc.property(
      noteName,
      fc.integer({ min: -48, max: 48 }),
      fc.integer({ min: -48, max: 48 }),
      (root, first, second) => {
        const composed = getTransposedRoot(getTransposedRoot(root, first), second);
        expect(composed).toBe(getTransposedRoot(root, first + second));
        expect(getTransposedRoot(getTransposedRoot(root, first), -first)).toBe(root);
      },
    ));
  });

  it('formats scientific-pitch octave boundaries correctly', () => {
    expect(pitchToNoteName(-1)).toBe('B3');
    expect(pitchToNoteName(0)).toBe('C4');
    expect(pitchToNoteName(11)).toBe('B4');
    expect(pitchToNoteName(12)).toBe('C5');
  });
});
