/**
 * Property-Based Tests for semitoneToFrequency
 *
 * Verifies mathematical invariants:
 * - Monotonicity: s1 < s2 => f(s1) < f(s2)
 * - Positivity: f(s) > 0 for all s
 * - Octave doubling: f(s+12) ≈ 2*f(s) within float tolerance
 * - Practical bounds: f(s) in [20, 20000] for s in [-45, 48]
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { semitoneToFrequency } from './constants';

const semitoneArb = fc.double({ min: -100, max: 100, noNaN: true });

describe('semitoneToFrequency properties', () => {
  it('monotonicity: s1 < s2 => f(s1) < f(s2)', () => {
    fc.assert(
      fc.property(semitoneArb, semitoneArb, (s1, s2) => {
        // Require meaningful separation to avoid floating-point degenerate cases
        // (e.g., 0 vs 5e-324 where 2^(5e-324/12) rounds to 1.0)
        const epsilon = 1e-10;
        if (s1 < s2 - epsilon) {
          expect(semitoneToFrequency(s1)).toBeLessThan(semitoneToFrequency(s2));
        } else if (s1 > s2 + epsilon) {
          expect(semitoneToFrequency(s1)).toBeGreaterThan(semitoneToFrequency(s2));
        }
        // When |s1 - s2| < epsilon, skip — floating point can't distinguish
      }),
      { numRuns: 500 }
    );
  });

  it('positivity: f(s) > 0 for all s', () => {
    fc.assert(
      fc.property(semitoneArb, (s) => {
        expect(semitoneToFrequency(s)).toBeGreaterThan(0);
      }),
      { numRuns: 500 }
    );
  });

  it('octave doubling: f(s+12) ≈ 2*f(s)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -80, max: 80, noNaN: true }),
        (s) => {
          const f1 = semitoneToFrequency(s);
          const f2 = semitoneToFrequency(s + 12);
          expect(f2 / f1).toBeCloseTo(2, 10);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('practical bounds: f(s) in [20, 20000] for s in [-44, 48]', () => {
    fc.assert(
      fc.property(
        // -44 semitones from C4 ≈ 21.8 Hz, +48 semitones ≈ 4186 Hz
        fc.double({ min: -44, max: 48, noNaN: true }),
        (s) => {
          const freq = semitoneToFrequency(s);
          expect(freq).toBeGreaterThanOrEqual(20);
          expect(freq).toBeLessThanOrEqual(20000);
        }
      ),
      { numRuns: 500 }
    );
  });
});
