import type { APIRequestContext, APIResponse } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionWithRetry } from '../e2e/test-utils';

describe('createSessionWithRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a thrown transport error instead of aborting the E2E lane', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const successfulResponse = {
      ok: () => true,
      json: async () => ({ id: 'created-after-reset' }),
    } as APIResponse;
    const post = vi.fn()
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce(successfulResponse);
    const request = { post } as unknown as APIRequestContext;

    const result = createSessionWithRetry(request, { tracks: [] }, 2);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ id: 'created-after-reset' });
    expect(post).toHaveBeenCalledTimes(2);
  });
});
