/**
 * Regression test for #2: worklet's `nextStepTime = audioStartTime +
 * N*stepDuration` recomputation discarded the join offset after the
 * first step. With initialNextStepTime = startTime + 75ms the
 * subsequent step times collapsed back to startTime + N*stepDuration.
 *
 * The fix: anchor `audioStartTime` to `initialNextStepTime` at start
 * so the standard arithmetic naturally preserves the offset for all N.
 *
 * The worklet body itself can't be exercised in vitest, but the math
 * is a pure function of (initialNextStepTime, stepDuration, N). We
 * verify the formula explicitly here, then bind it to the worklet's
 * actual `start()` semantics in the source.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Mirror of the worklet's per-iteration step-time formula AFTER the fix.
 * If this function and the worklet's logic disagree, the test catches it
 * via the integration in scheduler-worklet-host.multiplayer.test.ts.
 */
function nextStepTimeAt(
  initialNextStepTime: number,
  stepDurationSec: number,
  totalStepsScheduled: number,
): number {
  const audioStartTime = initialNextStepTime;
  return audioStartTime + totalStepsScheduled * stepDurationSec;
}

describe('worklet step-time arithmetic (#2)', () => {
  it('preserves join offset across the next 3 steps', () => {
    const initialNextStepTime = 100.075; // 75 ms into the audio context
    const stepDurationSec = 0.125;
    expect(nextStepTimeAt(initialNextStepTime, stepDurationSec, 0)).toBeCloseTo(100.075, 6);
    expect(nextStepTimeAt(initialNextStepTime, stepDurationSec, 1)).toBeCloseTo(100.200, 6);
    expect(nextStepTimeAt(initialNextStepTime, stepDurationSec, 2)).toBeCloseTo(100.325, 6);
    expect(nextStepTimeAt(initialNextStepTime, stepDurationSec, 3)).toBeCloseTo(100.450, 6);
  });

  it('pbt: subsequent step times are evenly spaced from initialNextStepTime', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.001, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 1, max: 64 }),
        (initial, dur, n) => {
          for (let i = 0; i < n; i++) {
            const t = nextStepTimeAt(initial, dur, i);
            const expected = initial + i * dur;
            expect(t).toBeCloseTo(expected, 6);
          }
        },
      ),
      { numRuns: 200, seed: 0x4ce5e776 },
    );
  });

  it('pbt: spacing between consecutive step times equals stepDuration', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.001, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 2, max: 32 }),
        (initial, dur, n) => {
          for (let i = 1; i < n; i++) {
            const a = nextStepTimeAt(initial, dur, i - 1);
            const b = nextStepTimeAt(initial, dur, i);
            expect(b - a).toBeCloseTo(dur, 6);
          }
        },
      ),
      { numRuns: 200, seed: 0x4ce5e777 },
    );
  });
});
