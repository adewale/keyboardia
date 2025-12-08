/**
 * Structured request logging for observability
 */

import type { Env } from './types';

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
  } | null;

  // Total sessions requires listing KV (expensive, so we estimate)
  const totalEstimate = await env.SESSIONS.get('metrics:total-sessions', 'json') as number | null;

  return {
    sessions: {
      total: totalEstimate ?? 0,
      createdToday: dailyMetrics?.created ?? 0,
      accessedToday: dailyMetrics?.accessed ?? 0,
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
  } | null;

  const metrics = existing ?? { created: 0, accessed: 0 };
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
  } | null;

  const metrics = existing ?? { created: 0, accessed: 0 };
  metrics.accessed++;

  await env.SESSIONS.put(dailyKey, JSON.stringify(metrics), {
    expirationTtl: 86400 * 7,
  });

  await incrementMetric(env, 'reads');
}
