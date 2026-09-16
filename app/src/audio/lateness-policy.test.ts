import { describe, expect, it } from 'vitest';
import { audioTime, seconds } from './audio-time';
import { resolveDispatchTime, type LatenessPolicy } from './lateness-policy';

const policy: LatenessPolicy = {
  tolerance: seconds(0.1),
  minimumLead: seconds(0.001),
};

describe('resolveDispatchTime', () => {
  it('preserves an on-time absolute AudioTime', () => {
    const result = resolveDispatchTime(audioTime(10.2), audioTime(10), policy);
    expect(result.kind).toBe('on-time');
    expect('time' in result && result.time).toBe(10.2);
    expect(result.lateness).toBeCloseTo(-0.2, 10);
  });

  it('clamps a tolerably late event once, before renderer dispatch', () => {
    const result = resolveDispatchTime(audioTime(9.95), audioTime(10), policy);
    expect(result.kind).toBe('late-clamped');
    expect('time' in result && result.time).toBe(10.001);
    expect(result.lateness).toBeCloseTo(0.05, 10);
  });

  it('drops stale events instead of producing a catch-up burst', () => {
    const result = resolveDispatchTime(audioTime(9.8), audioTime(10), policy);
    expect(result.kind).toBe('drop');
    expect(result.lateness).toBeCloseTo(0.2, 10);
  });

  it('rejects an invalid negative policy tolerance', () => {
    expect(() => resolveDispatchTime(audioTime(10), audioTime(10), {
      tolerance: seconds(-1),
      minimumLead: seconds(0.001),
    })).toThrow(RangeError);
  });
});
