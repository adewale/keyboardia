import { describe, expect, it } from 'vitest';

import { absoluteToneStartTime } from './tone-schedule';

describe('absolute Tone scheduling contract', () => {
  it('preserves a future scheduler timestamp instead of adding lookahead', () => {
    expect(absoluteToneStartTime(10.25, 10.15, 10)).toBe(10.25);
  });

  it('clamps late and duplicate events against the raw audio clock', () => {
    expect(absoluteToneStartTime(10, 10.25, 10.4)).toBeCloseTo(10.401, 6);
  });

  it('uses the raw audio clock when no event timestamp is supplied', () => {
    expect(absoluteToneStartTime(undefined, 3, 0)).toBe(3.001);
  });
});
