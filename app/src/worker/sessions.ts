/**
 * Session CRUD operations using KV storage
 */

import type { Env, Session, SessionState } from './types';

// Sessions are permanent by default (no TTL)
const CURRENT_VERSION = 1;

/**
 * Result type for operations that can fail with quota errors
 */
export type SessionResult<T> =
  | { success: true; data: T }
  | { success: false; quotaExceeded: boolean; error: string };

/**
 * Check if an error is a KV quota limit error
 */
function isKVQuotaError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('limit exceeded');
}

/**
 * Calculate seconds until midnight UTC (when quota resets)
 */
export function getSecondsUntilMidnightUTC(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

/**
 * Generate a cryptographically secure UUID v4
 */
function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Options for creating a new session
 */
export interface CreateSessionOptions {
  /** Initial session state (tracks, tempo, swing) */
  initialState?: Partial<SessionState>;
  /** Optional session name */
  name?: string | null;
}

/**
 * Create a new session
 */
export async function createSession(
  env: Env,
  options?: CreateSessionOptions
): Promise<SessionResult<Session>> {
  const id = generateSessionId();
  const now = Date.now();

  const defaultState: SessionState = {
    tracks: [],
    tempo: 120,
    swing: 0,
    version: CURRENT_VERSION,
  };

  const session: Session = {
    id,
    name: options?.name ?? null,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    remixedFrom: null,
    remixedFromName: null,
    remixCount: 0,
    state: { ...defaultState, ...options?.initialState },
  };

  try {
    await env.SESSIONS.put(`session:${id}`, JSON.stringify(session));
    return { success: true, data: session };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      quotaExceeded: isKVQuotaError(error),
      error: message,
    };
  }
}

/**
 * Get a session by ID (also updates lastAccessedAt)
 */
export async function getSession(
  env: Env,
  id: string,
  updateAccess: boolean = true
): Promise<Session | null> {
  const data = await env.SESSIONS.get(`session:${id}`, 'json') as Session | null;
  if (!data) return null;

  // Backwards compatibility: add missing fields
  const session: Session = {
    ...data,
    name: data.name ?? null,
    lastAccessedAt: data.lastAccessedAt ?? data.updatedAt ?? data.createdAt,
    remixedFromName: data.remixedFromName ?? null,
    remixCount: data.remixCount ?? 0,
  };

  // Update lastAccessedAt on read (async, don't await)
  if (updateAccess) {
    const now = Date.now();
    session.lastAccessedAt = now;
    env.SESSIONS.put(`session:${id}`, JSON.stringify(session)).catch(() => {
      // Ignore errors on access time update
    });
  }

  return session;
}

/**
 * Update a session's state
 */
export async function updateSession(
  env: Env,
  id: string,
  state: SessionState
): Promise<SessionResult<Session> | null> {
  // Pass false to avoid race condition with async lastAccessedAt update
  const existing = await getSession(env, id, false);
  if (!existing) return null;

  const updated: Session = {
    ...existing,
    updatedAt: Date.now(),
    state: { ...state, version: CURRENT_VERSION },
  };

  try {
    await env.SESSIONS.put(`session:${id}`, JSON.stringify(updated));
    return { success: true, data: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      quotaExceeded: isKVQuotaError(error),
      error: message,
    };
  }
}

/**
 * Remix a session (create a copy with new ID)
 */
export async function remixSession(
  env: Env,
  sourceId: string
): Promise<SessionResult<Session> | null> {
  const source = await getSession(env, sourceId, false);
  if (!source) return null;

  const id = generateSessionId();
  const now = Date.now();

  // Get a display name for the source session
  // Priority: session name > first track name (if non-empty) > "Untitled Session"
  const firstTrackName = source.state.tracks[0]?.name;
  const sourceName = firstTrackName || 'Untitled Session';

  const remixed: Session = {
    id,
    name: null,  // Start fresh, don't inherit source name
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    remixedFrom: sourceId,
    remixedFromName: source.name || sourceName,
    remixCount: 0,
    state: { ...source.state },
  };

  // Increment remix count on source (must complete before returning for consistency)
  source.remixCount = (source.remixCount ?? 0) + 1;
  try {
    await env.SESSIONS.put(`session:${sourceId}`, JSON.stringify(source));
  } catch {
    // Non-critical: remix count update failed, but remix itself can proceed
  }

  try {
    await env.SESSIONS.put(`session:${id}`, JSON.stringify(remixed));
    return { success: true, data: remixed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      quotaExceeded: isKVQuotaError(error),
      error: message,
    };
  }
}

/**
 * Delete a session
 */
export async function deleteSession(
  env: Env,
  id: string
): Promise<boolean> {
  const existing = await getSession(env, id);
  if (!existing) return false;

  await env.SESSIONS.delete(`session:${id}`);
  return true;
}

/**
 * Update a session's name
 */
export async function updateSessionName(
  env: Env,
  id: string,
  name: string | null
): Promise<SessionResult<Session> | null> {
  const existing = await getSession(env, id, false);
  if (!existing) return null;

  // Sanitize name: trim, limit length, allow null
  const sanitizedName = name
    ? name.trim().slice(0, 100) || null
    : null;

  const updated: Session = {
    ...existing,
    name: sanitizedName,
    updatedAt: Date.now(),
  };

  try {
    await env.SESSIONS.put(`session:${id}`, JSON.stringify(updated));
    return { success: true, data: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      quotaExceeded: isKVQuotaError(error),
      error: message,
    };
  }
}
