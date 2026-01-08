/**
 * Property-Based Tests for Playhead Index Utilities
 *
 * These tests verify the universal properties that must hold for
 * playhead index calculations across all possible inputs.
 *
 * Key Property: ∀ currentStep ∈ [0, MAX_STEPS), ∀ maxStepCount ∈ [1, MAX_STEPS]:
 *   getPlayheadIndex(currentStep, maxStepCount) ∈ [0, maxStepCount)
 *
 * @see bug-patterns.ts#step-index-boundary-wrapping
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MAX_STEPS } from '../types';
import {
  getPlayheadIndex,
  isStepPlaying,
  getPlayheadPercent,
} from './playhead';

// Valid step counts used in the app
const VALID_STEP_COUNTS = [8, 12, 16, 24, 32, 48, 64, 96, 128];

// Arbitrary for valid step counts
const arbStepCount = fc.constantFrom(...VALID_STEP_COUNTS);

// Arbitrary for any step count in range [1, MAX_STEPS]
const arbAnyStepCount = fc.integer({ min: 1, max: MAX_STEPS });

// Arbitrary for currentStep in scheduler range
const arbCurrentStep = fc.integer({ min: 0, max: MAX_STEPS - 1 });

describe('Playhead Index Properties', () => {
  // ===========================================================================
  // Core Property: Bounded Output
  // ===========================================================================

  describe('PH-001: Output is always bounded', () => {
    it('PH-001a: result is always in [0, maxStepCount) for valid inputs', () => {
      fc.assert(
        fc.property(arbCurrentStep, arbStepCount, (currentStep, maxStepCount) => {
          const result = getPlayheadIndex(currentStep, maxStepCount);

          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(maxStepCount);
          expect(Number.isInteger(result)).toBe(true);
        }),
        { numRuns: 1000 }
      );
    });

    it('PH-001b: result is bounded for ANY positive maxStepCount', () => {
      fc.assert(
        fc.property(arbCurrentStep, arbAnyStepCount, (currentStep, maxStepCount) => {
          const result = getPlayheadIndex(currentStep, maxStepCount);

          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(maxStepCount);
        }),
        { numRuns: 1000 }
      );
    });

    it('PH-001c: handles edge case maxStepCount = 1 (always returns 0)', () => {
      fc.assert(
        fc.property(arbCurrentStep, (currentStep) => {
          const result = getPlayheadIndex(currentStep, 1);
          expect(result).toBe(0);
        }),
        { numRuns: 100 }
      );
    });

    it('PH-001d: handles edge case maxStepCount = MAX_STEPS (identity)', () => {
      fc.assert(
        fc.property(arbCurrentStep, (currentStep) => {
          const result = getPlayheadIndex(currentStep, MAX_STEPS);
          expect(result).toBe(currentStep);
        }),
        { numRuns: 100 }
      );
    });
  });

  // ===========================================================================
  // Property: Wrapping at Boundary
  // ===========================================================================

  describe('PH-002: Correct wrapping at boundaries', () => {
    it('PH-002a: currentStep = maxStepCount wraps to 0', () => {
      fc.assert(
        fc.property(arbStepCount, (maxStepCount) => {
          const result = getPlayheadIndex(maxStepCount, maxStepCount);
          expect(result).toBe(0);
        }),
        { numRuns: 50 }
      );
    });

    it('PH-002b: currentStep = maxStepCount + k wraps to k', () => {
      fc.assert(
        fc.property(
          arbStepCount,
          fc.integer({ min: 0, max: 127 }),
          (maxStepCount, k) => {
            fc.pre(k < maxStepCount); // k must be less than maxStepCount
            const result = getPlayheadIndex(maxStepCount + k, maxStepCount);
            expect(result).toBe(k);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('PH-002c: multiple wraps work correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(8, 16, 32), // Small step counts
          fc.integer({ min: 2, max: 10 }), // Number of full cycles
          fc.integer({ min: 0, max: 7 }), // Offset within cycle
          (maxStepCount, cycles, offset) => {
            fc.pre(offset < maxStepCount);
            const currentStep = cycles * maxStepCount + offset;
            const result = getPlayheadIndex(currentStep, maxStepCount);
            expect(result).toBe(offset);
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  // ===========================================================================
  // Property: Determinism
  // ===========================================================================

  describe('PH-003: Deterministic output', () => {
    it('PH-003a: same inputs always produce same output', () => {
      fc.assert(
        fc.property(arbCurrentStep, arbStepCount, (currentStep, maxStepCount) => {
          const result1 = getPlayheadIndex(currentStep, maxStepCount);
          const result2 = getPlayheadIndex(currentStep, maxStepCount);
          const result3 = getPlayheadIndex(currentStep, maxStepCount);

          expect(result1).toBe(result2);
          expect(result2).toBe(result3);
        }),
        { numRuns: 200 }
      );
    });
  });

  // ===========================================================================
  // Property: Monotonicity within cycle
  // ===========================================================================

  describe('PH-004: Monotonicity within a cycle', () => {
    it('PH-004a: consecutive steps produce consecutive results (within cycle)', () => {
      fc.assert(
        fc.property(
          arbStepCount,
          fc.integer({ min: 0, max: MAX_STEPS - 2 }),
          (maxStepCount, baseStep) => {
            fc.pre(baseStep % maxStepCount < maxStepCount - 1); // Not at wrap point

            const result1 = getPlayheadIndex(baseStep, maxStepCount);
            const result2 = getPlayheadIndex(baseStep + 1, maxStepCount);

            expect(result2).toBe(result1 + 1);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // Property: Safety for invalid inputs
  // ===========================================================================

  describe('PH-005: Safe handling of edge cases', () => {
    it('PH-005a: maxStepCount <= 0 returns 0', () => {
      fc.assert(
        fc.property(
          arbCurrentStep,
          fc.integer({ min: -100, max: 0 }),
          (currentStep, badMax) => {
            const result = getPlayheadIndex(currentStep, badMax);
            expect(result).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('PH-005b: negative currentStep is handled safely', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -1000, max: -1 }),
          arbStepCount,
          (negativeStep, maxStepCount) => {
            const result = getPlayheadIndex(negativeStep, maxStepCount);

            // Result should still be valid (non-negative, < maxStepCount)
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThan(maxStepCount);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('PH-005c: very large currentStep is handled', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: MAX_STEPS, max: 10000 }),
          arbStepCount,
          (largeStep, maxStepCount) => {
            const result = getPlayheadIndex(largeStep, maxStepCount);

            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThan(maxStepCount);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ===========================================================================
  // Real-world scenarios from the bug
  // ===========================================================================

  describe('PH-006: Real-world bug scenarios', () => {
    it('PH-006a: 16-step track at step 16 wraps to 0', () => {
      expect(getPlayheadIndex(16, 16)).toBe(0);
    });

    it('PH-006b: 64-step track at step 64 wraps to 0', () => {
      expect(getPlayheadIndex(64, 64)).toBe(0);
    });

    it('PH-006c: 64-step track at step 80 wraps to 16', () => {
      expect(getPlayheadIndex(80, 64)).toBe(16);
    });

    it('PH-006d: 64-step track at step 127 wraps to 63', () => {
      expect(getPlayheadIndex(127, 64)).toBe(63);
    });

    it('PH-006e: 16-step track at step 127 wraps to 15', () => {
      // 127 % 16 = 15
      expect(getPlayheadIndex(127, 16)).toBe(15);
    });

    it('PH-006f: 32-step track at step 100 wraps to 4', () => {
      // 100 % 32 = 4
      expect(getPlayheadIndex(100, 32)).toBe(4);
    });
  });
});

// =============================================================================
// isStepPlaying Properties
// =============================================================================

describe('isStepPlaying Properties', () => {
  it('returns false when not playing', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 127 }),
        arbCurrentStep,
        arbStepCount,
        (stepIndex, currentStep, maxStepCount) => {
          const result = isStepPlaying(stepIndex, currentStep, maxStepCount, false);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('returns false when currentStep is negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 127 }),
        fc.integer({ min: -100, max: -1 }),
        arbStepCount,
        (stepIndex, negStep, maxStepCount) => {
          const result = isStepPlaying(stepIndex, negStep, maxStepCount, true);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exactly one step is playing per position', () => {
    fc.assert(
      fc.property(arbCurrentStep, arbStepCount, (currentStep, maxStepCount) => {
        let playingCount = 0;
        for (let i = 0; i < maxStepCount; i++) {
          if (isStepPlaying(i, currentStep, maxStepCount, true)) {
            playingCount++;
          }
        }
        expect(playingCount).toBe(1);
      }),
      { numRuns: 300 }
    );
  });
});

// =============================================================================
// getPlayheadPercent Properties
// =============================================================================

describe('getPlayheadPercent Properties', () => {
  it('returns 0 when not playing', () => {
    fc.assert(
      fc.property(arbCurrentStep, arbStepCount, (currentStep, maxStepCount) => {
        const result = getPlayheadPercent(currentStep, maxStepCount, false);
        expect(result).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('percentage is always in [0, 100)', () => {
    fc.assert(
      fc.property(arbCurrentStep, arbStepCount, (currentStep, maxStepCount) => {
        const result = getPlayheadPercent(currentStep, maxStepCount, true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(100);
      }),
      { numRuns: 500 }
    );
  });

  it('percentage = (index / maxStepCount) * 100', () => {
    fc.assert(
      fc.property(arbCurrentStep, arbStepCount, (currentStep, maxStepCount) => {
        const percent = getPlayheadPercent(currentStep, maxStepCount, true);
        const index = getPlayheadIndex(currentStep, maxStepCount);
        const expected = (index / maxStepCount) * 100;
        expect(percent).toBeCloseTo(expected, 10);
      }),
      { numRuns: 200 }
    );
  });
});
