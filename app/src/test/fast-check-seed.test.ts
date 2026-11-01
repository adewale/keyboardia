import { describe, expect, it } from 'vitest';
import { DEFAULT_FAST_CHECK_SEED, resolveFastCheckSeed } from './fast-check-seed';

describe('fast-check seed policy', () => {
  it('uses one stable default for every Vitest project', () => {
    expect(resolveFastCheckSeed(undefined)).toBe(DEFAULT_FAST_CHECK_SEED);
    expect(resolveFastCheckSeed('')).toBe(DEFAULT_FAST_CHECK_SEED);
  });

  it('accepts a replayable FC_SEED override', () => {
    expect(resolveFastCheckSeed('424242')).toBe(424242);
  });

  it.each(['not-a-number', '1.5', 'Infinity', '9007199254740992'])(
    'rejects a non-integer or lossy seed: %s',
    (value) => {
      expect(() => resolveFastCheckSeed(value)).toThrow(/safe integer/);
    },
  );
});
