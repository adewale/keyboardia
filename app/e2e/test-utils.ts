/**
 * Shared E2E Test Utilities
 *
 * This module provides helper functions for E2E tests to handle common
 * issues like API response formats and intermittent failures.
 *
 * ## Key Patterns
 *
 * 1. **API Response Structure**
 *    The GET /api/sessions/{id} endpoint returns:
 *    ```json
 *    {
 *      "id": "...",
 *      "state": {
 *        "tracks": [...],
 *        "tempo": 120,
 *        "swing": 0,
 *        ...
 *      }
 *    }
 *    ```
 *    Always access `response.state.tracks`, NOT `response.tracks`.
 *
 * 2. **Retry Logic**
 *    CI environments may experience:
 *    - Rate limiting on the production API
 *    - Durable Object cold starts
 *    - KV eventual consistency delays
 *    Use `createSessionWithRetry` and `getSessionWithRetry` for resilience.
 *
 * @see docs/LESSONS-LEARNED.md for background on these patterns
 */

import type { APIRequestContext } from '@playwright/test';

// Use local dev server when running locally, production when deployed
export const API_BASE = process.env.CI
  ? 'https://keyboardia.adewale-883.workers.dev'
  : 'http://localhost:5173';

/**
 * Session state from the API response.
 * This matches the structure returned by GET /api/sessions/{id}
 */
export interface SessionState {
  tracks: Array<{
    id: string;
    name: string;
    sampleId: string;
    steps: boolean[];
    parameterLocks: (null | Record<string, number>)[];
    volume: number;
    muted: boolean;
    playbackMode: 'oneshot' | 'gate';
    transpose: number;
    stepCount: number;
  }>;
  tempo: number;
  swing: number;
  version: number;
}

/**
 * Full session response from the API.
 * Note: tracks/tempo/swing are inside the `state` object, not at the top level.
 */
export interface SessionResponse {
  id: string;
  exists?: boolean;
  createdAt?: string;
  updatedAt?: string;
  state: SessionState;
  sizeBytes?: number;
}

/**
 * Create a session with retry logic for intermittent API failures.
 *
 * CI environments may experience rate limiting, cold starts, or network issues.
 * This helper retries with exponential backoff.
 *
 * @example
 * ```typescript
 * const { id: sessionId } = await createSessionWithRetry(request, {
 *   tracks: [{ ... }],
 *   tempo: 120,
 *   swing: 0,
 *   version: 1,
 * });
 * ```
 */
export async function createSessionWithRetry(
  request: APIRequestContext,
  data: Record<string, unknown>,
  maxRetries = 3
): Promise<{ id: string }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await request.post(`${API_BASE}/api/sessions`, { data });
    if (res.ok()) {
      return res.json();
    }
    lastError = new Error(`Session create failed: ${res.status()} ${res.statusText()}`);
    console.log(`[TEST] Session create attempt ${attempt + 1} failed, retrying...`);
    // Wait before retry with exponential backoff
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw lastError ?? new Error('Session create failed after retries');
}

/**
 * Get a session with retry logic for KV eventual consistency.
 *
 * Cloudflare KV has eventual consistency, so data may not be immediately
 * available after writes. This helper retries until data is present.
 *
 * @example
 * ```typescript
 * const session = await getSessionWithRetry(request, sessionId);
 * expect(session.state.tracks).toHaveLength(2);
 * expect(session.state.tempo).toBe(120);
 * ```
 */
export async function getSessionWithRetry(
  request: APIRequestContext,
  sessionId: string,
  maxRetries = 3,
  delayMs = 2000
): Promise<SessionResponse> {
  let lastResponse: SessionResponse | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await request.get(`${API_BASE}/api/sessions/${sessionId}`);
    if (!res.ok()) {
      console.log(`[TEST] Session get attempt ${attempt + 1} failed: ${res.status()}`);
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    lastResponse = await res.json();
    // Check if state.tracks is populated (KV may return partial data during propagation)
    if (lastResponse.state?.tracks && lastResponse.state.tracks.length > 0) {
      return lastResponse;
    }
    console.log(`[TEST] Retry ${attempt + 1}: tracks undefined or empty, waiting for KV consistency...`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (lastResponse) {
    console.log('[TEST] Session data after retries:', JSON.stringify(lastResponse, null, 2));
    return lastResponse;
  }
  throw new Error(`Session ${sessionId} not found after ${maxRetries} retries`);
}

/**
 * Sleep helper for waiting between operations.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
