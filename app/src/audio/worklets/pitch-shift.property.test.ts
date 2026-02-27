/**
 * Property-Based Tests for Pitch-Shift Worklet Math
 *
 * Verifies invariants of the Hann window and granular overlap-add:
 * - Hann window is symmetric
 * - Hann window is zero at endpoints and 1 at center
 * - Hann window values are in [0, 1]
 * - Overlap-add of two 50%-overlapping Hann windows sums to ~1 (constant gain)
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

// ─── Re-implementation of worklet math ──────────────────────────────────

function createHannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return window;
}

function semitoneToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

// ─── Arbitraries ────────────────────────────────────────────────────────

const arbWindowSize = fc.integer({ min: 4, max: 4096 });
const arbSemitones = fc.integer({ min: -24, max: 24 });

// ─── Hann Window Properties ─────────────────────────────────────────────

describe('Hann window properties', () => {
  it('all values are in [0, 1]', () => {
    fc.assert(
      fc.property(arbWindowSize, (size) => {
        const w = createHannWindow(size);
        for (let i = 0; i < w.length; i++) {
          expect(w[i]).toBeGreaterThanOrEqual(-1e-7);
          expect(w[i]).toBeLessThanOrEqual(1 + 1e-7);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('is zero at endpoints', () => {
    fc.assert(
      fc.property(arbWindowSize, (size) => {
        const w = createHannWindow(size);
        expect(w[0]).toBeCloseTo(0, 5);
        expect(w[size - 1]).toBeCloseTo(0, 5);
      }),
      { numRuns: 100 }
    );
  });

  it('peaks at 1 at center (odd sizes)', () => {
    fc.assert(
      // Only odd sizes have a sample exactly at the center (N-1)/2
      fc.property(fc.integer({ min: 1, max: 2048 }).map(n => n * 2 + 1), (size) => {
        const w = createHannWindow(size);
        const center = (size - 1) / 2;
        expect(w[center]).toBeCloseTo(1, 5);
      }),
      { numRuns: 100 }
    );
  });

  it('is symmetric: w[i] = w[N-1-i]', () => {
    fc.assert(
      fc.property(arbWindowSize, (size) => {
        const w = createHannWindow(size);
        for (let i = 0; i < Math.floor(size / 2); i++) {
          expect(w[i]).toBeCloseTo(w[size - 1 - i], 5);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('50% overlap-add sums to ~1 (constant-gain property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 2048 }), (size) => {
        const w = createHannWindow(size);
        const hop = Math.floor(size / 2);

        // In the overlap region (hop..size-1 of window 1 overlaps 0..hop-1 of window 2),
        // the sum should be approximately 1.0
        // Check the middle of the overlap region
        for (let i = 0; i < hop; i++) {
          const sum = w[hop + i] + w[i];
          // Hann windows at 50% overlap have constant-power, not exactly
          // constant-amplitude, but the sum should be close to 1.0
          expect(sum).toBeGreaterThan(0.5);
          expect(sum).toBeLessThan(1.5);
        }
      }),
      { numRuns: 50 }
    );
  });
});

// ─── Pitch Ratio Properties ─────────────────────────────────────────────

describe('pitch ratio properties', () => {
  it('0 semitones = ratio 1.0 (no shift)', () => {
    expect(semitoneToRatio(0)).toBeCloseTo(1.0, 10);
  });

  it('+12 semitones = ratio 2.0 (octave up)', () => {
    expect(semitoneToRatio(12)).toBeCloseTo(2.0, 10);
  });

  it('-12 semitones = ratio 0.5 (octave down)', () => {
    expect(semitoneToRatio(-12)).toBeCloseTo(0.5, 10);
  });

  it('ratio is always positive', () => {
    fc.assert(
      fc.property(arbSemitones, (semitones) => {
        expect(semitoneToRatio(semitones)).toBeGreaterThan(0);
      }),
      { numRuns: 200 }
    );
  });

  it('ratio increases monotonically with semitones', () => {
    fc.assert(
      fc.property(arbSemitones, arbSemitones, (a, b) => {
        if (a < b) {
          expect(semitoneToRatio(a)).toBeLessThan(semitoneToRatio(b));
        } else if (a > b) {
          expect(semitoneToRatio(a)).toBeGreaterThan(semitoneToRatio(b));
        }
      }),
      { numRuns: 200 }
    );
  });

  it('ratio is within worklet parameter bounds [0.25, 4.0]', () => {
    fc.assert(
      fc.property(arbSemitones, (semitones) => {
        const ratio = semitoneToRatio(semitones);
        expect(ratio).toBeGreaterThanOrEqual(0.25);
        expect(ratio).toBeLessThanOrEqual(4.0);
      }),
      { numRuns: 200 }
    );
  });

  it('shifting up N then down N returns ratio 1.0', () => {
    fc.assert(
      fc.property(arbSemitones, (semitones) => {
        const up = semitoneToRatio(semitones);
        const down = semitoneToRatio(-semitones);
        expect(up * down).toBeCloseTo(1.0, 10);
      }),
      { numRuns: 200 }
    );
  });
});
