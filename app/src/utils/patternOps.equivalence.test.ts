/**
 * Equivalence Proof for arraysEqual
 *
 * PBT: arraysEqual(a, b) === (JSON.stringify(a) === JSON.stringify(b))
 * for boolean arrays. This proves the optimized implementation matches
 * the JSON.stringify approach it replaced.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { arraysEqual } from './patternOps';

const boolArrayArb = fc.array(fc.boolean(), { minLength: 0, maxLength: 64 });

describe('arraysEqual equivalence proof', () => {
  it('matches JSON.stringify comparison for all boolean array pairs', () => {
    fc.assert(
      fc.property(boolArrayArb, boolArrayArb, (a, b) => {
        const fast = arraysEqual(a, b);
        const reference = JSON.stringify(a) === JSON.stringify(b);
        expect(fast).toBe(reference);
      }),
      { numRuns: 1000 }
    );
  });

  it('is reflexive: arraysEqual(a, a) is always true', () => {
    fc.assert(
      fc.property(boolArrayArb, (a) => {
        expect(arraysEqual(a, a)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('is symmetric: arraysEqual(a, b) === arraysEqual(b, a)', () => {
    fc.assert(
      fc.property(boolArrayArb, boolArrayArb, (a, b) => {
        expect(arraysEqual(a, b)).toBe(arraysEqual(b, a));
      }),
      { numRuns: 500 }
    );
  });
});
