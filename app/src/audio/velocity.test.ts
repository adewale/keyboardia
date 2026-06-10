import { describe, it, expect } from 'vitest';
import {
  velocityFromMultiplier,
  MIDI_VELOCITY_MAX,
  DEFAULT_MIDI_VELOCITY,
} from './velocity';

/**
 * The volume p-lock (a.k.a. the Velocity Lane) stores a 0–1 multiplier.
 * Sampled instruments need a MIDI velocity (0–127) to select velocity
 * layers. This mapping is the single bridge between the two domains —
 * bug P2 in SAMPLE-AUDIT-2026-06: velocity was never derived, so the
 * pp/ff layers shipped in January were unreachable.
 */
describe('velocityFromMultiplier', () => {
  it('maps full volume (no p-lock) to maximum velocity', () => {
    expect(velocityFromMultiplier(1)).toBe(127);
  });

  it('maps silence to zero velocity', () => {
    expect(velocityFromMultiplier(0)).toBe(0);
  });

  it('maps the velocity-lane midpoint into the mf layer range (51-100)', () => {
    const v = velocityFromMultiplier(0.6);
    expect(v).toBeGreaterThanOrEqual(51);
    expect(v).toBeLessThanOrEqual(100);
  });

  it('maps low lane values into the pp layer range (0-50)', () => {
    expect(velocityFromMultiplier(0.3)).toBeLessThanOrEqual(50);
  });

  it('clamps out-of-range multipliers instead of extrapolating', () => {
    expect(velocityFromMultiplier(1.5)).toBe(MIDI_VELOCITY_MAX);
    expect(velocityFromMultiplier(-0.5)).toBe(0);
  });

  it('is total: non-finite input falls back to the default velocity', () => {
    expect(velocityFromMultiplier(NaN)).toBe(DEFAULT_MIDI_VELOCITY);
    expect(velocityFromMultiplier(Infinity)).toBe(DEFAULT_MIDI_VELOCITY);
    expect(velocityFromMultiplier(-Infinity)).toBe(DEFAULT_MIDI_VELOCITY);
  });
});
