/**
 * Property-Based Tests for Pattern Operations
 *
 * Tests algebraic properties and invariants of pattern manipulation functions.
 * These tests use random generation to explore edge cases that example-based
 * tests might miss.
 */

import fc from 'fast-check';
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
import { arbVariableLengthPattern, arbEuclideanParams, MAX_STEPS } from '../test/arbitraries';

describe('patternOps - Property-Based Tests', () => {
  // ===========================================================================
  // Rotation Properties
  // ===========================================================================

  describe('rotateLeft/rotateRight', () => {
    it('PO-001: rotateLeft then rotateRight is identity', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(2, 64),
          (pattern) => {
            const stepCount = pattern.length;
            const rotated = rotateRight(rotateLeft(pattern, stepCount), stepCount);
            expect(rotated).toEqual(pattern);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('rotateRight then rotateLeft is identity', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(2, 64),
          (pattern) => {
            const stepCount = pattern.length;
            const rotated = rotateLeft(rotateRight(pattern, stepCount), stepCount);
            expect(rotated).toEqual(pattern);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('rotating by stepCount is identity', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(2, 32),
          (pattern) => {
            const stepCount = pattern.length;
            let result = [...pattern];
            for (let i = 0; i < stepCount; i++) {
              result = rotateLeft(result, stepCount);
            }
            expect(result).toEqual(pattern);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('PO-006: rotation preserves length', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 128),
          (pattern) => {
            const stepCount = pattern.length;
            expect(rotateLeft(pattern, stepCount).length).toBe(pattern.length);
            expect(rotateRight(pattern, stepCount).length).toBe(pattern.length);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('rotation preserves the set of elements', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(2, 64),
          (pattern) => {
            const stepCount = pattern.length;
            const rotated = rotateLeft(pattern, stepCount);

            // Count true/false in both
            const originalTrues = pattern.filter((x) => x).length;
            const rotatedTrues = rotated.filter((x) => x).length;

            expect(rotatedTrues).toBe(originalTrues);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('stepCount=1 returns pattern unchanged', () => {
      fc.assert(
        fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 128 }), (pattern) => {
          expect(rotateLeft(pattern, 1)).toEqual(pattern);
          expect(rotateRight(pattern, 1)).toEqual(pattern);
        }),
        { numRuns: 200 }
      );
    });
  });

  // ===========================================================================
  // Invert Properties
  // ===========================================================================

  describe('invertPattern', () => {
    it('PO-002: double invert is identity', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 128),
          (pattern) => {
            const stepCount = pattern.length;
            const result = invertPattern(invertPattern(pattern, stepCount), stepCount);
            expect(result).toEqual(pattern);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('invert toggles all steps', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 64),
          (pattern) => {
            const stepCount = pattern.length;
            const inverted = invertPattern(pattern, stepCount);

            for (let i = 0; i < stepCount; i++) {
              expect(inverted[i]).toBe(!pattern[i]);
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('PO-006: invert preserves length', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 128),
          (pattern) => {
            const stepCount = pattern.length;
            expect(invertPattern(pattern, stepCount).length).toBe(pattern.length);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('invert changes count to complement', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 64),
          (pattern) => {
            const stepCount = pattern.length;
            const originalTrues = pattern.filter((x) => x).length;
            const inverted = invertPattern(pattern, stepCount);
            const invertedTrues = inverted.filter((x) => x).length;

            expect(originalTrues + invertedTrues).toBe(stepCount);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // Reverse Properties
  // ===========================================================================

  describe('reversePattern', () => {
    it('PO-003: double reverse is identity', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 128),
          (pattern) => {
            const stepCount = pattern.length;
            const result = reversePattern(reversePattern(pattern, stepCount), stepCount);
            expect(result).toEqual(pattern);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('reverse swaps first and last elements', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(2, 64),
          (pattern) => {
            const stepCount = pattern.length;
            const reversed = reversePattern(pattern, stepCount);

            expect(reversed[0]).toBe(pattern[stepCount - 1]);
            expect(reversed[stepCount - 1]).toBe(pattern[0]);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('PO-006: reverse preserves length', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 128),
          (pattern) => {
            const stepCount = pattern.length;
            expect(reversePattern(pattern, stepCount).length).toBe(pattern.length);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('reverse preserves element count', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 64),
          (pattern) => {
            const stepCount = pattern.length;
            const originalTrues = pattern.filter((x) => x).length;
            const reversed = reversePattern(pattern, stepCount);
            const reversedTrues = reversed.filter((x) => x).length;

            expect(reversedTrues).toBe(originalTrues);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // Mirror Properties
  // ===========================================================================

  describe('mirrorPattern', () => {
    it('mirror creates palindromic structure (left-to-right)', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(4, 64),
          (pattern) => {
            const stepCount = pattern.length;
            const mirrored = mirrorPattern(pattern, stepCount, 'left-to-right');

            // Check that second half mirrors first half
            const midpoint = Math.floor(stepCount / 2);
            for (let i = 0; i < midpoint; i++) {
              expect(mirrored[stepCount - 1 - i]).toBe(mirrored[i]);
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('mirror creates palindromic structure (right-to-left)', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(4, 64),
          (pattern) => {
            const stepCount = pattern.length;
            const mirrored = mirrorPattern(pattern, stepCount, 'right-to-left');

            // Check that first half mirrors second half
            const midpoint = Math.floor(stepCount / 2);
            for (let i = 0; i < midpoint; i++) {
              expect(mirrored[i]).toBe(mirrored[stepCount - 1 - i]);
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('PO-006: mirror preserves length', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 128),
          (pattern) => {
            const stepCount = pattern.length;
            expect(mirrorPattern(pattern, stepCount).length).toBe(pattern.length);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('short patterns (<=2) return unchanged', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(1, 2),
          (pattern) => {
            const stepCount = pattern.length;
            const mirrored = mirrorPattern(pattern, stepCount);
            expect(mirrored).toEqual(pattern);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ===========================================================================
  // Euclidean Rhythm Properties
  // ===========================================================================

  describe('euclidean', () => {
    it('PO-004: euclidean produces exactly k hits', () => {
      fc.assert(
        fc.property(arbEuclideanParams, ({ steps, hits }) => {
          const pattern = euclidean(steps, hits);
          const actualHits = pattern.filter((x) => x).length;
          expect(actualHits).toBe(hits);
        }),
        { numRuns: 1000 }
      );
    });

    it('euclidean pattern has correct length', () => {
      fc.assert(
        fc.property(arbEuclideanParams, ({ steps, hits }) => {
          const pattern = euclidean(steps, hits);
          expect(pattern.length).toBe(steps);
        }),
        { numRuns: 1000 }
      );
    });

    it('PO-005: euclidean has maximal evenness (gap sizes differ by at most 1)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 64 }),
          fc.integer({ min: 1, max: 64 }),
          (steps, hits) => {
            fc.pre(hits <= steps && hits >= 1);
            const pattern = euclidean(steps, hits);

            // Calculate gaps between hits
            const gaps: number[] = [];
            let lastHitIndex = -1;

            for (let i = 0; i < steps; i++) {
              if (pattern[i]) {
                if (lastHitIndex >= 0) {
                  gaps.push(i - lastHitIndex);
                }
                lastHitIndex = i;
              }
            }

            // Include wrap-around gap
            if (lastHitIndex >= 0 && pattern.some((x) => x)) {
              const firstHitIndex = pattern.findIndex((x) => x);
              if (firstHitIndex !== lastHitIndex) {
                gaps.push(steps - lastHitIndex + firstHitIndex);
              }
            }

            // Gap sizes should differ by at most 1
            if (gaps.length >= 2) {
              const maxGap = Math.max(...gaps);
              const minGap = Math.min(...gaps);
              expect(maxGap - minGap).toBeLessThanOrEqual(1);
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('euclidean(n, 0) returns all false', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 128 }), (steps) => {
          const pattern = euclidean(steps, 0);
          expect(pattern.every((x) => !x)).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('euclidean(n, n) returns all true', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 128 }), (steps) => {
          const pattern = euclidean(steps, steps);
          expect(pattern.every((x) => x)).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('euclidean(n, k) with k > n still returns n trues', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 64 }),
          fc.integer({ min: 65, max: 128 }),
          (steps, hits) => {
            const pattern = euclidean(steps, hits);
            expect(pattern.filter((x) => x).length).toBe(steps);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ===========================================================================
  // applyEuclidean Properties
  // ===========================================================================

  describe('applyEuclidean', () => {
    it('applies correct number of hits', () => {
      fc.assert(
        fc.property(
          fc.array(fc.boolean(), { minLength: MAX_STEPS, maxLength: MAX_STEPS }),
          fc.array(fc.constant(null), { minLength: MAX_STEPS, maxLength: MAX_STEPS }),
          fc.integer({ min: 4, max: 64 }),
          fc.integer({ min: 0, max: 64 }),
          (steps, locks, stepCount, hits) => {
            const actualHits = Math.min(hits, stepCount);
            const { steps: newSteps } = applyEuclidean(steps, locks, stepCount, actualHits);

            // Count active steps within stepCount
            let activeCount = 0;
            for (let i = 0; i < stepCount; i++) {
              if (newSteps[i]) activeCount++;
            }

            expect(activeCount).toBe(actualHits);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('preserves array length', () => {
      fc.assert(
        fc.property(
          fc.array(fc.boolean(), { minLength: MAX_STEPS, maxLength: MAX_STEPS }),
          fc.array(fc.constant(null), { minLength: MAX_STEPS, maxLength: MAX_STEPS }),
          fc.integer({ min: 4, max: 64 }),
          fc.integer({ min: 0, max: 64 }),
          (steps, locks, stepCount, hits) => {
            const { steps: newSteps, locks: newLocks } = applyEuclidean(
              steps,
              locks,
              stepCount,
              Math.min(hits, stepCount)
            );

            expect(newSteps.length).toBe(MAX_STEPS);
            expect(newLocks.length).toBe(MAX_STEPS);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('clears locks on deactivated steps', () => {
      // Create a pattern with all steps active and locks
      const steps = new Array(MAX_STEPS).fill(true);
      const locks = new Array(MAX_STEPS).fill({ pitch: 5 });
      const stepCount = 16;
      const hits = 4; // Only 4 hits from 16

      const { steps: newSteps, locks: newLocks } = applyEuclidean(steps, locks, stepCount, hits);

      // Deactivated steps should have null locks
      for (let i = 0; i < stepCount; i++) {
        if (!newSteps[i]) {
          expect(newLocks[i]).toBe(null);
        }
      }
    });
  });

  // ===========================================================================
  // Composition Properties
  // ===========================================================================

  describe('composition properties', () => {
    it('rotate preserves inversion relationship', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(4, 32),
          (pattern) => {
            const stepCount = pattern.length;

            // invert(rotate(p)) should equal rotate(invert(p))
            const rotateFirst = invertPattern(rotateLeft(pattern, stepCount), stepCount);
            const invertFirst = rotateLeft(invertPattern(pattern, stepCount), stepCount);

            expect(rotateFirst).toEqual(invertFirst);
          }
        ),
        { numRuns: 300 }
      );
    });

    it('reverse commutes with invert', () => {
      fc.assert(
        fc.property(
          arbVariableLengthPattern(4, 32),
          (pattern) => {
            const stepCount = pattern.length;

            // invert(reverse(p)) should equal reverse(invert(p))
            const reverseFirst = invertPattern(reversePattern(pattern, stepCount), stepCount);
            const invertFirst = reversePattern(invertPattern(pattern, stepCount), stepCount);

            expect(reverseFirst).toEqual(invertFirst);
          }
        ),
        { numRuns: 300 }
      );
    });
  });
});
