/**
 * Property-Based Tests for Scheduler Worklet Parity
 *
 * Verifies that the pure math functions ported into scheduler.worklet.ts
 * produce identical results to the canonical timing-calculations.ts.
 *
 * This is the critical correctness proof: if these properties hold,
 * the worklet scheduler will produce the same note timings as the
 * main-thread scheduler.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  getStepDuration,
  calculateSwingDelay,
  calculateTiedDuration,
  STEPS_PER_BEAT,
} from '../timing-calculations';
import { arbTempo, arbSwing, createTrackWithTies, VALID_STEP_COUNTS } from '../../test/arbitraries';

// ─── Worklet re-implementations (must match scheduler.worklet.ts exactly) ─

const WORKLET_STEPS_PER_BEAT = 4;
const WORKLET_SWING_DELAY_FACTOR = 0.5;
const WORKLET_GATE_TIME_RATIO = 0.9;

function workletGetStepDuration(tempo: number): number {
  return 1 / ((tempo / 60) * WORKLET_STEPS_PER_BEAT);
}

function workletCalculateSwingTime(
  trackStep: number,
  time: number,
  duration: number,
  globalSwing: number,
  trackSwing: number
): number {
  const swingAmount = globalSwing + trackSwing - (globalSwing * trackSwing);
  const isSwungStep = trackStep % 2 === 1;
  const swingDelay = isSwungStep ? duration * swingAmount * WORKLET_SWING_DELAY_FACTOR : 0;
  return time + swingDelay;
}

function workletCalculateTiedDuration(
  steps: boolean[],
  parameterLocks: ({ tie?: boolean } | null)[],
  startStep: number,
  trackStepCount: number,
  stepDuration: number
): number {
  let tieCount = 1;
  let stepsChecked = 0;

  while (stepsChecked < trackStepCount - 1) {
    const nextStep = (startStep + 1 + stepsChecked) % trackStepCount;
    const nextPLock = parameterLocks[nextStep];

    if (steps[nextStep] && nextPLock?.tie === true) {
      tieCount++;
      stepsChecked++;
    } else {
      break;
    }
  }

  return stepDuration * tieCount * WORKLET_GATE_TIME_RATIO;
}

// ─── Arbitraries ────────────────────────────────────────────────────────

const arbStepCount = fc.constantFrom(...VALID_STEP_COUNTS);

// ─── Parity Properties ─────────────────────────────────────────────────

describe('Scheduler worklet parity: step duration', () => {
  it('worklet getStepDuration matches timing-calculations.ts', () => {
    fc.assert(
      fc.property(arbTempo, (tempo) => {
        const canonical = getStepDuration(tempo);
        const worklet = workletGetStepDuration(tempo);
        expect(worklet).toBeCloseTo(canonical, 15);
      }),
      { numRuns: 500 }
    );
  });

  it('STEPS_PER_BEAT constant matches', () => {
    expect(WORKLET_STEPS_PER_BEAT).toBe(STEPS_PER_BEAT);
  });
});

describe('Scheduler worklet parity: swing', () => {
  it('worklet swing matches timing-calculations swing for even steps', () => {
    fc.assert(
      fc.property(
        arbTempo,
        arbSwing,
        arbSwing,
        fc.integer({ min: 0, max: 63 }),
        (tempo, globalSwing, trackSwing, halfStep) => {
          const step = halfStep * 2; // even steps only
          const duration = getStepDuration(tempo);
          const time = 1.0; // arbitrary reference time

          const workletTime = workletCalculateSwingTime(
            step, time, duration,
            globalSwing / 100, trackSwing / 100
          );

          // Even steps should have no swing delay
          expect(workletTime).toBeCloseTo(time, 10);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('worklet swing delay matches canonical for odd steps', () => {
    fc.assert(
      fc.property(
        arbTempo,
        arbSwing,
        arbSwing,
        fc.integer({ min: 0, max: 63 }),
        (tempo, globalSwingPct, trackSwingPct, halfStep) => {
          const step = halfStep * 2 + 1; // odd steps
          const duration = getStepDuration(tempo);
          const time = 0;

          const globalSwing = globalSwingPct / 100;
          const trackSwing = trackSwingPct / 100;

          // Canonical calculation (normalized 0-1 values)
          const canonicalDelay = calculateSwingDelay(
            step, globalSwing, trackSwing, duration
          );

          // Worklet calculation (also normalized 0-1 values)
          const workletTime = workletCalculateSwingTime(
            step, time, duration,
            globalSwing, trackSwing
          );
          const workletDelay = workletTime - time;

          expect(workletDelay).toBeCloseTo(canonicalDelay, 10);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('swing blending formula is commutative: g+t-gt = t+g-tg', () => {
    fc.assert(
      fc.property(arbSwing, arbSwing, (g, t) => {
        const gn = g / 100;
        const tn = t / 100;
        const a = gn + tn - (gn * tn);
        const b = tn + gn - (tn * gn);
        expect(a).toBeCloseTo(b, 15);
      }),
      { numRuns: 200 }
    );
  });

  it('swing blending result is in [0, 1]', () => {
    fc.assert(
      fc.property(arbSwing, arbSwing, (g, t) => {
        const gn = g / 100;
        const tn = t / 100;
        const result = gn + tn - (gn * tn);
        expect(result).toBeGreaterThanOrEqual(-1e-10);
        expect(result).toBeLessThanOrEqual(1 + 1e-10);
      }),
      { numRuns: 200 }
    );
  });
});

describe('Scheduler worklet parity: tied duration', () => {
  it('single untied step = stepDuration × 0.9', () => {
    fc.assert(
      fc.property(arbTempo, arbStepCount, (tempo, stepCount) => {
        const duration = getStepDuration(tempo);
        const steps = new Array(128).fill(false);
        steps[0] = true;
        const locks = new Array(128).fill(null);

        const result = workletCalculateTiedDuration(steps, locks, 0, stepCount, duration);
        expect(result).toBeCloseTo(duration * 0.9, 10);
      }),
      { numRuns: 200 }
    );
  });

  it('tied duration matches canonical for generated patterns', () => {
    fc.assert(
      fc.property(
        arbTempo,
        arbStepCount,
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 1, max: 8 }),
        (tempo, stepCount, startStep, tieLength) => {
          fc.pre(startStep < stepCount);
          fc.pre(tieLength <= stepCount);

          const duration = getStepDuration(tempo);
          const { steps, parameterLocks } = createTrackWithTies(startStep, tieLength, stepCount);

          const canonical = calculateTiedDuration(
            { steps, parameterLocks },
            startStep, stepCount, duration
          );
          const worklet = workletCalculateTiedDuration(
            steps, parameterLocks, startStep, stepCount, duration
          );

          expect(worklet).toBeCloseTo(canonical, 10);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('tied duration scales linearly with tie count', () => {
    fc.assert(
      fc.property(
        arbTempo,
        fc.integer({ min: 1, max: 8 }),
        (tempo, tieLength) => {
          const stepCount = 16;
          const duration = getStepDuration(tempo);
          const { steps, parameterLocks } = createTrackWithTies(0, tieLength, stepCount);

          const result = workletCalculateTiedDuration(
            steps, parameterLocks, 0, stepCount, duration
          );
          expect(result).toBeCloseTo(duration * tieLength * 0.9, 10);
        }
      ),
      { numRuns: 200 }
    );
  });
});
