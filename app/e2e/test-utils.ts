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
 *    All retries use exponential backoff with jitter to prevent
 *    thundering herd problems.
 *
 * @see docs/LESSONS-LEARNED.md - Lessons 6, 15, 16
 * @see src/utils/retry.ts for the centralized retry implementation
 */

import type { APIRequestContext } from '@playwright/test';
import { calculateBackoffDelay } from '../src/utils/retry';

// Use local dev server - in CI we run with USE_MOCK_API=1
// which provides mocked API responses via Vite plugin
// Port 5175 matches playwright.config.ts webServer config
export const API_BASE = process.env.BASE_URL || 'http://localhost:5175';

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
 * This helper retries with exponential backoff and jitter.
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
    // Don't sleep after the last attempt
    if (attempt < maxRetries - 1) {
      const delay = calculateBackoffDelay(attempt);
      console.log(`[TEST] Session create attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError ?? new Error('Session create failed after retries');
}

/**
 * Get a session with retry logic for KV eventual consistency.
 *
 * Cloudflare KV has eventual consistency, so data may not be immediately
 * available after writes. This helper retries with exponential backoff
 * and jitter until data is present.
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
  maxRetries = 3
): Promise<SessionResponse> {
  let lastResponse: SessionResponse | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await request.get(`${API_BASE}/api/sessions/${sessionId}`);
    if (!res.ok()) {
      console.log(`[TEST] Session get attempt ${attempt + 1} failed: ${res.status()}`);
      if (attempt < maxRetries - 1) {
        const delay = calculateBackoffDelay(attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
      continue;
    }
    lastResponse = await res.json();
    // Check if state.tracks is populated (KV may return partial data during propagation)
    if (lastResponse.state?.tracks && lastResponse.state.tracks.length > 0) {
      return lastResponse;
    }
    if (attempt < maxRetries - 1) {
      const delay = calculateBackoffDelay(attempt);
      console.log(`[TEST] Retry ${attempt + 1}: tracks undefined or empty, waiting ${delay}ms for KV consistency...`);
      await new Promise((r) => setTimeout(r, delay));
    }
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
