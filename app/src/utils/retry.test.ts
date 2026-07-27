import { describe, expect, it, vi } from 'vitest';
import { calculateBackoffDelay } from './retry';

describe('calculateBackoffDelay', () => {
  it('applies bounded jitter to the exponential delay', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(1);

    expect(calculateBackoffDelay(0)).toBe(750);
    expect(calculateBackoffDelay(0)).toBe(1000);
    expect(calculateBackoffDelay(0)).toBe(1250);
    vi.restoreAllMocks();
  });

  it('doubles until the configured cap', () => {
    const config = { jitterFactor: 0, maxDelayMs: 10_000 };
    expect(calculateBackoffDelay(0, config)).toBe(1_000);
    expect(calculateBackoffDelay(1, config)).toBe(2_000);
    expect(calculateBackoffDelay(2, config)).toBe(4_000);
    expect(calculateBackoffDelay(10, config)).toBe(10_000);
  });

  it('respects a custom base delay', () => {
    const config = { jitterFactor: 0, baseDelayMs: 500 };
    expect(calculateBackoffDelay(0, config)).toBe(500);
    expect(calculateBackoffDelay(3, config)).toBe(4_000);
  });
});
