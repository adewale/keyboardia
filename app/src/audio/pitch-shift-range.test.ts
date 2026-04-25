/**
 * Regression test for bug_003: pitch shift > ±24 semitones silently
 * clamped to wrong pitch.
 *
 * The pitch-shift worklet's `pitchRatio` AudioParam is bounded
 * `[0.25, 4.0]`, corresponding to ±24 semitones. Web Audio silently
 * clamps out-of-range AudioParam values, so a `pitchSemitones` of -36
 * (transpose -24 + p-lock -12) was producing a ratio of `0.125` →
 * silently clamped to `0.25` → audible -24 semitones instead of -36.
 *
 * The helper converts `pitchSemitones` to `pitchRatio` with explicit
 * clamping at the worklet's range so the engine can decide what to do
 * (warn, fall back to native playbackRate, etc).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  PITCH_WORKLET_MAX_SEMITONES,
  PITCH_WORKLET_MIN_RATIO,
  PITCH_WORKLET_MAX_RATIO,
  pitchSemitonesToWorkletRatio,
} from './pitch-shift-range';

describe('pitchSemitonesToWorkletRatio', () => {
  it('agrees with 2^(semis/12) within the supported range', () => {
    for (const s of [-24, -12, -6, 0, 6, 12, 24]) {
      const { ratio, clamped } = pitchSemitonesToWorkletRatio(s);
      expect(ratio).toBeCloseTo(Math.pow(2, s / 12), 10);
      expect(clamped).toBe(false);
    }
  });

  it('clamps below -24 to the worklet minimum', () => {
    const { ratio, clamped } = pitchSemitonesToWorkletRatio(-36);
    expect(ratio).toBeCloseTo(PITCH_WORKLET_MIN_RATIO, 10);
    expect(clamped).toBe(true);
  });

  it('clamps above +24 to the worklet maximum', () => {
    const { ratio, clamped } = pitchSemitonesToWorkletRatio(48);
    expect(ratio).toBeCloseTo(PITCH_WORKLET_MAX_RATIO, 10);
    expect(clamped).toBe(true);
  });

  // Property: for any semitone input the produced ratio is always within
  // the worklet's declared parameter range. This is the invariant that,
  // when violated, causes Web Audio to silently clamp and the user to
  // hear a wrong pitch.
  it('pbt: produces a ratio inside [minValue, maxValue] for any finite input', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (semis) => {
          const { ratio } = pitchSemitonesToWorkletRatio(semis);
          expect(ratio).toBeGreaterThanOrEqual(PITCH_WORKLET_MIN_RATIO);
          expect(ratio).toBeLessThanOrEqual(PITCH_WORKLET_MAX_RATIO);
          expect(Number.isFinite(ratio)).toBe(true);
        },
      ),
      { numRuns: 500, seed: 0x4ce5e772 },
    );
  });

  it('pbt: clamped flag is true iff |semitones| > max', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        (semis) => {
          const { clamped } = pitchSemitonesToWorkletRatio(semis);
          expect(clamped).toBe(Math.abs(semis) > PITCH_WORKLET_MAX_SEMITONES);
        },
      ),
      { numRuns: 500, seed: 0x4ce5e773 },
    );
  });
});
