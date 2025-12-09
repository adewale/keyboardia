/**
 * Cloudflare Worker entry point
 * Handles API routes and serves static assets
 */

import type { Env, SessionState, CreateSessionResponse, RemixSessionResponse, ErrorResponse } from './types';
import { createSession, getSession, updateSession, remixSession } from './sessions';
import {
  RequestLog,
  generateRequestId,
  createRequestLog,
  storeLog,
  getSessionLogs,
  getRecentLogs,
  getMetrics,
  trackSessionCreated,
  trackSessionAccessed,
  incrementMetric,
  // Phase 7: Multiplayer Observability
  getSessionWsLogs,
  getWsMetrics,
  hashState,
  type ConnectionsDebugInfo,
  type ClockDebugInfo,
  type StateSyncDebugInfo,
  type DurableObjectDebugInfo,
  type WebSocketLog,
} from './logging';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for API requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API routes
    if (path.startsWith('/api/')) {
      const response = await handleApiRequest(request, env, path);
      // Add CORS headers to all API responses
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    }

    // SPA routing: /s/{uuid} routes should serve index.html
    if (path.match(/^\/s\/[a-f0-9-]{36}$/)) {
      // Rewrite to index.html for client-side routing
      const indexUrl = new URL('/', request.url);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }

    // Serve static assets for everything else
    return env.ASSETS.fetch(request);
  },
};

async function handleApiRequest(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const method = request.method;
  const requestId = generateRequestId();
  const startTime = Date.now();

  // Extract session ID from path for logging
  const sessionIdMatch = path.match(/\/([a-f0-9-]{36})/);
  const sessionId = sessionIdMatch ? sessionIdMatch[1] : undefined;

  // Create log entry
  const log = createRequestLog(requestId, method, path, sessionId);

  // Helper to complete and store log
  const completeLog = async (status: number, sessionState?: RequestLog['sessionState'], error?: string) => {
    log.status = status;
    log.responseTime = Date.now() - startTime;
    log.sessionState = sessionState;
    log.error = error;
    // Store log async (don't block response)
    storeLog(env, log).catch(console.error);
  };

  // GET /api/debug/logs - Get recent logs
  if (path === '/api/debug/logs' && method === 'GET') {
    const url = new URL(request.url);
    const filterSessionId = url.searchParams.get('sessionId');
    const limit = parseInt(url.searchParams.get('last') ?? '50', 10);

    const logs = filterSessionId
      ? await getSessionLogs(env, filterSessionId, limit)
      : await getRecentLogs(env, limit);

    await completeLog(200);
    return new Response(JSON.stringify({ logs }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/metrics - Get system metrics
  if (path === '/api/metrics' && method === 'GET') {
    const metrics = await getMetrics(env);
    await completeLog(200);
    return new Response(JSON.stringify(metrics, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/sessions - Create new session
  if (path === '/api/sessions' && method === 'POST') {
    try {
      let initialState: Partial<SessionState> | undefined;

      // Check if request has a body
      const contentType = request.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const body = await request.json() as Record<string, unknown>;

        // Support both { state: {...} } and direct { tracks: [...], tempo: ..., swing: ... }
        if (body.state && typeof body.state === 'object') {
          initialState = body.state as Partial<SessionState>;
        } else if (body.tracks !== undefined || body.tempo !== undefined || body.swing !== undefined) {
          // Direct format - tracks, tempo, swing at top level
          initialState = {
            tracks: body.tracks as SessionState['tracks'],
            tempo: body.tempo as number,
            swing: body.swing as number,
            version: (body.version as number) ?? 1,
          };
        }

        // Log request body details
        log.requestBody = {
          trackCount: (initialState?.tracks as unknown[])?.length,
          tempo: initialState?.tempo as number,
          swing: initialState?.swing as number,
        };
      }

      const session = await createSession(env, initialState);

      // Track metrics
      await trackSessionCreated(env);

      await completeLog(201, {
        trackCount: session.state.tracks.length,
        hasData: session.state.tracks.length > 0,
      });

      const response: CreateSessionResponse = {
        id: session.id,
        url: `/s/${session.id}`,
      };

      return new Response(JSON.stringify(response), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      await completeLog(500, undefined, String(error));
      return jsonError('Failed to create session', 500);
    }
  }

  // Match /api/sessions/:id patterns
  const sessionMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})$/);
  const remixMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/remix$/);

  // POST /api/sessions/:id/remix - Remix a session (create a copy)
  if (remixMatch && method === 'POST') {
    const sourceId = remixMatch[1];
    const remixed = await remixSession(env, sourceId);

    if (!remixed) {
      await completeLog(404, undefined, 'Session not found');
      return jsonError('Session not found', 404);
    }

    await incrementMetric(env, 'remixes');
    await completeLog(201, {
      trackCount: remixed.state.tracks.length,
      hasData: remixed.state.tracks.length > 0,
    });

    const response: RemixSessionResponse = {
      id: remixed.id,
      remixedFrom: sourceId,
      url: `/s/${remixed.id}`,
    };

    return new Response(JSON.stringify(response), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/sessions/:id - Get session
  if (sessionMatch && method === 'GET') {
    const id = sessionMatch[1];
    const session = await getSession(env, id);

    if (!session) {
      await completeLog(404, undefined, 'Session not found');
      return jsonError('Session not found', 404);
    }

    await trackSessionAccessed(env);
    await completeLog(200, {
      trackCount: session.state.tracks.length,
      hasData: session.state.tracks.length > 0,
    });

    return new Response(JSON.stringify(session), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // PUT /api/sessions/:id - Update session
  if (sessionMatch && method === 'PUT') {
    const id = sessionMatch[1];

    try {
      const body = await request.json() as { state: SessionState };

      // Log request body details
      log.requestBody = {
        trackCount: body.state.tracks?.length,
        tempo: body.state.tempo,
        swing: body.state.swing,
      };

      const updated = await updateSession(env, id, body.state);

      if (!updated) {
        await completeLog(404, undefined, 'Session not found');
        return jsonError('Session not found', 404);
      }

      await incrementMetric(env, 'updates');
      await completeLog(200, {
        trackCount: updated.state.tracks.length,
        hasData: updated.state.tracks.length > 0,
      });

      return new Response(JSON.stringify({ id: updated.id, updatedAt: updated.updatedAt }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      await completeLog(400, undefined, String(error));
      return jsonError('Invalid request body', 400);
    }
  }

  // GET /api/debug/session/:id - Debug endpoint for session inspection
  const debugMatch = path.match(/^\/api\/debug\/session\/([a-f0-9-]{36})$/);
  if (debugMatch && method === 'GET') {
    const id = debugMatch[1];
    const session = await getSession(env, id, false); // Don't update access time

    if (!session) {
      await completeLog(404, undefined, 'Session not found');
      return new Response(JSON.stringify({
        id,
        exists: false,
        error: 'Session not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create a debug summary
    const trackSummaries = session.state.tracks.map(t => ({
      id: t.id,
      name: t.name,
      sampleId: t.sampleId,
      activeSteps: t.steps.filter(Boolean).length,
      stepCount: t.stepCount,
    }));

    const debugInfo = {
      id: session.id,
      exists: true,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
      lastAccessedAt: new Date(session.lastAccessedAt).toISOString(),
      remixedFrom: session.remixedFrom,
      remixCount: session.remixCount,
      state: {
        trackCount: session.state.tracks.length,
        tempo: session.state.tempo,
        swing: session.state.swing,
        version: session.state.version,
        tracks: trackSummaries,
      },
      sizeBytes: JSON.stringify(session).length,
    };

    await completeLog(200, {
      trackCount: session.state.tracks.length,
      hasData: session.state.tracks.length > 0,
    });

    return new Response(JSON.stringify(debugInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ==========================================================================
  // Phase 7: Multiplayer Debug Endpoints
  // ==========================================================================

  // GET /api/debug/session/:id/connections - WebSocket connection info
  const connectionsMatch = path.match(/^\/api\/debug\/session\/([a-f0-9-]{36})\/connections$/);
  if (connectionsMatch && method === 'GET') {
    const id = connectionsMatch[1];
    const session = await getSession(env, id, false);

    if (!session) {
      await completeLog(404, undefined, 'Session not found');
      return jsonError('Session not found', 404);
    }

    const wsMetrics = await getWsMetrics(env, id);
    const wsLogs = await getSessionWsLogs(env, id, 50);

    // Build player connection info from logs
    const playerMap = new Map<string, { connectedAt: string; lastMessage: string; messageCount: number }>();
    const now = Date.now();

    for (const log of wsLogs) {
      if (log.type === 'ws_connect') {
        playerMap.set(log.playerId, {
          connectedAt: log.timestamp,
          lastMessage: log.timestamp,
          messageCount: 0,
        });
      } else if (log.type === 'ws_message') {
        const player = playerMap.get(log.playerId);
        if (player) {
          player.lastMessage = log.timestamp;
          player.messageCount++;
        }
      } else if (log.type === 'ws_disconnect') {
        playerMap.delete(log.playerId);
      }
    }

    // Calculate message rate (messages per second over last 5 minutes)
    const totalMessages = Object.values(wsMetrics.messages.byType).reduce((a, b) => a + b, 0);
    const messageRate = `${(totalMessages / 300).toFixed(1)}/sec`;

    const connectionsInfo: ConnectionsDebugInfo = {
      activeConnections: wsMetrics.connections.active,
      players: Array.from(playerMap.entries()).map(([id, info]) => ({
        id,
        connectedAt: info.connectedAt,
        lastMessage: info.lastMessage,
        messageCount: info.messageCount,
      })),
      messageRate,
    };

    await completeLog(200);
    return new Response(JSON.stringify(connectionsInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/debug/session/:id/clock - Clock sync debug info
  const clockMatch = path.match(/^\/api\/debug\/session\/([a-f0-9-]{36})\/clock$/);
  if (clockMatch && method === 'GET') {
    const id = clockMatch[1];
    const session = await getSession(env, id, false);

    if (!session) {
      await completeLog(404, undefined, 'Session not found');
      return jsonError('Session not found', 404);
    }

    // Clock sync data is stored per-session in Phase 10
    // For now, return placeholder structure that will be populated later
    const clockKey = `clock-sync:${id}`;
    const clockData = await env.SESSIONS.get(clockKey, 'json') as {
      clients: Array<{ id: string; offset: number; lastPing: number }>;
    } | null;

    const clockInfo: ClockDebugInfo = {
      serverTime: Date.now(),
      connectedClients: clockData?.clients ?? [],
    };

    await completeLog(200);
    return new Response(JSON.stringify(clockInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/debug/session/:id/state-sync - State sync verification
  const stateSyncMatch = path.match(/^\/api\/debug\/session\/([a-f0-9-]{36})\/state-sync$/);
  if (stateSyncMatch && method === 'GET') {
    const id = stateSyncMatch[1];
    const session = await getSession(env, id, false);

    if (!session) {
      await completeLog(404, undefined, 'Session not found');
      return jsonError('Session not found', 404);
    }

    const serverStateHash = hashState(session.state);

    // Client hashes are reported via WebSocket in Phase 9
    // For now, return placeholder structure
    const clientHashesKey = `state-hashes:${id}`;
    const clientHashes = await env.SESSIONS.get(clientHashesKey, 'json') as Array<{
      playerId: string;
      hash: string;
    }> | null;

    const stateSyncInfo: StateSyncDebugInfo = {
      serverStateHash,
      clientHashes: (clientHashes ?? []).map(c => ({
        ...c,
        match: c.hash === serverStateHash,
      })),
    };

    await completeLog(200);
    return new Response(JSON.stringify(stateSyncInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/debug/durable-object/:id - Durable Object debug info
  const doMatch = path.match(/^\/api\/debug\/durable-object\/([a-f0-9-]{36})$/);
  if (doMatch && method === 'GET') {
    const id = doMatch[1];
    const session = await getSession(env, id, false);

    if (!session) {
      await completeLog(404, undefined, 'Session not found');
      return jsonError('Session not found', 404);
    }

    const wsMetrics = await getWsMetrics(env, id);

    // DO state is stored in the DO itself (Phase 8)
    // For now, return what we can infer from KV
    const doStateKey = `do-state:${id}`;
    const doState = await env.SESSIONS.get(doStateKey, 'json') as {
      isPlaying: boolean;
      currentStep: number;
      messageQueueSize: number;
      lastActivity: number;
    } | null;

    const lastActivityAgo = doState?.lastActivity
      ? `${Math.round((Date.now() - doState.lastActivity) / 1000)}s ago`
      : 'unknown';

    const doInfo: DurableObjectDebugInfo = {
      id,
      connectedPlayers: wsMetrics.connections.active,
      isPlaying: doState?.isPlaying ?? false,
      currentStep: doState?.currentStep ?? 0,
      messageQueueSize: doState?.messageQueueSize ?? 0,
      lastActivity: lastActivityAgo,
    };

    await completeLog(200);
    return new Response(JSON.stringify(doInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/debug/session/:id/ws-logs - WebSocket logs for session
  const wsLogsMatch = path.match(/^\/api\/debug\/session\/([a-f0-9-]{36})\/ws-logs$/);
  if (wsLogsMatch && method === 'GET') {
    const id = wsLogsMatch[1];
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('last') ?? '100', 10);

    const wsLogs = await getSessionWsLogs(env, id, limit);

    await completeLog(200);
    return new Response(JSON.stringify({ logs: wsLogs }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Unknown API route
  await completeLog(404, undefined, 'Unknown route');
  return jsonError('Not found', 404);
}

function jsonError(message: string, status: number): Response {
  const error: ErrorResponse = { error: message };
  return new Response(JSON.stringify(error), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
