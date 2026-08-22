import { describe, expect, it } from 'vitest';
import { DEFAULT_STEP_MIDI_VELOCITY } from '../shared/constants';
import {
  velocitySampleCutoff,
  velocitySampleCutoffAt,
  VELOCITY_FILTER_BYPASS_VELOCITY,
  VELOCITY_FILTER_MAX_ANCHOR_HZ,
  VELOCITY_FILTER_MIN_ANCHOR_HZ,
  VELOCITY_FILTER_OCTAVES,
} from './velocity-sample-filter';

describe('velocitySampleCutoff', () => {
  it('bypasses at and above the unlocked-step velocity so default sessions are untouched', () => {
    expect(VELOCITY_FILTER_BYPASS_VELOCITY).toBe(DEFAULT_STEP_MIDI_VELOCITY);
    expect(velocitySampleCutoff(4000, DEFAULT_STEP_MIDI_VELOCITY)).toBeNull();
    expect(velocitySampleCutoff(4000, 127)).toBeNull();
    expect(velocitySampleCutoff(4000, DEFAULT_STEP_MIDI_VELOCITY - 1)).not.toBeNull();
  });

  it('bypasses when the manifest declares no anchor', () => {
    expect(velocitySampleCutoff(undefined, 1)).toBeNull();
  });

  it('sweeps the full configured depth by velocity zero', () => {
    const anchor = 4000;
    expect(velocitySampleCutoff(anchor, 0)).toBeCloseTo(anchor * 2 ** -VELOCITY_FILTER_OCTAVES, 6);
  });

  it('opens monotonically with velocity below the bypass threshold', () => {
    const anchor = 4000;
    let previous = 0;
    for (let velocity = 0; velocity < VELOCITY_FILTER_BYPASS_VELOCITY; velocity++) {
      const cutoff = velocitySampleCutoff(anchor, velocity);
      expect(cutoff).not.toBeNull();
      expect(cutoff!).toBeGreaterThan(previous);
      previous = cutoff!;
    }
  });

  it('treats out-of-range anchors as absent instead of clamping them', () => {
    expect(velocitySampleCutoff(VELOCITY_FILTER_MIN_ANCHOR_HZ - 1, 40)).toBeNull();
    expect(velocitySampleCutoff(VELOCITY_FILTER_MAX_ANCHOR_HZ + 1, 40)).toBeNull();
    expect(velocitySampleCutoff(Number.NaN, 40)).toBeNull();
    expect(velocitySampleCutoff(VELOCITY_FILTER_MIN_ANCHOR_HZ, 40)).not.toBeNull();
    expect(velocitySampleCutoff(VELOCITY_FILTER_MAX_ANCHOR_HZ, 40)).not.toBeNull();
  });

  it('clamps negative velocity to the deepest sweep instead of extrapolating', () => {
    expect(velocitySampleCutoffAt(4000, -20, 1.5)).toBe(velocitySampleCutoffAt(4000, 0, 1.5));
  });

  it('rejects non-finite velocity', () => {
    expect(velocitySampleCutoff(4000, Number.NaN)).toBeNull();
  });
});
