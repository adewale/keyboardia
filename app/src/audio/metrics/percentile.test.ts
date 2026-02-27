import { describe, it, expect } from 'vitest';
import { percentile, mean, stddev } from './percentile';

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('returns the single value for single-element array', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it('computes median (p50) correctly', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('computes p0 as minimum', () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
  });

  it('computes p100 as maximum', () => {
    expect(percentile([10, 20, 30], 100)).toBe(30);
  });

  it('interpolates for p75', () => {
    // [1, 2, 3, 4] → p75 index = 0.75 * 3 = 2.25 → 3 + 0.25*(4-3) = 3.25
    expect(percentile([1, 2, 3, 4], 75)).toBe(3.25);
  });

  it('handles unsorted input', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
  });

  it('does not mutate input array', () => {
    const arr = [5, 1, 3];
    percentile(arr, 50);
    expect(arr).toEqual([5, 1, 3]);
  });
});

describe('mean', () => {
  it('returns 0 for empty array', () => {
    expect(mean([])).toBe(0);
  });

  it('computes mean correctly', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([10])).toBe(10);
  });
});

describe('stddev', () => {
  it('returns 0 for single element', () => {
    expect(stddev([5])).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(stddev([])).toBe(0);
  });

  it('computes sample standard deviation', () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, variance=4, stddev=2
    const result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2, 0);
  });
});
