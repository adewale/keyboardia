import { describe, expect, it } from 'vitest';
import {
  meetsSustainCeilingFloor,
  MIN_SUSTAINING_MEDIAN_USABLE_SECONDS,
} from './instrument-classification';

describe('sustain ceiling floor', () => {
  it('accepts equality with the complete tied-bar duration', () => {
    expect(meetsSustainCeilingFloor(MIN_SUSTAINING_MEDIAN_USABLE_SECONDS)).toBe(true);
  });

  it('rejects a duration immediately below the floor', () => {
    expect(meetsSustainCeilingFloor(MIN_SUSTAINING_MEDIAN_USABLE_SECONDS - 0.001)).toBe(false);
  });

  it('accepts a duration above the floor', () => {
    expect(meetsSustainCeilingFloor(MIN_SUSTAINING_MEDIAN_USABLE_SECONDS + 0.001)).toBe(true);
  });
});
