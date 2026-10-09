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
 * 2. **Retry policy**
 *    The helpers retry only failures that say nothing about the backend's
 *    correctness: a thrown transport error (connection refused or reset,
 *    request timeout) and HTTP 429. Every other non-2xx response, including
 *    5xx, fails the calling test on the first attempt. These retries happen
 *    below Playwright's `retries: 0` / `flaky: 0` accounting, so each one is
 *    recorded as an `api-retry` annotation on the running test and logged;
 *    `scripts/assert-playwright-stats.mjs` prints the count for every lane.
 *    Never widen this to 5xx: a backend that fails intermittently is a bug the
 *    suite must report, not absorb. (This supersedes LESSONS-LEARNED Lesson 16.)
 *
 *    Backoff uses exponential delay with jitter (src/utils/retry.ts).
 *
 * @see docs/LESSONS-LEARNED.md - Lessons 6, 15, 16 (superseded)
 */

import { test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { MAX_STEPS } from '../src/shared/constants';
import { calculateBackoffDelay } from '../src/utils/retry';

// Use local dev server - in CI we run with USE_MOCK_API=1
// which provides mocked API responses via Vite plugin
// E2E_PORT matches playwright.config.ts and lets concurrent worktrees avoid
// falsely failing on a shared default port.
export const API_BASE = process.env.BASE_URL || `http://localhost:${process.env.E2E_PORT ?? 5175}`;

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
    pan: number;
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

/** Annotation type recorded on the running test for every helper-level retry. */
export const API_RETRY_ANNOTATION = 'api-retry';

/**
 * Only rate limiting is retryable at the HTTP level. A 5xx or validation 4xx is
 * a real answer from the backend and must fail the test that received it.
 */
export function isRetryableApiStatus(status: number): boolean {
  return status === 429;
}

function recordApiRetry(description: string): void {
  console.warn(`[TEST] ${description}`);
  test.info().annotations.push({ type: API_RETRY_ANNOTATION, description });
}

/**
 * Send one API request, retrying only thrown transport errors and HTTP 429.
 * Returns the first response that is not a 429 (which may still be non-2xx),
 * or the final 429; rethrows the final transport error.
 */
async function sendWithTransportRetry(
  label: string,
  send: () => Promise<APIResponse>,
  maxAttempts: number,
  retryResponse?: (response: APIResponse) => Promise<string | null>,
): Promise<APIResponse> {
  for (let attempt = 1; ; attempt++) {
    let reason: string | undefined;
    let response: APIResponse | undefined;
    try {
      response = await send();
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      reason = error instanceof Error ? error.message : String(error);
    }
    if (response) {
      // Response parsing is not a transport error: malformed successful
      // responses must fail immediately, not be hidden by another attempt.
      const responseReason = isRetryableApiStatus(response.status())
        ? `HTTP ${response.status()}`
        : await retryResponse?.(response);
      if (!responseReason || attempt >= maxAttempts) return response;
      reason = responseReason;
    }
    const delay = calculateBackoffDelay(attempt - 1);
    recordApiRetry(`${label} attempt ${attempt} failed (${reason}); retrying in ${delay}ms`);
    await sleep(delay);
  }
}

async function describeFailure(label: string, response: APIResponse): Promise<Error> {
  const body = await response.text().catch(() => '');
  return new Error(
    `${label} failed: ${response.status()} ${response.statusText()}`
    + (body ? ` — ${body.slice(0, 500)}` : ''),
  );
}

/**
 * Create a session, retrying only transport errors and HTTP 429.
 *
 * Any other non-2xx response (including 5xx) fails immediately with the status
 * and response body. Each retry is recorded as an `api-retry` annotation.
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
  maxAttempts = 3
): Promise<{ id: string }> {
  const tracks = data.tracks;
  if (Array.isArray(tracks)) {
    for (const [index, candidate] of tracks.entries()) {
      if (!candidate || typeof candidate !== 'object') continue;
      const track = candidate as { id?: unknown; steps?: unknown; parameterLocks?: unknown };
      const label = typeof track.id === 'string' ? track.id : `tracks[${index}]`;
      if (!Array.isArray(track.steps) || track.steps.length !== MAX_STEPS) {
        throw new Error(
          `E2E fixture ${label} must provide exactly ${MAX_STEPS} steps; ` +
          'use a direct API request when intentionally testing legacy normalization.',
        );
      }
      if (!Array.isArray(track.parameterLocks) || track.parameterLocks.length !== MAX_STEPS) {
        throw new Error(
          `E2E fixture ${label} must provide exactly ${MAX_STEPS} parameter locks; ` +
          'use a direct API request when intentionally testing legacy normalization.',
        );
      }
    }
  }

  const response = await sendWithTransportRetry(
    'Session create',
    () => request.post(`${API_BASE}/api/sessions`, { data }),
    maxAttempts,
  );
  if (!response.ok()) throw await describeFailure('Session create', response);
  return response.json();
}

/**
 * Create the populated, long-pattern session used by responsive and
 * accessibility browser contracts.
 *
 * These tests used to navigate to a production UUID and therefore only passed
 * when the selected backend happened to contain that ambient KV record. Build
 * the prerequisite through the public API instead so every backend starts from
 * the same owned state. Twenty-seven visible steps deliberately exercise the
 * partial final portrait page (25-27); the persisted arrays remain at the
 * production invariant of 128 slots.
 */
export function createPopulatedSessionWithRetry(
  request: APIRequestContext,
): Promise<{ id: string }> {
  const sampleIds = [
    'kick',
    'snare',
    'hihat',
    'clap',
    'tom',
    'rim',
    'cowbell',
    'openhat',
    'shaker',
    'conga',
  ];

  return createSessionWithRetry(request, {
    tracks: sampleIds.map((sampleId, trackIndex) => ({
      id: `populated-track-${trackIndex + 1}`,
      name: `Track ${trackIndex + 1}`,
      sampleId,
      steps: Array.from(
        { length: 128 },
        (_, stepIndex) => stepIndex < 27 && stepIndex % 8 === trackIndex % 8,
      ),
      parameterLocks: Array(128).fill(null),
      volume: 1,
      pan: 0,
      muted: false,
      transpose: 0,
      stepCount: 27,
    })),
    tempo: 120,
    swing: 0,
    version: 1,
  });
}

/**
 * Read a session, retrying transport errors and HTTP 429 only.
 *
 * A non-2xx response (404, 5xx, ...) fails immediately. A 200 whose state has
 * no tracks is re-read with backoff (recorded as an `api-retry` annotation) in
 * case a write is still propagating; after the last attempt the final response
 * is returned for the caller to assert on.
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
  maxAttempts = 3
): Promise<SessionResponse> {
  const label = `Session ${sessionId} read`;
  let session: SessionResponse | undefined;
  const response = await sendWithTransportRetry(
    label,
    () => request.get(`${API_BASE}/api/sessions/${sessionId}`),
    maxAttempts,
    async response => {
      if (!response.ok()) return null;
      session = await response.json() as SessionResponse;
      return (session.state?.tracks?.length ?? 0) > 0 ? null : 'no tracks';
    },
  );
  if (!response.ok()) throw await describeFailure(label, response);
  return session!;
}

/**
 * Sleep helper for waiting between operations.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Computed styles relevant to a focus indicator.
 */
export interface FocusStyle {
  outlineStyle: string;
  outlineWidth: number;
  boxShadow: string;
}

/**
 * Does a focused element show a visible focus indicator? (WCAG 2.4.7)
 *
 * `outline-style: auto` is the browser's native focus ring and counts on its
 * own: Chromium reports a computed `outline-width` of 0px for it, so a naive
 * `outlineWidth > 0` check rejects perfectly good native focus rings.
 *
 * Note for callers: drive focus with real `Tab` presses, not `locator.focus()`.
 * The native ring comes from a UA `:focus-visible` rule, and `:focus-visible`
 * deliberately does not match programmatic focus on links or `[tabindex]`
 * containers — so `.focus()` reports "no indicator" for elements that are in
 * fact styled correctly.
 */
export function hasVisibleFocusIndicator(style: FocusStyle): boolean {
  if (style.outlineStyle === 'auto') return true;
  if (style.outlineStyle !== 'none' && style.outlineWidth > 0) return true;
  return style.boxShadow !== 'none' && style.boxShadow !== '';
}
