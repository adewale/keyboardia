import { describe, expect, it } from 'vitest';

import { absoluteToneStartTime } from './tone-schedule';

describe('absolute Tone scheduling contract', () => {
  it('preserves a future scheduler timestamp instead of adding lookahead', () => {
    expect(absoluteToneStartTime(10.25, 10.15)).toBe(10.25);
  });

  it('does not reinterpret a late or duplicate event inside the renderer', () => {
    expect(absoluteToneStartTime(10, 10.25)).toBe(10);
  });

  it('uses the raw audio clock only when no event timestamp is supplied', () => {
    expect(absoluteToneStartTime(undefined, 3)).toBe(3);
  });

  it('rejects an invalid timestamp instead of silently replacing it', () => {
    expect(() => absoluteToneStartTime(Number.NaN, 3)).toThrow(RangeError);
  });
});
