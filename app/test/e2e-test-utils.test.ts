import type { APIRequestContext, APIResponse } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testInfo = vi.hoisted(() => ({
  annotations: [] as Array<{ type: string; description?: string }>,
}));
vi.mock('@playwright/test', () => ({ test: { info: () => testInfo } }));

import {
  API_RETRY_ANNOTATION,
  createSessionWithRetry,
  getSessionWithRetry,
} from '../e2e/test-utils';

function response(status: number, body: unknown = {}): APIResponse {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    statusText: () => `status ${status}`,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as APIResponse;
}

const retries = () => testInfo.annotations.filter(({ type }) => type === API_RETRY_ANNOTATION);

describe('E2E API helpers retry policy', () => {
  beforeEach(() => {
    testInfo.annotations.length = 0;
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a thrown transport error and records the retry on the test', async () => {
    const post = vi.fn()
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce(response(201, { id: 'created-after-reset' }));
    const request = { post } as unknown as APIRequestContext;

    const result = createSessionWithRetry(request, { tracks: [] }, 2);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ id: 'created-after-reset' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(retries()).toEqual([
      expect.objectContaining({ description: expect.stringContaining('read ECONNRESET') }),
    ]);
  });

  it('retries HTTP 429 and records the retry on the test', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce(response(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(response(201, { id: 'created-after-429' }));
    const request = { post } as unknown as APIRequestContext;

    const result = createSessionWithRetry(request, { tracks: [] });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ id: 'created-after-429' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(retries()).toEqual([
      expect.objectContaining({ description: expect.stringContaining('HTTP 429') }),
    ]);
  });

  it.each([500, 503, 400])('fails on the first %i without retrying', async (status) => {
    const post = vi.fn().mockResolvedValue(response(status, { error: 'backend said no' }));
    const request = { post } as unknown as APIRequestContext;

    const result = createSessionWithRetry(request, { tracks: [] });
    const settled = expect(result).rejects.toThrow(`Session create failed: ${status}`);
    await vi.runAllTimersAsync();

    await settled;
    expect(post).toHaveBeenCalledTimes(1);
    expect(retries()).toEqual([]);
    await expect(result).rejects.toThrow('backend said no');
  });

  it('rethrows the last transport error once the attempts are spent', async () => {
    const post = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const request = { post } as unknown as APIRequestContext;

    const result = createSessionWithRetry(request, { tracks: [] }, 3);
    const settled = expect(result).rejects.toThrow('connect ECONNREFUSED');
    await vi.runAllTimersAsync();

    await settled;
    expect(post).toHaveBeenCalledTimes(3);
    expect(retries()).toHaveLength(2);
  });

  it('fails a session read on the first 5xx instead of retrying it', async () => {
    const get = vi.fn().mockResolvedValue(response(500, { error: 'storage failed' }));
    const request = { get } as unknown as APIRequestContext;

    const result = getSessionWithRetry(request, 'session-1');
    const settled = expect(result).rejects.toThrow('Session session-1 read failed: 500');
    await vi.runAllTimersAsync();

    await settled;
    expect(get).toHaveBeenCalledTimes(1);
    expect(retries()).toEqual([]);
  });
});
