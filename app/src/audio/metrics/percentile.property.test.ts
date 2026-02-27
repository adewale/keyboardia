/**
 * Property-Based Tests for Statistical Helpers
 *
 * Verifies mathematical invariants of percentile, mean, and stddev:
 * - percentile(0) = min, percentile(100) = max
 * - percentile is monotonically non-decreasing in p
 * - mean is bounded by [min, max]
 * - stddev is non-negative
 * - stddev of constant array is 0
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { percentile, mean, stddev } from './percentile';

// ─── Arbitraries ────────────────────────────────────────────────────────

const arbNonEmptyNumbers = fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 200 });
const arbPercentile = fc.double({ min: 0, max: 100, noNaN: true });

// ─── Percentile Properties ──────────────────────────────────────────────

describe('percentile properties', () => {
  it('p0 equals minimum value', () => {
    fc.assert(
      fc.property(arbNonEmptyNumbers, (values) => {
        expect(percentile(values, 0)).toBeCloseTo(Math.min(...values), 10);
      }),
      { numRuns: 200 }
    );
  });

  it('p100 equals maximum value', () => {
    fc.assert(
      fc.property(arbNonEmptyNumbers, (values) => {
        expect(percentile(values, 100)).toBeCloseTo(Math.max(...values), 10);
      }),
      { numRuns: 200 }
    );
  });

  it('result is bounded by [min, max]', () => {
    fc.assert(
      fc.property(arbNonEmptyNumbers, arbPercentile, (values, p) => {
        const result = percentile(values, p);
        const min = Math.min(...values);
        const max = Math.max(...values);
        expect(result).toBeGreaterThanOrEqual(min - 1e-10);
        expect(result).toBeLessThanOrEqual(max + 1e-10);
      }),
      { numRuns: 300 }
    );
  });

  it('is monotonically non-decreasing in p', () => {
    fc.assert(
      fc.property(arbNonEmptyNumbers, arbPercentile, arbPercentile, (values, p1, p2) => {
        const lo = Math.min(p1, p2);
        const hi = Math.max(p1, p2);
        expect(percentile(values, hi)).toBeGreaterThanOrEqual(percentile(values, lo) - 1e-10);
      }),
      { numRuns: 300 }
    );
  });

  it('constant array returns the constant for any percentile', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: 1, max: 50 }),
        arbPercentile,
        (val, len, p) => {
          const arr = new Array(len).fill(val);
          expect(percentile(arr, p)).toBeCloseTo(val, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not mutate the input array', () => {
    fc.assert(
      fc.property(arbNonEmptyNumbers, arbPercentile, (values, p) => {
        const copy = [...values];
        percentile(values, p);
        expect(values).toEqual(copy);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Mean Properties ────────────────────────────────────────────────────

describe('mean properties', () => {
  it('is bounded by [min, max]', () => {
    fc.assert(
      fc.property(arbNonEmptyNumbers, (values) => {
        const m = mean(values);
        expect(m).toBeGreaterThanOrEqual(Math.min(...values) - 1e-10);
        expect(m).toBeLessThanOrEqual(Math.max(...values) + 1e-10);
      }),
      { numRuns: 200 }
    );
  });

  it('constant array returns the constant', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: 1, max: 50 }),
        (val, len) => {
          const arr = new Array(len).fill(val);
          expect(mean(arr)).toBeCloseTo(val, 7);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('is invariant to element order (commutative)', () => {
    fc.assert(
      fc.property(arbNonEmptyNumbers, (values) => {
        const reversed = [...values].reverse();
        expect(mean(values)).toBeCloseTo(mean(reversed), 10);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Stddev Properties ──────────────────────────────────────────────────

describe('stddev properties', () => {
  it('is non-negative', () => {
    fc.assert(
      fc.property(arbNonEmptyNumbers, (values) => {
        expect(stddev(values)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 }
    );
  });

  it('constant array returns 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: 2, max: 50 }),
        (val, len) => {
          const arr = new Array(len).fill(val);
          expect(stddev(arr)).toBeCloseTo(0, 7);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('is invariant to translation (adding constant to all elements)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e3, max: 1e3, noNaN: true }), { minLength: 2, maxLength: 50 }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        (values, offset) => {
          const shifted = values.map(v => v + offset);
          expect(stddev(shifted)).toBeCloseTo(stddev(values), 5);
        }
      ),
      { numRuns: 100 }
    );
  });
});
