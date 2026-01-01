/**
 * Tests for Phase 31B: Pattern Manipulation Operations
 */
import { describe, it, expect } from 'vitest';
import {
  rotateLeft,
  rotateRight,
  invertPattern,
  reversePattern,
  mirrorPattern,
  euclidean,
  applyEuclidean,
} from './patternOps';

describe('rotateLeft', () => {
  it('rotates a boolean array left by one position', () => {
    const steps = [true, false, false, true, false, false, false, false];
    const result = rotateLeft(steps, 8);
    expect(result).toEqual([false, false, true, false, false, false, false, true]);
  });

  it('wraps the first element to the end', () => {
    const steps = [true, false, false, false];
    const result = rotateLeft(steps, 4);
    expect(result.slice(0, 4)).toEqual([false, false, false, true]);
  });

  it('handles single element array', () => {
    const steps = [true];
    const result = rotateLeft(steps, 1);
    expect(result[0]).toBe(true);
  });

  it('only rotates within stepCount', () => {
    const steps = [true, false, false, false, true, true, true, true];
    const result = rotateLeft(steps, 4);
    // First 4 elements should rotate, rest unchanged
    expect(result.slice(0, 4)).toEqual([false, false, false, true]);
    expect(result.slice(4)).toEqual([true, true, true, true]);
  });
});

describe('rotateRight', () => {
  it('rotates a boolean array right by one position', () => {
    const steps = [true, false, false, true, false, false, false, false];
    const result = rotateRight(steps, 8);
    expect(result).toEqual([false, true, false, false, true, false, false, false]);
  });

  it('wraps the last element to the start', () => {
    const steps = [false, false, false, true];
    const result = rotateRight(steps, 4);
    expect(result.slice(0, 4)).toEqual([true, false, false, false]);
  });

  it('only rotates within stepCount', () => {
    const steps = [false, false, false, true, true, true, true, true];
    const result = rotateRight(steps, 4);
    // First 4 elements should rotate, rest unchanged
    expect(result.slice(0, 4)).toEqual([true, false, false, false]);
    expect(result.slice(4)).toEqual([true, true, true, true]);
  });
});

describe('invertPattern', () => {
  it('toggles all steps on/off', () => {
    const steps = [true, false, true, false];
    const result = invertPattern(steps, 4);
    expect(result.slice(0, 4)).toEqual([false, true, false, true]);
  });

  it('only inverts within stepCount', () => {
    const steps = [true, false, true, false, true, true, true, true];
    const result = invertPattern(steps, 4);
    // First 4 elements should invert, rest unchanged
    expect(result.slice(0, 4)).toEqual([false, true, false, true]);
    expect(result.slice(4)).toEqual([true, true, true, true]);
  });

  it('handles all-on pattern', () => {
    const steps = [true, true, true, true];
    const result = invertPattern(steps, 4);
    expect(result.slice(0, 4)).toEqual([false, false, false, false]);
  });

  it('handles all-off pattern', () => {
    const steps = [false, false, false, false];
    const result = invertPattern(steps, 4);
    expect(result.slice(0, 4)).toEqual([true, true, true, true]);
  });
});

describe('reversePattern', () => {
  it('reverses step order', () => {
    const steps = [true, false, false, true];
    const result = reversePattern(steps, 4);
    expect(result.slice(0, 4)).toEqual([true, false, false, true]);
  });

  it('reverses asymmetric pattern', () => {
    const steps = [true, true, false, false, false, false, false, true];
    const result = reversePattern(steps, 8);
    expect(result).toEqual([true, false, false, false, false, false, true, true]);
  });

  it('only reverses within stepCount', () => {
    const steps = [true, false, false, true, true, true, true, true];
    const result = reversePattern(steps, 4);
    // First 4 elements should reverse, rest unchanged
    expect(result.slice(0, 4)).toEqual([true, false, false, true]);
    expect(result.slice(4)).toEqual([true, true, true, true]);
  });
});

describe('mirrorPattern', () => {
  it('mirrors first half to second half (ABCD → ABBA)', () => {
    const steps = [true, false, false, true];
    const result = mirrorPattern(steps, 4);
    // Steps: [A, B, C, D] → [A, B, B, A]
    expect(result.slice(0, 4)).toEqual([true, false, false, true]);
  });

  it('mirrors 8-step pattern (ABCDEFGH → ABCDDCBA)', () => {
    const steps = [true, false, true, false, false, false, false, false];
    const result = mirrorPattern(steps, 8);
    // First half [true, false, true, false] mirrors to second half
    expect(result).toEqual([true, false, true, false, false, true, false, true]);
  });

  it('handles odd step count (center stays)', () => {
    const steps = [true, false, true, false, true];
    const result = mirrorPattern(steps, 5);
    // With 5 steps, midpoint is 2, so we mirror steps 0-1 to steps 3-4
    // [A, B, C, ?, ?] → [A, B, C, B, A]
    expect(result.slice(0, 5)).toEqual([true, false, true, false, true]);
  });

  it('returns unchanged for step count <= 2', () => {
    const steps = [true, false];
    const result = mirrorPattern(steps, 2);
    expect(result.slice(0, 2)).toEqual([true, false]);
  });
});

describe('euclidean', () => {
  it('generates Cuban tresillo E(3, 8)', () => {
    const result = euclidean(8, 3);
    // Tresillo: [X][ ][ ][X][ ][ ][X][ ]
    expect(result).toEqual([true, false, false, true, false, false, true, false]);
  });

  it('generates Cuban cinquillo E(5, 8)', () => {
    const result = euclidean(8, 5);
    // Cinquillo: [X][ ][X][X][ ][X][X][ ]
    expect(result).toEqual([true, false, true, true, false, true, true, false]);
  });

  it('handles 0 hits (all empty)', () => {
    const result = euclidean(8, 0);
    expect(result).toEqual(Array(8).fill(false));
  });

  it('handles hits = steps (all full)', () => {
    const result = euclidean(8, 8);
    expect(result).toEqual(Array(8).fill(true));
  });

  it('handles hits > steps (clamped to all full)', () => {
    const result = euclidean(8, 10);
    expect(result).toEqual(Array(8).fill(true));
  });

  it('generates E(4, 16) pattern', () => {
    const result = euclidean(16, 4);
    const expected = [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false];
    expect(result).toEqual(expected);
  });

  it('generates E(5, 16) bossa nova pattern', () => {
    const result = euclidean(16, 5);
    // Should have exactly 5 trues distributed evenly
    expect(result.filter(Boolean).length).toBe(5);
  });

  it('generates E(7, 16) pattern', () => {
    const result = euclidean(16, 7);
    expect(result.filter(Boolean).length).toBe(7);
  });
});

describe('applyEuclidean', () => {
  it('applies Euclidean pattern to track steps', () => {
    const currentSteps = [false, false, false, false, false, false, false, false];
    const currentLocks = Array(8).fill(null);
    const { steps } = applyEuclidean(currentSteps, currentLocks, 8, 3);

    // Should have 3 hits distributed
    expect(steps.filter(Boolean).length).toBe(3);
  });

  it('clears parameter locks on steps that become inactive', () => {
    const currentSteps = [true, true, true, true, false, false, false, false];
    const currentLocks = [
      { pitch: 5 },
      { pitch: 7 },
      { pitch: 3 },
      { pitch: 1 },
      null, null, null, null,
    ];

    const { steps, locks } = applyEuclidean(currentSteps, currentLocks, 8, 2);

    // Should have 2 hits distributed
    expect(steps.filter(Boolean).length).toBe(2);

    // Locks on inactive steps should be cleared (some may survive if their steps remain active)
    expect(locks.filter((l, i) => !steps[i] && l !== null).length).toBe(0);
  });

  it('preserves locks on steps that remain active', () => {
    const currentSteps = [true, false, false, false, false, false, false, false];
    const currentLocks = [{ pitch: 5 }, null, null, null, null, null, null, null];

    // Apply pattern with 1 hit - first step should remain active
    const { steps, locks } = applyEuclidean(currentSteps, currentLocks, 8, 1);

    // First step still active, lock preserved
    expect(steps[0]).toBe(true);
    expect(locks[0]).toEqual({ pitch: 5 });
  });
});
