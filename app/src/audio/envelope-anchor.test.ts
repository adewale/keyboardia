/**
 * Regression test for bug_009: pitch-shift envelope ramp anchored to
 * event time, not actual start time.
 *
 * The pitch worklet buffers one grain (~21 ms at 48 kHz) before producing
 * audible output. The envelope click-prevention ramp must run over the
 * leading edge of that audio. Previously the ramp anchor was
 * `time + pitchLatencySec`, but `source.start(...)` clamps the start to
 * `Math.max(time, currentTime)` for late-arriving notes. With even 4 ms of
 * receive lateness the ramp resolved entirely in the past — Web Audio
 * sets the gain to its post-ramp value immediately, so the first grain
 * arrives at full volume and the user hears a click.
 *
 * Fix: anchor envStart to `actualStartTime + pitchLatencySec`.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeEnvelopeStart } from './envelope-anchor';

describe('computeEnvelopeStart (bug_009)', () => {
  it('is event time + grain latency when the note is on time', () => {
    const out = computeEnvelopeStart({ eventTime: 5.0, currentTime: 4.95, pitchLatencySec: 0.021 });
    expect(out).toBeCloseTo(5.021, 5);
  });

  it('is current time + grain latency when the note is late (clamped)', () => {
    const out = computeEnvelopeStart({ eventTime: 5.0, currentTime: 5.05, pitchLatencySec: 0.021 });
    expect(out).toBeCloseTo(5.071, 5);
  });

  it('falls back to event time when no pitch worklet is in chain (latency = 0)', () => {
    const out = computeEnvelopeStart({ eventTime: 5.0, currentTime: 4.0, pitchLatencySec: 0 });
    expect(out).toBe(5.0);
  });

  // Lesson 33: explicit triple at the eventTime/currentTime equality boundary.
  describe('boundary triple at eventTime === currentTime', () => {
    it('eventTime just before currentTime → uses currentTime', () => {
      const out = computeEnvelopeStart({ eventTime: 4.999, currentTime: 5.0, pitchLatencySec: 0.02 });
      expect(out).toBeCloseTo(5.02, 6);
    });
    it('eventTime exactly equal → uses either (both = 5.0) + latency', () => {
      const out = computeEnvelopeStart({ eventTime: 5.0, currentTime: 5.0, pitchLatencySec: 0.02 });
      expect(out).toBeCloseTo(5.02, 6);
    });
    it('eventTime just after currentTime → uses eventTime', () => {
      const out = computeEnvelopeStart({ eventTime: 5.001, currentTime: 5.0, pitchLatencySec: 0.02 });
      expect(out).toBeCloseTo(5.021, 6);
    });
  });

  // Property: envelope start is never in the past relative to currentTime.
  // This is the load-bearing invariant — a ramp scheduled in the past
  // resolves immediately and bypasses click-prevention.
  it('pbt: envelope start is always at or after currentTime', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        (eventTime, currentTime, pitchLatencySec) => {
          const out = computeEnvelopeStart({ eventTime, currentTime, pitchLatencySec });
          expect(out).toBeGreaterThanOrEqual(currentTime + pitchLatencySec - 1e-9);
        },
      ),
      { numRuns: 300, seed: 0x4ce5e774 },
    );
  });

  // Property: when latency is zero, envStart is max(eventTime, currentTime).
  // When latency > 0, envStart is the same plus the latency.
  it('pbt: envStart equals max(event, current) + pitchLatencySec', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (eventTime, currentTime, pitchLatencySec) => {
          const out = computeEnvelopeStart({ eventTime, currentTime, pitchLatencySec });
          const expected = Math.max(eventTime, currentTime) + pitchLatencySec;
          expect(out).toBeCloseTo(expected, 6);
        },
      ),
      { numRuns: 300, seed: 0x4ce5e775 },
    );
  });
});
