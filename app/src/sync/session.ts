/**
 * Session sync layer - handles saving/loading sessions from the API
 *
 * Phase 13A: Added request timeouts with AbortController
 * Phase 14: Added exponential backoff with jitter for retries
 */

import type { GridState, Track } from '../types';
import { logger } from '../utils/logger';

// API types (mirrored from worker/types.ts for frontend)
interface SessionState {
  tracks: Track[];
  tempo: number;
  swing: number;
  version: number;
}

interface Session {
  id: string;
  name: string | null;           // Optional session name for tab/display
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  remixedFrom: string | null;
  remixedFromName: string | null;
  remixCount: number;
  state: SessionState;
}

interface CreateSessionResponse {
  id: string;
  url: string;
}

interface RemixSessionResponse {
  id: string;
  remixedFrom: string;
  url: string;
}

const API_BASE = '/api/sessions';
const SAVE_DEBOUNCE_MS = 5000;

// Phase 13A: Request timeout configuration
const DEFAULT_TIMEOUT_MS = 10000; // 10 seconds for most operations
const SAVE_TIMEOUT_MS = 15000;    // 15 seconds for saves (may be larger payloads)

// Phase 14: Retry configuration with exponential backoff + jitter
const RETRY_BASE_DELAY_MS = 1000;   // Starting delay: 1 second
const RETRY_MAX_DELAY_MS = 30000;   // Cap at 30 seconds
const RETRY_JITTER = 0.25;          // ±25% jitter
const MAX_RETRIES = 3;              // Max retry attempts for transient errors
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504]; // Status codes worth retrying

/**
 * Phase 14: Calculate retry delay with exponential backoff + jitter
 * Jitter prevents the "thundering herd" problem when server recovers
 */
function calculateRetryDelay(attempt: number, retryAfterSeconds?: number): number {
  // If server provided Retry-After, use it (with jitter)
  if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    const baseDelay = retryAfterSeconds * 1000;
    // Don't apply jitter if Retry-After is very long (quota reset)
    if (baseDelay > 60000) {
      return baseDelay;
    }
    const jitterRange = baseDelay * RETRY_JITTER;
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    return Math.round(baseDelay + jitter);
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
  const exponentialDelay = Math.min(
    RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
    RETRY_MAX_DELAY_MS
  );

  // Add jitter: ±25% randomization
  const jitterRange = exponentialDelay * RETRY_JITTER;
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  return Math.round(exponentialDelay + jitter);
}

/**
 * Phase 14: Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors are retryable
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return true;
    }
    // Timeout errors are retryable
    if (error.name === 'AbortError') {
      return true;
    }
  }
  return false;
}

/**
 * Phase 14: Parse Retry-After header (supports both seconds and HTTP-date)
 */
function parseRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return undefined;

  // Try parsing as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds;
  }

  // Try parsing as HTTP-date
  const date = Date.parse(retryAfter);
  if (!isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }

  return undefined;
}

/**
 * Phase 14: Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Phase 13A: Fetch with timeout using AbortController
 * Phase 14: Added retry with exponential backoff + jitter
 * Prevents hung connections from blocking indefinitely
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Phase 14: Fetch with retry, timeout, and exponential backoff
 * Retries on transient errors (5xx, 429, network errors)
 * Respects Retry-After header from server
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);

      // Success or non-retryable error
      if (response.ok || !RETRYABLE_STATUS_CODES.includes(response.status)) {
        return response;
      }

      // Retryable status code - check if we should retry
      lastResponse = response;

      // Don't retry if this was the last attempt
      if (attempt >= maxRetries) {
        return response;
      }

      // Parse Retry-After header for backoff timing
      const retryAfterSeconds = parseRetryAfter(response);

      // For quota errors (503 with long Retry-After), don't retry
      if (response.status === 503 && retryAfterSeconds && retryAfterSeconds > 300) {
        logger.session.warn(`Quota exceeded, retry after ${retryAfterSeconds}s - not retrying`);
        return response;
      }

      const delay = calculateRetryDelay(attempt, retryAfterSeconds);
      logger.session.log(`Retrying ${options.method || 'GET'} ${url} in ${delay}ms (attempt ${attempt + 1}/${maxRetries}, status: ${response.status})`);
      await sleep(delay);

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if this was the last attempt
      if (attempt >= maxRetries) {
        throw lastError;
      }

      // Only retry on retryable errors
      if (!isRetryableError(error)) {
        throw lastError;
      }

      const delay = calculateRetryDelay(attempt);
      logger.session.log(`Retrying ${options.method || 'GET'} ${url} in ${delay}ms (attempt ${attempt + 1}/${maxRetries}, error: ${lastError.message})`);
      await sleep(delay);
    }
  }

  // Should not reach here, but just in case
  if (lastResponse) return lastResponse;
  throw lastError || new Error('Fetch failed after retries');
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let currentSessionId: string | null = null;
let lastSavedState: string | null = null;

/**
 * Get session ID from URL path
 * Matches /s/{uuid}
 */
export function getSessionIdFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/s\/([a-f0-9-]{36})$/);
  return match ? match[1] : null;
}

/**
 * Update URL to reflect current session
 */
export function updateUrlWithSession(sessionId: string): void {
  const newUrl = `/s/${sessionId}`;
  if (window.location.pathname !== newUrl) {
    window.history.pushState({ sessionId }, '', newUrl);
  }
}

/**
 * Create a new session
 * Phase 14: Uses retry with exponential backoff
 */
export async function createSession(initialState?: Partial<SessionState>): Promise<Session> {
  const response = await fetchWithRetry(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: initialState }),
  });

  if (!response.ok) {
    throw new Error('Failed to create session');
  }

  const data = await response.json() as CreateSessionResponse;
  currentSessionId = data.id;

  // Load the full session to get timestamps
  const session = await loadSession(data.id);
  if (!session) throw new Error('Session created but not found');

  return session;
}

/**
 * Load an existing session
 * Phase 14: Uses retry with exponential backoff
 */
export async function loadSession(sessionId: string): Promise<Session | null> {
  const response = await fetchWithRetry(`${API_BASE}/${sessionId}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('Failed to load session');
  }

  const session = await response.json() as Session;
  currentSessionId = session.id;
  lastSavedState = JSON.stringify(session.state);

  return session;
}

/**
 * Save session state (debounced)
 */
export function saveSession(state: GridState): void {
  if (!currentSessionId) return;

  // Cancel pending save
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  // Debounce save
  saveTimeout = setTimeout(() => {
    saveSessionNow(state);
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Save session immediately (bypass debounce)
 * Phase 14: Uses retry with exponential backoff
 */
export async function saveSessionNow(state: GridState): Promise<boolean> {
  if (!currentSessionId) return false;

  const sessionState: SessionState = {
    tracks: state.tracks,
    tempo: state.tempo,
    swing: state.swing,
    version: 1,
  };

  // Skip if state hasn't changed
  const stateJson = JSON.stringify(sessionState);
  if (stateJson === lastSavedState) {
    return true;
  }

  try {
    // Phase 14: Use retry with longer timeout for saves (may have larger payloads)
    const response = await fetchWithRetry(
      `${API_BASE}/${currentSessionId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: sessionState }),
      },
      SAVE_TIMEOUT_MS
    );

    if (!response.ok) {
      logger.session.error('Failed to save session:', response.status);
      return false;
    }

    lastSavedState = stateJson;
    return true;
  } catch (error) {
    // Phase 13A: Handle timeout errors specifically
    if (error instanceof Error && error.name === 'AbortError') {
      logger.session.error('Save session timed out after retries');
    } else {
      logger.session.error('Failed to save session:', error);
    }
    return false;
  }
}

/**
 * Remix a session (create a copy and switch to it)
 * Phase 14: Uses retry with exponential backoff
 */
export async function remixSession(sourceId: string): Promise<Session> {
  const response = await fetchWithRetry(`${API_BASE}/${sourceId}/remix`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to remix session');
  }

  const data = await response.json() as RemixSessionResponse;
  currentSessionId = data.id;

  // Load the full session
  const session = await loadSession(data.id);
  if (!session) throw new Error('Remixed session not found');

  return session;
}

/**
 * Send a copy (create a remix but don't switch to it)
 * Returns the URL of the new session for clipboard
 * Phase 14: Uses retry with exponential backoff
 */
export async function sendCopy(sourceId: string): Promise<string> {
  const response = await fetchWithRetry(`${API_BASE}/${sourceId}/remix`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to create copy');
  }

  const data = await response.json() as RemixSessionResponse;
  return `${window.location.origin}/s/${data.id}`;
}

/**
 * Get current session ID
 */
export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

/**
 * Set current session ID (used when initializing from URL)
 */
export function setCurrentSessionId(id: string | null): void {
  currentSessionId = id;
}

/**
 * Check if we have unsaved changes
 */
export function hasUnsavedChanges(state: GridState): boolean {
  if (!currentSessionId || !lastSavedState) return false;

  const sessionState: SessionState = {
    tracks: state.tracks,
    tempo: state.tempo,
    swing: state.swing,
    version: 1,
  };

  return JSON.stringify(sessionState) !== lastSavedState;
}

/**
 * Normalize a track to ensure parameterLocks is always an array
 * API may return objects for parameterLocks when created via curl
 */
function normalizeTrack(track: Track): Track {
  // If parameterLocks is an object (from API), convert to array
  let parameterLocks = track.parameterLocks;
  if (!Array.isArray(parameterLocks)) {
    // Convert object to sparse array
    const arr: (typeof track.parameterLocks[number])[] = [];
    const obj = parameterLocks as Record<string, typeof track.parameterLocks[number]>;
    for (const key of Object.keys(obj)) {
      const idx = parseInt(key, 10);
      if (!isNaN(idx)) {
        arr[idx] = obj[key];
      }
    }
    parameterLocks = arr;
  }

  return {
    ...track,
    parameterLocks,
    // Ensure stepCount has a default
    stepCount: track.stepCount ?? 16,
    // Ensure transpose has a default
    transpose: track.transpose ?? 0,
  };
}

/**
 * Convert session state to grid state
 */
export function sessionToGridState(session: Session): Partial<GridState> {
  return {
    tracks: session.state.tracks.map(normalizeTrack),
    tempo: session.state.tempo,
    swing: session.state.swing,
  };
}
