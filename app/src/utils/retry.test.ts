/**
 * Tests for centralized retry utilities.
 *
 * These tests verify exponential backoff with jitter behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { calculateBackoffDelay, backoffSleep, withRetry, shouldRetry } from './retry';

describe('calculateBackoffDelay', () => {
  it('returns base delay for first attempt (with jitter)', () => {
    // Run multiple times to test jitter range
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays.push(calculateBackoffDelay(0));
    }

    // Base delay is 1000ms, jitter is ±25%, so range is 750-1250ms
    const min = Math.min(...delays);
    const max = Math.max(...delays);

    expect(min).toBeGreaterThanOrEqual(750);
    expect(max).toBeLessThanOrEqual(1250);
    // Should have some variation (jitter is working)
    expect(max - min).toBeGreaterThan(100);
  });

  it('doubles delay for each attempt (exponential)', () => {
    // Test without jitter to verify exponential behavior
    const config = { jitterFactor: 0 };

    expect(calculateBackoffDelay(0, config)).toBe(1000);  // 1s
    expect(calculateBackoffDelay(1, config)).toBe(2000);  // 2s
    expect(calculateBackoffDelay(2, config)).toBe(4000);  // 4s
    expect(calculateBackoffDelay(3, config)).toBe(8000);  // 8s
    expect(calculateBackoffDelay(4, config)).toBe(16000); // 16s
  });

  it('caps delay at maxDelayMs', () => {
    const config = { jitterFactor: 0, maxDelayMs: 10000 };

    expect(calculateBackoffDelay(0, config)).toBe(1000);
    expect(calculateBackoffDelay(10, config)).toBe(10000); // Would be 1024000 without cap
    expect(calculateBackoffDelay(100, config)).toBe(10000);
  });

  it('respects custom baseDelayMs', () => {
    const config = { jitterFactor: 0, baseDelayMs: 500 };

    expect(calculateBackoffDelay(0, config)).toBe(500);
    expect(calculateBackoffDelay(1, config)).toBe(1000);
    expect(calculateBackoffDelay(2, config)).toBe(2000);
  });

  it('respects custom jitterFactor', () => {
    // 50% jitter means range of 500-1500 for base 1000
    const config = { jitterFactor: 0.5 };
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays.push(calculateBackoffDelay(0, config));
    }

    const min = Math.min(...delays);
    const max = Math.max(...delays);

    expect(min).toBeGreaterThanOrEqual(500);
    expect(max).toBeLessThanOrEqual(1500);
  });
});

describe('backoffSleep', () => {
  it('sleeps for the calculated delay', async () => {
    const start = Date.now();
    await backoffSleep(0, { jitterFactor: 0, baseDelayMs: 50 });
    const elapsed = Date.now() - start;

    // Allow some tolerance for timing
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, { maxAttempts: 3 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitterFactor: 0,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after max attempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, jitterFactor: 0 })
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not sleep after the last failed attempt', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const start = Date.now();

    await expect(
      withRetry(fn, { maxAttempts: 2, baseDelayMs: 1000, jitterFactor: 0 })
    ).rejects.toThrow();

    const elapsed = Date.now() - start;
    // Should only sleep once (between attempt 0 and 1), not after attempt 1
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('shouldRetry', () => {
  it('returns true when more attempts remain', () => {
    expect(shouldRetry(0, 3)).toBe(true);
    expect(shouldRetry(1, 3)).toBe(true);
  });

  it('returns false on last attempt', () => {
    expect(shouldRetry(2, 3)).toBe(false);
    expect(shouldRetry(3, 3)).toBe(false);
  });

  it('uses default maxAttempts if not provided', () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(1)).toBe(true);
    expect(shouldRetry(2)).toBe(false); // Default is 3
  });
});
