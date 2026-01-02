/**
 * Cloudflare Worker entry point
 * Handles API routes and serves static assets
 */

import type { Env, SessionState, CreateSessionResponse, RemixSessionResponse, ErrorResponse } from './types';

// Phase 21.5: Rate limiting for session creation
// Simple in-memory rate limiter to prevent KV quota abuse
// Resets when worker restarts, which is acceptable for this use case
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
// NOTE: Increased from 10 to 100 for integration testing. Revert after testing.
const RATE_LIMIT_MAX_REQUESTS = 100; // Max 100 session creates per minute per IP

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  // Clean up old entries periodically (simple garbage collection)
  if (rateLimitMap.size > 10000) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (now - value.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(key);
      }
    }
  }

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // Start new window
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    const resetIn = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, remaining: 0, resetIn };
  }

  entry.count++;
  const resetIn = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - entry.count, resetIn };
}
import { createSession, getSession, remixSession, publishSession, getSecondsUntilMidnightUTC } from './sessions';
import {
  isValidUUID,
  validateSessionState,
  validateSessionName,
  isBodySizeValid,
  validationErrorResponse,
} from './validation';
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
  canonicalizeForHash,
  type ConnectionsDebugInfo,
  type ClockDebugInfo,
  type StateSyncDebugInfo,
  type DurableObjectDebugInfo,
  // WebSocketLog imported but used as type in getSessionWsLogs return
} from './logging';

// Phase 8: Export Durable Object class
export { LiveSessionDurableObject } from './live-session';

// Security headers for static assets
// Note: _headers file is a Pages convention; Workers need headers added in code
const SECURITY_HEADERS = {
  // CSP: blob: needed for Tone.js AudioWorklets, cloudflareinsights.com for Web Analytics
  'Content-Security-Policy': "default-src 'self'; script-src 'self' blob: https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://*.keyboardia.dev https://*.keyboardia.dev wss://*.workers.dev https://*.workers.dev https://cloudflareinsights.com; media-src 'self' blob:; worker-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self), autoplay=(self)',
};

/**
 * Add security headers to asset responses
 */
async function serveAssetWithSecurityHeaders(
  env: Env,
  request: Request,
  assetUrl?: URL
): Promise<Response> {
  const assetRequest = assetUrl ? new Request(assetUrl, request) : request;
  const response = await env.ASSETS.fetch(assetRequest);

  // Clone response to add headers (Response headers are immutable)
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    newHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for API requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API routes
    if (path.startsWith('/api/')) {
      const response = await handleApiRequest(request, env, path);
      // Add CORS headers to all API responses EXCEPT WebSocket upgrades
      // WebSocket responses have immutable headers
      if (response.status !== 101) {
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      }
      return response;
    }

    // SPA routing: /s/* routes should serve index.html for client-side routing
    // Matches both /s/{uuid} and /s/new
    if (path.startsWith('/s/')) {
      const indexUrl = new URL('/', request.url);
      return serveAssetWithSecurityHeaders(env, request, indexUrl);
    }

    // Serve static assets for everything else
    return serveAssetWithSecurityHeaders(env, request);
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
    // Phase 21.5: Rate limiting to prevent KV quota abuse
    // CF-Connecting-IP is always set in production by Cloudflare
    // When missing (test/local env), skip rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP');
    if (clientIP) {
      const rateLimit = checkRateLimit(clientIP);
      if (!rateLimit.allowed) {
        await completeLog(429, undefined, `Rate limit exceeded for IP: ${clientIP}`);
        return new Response(JSON.stringify({
          error: 'Too many requests. Please wait before creating more sessions.',
          retryAfter: Math.ceil(rateLimit.resetIn / 1000),
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
          },
        });
      }
    }

    // Phase 13A: Validate body size before parsing
    if (!isBodySizeValid(request.headers.get('content-length'))) {
      await completeLog(413, undefined, 'Request body too large');
      return jsonError('Request body too large', 413);
    }

    try {
      let initialState: Partial<SessionState> | undefined;
      let sessionName: string | null = null;

      // Check if request has a body
      const contentType = request.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const body = await request.json() as Record<string, unknown>;

        // Extract session name if provided
        if (body.name !== undefined) {
          const nameValidation = validateSessionName(body.name);
          if (!nameValidation.valid) {
            await completeLog(400, undefined, `Validation failed: ${nameValidation.errors.join(', ')}`);
            return validationErrorResponse(nameValidation.errors);
          }
          sessionName = body.name as string;
        }

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

        // Phase 13A: Validate session state before creating
        if (initialState) {
          const validation = validateSessionState(initialState);
          if (!validation.valid) {
            await completeLog(400, undefined, `Validation failed: ${validation.errors.join(', ')}`);
            return validationErrorResponse(validation.errors);
          }
        }

        // Log request body details
        log.requestBody = {
          trackCount: (initialState?.tracks as unknown[])?.length,
          tempo: initialState?.tempo as number,
          swing: initialState?.swing as number,
        };
      }

      const result = await createSession(env, { initialState, name: sessionName });

      if (!result.success) {
        if (result.quotaExceeded) {
          await completeLog(503, undefined, 'KV quota exceeded');
          return quotaExceededResponse();
        }
        await completeLog(500, undefined, result.error);
        return jsonError('Failed to create session', 500);
      }

      const session = result.data;

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
  const publishMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/publish$/);

  // ==========================================================================
  // Phase 8-9: WebSocket endpoint for multiplayer
  // ==========================================================================

  // GET /api/sessions/:id/ws - WebSocket upgrade to Durable Object
  const wsMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/ws$/);
  if (wsMatch && request.headers.get('Upgrade') === 'websocket') {
    const sessionId = wsMatch[1];

    // Phase 13A: Validate session ID format BEFORE routing to DO
    // This saves DO billing for malformed requests
    if (!isValidUUID(sessionId)) {
      await completeLog(400, undefined, 'Invalid session ID format');
      return jsonError('Invalid session ID format', 400);
    }

    // Verify session exists
    const session = await getSession(env, sessionId, false);
    if (!session) {
      await completeLog(404, undefined, 'Session not found');
      return jsonError('Session not found', 404);
    }

    // Get the Durable Object instance for this session
    const doId = env.LIVE_SESSIONS.idFromName(sessionId);
    let stub = env.LIVE_SESSIONS.get(doId);

    // Forward the WebSocket upgrade request to the DO
    // Don't log for WebSocket as it interferes with the upgrade
    console.log(`[GET] ${path} -> 101 (WebSocket upgrade) session=${sessionId}`);

    try {
      // Return the DO response directly - WebSocket upgrade responses cannot be modified
      return await stub.fetch(request);
    } catch (error) {
      // Phase 13A: Stub recreation on error (CF best practice)
      // DurableObjectStub may be in "broken" state after certain errors
      console.error(`[WS] DO error, recreating stub: ${error}`);

      // Check if error is retryable
      const e = error as { retryable?: boolean; overloaded?: boolean };
      if (e.overloaded) {
        // Never retry overloaded errors - it makes things worse
        await completeLog(503, undefined, 'Service overloaded');
        return jsonError('Service temporarily unavailable', 503);
      }

      if (e.retryable) {
        // Create fresh stub and retry once
        stub = env.LIVE_SESSIONS.get(doId);
        try {
          return await stub.fetch(request);
        } catch (retryError) {
          console.error(`[WS] DO retry failed: ${retryError}`);
          await completeLog(500, undefined, 'WebSocket connection failed');
          return jsonError('Failed to establish WebSocket connection', 500);
        }
      }

      await completeLog(500, undefined, String(error));
      return jsonError('WebSocket connection failed', 500);
    }
  }

  // GET /api/sessions/:id/live-debug - Forward to Durable Object debug endpoint
  const liveDebugMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/live-debug$/);
  if (liveDebugMatch && method === 'GET') {
    const sessionId = liveDebugMatch[1];

    try {
      // Get the Durable Object instance for this session
      const doId = env.LIVE_SESSIONS.idFromName(sessionId);
      const stub = env.LIVE_SESSIONS.get(doId);

      // Create debug request URL
      const debugUrl = new URL(request.url);
      debugUrl.pathname = `/api/sessions/${sessionId}/debug`;

      // Forward to DO
      const response = await stub.fetch(new Request(debugUrl.toString(), { method: 'GET' }));
      await completeLog(response.status);
      return response;
    } catch (e) {
      console.error(`[live-debug] Error for session ${sessionId}:`, e);
      await completeLog(500, undefined, String(e));
      return jsonError(`Debug request failed: ${e}`, 500);
    }
  }

  // POST /api/sessions/:id/remix - Remix a session (create a copy)
  if (remixMatch && method === 'POST') {
    const sourceId = remixMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(sourceId)) {
      await completeLog(400, undefined, 'Invalid session ID format');
      return jsonError('Invalid session ID format', 400);
    }

    const result = await remixSession(env, sourceId);

    if (!result) {
      await completeLog(404, undefined, 'Session not found');
      return jsonError('Session not found', 404);
    }

    if (!result.success) {
      if (result.quotaExceeded) {
        await completeLog(503, undefined, 'KV quota exceeded');
        return quotaExceededResponse();
      }
      await completeLog(500, undefined, result.error);
      return jsonError('Failed to remix session', 500);
    }

    const remixed = result.data;

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

  // ==========================================================================
  // Phase 21: Publish endpoint (make session immutable)
  // ==========================================================================

  // POST /api/sessions/:id/publish - Publish a session (make it immutable)
  if (publishMatch && method === 'POST') {
    const id = publishMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(id)) {
      await completeLog(400, undefined, 'Invalid session ID format');
      return jsonError('Invalid session ID format', 400);
    }

    const result = await publishSession(env, id);

    if (!result) {
      await completeLog(404, undefined, 'Session not found');
      return jsonError('Session not found', 404);
    }

    if (!result.success) {
      if (result.quotaExceeded) {
        await completeLog(503, undefined, 'KV quota exceeded');
        return quotaExceededResponse();
      }
      // Handle trying to publish from an already-published session
      if (result.error.includes('already-published')) {
        await completeLog(400, undefined, result.error);
        return jsonError(result.error, 400);
      }
      await completeLog(500, undefined, result.error);
      return jsonError('Failed to publish session', 500);
    }

    const published = result.data;

    await incrementMetric(env, 'publishes');
    await completeLog(201, {
      trackCount: published.state.tracks.length,
      hasData: published.state.tracks.length > 0,
    });

    // Return 201 Created - we're creating a NEW immutable session
    // The source session remains editable at its original URL
    return new Response(JSON.stringify({
      id: published.id,
      immutable: published.immutable,
      url: `/s/${published.id}`,
      sourceId: id,  // Include source session ID for reference
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/sessions/:id - Get session
  if (sessionMatch && method === 'GET') {
    const id = sessionMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(id)) {
      await completeLog(400, undefined, 'Invalid session ID format');
      return jsonError('Invalid session ID format', 400);
    }

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
  // Phase 31E: Route through Durable Object to maintain architectural correctness
  // Previously this wrote directly to KV, causing state desync with active DO
  if (sessionMatch && method === 'PUT') {
    const id = sessionMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(id)) {
      await completeLog(400, undefined, 'Invalid session ID format');
      return jsonError('Invalid session ID format', 400);
    }

    // Phase 13A: Validate body size before parsing
    if (!isBodySizeValid(request.headers.get('content-length'))) {
      await completeLog(413, undefined, 'Request body too large');
      return jsonError('Request body too large', 413);
    }

    try {
      // Parse body to validate before forwarding to DO
      const body = await request.json() as { state: SessionState };

      // Phase 13A: Validate session state
      const validation = validateSessionState(body.state);
      if (!validation.valid) {
        await completeLog(400, undefined, `Validation failed: ${validation.errors.join(', ')}`);
        return validationErrorResponse(validation.errors);
      }

      // Log request body details
      log.requestBody = {
        trackCount: body.state.tracks?.length,
        tempo: body.state.tempo,
        swing: body.state.swing,
      };

      // Route to Durable Object - this is the architectural fix
      // The DO will:
      // 1. Update its internal state
      // 2. Persist to KV
      // 3. Broadcast to all connected WebSocket clients
      const doId = env.LIVE_SESSIONS.idFromName(id);
      const stub = env.LIVE_SESSIONS.get(doId);

      // Create a new request with the validated body
      const doRequest = new Request(request.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const doResponse = await stub.fetch(doRequest);

      // Handle DO response - clone to get mutable headers for CORS
      if (doResponse.status === 403) {
        // Session is immutable
        await completeLog(403, undefined, 'Session is published and cannot be modified');
        const body = await doResponse.text();
        return new Response(body, {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!doResponse.ok) {
        const errorBody = await doResponse.text();
        await completeLog(doResponse.status, undefined, errorBody);
        return new Response(errorBody, {
          status: doResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result = await doResponse.json() as { id: string; updatedAt: number; trackCount: number };

      await incrementMetric(env, 'updates');
      await completeLog(200, {
        trackCount: result.trackCount,
        hasData: result.trackCount > 0,
      });

      console.log(`[PUT] Session ${id} updated via DO, ${result.trackCount} tracks`);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      // Provide specific error messages for better debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      await completeLog(400, undefined, errorMessage);

      // Distinguish between JSON parse errors and other errors
      if (error instanceof SyntaxError) {
        return new Response(
          JSON.stringify({
            error: 'Invalid JSON',
            details: 'Request body is not valid JSON. Check for syntax errors.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // For other errors, include the actual error message
      return new Response(
        JSON.stringify({
          error: 'Invalid request body',
          details: errorMessage,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // PATCH /api/sessions/:id - Update session metadata and/or state
  // Phase 31E: Route through Durable Object to maintain architectural correctness
  // Previously this wrote directly to KV, causing state desync with active DO
  //
  // Accepts:
  //   { name: "New Name" } - Update just the session name
  //   { state: {...} } - Update just the session state
  //   { name: "New Name", state: {...} } - Update both
  if (sessionMatch && method === 'PATCH') {
    const id = sessionMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(id)) {
      await completeLog(400, undefined, 'Invalid session ID format');
      return jsonError('Invalid session ID format', 400);
    }

    try {
      // Parse body to validate before forwarding to DO
      const body = await request.json() as { name?: string | null; state?: SessionState };

      const hasName = 'name' in body;
      const hasState = 'state' in body && body.state !== undefined;

      // Require at least one of name or state
      if (!hasName && !hasState) {
        await completeLog(400, undefined, 'Missing name or state field');
        return jsonError('Missing name or state field', 400);
      }

      // Validate name if provided (XSS prevention)
      if (hasName) {
        const nameValidation = validateSessionName(body.name);
        if (!nameValidation.valid) {
          await completeLog(400, undefined, `Name validation failed: ${nameValidation.errors.join(', ')}`);
          return validationErrorResponse(nameValidation.errors);
        }
      }

      // Validate state if provided
      if (hasState) {
        const stateValidation = validateSessionState(body.state);
        if (!stateValidation.valid) {
          await completeLog(400, undefined, `State validation failed: ${stateValidation.errors.join(', ')}`);
          return validationErrorResponse(stateValidation.errors);
        }
      }

      // Route to Durable Object - this is the architectural fix
      // The DO will:
      // 1. Update KV
      // 2. Broadcast to all connected WebSocket clients
      const doId = env.LIVE_SESSIONS.idFromName(id);
      const stub = env.LIVE_SESSIONS.get(doId);

      // Create a new request with the validated body
      const doRequest = new Request(request.url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const doResponse = await stub.fetch(doRequest);

      // Handle DO response - clone to get mutable headers for CORS
      if (doResponse.status === 403) {
        // Session is immutable
        await completeLog(403, undefined, 'Session is published and cannot be modified');
        const responseBody = await doResponse.text();
        return new Response(responseBody, {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!doResponse.ok) {
        const errorBody = await doResponse.text();
        await completeLog(doResponse.status, undefined, errorBody);
        return new Response(errorBody, {
          status: doResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result = await doResponse.json() as { id: string; name: string | null; updatedAt: number };

      await completeLog(200);

      console.log(`[PATCH] Session ${id} name updated via DO to: ${result.name}`);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      // Provide specific error messages for better debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      await completeLog(400, undefined, errorMessage);

      // Distinguish between JSON parse errors and other errors
      if (error instanceof SyntaxError) {
        return new Response(
          JSON.stringify({
            error: 'Invalid JSON',
            details: 'Request body is not valid JSON. Check for syntax errors.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // For other errors, include the actual error message
      return new Response(
        JSON.stringify({
          error: 'Invalid request body',
          details: errorMessage,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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
     
    const _now = Date.now();

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

    // Use canonicalizeForHash for consistent comparison between client and server
    const canonicalState = canonicalizeForHash({
      tracks: session.state.tracks,
      tempo: session.state.tempo,
      swing: session.state.swing,
    });
    const serverStateHash = hashState(canonicalState);

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

    // Phase 8: Fetch debug info directly from the Durable Object
    try {
      const doId = env.LIVE_SESSIONS.idFromName(id);
      const stub = env.LIVE_SESSIONS.get(doId);
      const debugUrl = new URL(request.url);
      debugUrl.pathname = `/api/sessions/${id}/debug`;
      const doResponse = await stub.fetch(new Request(debugUrl.toString()));

      if (doResponse.ok) {
        const doDebug = await doResponse.json();
        await completeLog(200);
        return new Response(JSON.stringify(doDebug, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch {
      // DO may not be active, fall back to KV-based info
      console.log('[DEBUG] DO not active, using KV fallback');
    }

    // Fallback: return what we can infer from KV/metrics
    const wsMetrics = await getWsMetrics(env, id);

    const doInfo: DurableObjectDebugInfo = {
      id,
      connectedPlayers: wsMetrics.connections.active,
      // Phase 22: Per-player playback tracking
      playingPlayerIds: [],
      playingCount: 0,
      currentStep: 0,
      messageQueueSize: 0,
      lastActivity: 'unknown (DO not active)',
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

/**
 * Return a 503 response for KV quota exceeded errors
 * Includes Retry-After header indicating when quota resets (midnight UTC)
 */
function quotaExceededResponse(): Response {
  const retryAfter = getSecondsUntilMidnightUTC();
  return new Response(JSON.stringify({
    error: 'Storage quota exceeded',
    message: 'Daily storage limit reached. Please try again later.',
    retryAfter,
  }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
    },
  });
}
