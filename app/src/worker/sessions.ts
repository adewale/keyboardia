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
    immutable: false,
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
    immutable: data.immutable ?? false,
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

  // Get a display name for the source session (use first track name or "Untitled")
  const sourceName = source.state.tracks.length > 0
    ? source.state.tracks[0].name
    : 'Untitled Session';

  const remixed: Session = {
    id,
    name: null,  // Start fresh, don't inherit source name
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    remixedFrom: sourceId,
    remixedFromName: source.name ?? sourceName,
    remixCount: 0,
    immutable: false,  // Remixes are always editable
    state: { ...source.state },
  };

  // Increment remix count on source (async, don't block)
  source.remixCount = (source.remixCount ?? 0) + 1;
  env.SESSIONS.put(`session:${sourceId}`, JSON.stringify(source)).catch(() => {
    // Ignore errors on remix count update
  });

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

/**
 * Phase 21: Publish a session (create an immutable copy)
 *
 * Publishing creates a NEW permanent, frozen snapshot that cannot be edited.
 * The source session remains editable - user keeps their working copy.
 * This is ideal for sharing finished work for others to listen/remix.
 *
 * Flow:
 * - POST /api/sessions/{id}/publish creates NEW session with immutable: true
 * - Returns the NEW session's ID/URL (the published version)
 * - Original session stays editable at its original URL
 */
export async function publishSession(
  env: Env,
  sourceId: string
): Promise<SessionResult<Session> | null> {
  const source = await getSession(env, sourceId, false);
  if (!source) return null;

  // Source already immutable? Can't publish from a published session
  // (User should remix first to get an editable copy)
  if (source.immutable) {
    return {
      success: false,
      quotaExceeded: false,
      error: 'Cannot publish from an already-published session. Remix it first to create an editable copy.',
    };
  }

  const id = generateSessionId();
  const now = Date.now();

  // Get a display name for the source session
  const sourceName = source.name ??
    (source.state.tracks.length > 0 ? source.state.tracks[0].name : 'Untitled Session');

  const published: Session = {
    id,
    name: source.name,  // Keep the name for published version
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    remixedFrom: sourceId,
    remixedFromName: sourceName,
    remixCount: 0,
    immutable: true,  // KEY: This is a frozen snapshot
    state: { ...source.state },
  };

  try {
    await env.SESSIONS.put(`session:${id}`, JSON.stringify(published));
    return { success: true, data: published };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      quotaExceeded: isKVQuotaError(error),
      error: message,
    };
  }
}
