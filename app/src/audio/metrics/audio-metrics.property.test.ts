/**
 * Property-Based Tests for AudioMetricsCollector
 *
 * Verifies invariants of sampling, snapshot, and reset:
 * - Sampling records exactly 1 in every N events
 * - Reset clears all accumulated state
 * - Snapshot percentiles are monotonically ordered (p50 ≤ p95 ≤ p99 ≤ max)
 * - Sample rate floor is 1 (no zero-division)
 * - Drift lookup returns closest sample
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioMetricsCollector } from './audio-metrics';

// ─── Setup ──────────────────────────────────────────────────────────────

// Stub PerformanceObserver to avoid browser-only API errors
vi.stubGlobal('PerformanceObserver', undefined);

let collector: AudioMetricsCollector;

beforeEach(() => {
  collector = new AudioMetricsCollector();
});

// ─── Arbitraries ────────────────────────────────────────────────────────

const arbSampleRate = fc.integer({ min: 1, max: 50 });
const arbJitterValues = fc.array(
  fc.double({ min: 0, max: 100, noNaN: true }),
  { minLength: 1, maxLength: 500 }
);
const arbLatencyValues = fc.array(
  fc.double({ min: 0, max: 200, noNaN: true }),
  { minLength: 1, maxLength: 500 }
);

// ─── Sampling Properties ────────────────────────────────────────────────

describe('AudioMetricsCollector sampling properties', () => {
  it('records exactly floor(N / sampleRate) jitter samples from N events', () => {
    fc.assert(
      fc.property(arbSampleRate, arbJitterValues, (rate, values) => {
        collector = new AudioMetricsCollector();
        collector.setSampleRate(rate);

        for (const v of values) {
          collector.recordJitter(v);
        }

        const snapshot = collector.getSnapshot();
        const expectedSamples = Math.floor(values.length / rate);
        expect(snapshot.scheduler.samples).toBe(expectedSamples);
      }),
      { numRuns: 200 }
    );
  });

  it('records exactly floor(N / sampleRate) latency samples from N events', () => {
    fc.assert(
      fc.property(arbSampleRate, arbLatencyValues, (rate, values) => {
        collector = new AudioMetricsCollector();
        collector.setSampleRate(rate);

        for (const v of values) {
          collector.recordInputLatency(v);
        }

        const snapshot = collector.getSnapshot();
        const expectedSamples = Math.floor(values.length / rate);
        expect(snapshot.inputLatency.samples).toBe(expectedSamples);
      }),
      { numRuns: 200 }
    );
  });

  it('sampleRate=1 records every event', () => {
    fc.assert(
      fc.property(arbJitterValues, (values) => {
        collector = new AudioMetricsCollector();
        collector.setSampleRate(1);

        for (const v of values) {
          collector.recordJitter(v);
        }

        const snapshot = collector.getSnapshot();
        expect(snapshot.scheduler.samples).toBe(values.length);
      }),
      { numRuns: 100 }
    );
  });

  it('setSampleRate floors to 1 (no zero/negative rates)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 0 }),
        arbJitterValues,
        (rate, values) => {
          collector = new AudioMetricsCollector();
          collector.setSampleRate(rate);

          // Should behave as sampleRate=1 (record every event)
          for (const v of values) {
            collector.recordJitter(v);
          }

          const snapshot = collector.getSnapshot();
          expect(snapshot.scheduler.samples).toBe(values.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Snapshot Percentile Ordering ───────────────────────────────────────

describe('AudioMetricsCollector snapshot properties', () => {
  it('jitter percentiles are ordered: p50 ≤ p95 ≤ p99 ≤ max', () => {
    fc.assert(
      fc.property(arbJitterValues, (values) => {
        collector = new AudioMetricsCollector();
        collector.setSampleRate(1);

        for (const v of values) {
          collector.recordJitter(v);
        }

        const snapshot = collector.getSnapshot();
        expect(snapshot.scheduler.p50).toBeLessThanOrEqual(snapshot.scheduler.p95 + 1e-10);
        expect(snapshot.scheduler.p95).toBeLessThanOrEqual(snapshot.scheduler.p99 + 1e-10);
        expect(snapshot.scheduler.p99).toBeLessThanOrEqual(snapshot.scheduler.max + 1e-10);
      }),
      { numRuns: 200 }
    );
  });

  it('latency percentiles are ordered: p50 ≤ p95 ≤ p99', () => {
    fc.assert(
      fc.property(arbLatencyValues, (values) => {
        collector = new AudioMetricsCollector();
        collector.setSampleRate(1);

        for (const v of values) {
          collector.recordInputLatency(v);
        }

        const snapshot = collector.getSnapshot();
        expect(snapshot.inputLatency.p50).toBeLessThanOrEqual(snapshot.inputLatency.p95 + 1e-10);
        expect(snapshot.inputLatency.p95).toBeLessThanOrEqual(snapshot.inputLatency.p99 + 1e-10);
      }),
      { numRuns: 200 }
    );
  });

  it('snapshot with no data returns zeros', () => {
    collector = new AudioMetricsCollector();
    const snapshot = collector.getSnapshot();
    expect(snapshot.scheduler.p50).toBe(0);
    expect(snapshot.scheduler.p95).toBe(0);
    expect(snapshot.scheduler.p99).toBe(0);
    expect(snapshot.scheduler.max).toBe(0);
    expect(snapshot.scheduler.samples).toBe(0);
    expect(snapshot.inputLatency.samples).toBe(0);
  });

  it('max equals the maximum of all recorded jitter values', () => {
    fc.assert(
      fc.property(arbJitterValues, (values) => {
        collector = new AudioMetricsCollector();
        collector.setSampleRate(1);

        for (const v of values) {
          collector.recordJitter(v);
        }

        const snapshot = collector.getSnapshot();
        const expectedMax = Math.max(...values);
        expect(snapshot.scheduler.max).toBeCloseTo(expectedMax, 10);
      }),
      { numRuns: 200 }
    );
  });
});

// ─── Reset Properties ──────────────────────────────────────────────────

describe('AudioMetricsCollector reset properties', () => {
  it('reset clears all jitter and latency samples', () => {
    fc.assert(
      fc.property(arbJitterValues, arbLatencyValues, (jitters, latencies) => {
        collector = new AudioMetricsCollector();
        collector.setSampleRate(1);

        for (const v of jitters) collector.recordJitter(v);
        for (const v of latencies) collector.recordInputLatency(v);

        collector.reset();

        const snapshot = collector.getSnapshot();
        expect(snapshot.scheduler.samples).toBe(0);
        expect(snapshot.inputLatency.samples).toBe(0);
        expect(snapshot.scheduler.max).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('recording after reset starts fresh', () => {
    fc.assert(
      fc.property(
        arbJitterValues,
        fc.array(fc.double({ min: 0, max: 50, noNaN: true }), { minLength: 1, maxLength: 100 }),
        (before, after) => {
          collector = new AudioMetricsCollector();
          collector.setSampleRate(1);

          for (const v of before) collector.recordJitter(v);
          collector.reset();
          for (const v of after) collector.recordJitter(v);

          const snapshot = collector.getSnapshot();
          expect(snapshot.scheduler.samples).toBe(after.length);
          expect(snapshot.scheduler.max).toBeCloseTo(Math.max(...after), 10);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Drift Lookup Properties ────────────────────────────────────────────

describe('AudioMetricsCollector drift properties', () => {
  it('getDriftAtStep returns 0 when no drift recorded', () => {
    collector = new AudioMetricsCollector();
    expect(collector.getDriftAtStep(100)).toBe(0);
  });

  it('getDriftAtStep returns closest sample by step count', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            stepCount: fc.integer({ min: 0, max: 10000 }),
            driftMs: fc.double({ min: -10, max: 10, noNaN: true }),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        fc.integer({ min: 0, max: 10000 }),
        (samples, queryStep) => {
          collector = new AudioMetricsCollector();

          for (const s of samples) {
            collector.recordDrift(s.stepCount, s.driftMs);
          }

          const result = collector.getDriftAtStep(queryStep);

          // Find the expected closest sample
          let closest = samples[0];
          for (const s of samples) {
            if (Math.abs(s.stepCount - queryStep) < Math.abs(closest.stepCount - queryStep)) {
              closest = s;
            }
          }

          expect(result).toBeCloseTo(closest.driftMs, 10);
        }
      ),
      { numRuns: 100 }
    );
  });
});
