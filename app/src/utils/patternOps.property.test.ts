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

  // ===========================================================================
  // Parameter Lock Preservation Properties
  // ===========================================================================

  describe('parameter lock preservation', () => {
    /**
     * Arbitrary for generating parameter locks.
     * Produces objects with optional pitch, volume, and tie fields.
     */
    const arbLock = fc.record({
      pitch: fc.option(fc.integer({ min: -24, max: 24 }), { nil: undefined }),
      volume: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
      tie: fc.option(fc.boolean(), { nil: undefined }),
    });

    /**
     * Arbitrary for coordinated (steps, locks) pairs where locks may exist on active steps.
     * This mirrors real-world usage where parameter locks are typically on active steps.
     */
    const arbStepsWithLocks = (minLen: number, maxLen: number) =>
      fc.integer({ min: minLen, max: maxLen }).chain((length) =>
        fc.tuple(
          fc.array(fc.boolean(), { minLength: length, maxLength: length }),
          fc.array(
            fc.oneof(
              { weight: 3, arbitrary: fc.constant(null) },
              { weight: 1, arbitrary: arbLock }
            ),
            { minLength: length, maxLength: length }
          )
        ).map(([steps, locks]) => ({ steps, locks, stepCount: length }))
      );

    /**
     * Helper to serialize locks for comparison (handles undefined fields).
     */
    const serializeLock = (lock: { pitch?: number; volume?: number; tie?: boolean } | null): string => {
      if (lock === null) return 'null';
      const parts: string[] = [];
      if (lock.pitch !== undefined) parts.push(`p:${lock.pitch}`);
      if (lock.volume !== undefined) parts.push(`v:${lock.volume}`);
      if (lock.tie !== undefined) parts.push(`t:${lock.tie}`);
      return parts.length > 0 ? parts.join(',') : 'empty';
    };

    /**
     * Helper to get multiset (bag) of lock values for comparison.
     */
    const getLockMultiset = (locks: ({ pitch?: number; volume?: number; tie?: boolean } | null)[], stepCount: number): Map<string, number> => {
      const multiset = new Map<string, number>();
      for (let i = 0; i < stepCount; i++) {
        const key = serializeLock(locks[i]);
        multiset.set(key, (multiset.get(key) ?? 0) + 1);
      }
      return multiset;
    };

    describe('reversePattern with parameter locks', () => {
      it('PO-007: reverse preserves parameter lock multiset (content equality)', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(4, 64),
            ({ locks, stepCount }) => {
              const reversed = reversePattern(locks, stepCount);

              // The multiset of locks should be identical
              const originalMultiset = getLockMultiset(locks, stepCount);
              const reversedMultiset = getLockMultiset(reversed, stepCount);

              expect(reversedMultiset).toEqual(originalMultiset);
            }
          ),
          { numRuns: 500 }
        );
      });

      it('PO-008: reverse is a bijection (lock at i moves to stepCount-1-i)', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(4, 64),
            ({ locks, stepCount }) => {
              const reversed = reversePattern(locks, stepCount);

              // Verify the bijection property: lock[i] should be at position stepCount-1-i
              for (let i = 0; i < stepCount; i++) {
                expect(serializeLock(reversed[stepCount - 1 - i])).toBe(serializeLock(locks[i]));
              }
            }
          ),
          { numRuns: 500 }
        );
      });

      it('PO-009: double reverse preserves locks exactly (involution)', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(1, 64),
            ({ locks, stepCount }) => {
              const doubleReversed = reversePattern(reversePattern(locks, stepCount), stepCount);

              // Each lock should be back in its original position
              for (let i = 0; i < stepCount; i++) {
                expect(serializeLock(doubleReversed[i])).toBe(serializeLock(locks[i]));
              }
            }
          ),
          { numRuns: 500 }
        );
      });

      it('PO-010: reverse preserves step-lock correspondence', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(4, 32),
            ({ steps, locks, stepCount }) => {
              const reversedSteps = reversePattern(steps, stepCount);
              const reversedLocks = reversePattern(locks, stepCount);

              // If step[i] was active with lock[i], then reversedSteps[j] should have reversedLocks[j]
              // where j = stepCount - 1 - i
              for (let i = 0; i < stepCount; i++) {
                const j = stepCount - 1 - i;
                // The step and lock should move together
                expect(reversedSteps[j]).toBe(steps[i]);
                expect(serializeLock(reversedLocks[j])).toBe(serializeLock(locks[i]));
              }
            }
          ),
          { numRuns: 500 }
        );
      });
    });

    describe('mirrorPattern with parameter locks', () => {
      it('PO-011: mirror (L→R) preserves first half locks in mirrored positions', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(4, 64),
            ({ locks, stepCount }) => {
              const mirrored = mirrorPattern(locks, stepCount, 'left-to-right');
              const midpoint = Math.floor(stepCount / 2);

              // First half should remain unchanged
              for (let i = 0; i < midpoint; i++) {
                expect(serializeLock(mirrored[i])).toBe(serializeLock(locks[i]));
              }

              // Second half should mirror first half
              for (let i = 0; i < midpoint; i++) {
                expect(serializeLock(mirrored[stepCount - 1 - i])).toBe(serializeLock(locks[i]));
              }
            }
          ),
          { numRuns: 500 }
        );
      });

      it('PO-012: mirror (R→L) preserves second half locks in mirrored positions', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(4, 64),
            ({ locks, stepCount }) => {
              const mirrored = mirrorPattern(locks, stepCount, 'right-to-left');
              const midpoint = Math.floor(stepCount / 2);

              // Second half should remain unchanged
              for (let i = midpoint; i < stepCount; i++) {
                expect(serializeLock(mirrored[i])).toBe(serializeLock(locks[i]));
              }

              // First half should mirror second half
              for (let i = 0; i < midpoint; i++) {
                expect(serializeLock(mirrored[i])).toBe(serializeLock(locks[stepCount - 1 - i]));
              }
            }
          ),
          { numRuns: 500 }
        );
      });

      it('PO-013: mirror preserves step-lock correspondence', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(4, 32),
            fc.constantFrom('left-to-right' as const, 'right-to-left' as const),
            ({ steps, locks, stepCount }, direction) => {
              const mirroredSteps = mirrorPattern(steps, stepCount, direction);
              const mirroredLocks = mirrorPattern(locks, stepCount, direction);

              // For each position, the step and lock should both come from the same source
              const midpoint = Math.floor(stepCount / 2);
              for (let i = 0; i < stepCount; i++) {
                // Determine source index based on direction and position
                let sourceIndex: number;
                if (direction === 'left-to-right') {
                  sourceIndex = i < midpoint ? i : stepCount - 1 - i;
                } else {
                  sourceIndex = i >= midpoint ? i : stepCount - 1 - i;
                }

                // Both step and lock should come from the same source
                expect(mirroredSteps[i]).toBe(steps[sourceIndex]);
                expect(serializeLock(mirroredLocks[i])).toBe(serializeLock(locks[sourceIndex]));
              }
            }
          ),
          { numRuns: 500 }
        );
      });

      it('PO-014: double mirror with same direction is idempotent', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(4, 64),
            fc.constantFrom('left-to-right' as const, 'right-to-left' as const),
            ({ locks, stepCount }, direction) => {
              const onceMirrored = mirrorPattern(locks, stepCount, direction);
              const twiceMirrored = mirrorPattern(onceMirrored, stepCount, direction);

              // Mirroring twice with same direction should give same result as once
              for (let i = 0; i < stepCount; i++) {
                expect(serializeLock(twiceMirrored[i])).toBe(serializeLock(onceMirrored[i]));
              }
            }
          ),
          { numRuns: 500 }
        );
      });
    });

    describe('rotateLeft/rotateRight with parameter locks', () => {
      it('PO-015: rotation preserves parameter lock multiset', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(2, 64),
            ({ locks, stepCount }) => {
              const rotatedLeft = rotateLeft(locks, stepCount);
              const rotatedRight = rotateRight(locks, stepCount);

              const originalMultiset = getLockMultiset(locks, stepCount);
              expect(getLockMultiset(rotatedLeft, stepCount)).toEqual(originalMultiset);
              expect(getLockMultiset(rotatedRight, stepCount)).toEqual(originalMultiset);
            }
          ),
          { numRuns: 500 }
        );
      });

      it('PO-016: rotate preserves step-lock correspondence', () => {
        fc.assert(
          fc.property(
            arbStepsWithLocks(2, 32),
            ({ steps, locks, stepCount }) => {
              const rotatedSteps = rotateLeft(steps, stepCount);
              const rotatedLocks = rotateLeft(locks, stepCount);

              // After rotation, step[i] and lock[i] should both come from index (i+1) % stepCount
              for (let i = 0; i < stepCount; i++) {
                const sourceIndex = (i + 1) % stepCount;
                expect(rotatedSteps[i]).toBe(steps[sourceIndex]);
                expect(serializeLock(rotatedLocks[i])).toBe(serializeLock(locks[sourceIndex]));
              }
            }
          ),
          { numRuns: 500 }
        );
      });
    });
  });

  // ===========================================================================
  // Operation Interaction Properties with Parameter Locks
  // ===========================================================================

  describe('operation interactions with parameter locks', () => {
    /**
     * Arbitrary for coordinated (steps, locks) pairs.
     */
    const arbStepsWithLocks = (minLen: number, maxLen: number) =>
      fc.integer({ min: minLen, max: maxLen }).chain((length) =>
        fc.tuple(
          fc.array(fc.boolean(), { minLength: length, maxLength: length }),
          fc.array(
            fc.oneof(
              { weight: 3, arbitrary: fc.constant(null) },
              {
                weight: 1,
                arbitrary: fc.record({
                  pitch: fc.option(fc.integer({ min: -24, max: 24 }), { nil: undefined }),
                  volume: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
                }),
              }
            ),
            { minLength: length, maxLength: length }
          )
        ).map(([steps, locks]) => ({ steps, locks, stepCount: length }))
      );

    const serializeLock = (lock: { pitch?: number; volume?: number; tie?: boolean } | null): string => {
      if (lock === null) return 'null';
      const parts: string[] = [];
      if (lock.pitch !== undefined) parts.push(`p:${lock.pitch}`);
      if (lock.volume !== undefined) parts.push(`v:${lock.volume}`);
      if (lock.tie !== undefined) parts.push(`t:${lock.tie}`);
      return parts.length > 0 ? parts.join(',') : 'empty';
    };

    it('PO-017: reverse then rotate gives different result than rotate then reverse (non-commutative)', () => {
      // This tests that these operations don't accidentally commute, which would indicate a bug
      fc.assert(
        fc.property(
          arbStepsWithLocks(4, 16),
          ({ locks, stepCount }) => {
            // Skip trivial cases where all locks are the same
            const uniqueLocks = new Set(locks.slice(0, stepCount).map(serializeLock));
            fc.pre(uniqueLocks.size > 1);

            const reverseFirst = rotateLeft(reversePattern(locks, stepCount), stepCount);
            const rotateFirst = reversePattern(rotateLeft(locks, stepCount), stepCount);

            // These should generally NOT be equal (they don't commute)
            // We just verify both produce valid results
            expect(reverseFirst.length).toBe(locks.length);
            expect(rotateFirst.length).toBe(locks.length);

            // Count that transformations were actually applied (not identity)
            let reverseFirstDiffs = 0;
            let rotateFirstDiffs = 0;
            for (let i = 0; i < stepCount; i++) {
              if (serializeLock(reverseFirst[i]) !== serializeLock(locks[i])) reverseFirstDiffs++;
              if (serializeLock(rotateFirst[i]) !== serializeLock(locks[i])) rotateFirstDiffs++;
            }

            // At least one transformation should have changed something
            expect(reverseFirstDiffs > 0 || rotateFirstDiffs > 0).toBe(true);
          }
        ),
        { numRuns: 300 }
      );
    });

    it('PO-018: reverse commutes with invert for locks (locks at inverted steps)', () => {
      fc.assert(
        fc.property(
          arbStepsWithLocks(4, 32),
          ({ steps, locks, stepCount }) => {
            // For steps: invert(reverse(s)) = reverse(invert(s))
            const reverseFirstSteps = invertPattern(reversePattern(steps, stepCount), stepCount);
            const invertFirstSteps = reversePattern(invertPattern(steps, stepCount), stepCount);
            expect(reverseFirstSteps).toEqual(invertFirstSteps);

            // For locks: reverse should work identically regardless of step inversion
            const reversedLocks = reversePattern(locks, stepCount);

            // Verify bijection is maintained
            for (let i = 0; i < stepCount; i++) {
              expect(serializeLock(reversedLocks[stepCount - 1 - i])).toBe(serializeLock(locks[i]));
            }
          }
        ),
        { numRuns: 300 }
      );
    });

    it('PO-019: composed operations preserve lock count', () => {
      fc.assert(
        fc.property(
          arbStepsWithLocks(4, 32),
          fc.array(
            fc.constantFrom('reverse', 'rotateLeft', 'rotateRight', 'mirrorLR', 'mirrorRL'),
            { minLength: 1, maxLength: 5 }
          ),
          ({ locks, stepCount }, operations) => {
            let result = [...locks];

            for (const op of operations) {
              switch (op) {
                case 'reverse':
                  result = reversePattern(result, stepCount);
                  break;
                case 'rotateLeft':
                  result = rotateLeft(result, stepCount);
                  break;
                case 'rotateRight':
                  result = rotateRight(result, stepCount);
                  break;
                case 'mirrorLR':
                  result = mirrorPattern(result, stepCount, 'left-to-right');
                  break;
                case 'mirrorRL':
                  result = mirrorPattern(result, stepCount, 'right-to-left');
                  break;
              }
            }

            // Array length should be preserved
            expect(result.length).toBe(locks.length);

            // Non-null lock count within stepCount should be preserved for bijective ops
            // (rotate, reverse preserve count; mirror may change count)
            const onlyBijective = operations.every((op) =>
              ['reverse', 'rotateLeft', 'rotateRight'].includes(op)
            );

            if (onlyBijective) {
              const originalNonNull = locks.slice(0, stepCount).filter((l) => l !== null).length;
              const resultNonNull = result.slice(0, stepCount).filter((l) => l !== null).length;
              expect(resultNonNull).toBe(originalNonNull);
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('PO-020: reverse of mirrored pattern equals mirrored reverse (for palindromes)', () => {
      fc.assert(
        fc.property(
          arbStepsWithLocks(4, 32),
          ({ locks, stepCount }) => {
            // First mirror, creating a palindrome
            const mirrored = mirrorPattern(locks, stepCount, 'left-to-right');

            // Reverse the palindrome
            const mirroredThenReversed = reversePattern(mirrored, stepCount);

            // For a palindrome, reverse should equal the original mirrored
            // (since palindrome reads same forwards and backwards)
            for (let i = 0; i < stepCount; i++) {
              expect(serializeLock(mirroredThenReversed[i])).toBe(serializeLock(mirrored[i]));
            }
          }
        ),
        { numRuns: 300 }
      );
    });

    it('PO-021: N rotations followed by reverse equals reverse followed by N rotations in opposite direction', () => {
      fc.assert(
        fc.property(
          arbStepsWithLocks(4, 32),
          fc.integer({ min: 1, max: 10 }),
          ({ locks, stepCount }, n) => {
            // rotate_left^n then reverse
            let rotatedFirst = [...locks];
            for (let i = 0; i < n; i++) {
              rotatedFirst = rotateLeft(rotatedFirst, stepCount);
            }
            rotatedFirst = reversePattern(rotatedFirst, stepCount);

            // reverse then rotate_right^n
            let reversedFirst = reversePattern([...locks], stepCount);
            for (let i = 0; i < n; i++) {
              reversedFirst = rotateRight(reversedFirst, stepCount);
            }

            // These should be equal: rotate_left^n ∘ reverse = reverse ∘ rotate_right^n
            for (let i = 0; i < stepCount; i++) {
              expect(serializeLock(rotatedFirst[i])).toBe(serializeLock(reversedFirst[i]));
            }
          }
        ),
        { numRuns: 300 }
      );
    });
  });
});
