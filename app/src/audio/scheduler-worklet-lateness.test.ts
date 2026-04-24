/**
 * Tests for main-thread receive-lateness measurement.
 *
 * The worklet's self-reported "jitter" (|nextStepTime - intendedTime|) is
 * always ~0 because both values come from the same arithmetic. The number
 * that actually matters for audible timing is how late the host receives
 * each note event relative to event.time.
 */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { computeReceiveLateness, measureAndReportLateness } from './scheduler-worklet-lateness';

describe('computeReceiveLateness', () => {
  it('returns positive lateness when current time has passed event time', () => {
    const result = computeReceiveLateness({ eventTime: 5.0, currentTime: 5.05 });
    expect(result.latenessMs).toBeCloseTo(50, 5);
    expect(result.isLate).toBe(true);
  });

  it('returns negative lateness when event is still in the future (on time)', () => {
    const result = computeReceiveLateness({ eventTime: 5.0, currentTime: 4.98 });
    expect(result.latenessMs).toBeCloseTo(-20, 5);
    expect(result.isLate).toBe(false);
  });

  it('is zero at exact delivery', () => {
    const result = computeReceiveLateness({ eventTime: 5.0, currentTime: 5.0 });
    expect(result.latenessMs).toBe(0);
    expect(result.isLate).toBe(false);
  });

  // Property-based: the relationship latenessMs = (currentTime - eventTime) * 1000
  // must hold for all finite floats in a realistic audio-time range.
  it('satisfies latenessMs = (currentTime - eventTime) * 1000 for arbitrary inputs', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (eventTime, currentTime) => {
          const result = computeReceiveLateness({ eventTime, currentTime });
          const expectedMs = (currentTime - eventTime) * 1000;
          expect(result.latenessMs).toBeCloseTo(expectedMs, 5);
          expect(result.isLate).toBe(expectedMs > 0);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('magnitude (absolute lateness) is always non-negative', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (eventTime, currentTime) => {
          const result = computeReceiveLateness({ eventTime, currentTime });
          expect(Math.abs(result.latenessMs)).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });

  it('is symmetric about zero: swapping eventTime and currentTime negates lateness', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (a, b) => {
          const forward = computeReceiveLateness({ eventTime: a, currentTime: b });
          const reverse = computeReceiveLateness({ eventTime: b, currentTime: a });
          expect(forward.latenessMs).toBeCloseTo(-reverse.latenessMs, 5);
        }
      )
    );
  });
});

describe('measureAndReportLateness', () => {
  function makeMetricsSpy() {
    return {
      recordJitter: vi.fn(),
      recordLateNote: vi.fn(),
    };
  }

  it('records absolute lateness as the jitter sample', () => {
    const metrics = makeMetricsSpy();
    measureAndReportLateness(5.0, 5.05, metrics);
    expect(metrics.recordJitter).toHaveBeenCalledTimes(1);
    expect(metrics.recordJitter.mock.calls[0][0]).toBeCloseTo(50, 5);
  });

  it('does not record a late-note when delivery was early', () => {
    const metrics = makeMetricsSpy();
    measureAndReportLateness(5.0, 4.95, metrics);
    expect(metrics.recordJitter).toHaveBeenCalledTimes(1);
    expect(metrics.recordJitter.mock.calls[0][0]).toBeCloseTo(50, 5);
    expect(metrics.recordLateNote).not.toHaveBeenCalled();
  });

  it('records a late-note when delivery missed the intended time', () => {
    const metrics = makeMetricsSpy();
    measureAndReportLateness(5.0, 5.1, metrics);
    expect(metrics.recordJitter.mock.calls[0][0]).toBeCloseTo(100, 5);
    expect(metrics.recordLateNote).toHaveBeenCalledTimes(1);
  });

  // The critical property that kills the bogus-metric bug: if lateness varies,
  // the recorded jitter samples must vary too. The old worklet-internal metric
  // was always ~0 regardless of actual delivery time.
  it('records different jitter values when lateness varies (not a constant)', () => {
    const metrics = makeMetricsSpy();
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            eventTime: fc.double({ min: 1, max: 100, noNaN: true }),
            currentTime: fc.double({ min: 1, max: 100, noNaN: true }),
          }),
          { minLength: 5, maxLength: 20 }
        ),
        (samples) => {
          metrics.recordJitter.mockClear();
          metrics.recordLateNote.mockClear();
          for (const s of samples) {
            measureAndReportLateness(s.eventTime, s.currentTime, metrics);
          }
          expect(metrics.recordJitter).toHaveBeenCalledTimes(samples.length);

          const recorded = metrics.recordJitter.mock.calls.map(c => c[0] as number);
          const expected = samples.map(s => Math.abs((s.currentTime - s.eventTime) * 1000));
          for (let i = 0; i < samples.length; i++) {
            expect(recorded[i]).toBeCloseTo(expected[i], 5);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
