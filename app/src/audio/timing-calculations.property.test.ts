/**
 * Property-Based Tests for Pure Timing Calculations
 *
 * These tests verify the pure timing functions extracted from the Scheduler.
 * Since these are pure functions, they can be tested directly without mocks.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  getStepDuration,
  calculateSwingDelay,
  calculateStepTime,
  advanceStep,
  STEPS_PER_BEAT,
  MAX_STEPS,
} from './timing-calculations';
import { arbTempo, arbSwing } from '../test/arbitraries';
import { seconds } from './audio-time';

// =============================================================================
// Step Duration Properties
// =============================================================================

describe('getStepDuration properties', () => {
  it('duration decreases as tempo increases', () => {
    fc.assert(
      fc.property(arbTempo, arbTempo, (tempo1, tempo2) => {
        // Distinctness is the property's domain (strict monotonicity needs two
        // tempos), not a perf constraint: rejection is 1/121 pairs (~0.8%).
        fc.pre(tempo1 !== tempo2);
        const d1 = getStepDuration(tempo1);
        const d2 = getStepDuration(tempo2);
        if (tempo1 < tempo2) {
          expect(d1).toBeGreaterThan(d2);
        } else {
          expect(d1).toBeLessThan(d2);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('duration is always positive', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), (tempo) => {
        const d = getStepDuration(tempo);
        expect(d).toBeGreaterThan(0);
        expect(Number.isFinite(d)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('duration formula is correct: 60 / (tempo * STEPS_PER_BEAT)', () => {
    fc.assert(
      fc.property(arbTempo, (tempo) => {
        const actual = getStepDuration(tempo);
        const expected = 60 / (tempo * STEPS_PER_BEAT);
        expect(actual).toBeCloseTo(expected, 10);
      }),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// Swing Delay Properties
// =============================================================================

describe('calculateSwingDelay properties', () => {
  it('even steps always have zero delay', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }).map((n) => n * 2), // Even steps
        arbSwing.map((s) => s / 100),
        arbSwing.map((s) => s / 100),
        arbTempo,
        (step, globalSwing, trackSwing, tempo) => {
          const stepDuration = getStepDuration(tempo);
          const delay = calculateSwingDelay(step, globalSwing, trackSwing, stepDuration);
          expect(delay).toBe(0);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('delay is non-negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 127 }),
        arbSwing.map((s) => s / 100),
        arbSwing.map((s) => s / 100),
        arbTempo,
        (step, globalSwing, trackSwing, tempo) => {
          const stepDuration = getStepDuration(tempo);
          const delay = calculateSwingDelay(step, globalSwing, trackSwing, stepDuration);
          expect(delay).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('delay is at most half of step duration for odd steps', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }).map((n) => n * 2 + 1), // Odd steps
        arbSwing.map((s) => s / 100),
        arbSwing.map((s) => s / 100),
        arbTempo,
        (step, globalSwing, trackSwing, tempo) => {
          const stepDuration = getStepDuration(tempo);
          const delay = calculateSwingDelay(step, globalSwing, trackSwing, stepDuration);
          expect(delay).toBeLessThanOrEqual(stepDuration * 0.5 + 0.0001); // Small epsilon for float
        }
      ),
      { numRuns: 300 }
    );
  });

  it('swing blending formula is monotonic', () => {
    fc.assert(
      fc.property(
        // Ordered pair built constructively (issue #97 T3): lo in [0,99],
        // hi in (lo,100]. The old form drew two swings and rejected half of
        // all runs with fc.pre(swing1 < swing2).
        fc.tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 1, max: 100 }))
          .map(([lo, gap]) => [lo / 100, Math.min(100, lo + gap) / 100] as const),
        // Exclude trackSwing=1.0 where formula becomes constant (1.0 regardless of globalSwing)
        fc.integer({ min: 0, max: 99 }).map((s) => s / 100),
        arbTempo,
        ([swing1, swing2], trackSwing, tempo) => {
          const stepDuration = getStepDuration(tempo);
          const delay1 = calculateSwingDelay(1, swing1, trackSwing, stepDuration);
          const delay2 = calculateSwingDelay(1, swing2, trackSwing, stepDuration);
          expect(delay2).toBeGreaterThanOrEqual(delay1);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// Step Time Properties
// =============================================================================

describe('calculateStepTime properties', () => {
  it('later steps have later times', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1000, noNaN: true }),
        arbTempo,
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 20 }),
        (startTime, tempo, stepIndices) => {
          const sorted = [...stepIndices].sort((a, b) => a - b);
          for (let i = 1; i < sorted.length; i++) {
            const t1 = calculateStepTime(seconds(startTime), sorted[i - 1], tempo);
            const t2 = calculateStepTime(seconds(startTime), sorted[i], tempo);
            expect(t2).toBeGreaterThanOrEqual(t1);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('time is monotonically increasing with step index', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100, noNaN: true }),
        arbTempo,
        fc.integer({ min: 0, max: 100 }),
        (startTime, tempo, step) => {
          const t1 = calculateStepTime(seconds(startTime), step, tempo);
          const t2 = calculateStepTime(seconds(startTime), step + 1, tempo);
          expect(t2).toBeGreaterThan(t1);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// =============================================================================
// Advance Step Properties
// =============================================================================

describe('advanceStep properties', () => {
  it('with loop region, step stays within bounds', () => {
    fc.assert(
      fc.property(
        // Ordered loop region built constructively (issue #97 T3): start in
        // [0,126], end in (start,127]. The old form rejected half of all runs.
        fc.tuple(fc.integer({ min: 0, max: 126 }), fc.integer({ min: 1, max: 127 }))
          .map(([s, gap]) => [s, Math.min(127, s + gap)] as const),
        fc.integer({ min: 0, max: 127 }),
        ([start, end], current) => {
          const loopRegion = { start, end };
          const next = advanceStep(current, loopRegion);
          if (current >= end) {
            expect(next).toBe(start);
          } else {
            expect(next).toBe(current + 1);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('without loop region, wraps at MAX_STEPS', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_STEPS - 1 }), (current) => {
        const next = advanceStep(current, null);
        expect(next).toBe((current + 1) % MAX_STEPS);
      }),
      { numRuns: 200 }
    );
  });

  it('at MAX_STEPS - 1 without loop, wraps to 0', () => {
    const next = advanceStep(MAX_STEPS - 1, null);
    expect(next).toBe(0);
  });
});
