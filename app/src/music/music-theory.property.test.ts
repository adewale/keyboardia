/**
 * Property-Based Tests for Music Theory Module
 *
 * Tests mathematical invariants of scale calculations and pitch manipulation.
 * These properties ensure correctness across the full range of inputs.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  getScaleNotes,
  getRootIndex,
  isInScale,
  getScaleDegree,
  isRoot,
  isFifth,
  snapToScale,
  getTransposedRoot,
  SCALES,
  NOTE_NAMES,
  type ScaleId,
  type NoteName,
} from './music-theory';
import { arbNoteName, arbScaleId, arbPitch, arbPlayablePitch } from '../test/arbitraries';

describe('music-theory - Property-Based Tests', () => {
  // ===========================================================================
  // Scale Notes Properties
  // ===========================================================================

  describe('getScaleNotes', () => {
    it('MT-001: all returned notes are in range 0-11', () => {
      fc.assert(
        fc.property(arbNoteName, arbScaleId, (root, scaleId) => {
          const rootIndex = getRootIndex(root);
          const notes = getScaleNotes(rootIndex, scaleId);

          for (const note of notes) {
            expect(note).toBeGreaterThanOrEqual(0);
            expect(note).toBeLessThan(12);
          }
        }),
        { numRuns: 500 }
      );
    });

    it('scale notes count matches scale definition', () => {
      fc.assert(
        fc.property(arbNoteName, arbScaleId, (root, scaleId) => {
          const rootIndex = getRootIndex(root);
          const notes = getScaleNotes(rootIndex, scaleId);
          const scale = SCALES[scaleId];

          expect(notes.length).toBe(scale.intervals.length);
        }),
        { numRuns: 500 }
      );
    });

    it('scale notes are unique', () => {
      fc.assert(
        fc.property(arbNoteName, arbScaleId, (root, scaleId) => {
          const rootIndex = getRootIndex(root);
          const notes = getScaleNotes(rootIndex, scaleId);

          const uniqueNotes = new Set(notes);
          expect(uniqueNotes.size).toBe(notes.length);
        }),
        { numRuns: 500 }
      );
    });

    it('root note is always first in scale', () => {
      fc.assert(
        fc.property(arbNoteName, arbScaleId, (root, scaleId) => {
          const rootIndex = getRootIndex(root);
          const notes = getScaleNotes(rootIndex, scaleId);

          expect(notes[0]).toBe(rootIndex);
        }),
        { numRuns: 500 }
      );
    });

    it('transposing root by scale intervals produces scale notes', () => {
      fc.assert(
        fc.property(arbNoteName, arbScaleId, (root, scaleId) => {
          const rootIndex = getRootIndex(root);
          const notes = getScaleNotes(rootIndex, scaleId);
          const scale = SCALES[scaleId];

          for (let i = 0; i < scale.intervals.length; i++) {
            expect(notes[i]).toBe((rootIndex + scale.intervals[i]) % 12);
          }
        }),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // isInScale Properties
  // ===========================================================================

  describe('isInScale', () => {
    it('MT-002: isInScale is consistent with getScaleNotes', () => {
      fc.assert(
        fc.property(arbPitch, arbNoteName, arbScaleId, (pitch, root, scaleId) => {
          const rootIndex = getRootIndex(root);
          const scaleNotes = getScaleNotes(rootIndex, scaleId);
          const normalizedPitch = ((pitch % 12) + 12) % 12;

          const inScaleResult = isInScale(pitch, root, scaleId);
          const inScaleNotes = scaleNotes.includes(normalizedPitch);

          expect(inScaleResult).toBe(inScaleNotes);
        }),
        { numRuns: 1000 }
      );
    });

    it('negative pitches are handled correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -120, max: -1 }),
          arbNoteName,
          arbScaleId,
          (pitch, root, scaleId) => {
            const result = isInScale(pitch, root, scaleId);
            expect(typeof result).toBe('boolean');

            // Normalize and check consistency
            const normalizedPitch = ((pitch % 12) + 12) % 12;
            const positivePitch = normalizedPitch;
            expect(isInScale(pitch, root, scaleId)).toBe(isInScale(positivePitch, root, scaleId));
          }
        ),
        { numRuns: 500 }
      );
    });

    it('octave equivalence: pitch and pitch+12 have same result', () => {
      fc.assert(
        fc.property(arbPlayablePitch, arbNoteName, arbScaleId, (pitch, root, scaleId) => {
          expect(isInScale(pitch, root, scaleId)).toBe(isInScale(pitch + 12, root, scaleId));
          expect(isInScale(pitch, root, scaleId)).toBe(isInScale(pitch - 12, root, scaleId));
        }),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // getScaleDegree Properties
  // ===========================================================================

  describe('getScaleDegree', () => {
    it('degree is undefined for pitches not in scale', () => {
      fc.assert(
        fc.property(arbPitch, arbNoteName, arbScaleId, (pitch, root, scaleId) => {
          const inScale = isInScale(pitch, root, scaleId);
          const degree = getScaleDegree(pitch, root, scaleId);

          if (!inScale) {
            expect(degree).toBeUndefined();
          } else {
            expect(degree).toBeDefined();
          }
        }),
        { numRuns: 500 }
      );
    });

    it('degree is in valid range when defined', () => {
      fc.assert(
        fc.property(arbPitch, arbNoteName, arbScaleId, (pitch, root, scaleId) => {
          const degree = getScaleDegree(pitch, root, scaleId);
          const scale = SCALES[scaleId];

          if (degree !== undefined) {
            expect(degree).toBeGreaterThanOrEqual(1);
            expect(degree).toBeLessThanOrEqual(scale.intervals.length);
          }
        }),
        { numRuns: 500 }
      );
    });

    it('root note always has degree 1', () => {
      fc.assert(
        fc.property(
          arbNoteName,
          arbScaleId,
          fc.integer({ min: -5, max: 5 }),
          (root, scaleId, octaveOffset) => {
            const rootIndex = getRootIndex(root);
            const pitch = rootIndex + octaveOffset * 12;
            const degree = getScaleDegree(pitch, root, scaleId);

            expect(degree).toBe(1);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // isRoot / isFifth Properties
  // ===========================================================================

  describe('isRoot', () => {
    it('root note at any octave returns true', () => {
      fc.assert(
        fc.property(arbNoteName, fc.integer({ min: -5, max: 5 }), (root, octave) => {
          const rootIndex = getRootIndex(root);
          const pitch = rootIndex + octave * 12;

          expect(isRoot(pitch, root)).toBe(true);
        }),
        { numRuns: 500 }
      );
    });

    it('non-root notes return false', () => {
      fc.assert(
        fc.property(
          arbNoteName,
          fc.integer({ min: 1, max: 11 }),
          fc.integer({ min: -5, max: 5 }),
          (root, offset, octave) => {
            const rootIndex = getRootIndex(root);
            const pitch = rootIndex + offset + octave * 12;

            expect(isRoot(pitch, root)).toBe(false);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('isFifth', () => {
    it('fifth (7 semitones up) at any octave returns true', () => {
      fc.assert(
        fc.property(arbNoteName, fc.integer({ min: -5, max: 5 }), (root, octave) => {
          const rootIndex = getRootIndex(root);
          const fifthPitch = rootIndex + 7 + octave * 12;

          expect(isFifth(fifthPitch, root)).toBe(true);
        }),
        { numRuns: 500 }
      );
    });

    it('root note is not the fifth', () => {
      fc.assert(
        fc.property(arbNoteName, fc.integer({ min: -5, max: 5 }), (root, octave) => {
          const rootIndex = getRootIndex(root);
          const pitch = rootIndex + octave * 12;

          expect(isFifth(pitch, root)).toBe(false);
        }),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // snapToScale Properties
  // ===========================================================================

  describe('snapToScale', () => {
    it('MT-003: snapped pitch is always in scale', () => {
      fc.assert(
        fc.property(arbPitch, arbNoteName, arbScaleId, (pitch, root, scaleId) => {
          const snapped = snapToScale(pitch, root, scaleId);
          expect(isInScale(snapped, root, scaleId)).toBe(true);
        }),
        { numRuns: 1000 }
      );
    });

    it('pitches already in scale snap to themselves', () => {
      fc.assert(
        fc.property(arbPitch, arbNoteName, arbScaleId, (pitch, root, scaleId) => {
          if (isInScale(pitch, root, scaleId)) {
            expect(snapToScale(pitch, root, scaleId)).toBe(pitch);
          }
        }),
        { numRuns: 500 }
      );
    });

    it('MT-004: snapped pitch is closest in scale (within octave)', () => {
      fc.assert(
        fc.property(arbPlayablePitch, arbNoteName, arbScaleId, (pitch, root, scaleId) => {
          const snapped = snapToScale(pitch, root, scaleId);
          const rootIndex = getRootIndex(root);
          const scaleNotes = getScaleNotes(rootIndex, scaleId);

          const snappedDistance = Math.abs(snapped - pitch);

          // Check that no other scale note in nearby octaves is closer
          const octave = Math.floor(pitch / 12);
          for (let oct = octave - 1; oct <= octave + 1; oct++) {
            for (const note of scaleNotes) {
              const candidate = oct * 12 + note;
              const candidateDistance = Math.abs(candidate - pitch);

              // Snapped should be at least as close as any candidate
              expect(snappedDistance).toBeLessThanOrEqual(candidateDistance + 0.001);
            }
          }
        }),
        { numRuns: 500 }
      );
    });

    it('MT-005: negative pitches are handled correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -60, max: -1 }),
          arbNoteName,
          arbScaleId,
          (pitch, root, scaleId) => {
            const snapped = snapToScale(pitch, root, scaleId);

            // Snapped should be in scale
            expect(isInScale(snapped, root, scaleId)).toBe(true);

            // Snapped should be within reasonable distance
            expect(Math.abs(snapped - pitch)).toBeLessThanOrEqual(6);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('chromatic scale snaps to input (all pitches in scale)', () => {
      fc.assert(
        fc.property(arbPitch, arbNoteName, (pitch, root) => {
          const snapped = snapToScale(pitch, root, 'chromatic');
          expect(snapped).toBe(pitch);
        }),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // getTransposedRoot Properties
  // ===========================================================================

  describe('getTransposedRoot', () => {
    it('transposing by 0 returns same root', () => {
      fc.assert(
        fc.property(arbNoteName, (root) => {
          expect(getTransposedRoot(root, 0)).toBe(root);
        }),
        { numRuns: 100 }
      );
    });

    it('transposing by 12 returns same root (octave)', () => {
      fc.assert(
        fc.property(arbNoteName, (root) => {
          expect(getTransposedRoot(root, 12)).toBe(root);
          expect(getTransposedRoot(root, -12)).toBe(root);
        }),
        { numRuns: 100 }
      );
    });

    it('transposing by 7 gives the fifth', () => {
      fc.assert(
        fc.property(arbNoteName, (root) => {
          const fifth = getTransposedRoot(root, 7);
          const rootIndex = getRootIndex(root);
          const fifthIndex = getRootIndex(fifth);

          expect((rootIndex + 7) % 12).toBe(fifthIndex);
        }),
        { numRuns: 100 }
      );
    });

    it('transposing is consistent with negative values', () => {
      fc.assert(
        fc.property(arbNoteName, fc.integer({ min: 0, max: 11 }), (root, offset) => {
          const upResult = getTransposedRoot(root, offset);
          const downResult = getTransposedRoot(root, offset - 12);

          expect(upResult).toBe(downResult);
        }),
        { numRuns: 200 }
      );
    });

    it('result is always a valid note name', () => {
      fc.assert(
        fc.property(arbNoteName, fc.integer({ min: -100, max: 100 }), (root, transpose) => {
          const result = getTransposedRoot(root, transpose);
          expect(NOTE_NAMES).toContain(result);
        }),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // Cross-Function Consistency
  // ===========================================================================

  describe('cross-function consistency', () => {
    it('getRootIndex and NOTE_NAMES are inverses', () => {
      fc.assert(
        fc.property(arbNoteName, (root) => {
          const index = getRootIndex(root);
          expect(NOTE_NAMES[index]).toBe(root);
        }),
        { numRuns: 100 }
      );
    });

    it('all scales have at least the root note', () => {
      fc.assert(
        fc.property(arbNoteName, arbScaleId, (root, scaleId) => {
          expect(isInScale(getRootIndex(root), root, scaleId)).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('scale degree 1 always corresponds to the root', () => {
      fc.assert(
        fc.property(arbNoteName, arbScaleId, (root, scaleId) => {
          const rootIndex = getRootIndex(root);
          const degree = getScaleDegree(rootIndex, root, scaleId);
          expect(degree).toBe(1);
        }),
        { numRuns: 200 }
      );
    });
  });
});
