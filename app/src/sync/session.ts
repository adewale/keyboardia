/**
 * Session sync layer - handles saving/loading sessions from the API
 *
 * Phase 13A: Added request timeouts with AbortController
 */

import type { GridState, Track } from '../types';

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
const SAVE_DEBOUNCE_MS = 2000;

// Phase 13A: Request timeout configuration
const DEFAULT_TIMEOUT_MS = 10000; // 10 seconds for most operations
const SAVE_TIMEOUT_MS = 15000;    // 15 seconds for saves (may be larger payloads)

/**
 * Phase 13A: Fetch with timeout using AbortController
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
 */
export async function createSession(initialState?: Partial<SessionState>): Promise<Session> {
  const response = await fetchWithTimeout(API_BASE, {
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
 */
export async function loadSession(sessionId: string): Promise<Session | null> {
  const response = await fetchWithTimeout(`${API_BASE}/${sessionId}`);

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
    // Phase 13A: Use longer timeout for saves (may have larger payloads)
    const response = await fetchWithTimeout(
      `${API_BASE}/${currentSessionId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: sessionState }),
      },
      SAVE_TIMEOUT_MS
    );

    if (!response.ok) {
      console.error('Failed to save session:', response.status);
      return false;
    }

    lastSavedState = stateJson;
    return true;
  } catch (error) {
    // Phase 13A: Handle timeout errors specifically
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Save session timed out');
    } else {
      console.error('Failed to save session:', error);
    }
    return false;
  }
}

/**
 * Remix a session (create a copy and switch to it)
 */
export async function remixSession(sourceId: string): Promise<Session> {
  const response = await fetchWithTimeout(`${API_BASE}/${sourceId}/remix`, {
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
 */
export async function sendCopy(sourceId: string): Promise<string> {
  const response = await fetchWithTimeout(`${API_BASE}/${sourceId}/remix`, {
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
