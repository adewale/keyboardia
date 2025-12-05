/**
 * Session CRUD operations using KV storage
 */

import type { Env, Session, SessionState } from './types';

const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const CURRENT_VERSION = 1;

/**
 * Generate a cryptographically secure UUID v4
 */
function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Create a new session
 */
export async function createSession(
  env: Env,
  initialState?: Partial<SessionState>
): Promise<Session> {
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
    createdAt: now,
    updatedAt: now,
    forkedFrom: null,
    state: { ...defaultState, ...initialState },
  };

  await env.SESSIONS.put(
    `session:${id}`,
    JSON.stringify(session),
    { expirationTtl: SESSION_TTL }
  );

  return session;
}

/**
 * Get a session by ID
 */
export async function getSession(
  env: Env,
  id: string
): Promise<Session | null> {
  const data = await env.SESSIONS.get(`session:${id}`, 'json');
  return data as Session | null;
}

/**
 * Update a session's state
 */
export async function updateSession(
  env: Env,
  id: string,
  state: SessionState
): Promise<Session | null> {
  const existing = await getSession(env, id);
  if (!existing) return null;

  const updated: Session = {
    ...existing,
    updatedAt: Date.now(),
    state: { ...state, version: CURRENT_VERSION },
  };

  await env.SESSIONS.put(
    `session:${id}`,
    JSON.stringify(updated),
    { expirationTtl: SESSION_TTL }
  );

  return updated;
}

/**
 * Fork a session (create a copy with new ID)
 */
export async function forkSession(
  env: Env,
  sourceId: string
): Promise<Session | null> {
  const source = await getSession(env, sourceId);
  if (!source) return null;

  const id = generateSessionId();
  const now = Date.now();

  const forked: Session = {
    id,
    createdAt: now,
    updatedAt: now,
    forkedFrom: sourceId,
    state: { ...source.state },
  };

  await env.SESSIONS.put(
    `session:${id}`,
    JSON.stringify(forked),
    { expirationTtl: SESSION_TTL }
  );

  return forked;
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
