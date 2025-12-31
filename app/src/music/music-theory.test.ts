/**
 * Music Theory Module Tests
 *
 * Tests for scale utilities to prevent regressions like the NaN bug
 * where getScaleNotes was called with string root instead of numeric index.
 */

import { describe, it, expect } from 'vitest';
import {
  getScaleNotes,
  getRootIndex,
  NOTE_NAMES,
  SCALES,
  isInScale,
  getScaleDegree,
  isRoot,
  isFifth,
  type ScaleId,
  type NoteName,
} from './music-theory';

describe('getScaleNotes', () => {
  it('should return valid numeric array for C minor pentatonic', () => {
    const notes = getScaleNotes(0, 'minor-pentatonic');

    // Should return [0, 3, 5, 7, 10] for C minor pentatonic
    expect(notes).toEqual([0, 3, 5, 7, 10]);

    // Verify no NaN values (this was the bug!)
    expect(notes.every(n => !isNaN(n))).toBe(true);
    expect(notes.every(n => typeof n === 'number')).toBe(true);
  });

  it('should transpose correctly for different root notes', () => {
    // D (index 2) minor pentatonic should be [2, 5, 7, 9, 0]
    const dMinorPent = getScaleNotes(2, 'minor-pentatonic');
    expect(dMinorPent).toEqual([2, 5, 7, 9, 0]);

    // All values should be 0-11
    expect(dMinorPent.every(n => n >= 0 && n < 12)).toBe(true);
  });

  it('should handle all valid root indices (0-11)', () => {
    for (let rootIndex = 0; rootIndex < 12; rootIndex++) {
      const notes = getScaleNotes(rootIndex, 'major');

      // Should return 7 notes for major scale
      expect(notes.length).toBe(7);

      // All values should be valid numbers 0-11
      expect(notes.every(n => typeof n === 'number')).toBe(true);
      expect(notes.every(n => !isNaN(n))).toBe(true);
      expect(notes.every(n => n >= 0 && n < 12)).toBe(true);
    }
  });

  it('should return chromatic scale for unknown scaleId', () => {
    const notes = getScaleNotes(0, 'nonexistent-scale' as ScaleId);

    // Should fallback to chromatic (all 12 notes)
    expect(notes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  // Regression test for the NaN bug
  it('should NOT produce NaN when called with numeric rootIndex', () => {
    // Test all scales with all root indices
    const scaleIds = Object.keys(SCALES) as ScaleId[];

    for (const scaleId of scaleIds) {
      for (let rootIndex = 0; rootIndex < 12; rootIndex++) {
        const notes = getScaleNotes(rootIndex, scaleId);

        // The key assertion - no NaN values
        const hasNaN = notes.some(n => isNaN(n));
        expect(hasNaN).toBe(false);

        // Additional sanity checks
        expect(notes.length).toBeGreaterThan(0);
        expect(notes.every(n => typeof n === 'number')).toBe(true);
      }
    }
  });
});

describe('getRootIndex', () => {
  it('should convert note names to correct indices', () => {
    expect(getRootIndex('C')).toBe(0);
    expect(getRootIndex('C#')).toBe(1);
    expect(getRootIndex('D')).toBe(2);
    expect(getRootIndex('D#')).toBe(3);
    expect(getRootIndex('E')).toBe(4);
    expect(getRootIndex('F')).toBe(5);
    expect(getRootIndex('F#')).toBe(6);
    expect(getRootIndex('G')).toBe(7);
    expect(getRootIndex('G#')).toBe(8);
    expect(getRootIndex('A')).toBe(9);
    expect(getRootIndex('A#')).toBe(10);
    expect(getRootIndex('B')).toBe(11);
  });

  it('should return -1 for invalid note names', () => {
    // This prevents silent failures when string handling goes wrong
    expect(getRootIndex('X' as NoteName)).toBe(-1);
  });
});

describe('scale note calculations - integration', () => {
  /**
   * This test simulates the ScaleSidebar component's logic
   * to ensure the pattern doesn't produce NaN.
   *
   * Bug scenario that was fixed:
   * - ScaleSidebar had: getScaleNotes(root, scaleId) where root was 'C' (string)
   * - Should have been: getScaleNotes(rootIndex, scaleId) where rootIndex is 0 (number)
   */
  it('should produce valid note names when following correct pattern', () => {
    const root: NoteName = 'C';
    const scaleId: ScaleId = 'minor-pentatonic';

    // Correct pattern (what ScaleSidebar should do):
    const noteNames = NOTE_NAMES;
    const rootIndex = noteNames.indexOf(root);
    const noteIndices = getScaleNotes(rootIndex, scaleId);
    const notes = noteIndices.map(idx => noteNames[idx]);

    // Should produce: ['C', 'D#', 'F', 'G', 'A#']
    expect(notes).toEqual(['C', 'D#', 'F', 'G', 'A#']);

    // No 'undefined' values (which would happen with NaN indices)
    expect(notes.every(n => n !== undefined)).toBe(true);
    expect(notes.every(n => NOTE_NAMES.includes(n as NoteName))).toBe(true);
  });

  it('should work for all root notes with minor pentatonic', () => {
    for (const root of NOTE_NAMES) {
      const rootIndex = NOTE_NAMES.indexOf(root);
      const noteIndices = getScaleNotes(rootIndex, 'minor-pentatonic');
      const notes = noteIndices.map(idx => NOTE_NAMES[idx]);

      // Should produce 5 valid note names
      expect(notes.length).toBe(5);
      expect(notes.every(n => n !== undefined)).toBe(true);

      // First note should be the root
      expect(notes[0]).toBe(root);
    }
  });
});

describe('isInScale', () => {
  it('should return true for notes in C minor pentatonic', () => {
    // C minor pentatonic: C, D#, F, G, A#
    expect(isInScale(0, 'C', 'minor-pentatonic')).toBe(true);  // C
    expect(isInScale(3, 'C', 'minor-pentatonic')).toBe(true);  // D#
    expect(isInScale(5, 'C', 'minor-pentatonic')).toBe(true);  // F
    expect(isInScale(7, 'C', 'minor-pentatonic')).toBe(true);  // G
    expect(isInScale(10, 'C', 'minor-pentatonic')).toBe(true); // A#
  });

  it('should return false for notes not in C minor pentatonic', () => {
    expect(isInScale(1, 'C', 'minor-pentatonic')).toBe(false);  // C#
    expect(isInScale(2, 'C', 'minor-pentatonic')).toBe(false);  // D
    expect(isInScale(4, 'C', 'minor-pentatonic')).toBe(false);  // E
    expect(isInScale(6, 'C', 'minor-pentatonic')).toBe(false);  // F#
    expect(isInScale(8, 'C', 'minor-pentatonic')).toBe(false);  // G#
    expect(isInScale(9, 'C', 'minor-pentatonic')).toBe(false);  // A
    expect(isInScale(11, 'C', 'minor-pentatonic')).toBe(false); // B
  });

  it('should handle negative pitches correctly', () => {
    // Negative pitch should normalize correctly
    expect(isInScale(-12, 'C', 'minor-pentatonic')).toBe(true);  // C (octave below)
    expect(isInScale(-9, 'C', 'minor-pentatonic')).toBe(true);   // D# (octave below)
  });
});

describe('getScaleDegree', () => {
  it('should return correct degrees for C major', () => {
    // C major: C(1), D(2), E(3), F(4), G(5), A(6), B(7)
    expect(getScaleDegree(0, 'C', 'major')).toBe(1);  // C = 1st
    expect(getScaleDegree(2, 'C', 'major')).toBe(2);  // D = 2nd
    expect(getScaleDegree(4, 'C', 'major')).toBe(3);  // E = 3rd
    expect(getScaleDegree(5, 'C', 'major')).toBe(4);  // F = 4th
    expect(getScaleDegree(7, 'C', 'major')).toBe(5);  // G = 5th
    expect(getScaleDegree(9, 'C', 'major')).toBe(6);  // A = 6th
    expect(getScaleDegree(11, 'C', 'major')).toBe(7); // B = 7th
  });

  it('should return undefined for out-of-scale notes', () => {
    expect(getScaleDegree(1, 'C', 'major')).toBeUndefined();  // C#
    expect(getScaleDegree(6, 'C', 'major')).toBeUndefined();  // F#
  });
});

describe('isRoot and isFifth', () => {
  it('should identify root correctly', () => {
    expect(isRoot(0, 'C')).toBe(true);
    expect(isRoot(12, 'C')).toBe(true);  // Octave above
    expect(isRoot(-12, 'C')).toBe(true); // Octave below
    expect(isRoot(1, 'C')).toBe(false);

    expect(isRoot(7, 'G')).toBe(true);
    expect(isRoot(0, 'G')).toBe(false);
  });

  it('should identify fifth correctly', () => {
    // Fifth of C is G (index 7)
    expect(isFifth(7, 'C')).toBe(true);
    expect(isFifth(19, 'C')).toBe(true);  // G an octave above
    expect(isFifth(0, 'C')).toBe(false);

    // Fifth of G is D (index 2)
    expect(isFifth(2, 'G')).toBe(true);
    expect(isFifth(14, 'G')).toBe(true);  // D an octave above
  });
});
