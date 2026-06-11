import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { velocityFromMultiplier, MIDI_VELOCITY_MAX } from './velocity';

/**
 * Property-based tests for the volume-multiplier → MIDI-velocity bridge.
 * These are the invariants the velocity-layer system depends on:
 * totality, range, monotonicity, and clamp-idempotence.
 */
describe('velocityFromMultiplier properties', () => {
  it('always returns an integer in [0, 127], for ANY double', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }), (x) => {
        const v = velocityFromMultiplier(x);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(MIDI_VELOCITY_MAX);
      })
    );
  });

  it('is monotone non-decreasing on [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(velocityFromMultiplier(lo)).toBeLessThanOrEqual(
            velocityFromMultiplier(hi)
          );
        }
      )
    );
  });

  it('clamping first changes nothing (clamp-idempotence)', () => {
    fc.assert(
      fc.property(fc.double({ min: -10, max: 10, noNaN: true }), (x) => {
        const clamped = Math.min(1, Math.max(0, x));
        expect(velocityFromMultiplier(x)).toBe(velocityFromMultiplier(clamped));
      })
    );
  });

  it('round-trips the velocity-lane UI convention (lane % → multiplier → velocity stays within one lane unit)', () => {
    // VelocityLane stores Math.round(multiplier * 100); a lane value of N%
    // must map to a velocity that converts back to the same lane value.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (lanePercent) => {
        const multiplier = lanePercent / 100;
        const velocity = velocityFromMultiplier(multiplier);
        const backToLane = Math.round((velocity / MIDI_VELOCITY_MAX) * 100);
        expect(Math.abs(backToLane - lanePercent)).toBeLessThanOrEqual(1);
      })
    );
  });
});
