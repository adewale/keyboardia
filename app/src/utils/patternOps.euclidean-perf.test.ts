/**
 * Tests that the Euclidean algorithm produces correct results after
 * replacing JSON.stringify group comparison with direct array comparison.
 *
 * These tests verify behavioral equivalence — the output should be
 * identical regardless of the comparison implementation.
 */

import { describe, it, expect } from 'vitest';
import { euclidean } from './patternOps';

describe('euclidean: correctness after removing JSON.stringify', () => {
  // Reference patterns from ethnomusicology literature
  const KNOWN_PATTERNS: [number, number, boolean[]][] = [
    // E(3, 8) = Cuban tresillo
    [8, 3, [true, false, false, true, false, false, true, false]],
    // E(5, 8) = Cuban cinquillo
    [8, 5, [true, false, true, true, false, true, true, false]],
    // E(4, 12) = common 12/8 pattern
    [12, 4, [true, false, false, true, false, false, true, false, false, true, false, false]],
    // E(2, 5) = Persian khafif-e-ramal
    [5, 2, [true, false, true, false, false]],
    // E(3, 4) = cumbia (Bjorklund canonical rotation)
    [4, 3, [true, true, true, false]],
    // E(7, 16) = Brazilian samba
    [16, 7, [true, false, false, true, false, true, false, true, false, false, true, false, true, false, true, false]],
  ];

  for (const [steps, hits, expected] of KNOWN_PATTERNS) {
    it(`E(${hits}, ${steps}) produces correct pattern`, () => {
      const result = euclidean(steps, hits);
      expect(result).toEqual(expected);
    });
  }

  it('edge case: 0 hits produces all false', () => {
    expect(euclidean(8, 0)).toEqual(Array(8).fill(false));
  });

  it('edge case: hits === steps produces all true', () => {
    expect(euclidean(8, 8)).toEqual(Array(8).fill(true));
  });

  it('edge case: 1 hit produces single true at start', () => {
    const result = euclidean(8, 1);
    expect(result[0]).toBe(true);
    expect(result.filter(Boolean).length).toBe(1);
  });

  it('hit count is always exact', () => {
    for (let steps = 2; steps <= 32; steps++) {
      for (let hits = 0; hits <= steps; hits++) {
        const result = euclidean(steps, hits);
        expect(result.length).toBe(steps);
        expect(result.filter(Boolean).length).toBe(hits);
      }
    }
  });

  it('patterns are maximally even', () => {
    // E(3, 8): gaps between hits should be as equal as possible
    // [T,_,_,T,_,_,T,_] → gaps of 3, 3, 2
    const result = euclidean(8, 3);
    const gaps: number[] = [];
    let lastHit = -1;
    for (let i = 0; i < result.length; i++) {
      if (result[i]) {
        if (lastHit >= 0) gaps.push(i - lastHit);
        lastHit = i;
      }
    }
    // Wrap-around gap
    gaps.push(result.length - lastHit + result.indexOf(true));

    // Max gap - min gap should be <= 1 (maximally even)
    const maxGap = Math.max(...gaps);
    const minGap = Math.min(...gaps);
    expect(maxGap - minGap).toBeLessThanOrEqual(1);
  });
});
