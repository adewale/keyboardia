/**
 * Session sync layer - handles saving/loading sessions from the API
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
  createdAt: number;
  updatedAt: number;
  forkedFrom: string | null;
  state: SessionState;
}

interface CreateSessionResponse {
  id: string;
  url: string;
}

interface ForkSessionResponse {
  id: string;
  forkedFrom: string;
  url: string;
}

const API_BASE = '/api/sessions';
const SAVE_DEBOUNCE_MS = 2000;

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
  const response = await fetch(API_BASE, {
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
  const response = await fetch(`${API_BASE}/${sessionId}`);

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
    const response = await fetch(`${API_BASE}/${currentSessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: sessionState }),
    });

    if (!response.ok) {
      console.error('Failed to save session:', response.status);
      return false;
    }

    lastSavedState = stateJson;
    return true;
  } catch (error) {
    console.error('Failed to save session:', error);
    return false;
  }
}

/**
 * Fork a session
 */
export async function forkSession(sourceId: string): Promise<Session> {
  const response = await fetch(`${API_BASE}/${sourceId}/fork`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to fork session');
  }

  const data = await response.json() as ForkSessionResponse;
  currentSessionId = data.id;

  // Load the full session
  const session = await loadSession(data.id);
  if (!session) throw new Error('Forked session not found');

  return session;
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
 * Convert session state to grid state
 */
export function sessionToGridState(session: Session): Partial<GridState> {
  return {
    tracks: session.state.tracks,
    tempo: session.state.tempo,
    swing: session.state.swing,
  };
}
