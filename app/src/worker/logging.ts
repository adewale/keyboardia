/**
 * Structured request logging for observability
 *
 * Supports both HTTP request logging and WebSocket lifecycle logging
 * for multiplayer session debugging.
 */

import type { Env } from './types';

// =============================================================================
// HTTP Request Logging
// =============================================================================

export interface RequestLog {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  sessionId?: string;

  // Request details
  requestBody?: {
    trackCount?: number;
    tempo?: number;
    swing?: number;
  };

  // Response details
  status: number;
  responseTime: number;

  // Session state (for debugging)
  sessionState?: {
    trackCount: number;
    hasData: boolean;
  };

  error?: string;
}

// =============================================================================
// WebSocket Lifecycle Logging (Phase 7: Multiplayer Observability)
// =============================================================================

export type WebSocketLogType = 'ws_connect' | 'ws_message' | 'ws_disconnect';

export interface WebSocketLog {
  type: WebSocketLogType;
  timestamp: string;
  sessionId: string;
  playerId: string;

  // For messages
  messageType?: string;
  payload?: unknown;

  // For disconnect
  reason?: string;
  duration?: number; // Connection duration in seconds
}

/**
 * Player connection info for debug endpoints
 */
export interface PlayerConnectionInfo {
  id: string;
  connectedAt: string;
  lastMessage: string;
  messageCount: number;
}

/**
 * Connection summary for debug endpoints
 */
export interface ConnectionsDebugInfo {
  activeConnections: number;
  players: PlayerConnectionInfo[];
  messageRate: string; // e.g., "12/sec"
}

/**
 * Clock sync info for debug endpoints
 */
export interface ClockDebugInfo {
  serverTime: number;
  connectedClients: Array<{
    id: string;
    reportedOffset: number;
    lastPing: number;
  }>;
}

/**
 * State sync info for debug endpoints
 */
export interface StateSyncDebugInfo {
  serverStateHash: string;
  clientHashes: Array<{
    playerId: string;
    hash: string;
    match: boolean;
  }>;
}

/**
 * Durable Object debug info
 */
export interface DurableObjectDebugInfo {
  id: string;
  connectedPlayers: number;
  isPlaying: boolean;
  currentStep: number;
  messageQueueSize: number;
  lastActivity: string;
}

// Store logs for up to 1 hour
const LOG_TTL_SECONDS = 3600;
const MAX_LOGS_PER_SESSION = 100;

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Create a structured log entry
 */
export function createRequestLog(
  requestId: string,
  method: string,
  path: string,
  sessionId?: string
): RequestLog {
  return {
    timestamp: new Date().toISOString(),
    requestId,
    method,
    path,
    sessionId,
    status: 0,
    responseTime: 0,
  };
}

/**
 * Store a log entry in KV
 */
export async function storeLog(env: Env, log: RequestLog): Promise<void> {
  // Store by request ID for individual lookup
  const logKey = `log:${log.requestId}`;
  await env.SESSIONS.put(logKey, JSON.stringify(log), {
    expirationTtl: LOG_TTL_SECONDS,
  });

  // Also index by session ID for session-specific queries
  if (log.sessionId) {
    const sessionLogKey = `session-logs:${log.sessionId}`;
    const existingLogs = await env.SESSIONS.get(sessionLogKey, 'json') as string[] | null;
    const logIds = existingLogs ?? [];

    // Keep only the most recent logs
    logIds.push(log.requestId);
    if (logIds.length > MAX_LOGS_PER_SESSION) {
      logIds.shift();
    }

    await env.SESSIONS.put(sessionLogKey, JSON.stringify(logIds), {
      expirationTtl: LOG_TTL_SECONDS,
    });
  }

  // Also add to global recent logs list
  const recentKey = 'logs:recent';
  const recentLogs = await env.SESSIONS.get(recentKey, 'json') as string[] | null;
  const recentIds = recentLogs ?? [];

  recentIds.push(log.requestId);
  if (recentIds.length > 200) {
    recentIds.shift();
  }

  await env.SESSIONS.put(recentKey, JSON.stringify(recentIds), {
    expirationTtl: LOG_TTL_SECONDS,
  });

  // Console log for Wrangler tail
  console.log(`[${log.method}] ${log.path} -> ${log.status} (${log.responseTime}ms)`,
    log.sessionId ? `session=${log.sessionId}` : '',
    log.error ? `error=${log.error}` : ''
  );
}

/**
 * Get logs for a specific session
 */
export async function getSessionLogs(
  env: Env,
  sessionId: string,
  limit: number = 50
): Promise<RequestLog[]> {
  const sessionLogKey = `session-logs:${sessionId}`;
  const logIds = await env.SESSIONS.get(sessionLogKey, 'json') as string[] | null;

  if (!logIds || logIds.length === 0) {
    return [];
  }

  // Get the most recent logs up to the limit
  const idsToFetch = logIds.slice(-limit);
  const logs: RequestLog[] = [];

  for (const id of idsToFetch) {
    const log = await env.SESSIONS.get(`log:${id}`, 'json') as RequestLog | null;
    if (log) {
      logs.push(log);
    }
  }

  return logs;
}

/**
 * Get recent logs across all sessions
 */
export async function getRecentLogs(
  env: Env,
  limit: number = 50
): Promise<RequestLog[]> {
  const recentKey = 'logs:recent';
  const logIds = await env.SESSIONS.get(recentKey, 'json') as string[] | null;

  if (!logIds || logIds.length === 0) {
    return [];
  }

  // Get the most recent logs up to the limit
  const idsToFetch = logIds.slice(-limit);
  const logs: RequestLog[] = [];

  for (const id of idsToFetch) {
    const log = await env.SESSIONS.get(`log:${id}`, 'json') as RequestLog | null;
    if (log) {
      logs.push(log);
    }
  }

  return logs;
}

/**
 * Metrics tracking
 */
export interface Metrics {
  sessions: {
    total: number;
    createdToday: number;
    accessedToday: number;
    multiplayerToday: number;
  };
  requests: {
    last5Minutes: {
      creates: number;
      reads: number;
      updates: number;
      remixes: number;
    };
  };
}

/**
 * Increment a metric counter
 */
export async function incrementMetric(
  env: Env,
  metric: 'creates' | 'reads' | 'updates' | 'remixes'
): Promise<void> {
  const now = Date.now();
  const windowStart = now - 5 * 60 * 1000; // 5 minutes ago

  // Get current window metrics
  const key = 'metrics:requests';
  const existing = await env.SESSIONS.get(key, 'json') as {
    windowStart: number;
    counts: Record<string, number>
  } | null;

  let counts: Record<string, number>;

  if (existing && existing.windowStart > windowStart) {
    // Same window, increment
    counts = existing.counts;
  } else {
    // New window, reset
    counts = { creates: 0, reads: 0, updates: 0, remixes: 0 };
  }

  counts[metric] = (counts[metric] ?? 0) + 1;

  await env.SESSIONS.put(key, JSON.stringify({ windowStart: now, counts }), {
    expirationTtl: 600, // 10 minutes
  });
}

/**
 * Get current metrics
 */
export async function getMetrics(env: Env): Promise<Metrics> {
  const now = Date.now();
  const windowStart = now - 5 * 60 * 1000;
  const todayStart = new Date().setHours(0, 0, 0, 0);

  // Get request counts
  const requestMetrics = await env.SESSIONS.get('metrics:requests', 'json') as {
    windowStart: number;
    counts: Record<string, number>
  } | null;

  let requestCounts = { creates: 0, reads: 0, updates: 0, remixes: 0 };
  if (requestMetrics && requestMetrics.windowStart > windowStart) {
    requestCounts = requestMetrics.counts as typeof requestCounts;
  }

  // Get session counts from daily metrics
  const dailyKey = `metrics:daily:${new Date().toISOString().slice(0, 10)}`;
  const dailyMetrics = await env.SESSIONS.get(dailyKey, 'json') as {
    created: number;
    accessed: number;
    multiplayer: number;
  } | null;

  // Total sessions requires listing KV (expensive, so we estimate)
  const totalEstimate = await env.SESSIONS.get('metrics:total-sessions', 'json') as number | null;

  return {
    sessions: {
      total: totalEstimate ?? 0,
      createdToday: dailyMetrics?.created ?? 0,
      accessedToday: dailyMetrics?.accessed ?? 0,
      multiplayerToday: dailyMetrics?.multiplayer ?? 0,
    },
    requests: {
      last5Minutes: requestCounts,
    },
  };
}

/**
 * Track a session creation for daily metrics
 */
export async function trackSessionCreated(env: Env): Promise<void> {
  const dailyKey = `metrics:daily:${new Date().toISOString().slice(0, 10)}`;
  const existing = await env.SESSIONS.get(dailyKey, 'json') as {
    created: number;
    accessed: number;
    multiplayer: number;
  } | null;

  const metrics = existing ?? { created: 0, accessed: 0, multiplayer: 0 };
  metrics.created++;

  await env.SESSIONS.put(dailyKey, JSON.stringify(metrics), {
    expirationTtl: 86400 * 7, // Keep for 7 days
  });

  // Update total count estimate
  const total = await env.SESSIONS.get('metrics:total-sessions', 'json') as number | null;
  await env.SESSIONS.put('metrics:total-sessions', JSON.stringify((total ?? 0) + 1));

  await incrementMetric(env, 'creates');
}

/**
 * Track a session access for daily metrics
 */
export async function trackSessionAccessed(env: Env): Promise<void> {
  const dailyKey = `metrics:daily:${new Date().toISOString().slice(0, 10)}`;
  const existing = await env.SESSIONS.get(dailyKey, 'json') as {
    created: number;
    accessed: number;
    multiplayer: number;
  } | null;

  const metrics = existing ?? { created: 0, accessed: 0, multiplayer: 0 };
  metrics.accessed++;

  await env.SESSIONS.put(dailyKey, JSON.stringify(metrics), {
    expirationTtl: 86400 * 7,
  });

  await incrementMetric(env, 'reads');
}

/**
 * Track when a session becomes multiplayer (2nd player joins)
 * Call this once per session when player count goes from 1 to 2
 */
export async function trackMultiplayer(env: Env): Promise<void> {
  const dailyKey = `metrics:daily:${new Date().toISOString().slice(0, 10)}`;
  const existing = await env.SESSIONS.get(dailyKey, 'json') as {
    created: number;
    accessed: number;
    multiplayer: number;
  } | null;

  const metrics = existing ?? { created: 0, accessed: 0, multiplayer: 0 };
  metrics.multiplayer++;

  await env.SESSIONS.put(dailyKey, JSON.stringify(metrics), {
    expirationTtl: 86400 * 7,
  });
}

// =============================================================================
// WebSocket Lifecycle Logging (Phase 7: Multiplayer Observability)
// =============================================================================

const WS_LOG_TTL_SECONDS = 3600; // 1 hour
const MAX_WS_LOGS_PER_SESSION = 500; // More events expected for WebSockets

/**
 * Generate a unique player ID
 */
export function generatePlayerId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Create a WebSocket connect log
 */
export function createWsConnectLog(sessionId: string, playerId: string): WebSocketLog {
  return {
    type: 'ws_connect',
    timestamp: new Date().toISOString(),
    sessionId,
    playerId,
  };
}

/**
 * Create a WebSocket message log
 */
export function createWsMessageLog(
  sessionId: string,
  playerId: string,
  messageType: string,
  payload?: unknown
): WebSocketLog {
  return {
    type: 'ws_message',
    timestamp: new Date().toISOString(),
    sessionId,
    playerId,
    messageType,
    payload,
  };
}

/**
 * Create a WebSocket disconnect log
 */
export function createWsDisconnectLog(
  sessionId: string,
  playerId: string,
  reason: string,
  durationSeconds: number
): WebSocketLog {
  return {
    type: 'ws_disconnect',
    timestamp: new Date().toISOString(),
    sessionId,
    playerId,
    reason,
    duration: durationSeconds,
  };
}

/**
 * Store a WebSocket log entry
 */
export async function storeWsLog(env: Env, log: WebSocketLog): Promise<void> {
  const logId = `${log.sessionId}-${log.playerId}-${Date.now()}`;
  const logKey = `ws-log:${logId}`;

  // Store individual log
  await env.SESSIONS.put(logKey, JSON.stringify(log), {
    expirationTtl: WS_LOG_TTL_SECONDS,
  });

  // Index by session
  const sessionWsLogKey = `ws-session-logs:${log.sessionId}`;
  const existingIds = await env.SESSIONS.get(sessionWsLogKey, 'json') as string[] | null;
  const logIds = existingIds ?? [];

  logIds.push(logId);
  if (logIds.length > MAX_WS_LOGS_PER_SESSION) {
    logIds.shift();
  }

  await env.SESSIONS.put(sessionWsLogKey, JSON.stringify(logIds), {
    expirationTtl: WS_LOG_TTL_SECONDS,
  });

  // Console log for Wrangler tail (Phase 7 format)
  const typeLabel = log.type.replace('ws_', '').toUpperCase();
  const baseLog = `[WS] ${typeLabel.toLowerCase()} session=${log.sessionId} player=${log.playerId}`;

  if (log.type === 'ws_message') {
    console.log(`${baseLog} type=${log.messageType}`);
  } else if (log.type === 'ws_disconnect') {
    console.log(`${baseLog} reason=${log.reason} duration=${log.duration}s`);
  } else {
    console.log(baseLog);
  }
}

/**
 * Get WebSocket logs for a session
 */
export async function getSessionWsLogs(
  env: Env,
  sessionId: string,
  limit: number = 100
): Promise<WebSocketLog[]> {
  const sessionWsLogKey = `ws-session-logs:${sessionId}`;
  const logIds = await env.SESSIONS.get(sessionWsLogKey, 'json') as string[] | null;

  if (!logIds || logIds.length === 0) {
    return [];
  }

  const idsToFetch = logIds.slice(-limit);
  const logs: WebSocketLog[] = [];

  for (const id of idsToFetch) {
    const log = await env.SESSIONS.get(`ws-log:${id}`, 'json') as WebSocketLog | null;
    if (log) {
      logs.push(log);
    }
  }

  return logs;
}

// =============================================================================
// State Hashing for Consistency Verification (Phase 7)
// =============================================================================

/**
 * Compute a hash of the session state for consistency checks.
 * Uses a simple string hash since crypto.subtle is async and we need sync for tests.
 *
 * Note: In Cloudflare Workers, we could use crypto.subtle.digest, but this
 * simpler hash works well for detecting state divergence.
 */
export function hashState(state: unknown): string {
  const str = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to hex and pad
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Async version using SHA-256 for production use
 */
export async function hashStateAsync(state: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(state));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

