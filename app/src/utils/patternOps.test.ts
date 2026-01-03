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
  detectMirrorDirection,
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

describe('detectMirrorDirection', () => {
  it('returns left-to-right when first half has more content', () => {
    const steps = [true, true, true, false, false, false, false, false];
    expect(detectMirrorDirection(steps, 8)).toBe('left-to-right');
  });

  it('returns right-to-left when second half has more content', () => {
    const steps = [false, false, false, false, true, true, true, true];
    expect(detectMirrorDirection(steps, 8)).toBe('right-to-left');
  });

  it('returns left-to-right when halves are equal (default)', () => {
    const steps = [true, true, false, false, false, false, true, true];
    expect(detectMirrorDirection(steps, 8)).toBe('left-to-right');
  });

  it('returns left-to-right for empty pattern (default)', () => {
    const steps = [false, false, false, false, false, false, false, false];
    expect(detectMirrorDirection(steps, 8)).toBe('left-to-right');
  });

  it('returns left-to-right for single step in first half', () => {
    const steps = [true, false, false, false, false, false, false, false];
    expect(detectMirrorDirection(steps, 8)).toBe('left-to-right');
  });

  it('returns right-to-left for single step in second half', () => {
    const steps = [false, false, false, false, false, false, false, true];
    expect(detectMirrorDirection(steps, 8)).toBe('right-to-left');
  });

  it('handles odd step count correctly', () => {
    // 7 steps: midpoint = 3, first half = [0,1,2], second half = [3,4,5,6]
    const steps = [false, false, false, true, true, true, true];
    expect(detectMirrorDirection(steps, 7)).toBe('right-to-left');
  });

  it('only considers steps within stepCount', () => {
    // 4-step track in 8-element array
    const steps = [false, false, false, false, true, true, true, true];
    // Only first 4 steps matter: [F,F,F,F] - both halves empty, default left-to-right
    expect(detectMirrorDirection(steps, 4)).toBe('left-to-right');
  });

  it('returns left-to-right for stepCount <= 2', () => {
    expect(detectMirrorDirection([true, false], 2)).toBe('left-to-right');
    expect(detectMirrorDirection([true], 1)).toBe('left-to-right');
  });
});

describe('mirrorPattern', () => {
  describe('with explicit direction', () => {
    it('mirrors left-to-right: copies first half to second half', () => {
      const steps = [true, true, false, false, false, false, false, false];
      const result = mirrorPattern(steps, 8, 'left-to-right');
      expect(result).toEqual([true, true, false, false, false, false, true, true]);
    });

    it('mirrors right-to-left: copies second half to first half', () => {
      const steps = [false, false, false, false, false, false, true, true];
      const result = mirrorPattern(steps, 8, 'right-to-left');
      expect(result).toEqual([true, true, false, false, false, false, true, true]);
    });

    it('handles 4-step pattern left-to-right', () => {
      const steps = [true, false, false, false];
      const result = mirrorPattern(steps, 4, 'left-to-right');
      // First half [T,F] mirrors to [F,T] in reverse
      expect(result).toEqual([true, false, false, true]);
    });

    it('handles 4-step pattern right-to-left', () => {
      const steps = [false, false, false, true];
      const result = mirrorPattern(steps, 4, 'right-to-left');
      // Second half [F,T] mirrors to [T,F] in reverse
      expect(result).toEqual([true, false, false, true]);
    });
  });

  describe('with smart detection (no direction specified)', () => {
    it('detects first half content and mirrors to second (original behavior)', () => {
      const steps = [true, false, true, false, false, false, false, false];
      const result = mirrorPattern(steps, 8);
      // First half [T,F,T,F] has 2 steps, second half [F,F,F,F] has 0
      // Should mirror left-to-right
      expect(result).toEqual([true, false, true, false, false, true, false, true]);
    });

    it('detects second half content and mirrors to first (THE BUG FIX)', () => {
      // This is the exact bug case reported by user
      const steps = [false, false, false, false, true, true, true, true];
      const result = mirrorPattern(steps, 8);
      // First half [F,F,F,F] has 0 steps, second half [T,T,T,T] has 4
      // Should mirror right-to-left (second half → first half)
      expect(result).toEqual([true, true, true, true, true, true, true, true]);
    });

    it('defaults to left-to-right when halves are equal', () => {
      const steps = [true, false, false, false, false, false, false, true];
      const result = mirrorPattern(steps, 8);
      // First half has 1, second half has 1 - equal, default left-to-right
      expect(result).toEqual([true, false, false, false, false, false, false, true]);
    });

    it('preserves data when all content is in one half', () => {
      // User has a pattern only in steps 4-7, mirror should NOT destroy it
      const steps = [false, false, false, false, true, false, true, false];
      const result = mirrorPattern(steps, 8);
      // Second half [T,F,T,F] has 2 steps, first half has 0
      // Should mirror right-to-left: first half becomes [F,T,F,T]
      expect(result).toEqual([false, true, false, true, true, false, true, false]);
    });
  });

  describe('parameter lock mirroring', () => {
    it('mirrors parameter locks in same direction as steps', () => {
      // Simulate what reducer does: detect direction from steps, apply to both
      const steps = [false, false, false, false, true, true, false, false];
      const locks = [null, null, null, null, { pitch: 5 }, { pitch: 7 }, null, null];

      const direction = detectMirrorDirection(steps, 8);
      expect(direction).toBe('right-to-left'); // second half has more

      const mirroredSteps = mirrorPattern(steps, 8, direction);
      const mirroredLocks = mirrorPattern(locks, 8, direction);

      // Steps should be palindrome with second half as source
      expect(mirroredSteps).toEqual([false, false, true, true, true, true, false, false]);
      // Locks should follow same transformation
      expect(mirroredLocks).toEqual([null, null, { pitch: 7 }, { pitch: 5 }, { pitch: 5 }, { pitch: 7 }, null, null]);
    });

    it('preserves pitch data when mirroring', () => {
      const locks = [{ pitch: 1 }, { pitch: 2 }, null, null, null, null, null, null];
      const result = mirrorPattern(locks, 8, 'left-to-right');
      // Second half should get reversed first half
      expect(result[7]).toEqual({ pitch: 1 });
      expect(result[6]).toEqual({ pitch: 2 });
    });
  });

  describe('edge cases', () => {
    it('returns copy for step count <= 2', () => {
      const steps = [true, false];
      const result = mirrorPattern(steps, 2);
      expect(result).toEqual([true, false]);
      expect(result).not.toBe(steps); // Should be a new array
    });

    it('handles odd step count with center preserved', () => {
      // 5 steps: midpoint = 2
      // First half = [0,1], center = [2], second half = [3,4]
      const steps = [true, false, true, false, false];
      const result = mirrorPattern(steps, 5, 'left-to-right');
      // [A, B, C, ?, ?] → [A, B, C, B, A]
      expect(result).toEqual([true, false, true, false, true]);
    });

    it('handles 16-step polyrhythmic pattern', () => {
      const steps = Array(16).fill(false);
      steps[12] = true;
      steps[13] = true;
      steps[14] = true;
      steps[15] = true;

      const result = mirrorPattern(steps, 16);
      // Second half (8-15) has 4 steps, first half has 0
      // Should mirror right-to-left
      expect(result.slice(0, 4)).toEqual([true, true, true, true]);
      expect(result.slice(12, 16)).toEqual([true, true, true, true]);
    });

    it('handles sparse patterns correctly', () => {
      // Single step at position 6 (second half)
      const steps = [false, false, false, false, false, false, true, false];
      const result = mirrorPattern(steps, 8);
      // Should detect right-to-left, mirror position 6 to position 1
      expect(result[1]).toBe(true);
      expect(result[6]).toBe(true);
    });

    it('only operates within stepCount bounds', () => {
      // 4-step track stored in 8-element array
      const steps = [true, false, false, false, true, true, true, true];
      const result = mirrorPattern(steps, 4);
      // Only first 4 matter, elements 4-7 should be unchanged
      expect(result.slice(0, 4)).toEqual([true, false, false, true]);
      expect(result.slice(4)).toEqual([true, true, true, true]); // Unchanged
    });
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
