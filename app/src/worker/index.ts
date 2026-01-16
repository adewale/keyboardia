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
import { createSession, getSession, remixSessionFromState, publishSessionFromState, getSecondsUntilMidnightUTC } from './sessions';
import {
  isValidUUID,
  validateSessionState,
  validateSessionName,
  isBodySizeValid,
  validationErrorResponse,
} from './validation';
// Observability 2.0: Wide events
import {
  emitHttpRequestEvent,
  getDeployInfo,
  getInfraInfo,
  getServiceInfo,
  getDeviceType,
  WarningCollector,
  classifyError,
  classifyCustomError,
  createRequestMetrics,
  type HttpRequestEvent,
  type RequestMetrics,
} from './observability';
import { matchRoute, extractSessionId } from './route-patterns';

// State hashing utilities (still needed for debug endpoints)
import {
  hashState,
  canonicalizeForHash,
} from './logging';

// Social Media Preview
import { injectSocialMeta, type SessionMeta } from './social-preview';
import { handleOGImageRequest, purgeOGCache } from './og-image';
import type { Session } from '../shared/state';

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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // ========================================================================
    // OG Image Generation Route (must be before API and SPA routing)
    // Rate limited to prevent DoS via expensive image generation
    // ========================================================================
    if (path.match(/^\/og\/[a-f0-9-]{36}\.png$/)) {
      // Apply rate limiting (same limits as session creation)
      const clientIP = request.headers.get('CF-Connecting-IP');
      if (clientIP) {
        const rateLimit = checkRateLimit(clientIP);
        if (!rateLimit.allowed) {
          return new Response('Too many requests', {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)),
            },
          });
        }
      }
      return handleOGImageRequest(request, env, ctx, url);
    }

    // API routes
    if (path.startsWith('/api/')) {
      const response = await handleApiRequest(request, env, path, ctx);
      // Add CORS headers to all API responses EXCEPT WebSocket upgrades
      // WebSocket responses have immutable headers
      if (response.status !== 101) {
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      }
      return response;
    }

    // ========================================================================
    // Session Pages: Inject dynamic meta tags for social sharing & SEO
    // Always inject for valid session IDs (not just crawlers) so validation
    // tools like OpenGraph.xyz, metatags.io, and schema.org see correct content
    // Phase 34: Route through DO for latest state (includes pending changes)
    // ========================================================================
    if (path.startsWith('/s/')) {
      const sessionMatch = path.match(/^\/s\/([a-f0-9-]{36})$/);

      if (sessionMatch) {
        const sessionId = sessionMatch[1];

        // Phase 34: Get session from DO (source of truth) instead of direct KV read
        // This ensures social previews show the latest state including pending changes
        let sessionData: Session | null = null;
        try {
          const doId = env.LIVE_SESSIONS.idFromName(sessionId);
          const stub = env.LIVE_SESSIONS.get(doId);
          const doResponse = await stub.fetch(new Request(
            new URL(`/api/sessions/${sessionId}`, request.url).toString(),
            { method: 'GET' }
          ));
          if (doResponse.ok) {
            sessionData = await doResponse.json() as Session;
          }
        } catch (error) {
          // Fall back to KV if DO fails (session might not exist or DO error)
          console.log(`[meta] DO fetch failed for ${sessionId}, falling back to KV:`, error);
          sessionData = await env.SESSIONS.get(`session:${sessionId}`, 'json') as Session | null;
        }

        if (sessionData) {
          // Fetch the base HTML (index.html for SPA)
          const indexUrl = new URL('/', request.url);
          const baseResponse = await env.ASSETS.fetch(new Request(indexUrl, request));

          // Extract metadata for preview
          const meta: SessionMeta = {
            id: sessionId,
            name: sessionData.name,
            trackCount: sessionData.state?.tracks?.length ?? 0,
            tempo: sessionData.state?.tempo ?? 120
          };

          // Use the request's origin as the base URL (works for staging, production, etc.)
          const baseUrl = url.origin;

          // Transform with social meta tags
          return injectSocialMeta(baseResponse, meta, baseUrl);
        }
      }

      // Fall through to static SPA serving for /s/new or non-existent sessions
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
  path: string,
  ctx: ExecutionContext
): Promise<Response> {
  const method = request.method;
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  // Observability 2.0: Wide event setup
  const warnings = new WarningCollector();
  const metrics: RequestMetrics = createRequestMetrics();
  const routeMatch = matchRoute(path, method);
  const sessionId = extractSessionId(path);

  // Helper to emit http_request wide event
  const emitEvent = (
    status: number,
    options?: {
      sessionId?: string;
      playerId?: string;
      isPublished?: boolean;
      sourceSessionId?: string;
      responseSize?: number;
      error?: Error | string | null;
      errorSlug?: string;
      errorExpected?: boolean;
    }
  ) => {
    const event: HttpRequestEvent = {
      event: 'http_request',
      requestId,
      method,
      path,
      deviceType: getDeviceType(request.headers.get('User-Agent')),
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status,
      responseSize: options?.responseSize,
      routePattern: routeMatch.pattern,
      action: routeMatch.action,
      outcome: status >= 400 ? 'error' : 'ok',
      sessionId: options?.sessionId ?? sessionId,
      playerId: options?.playerId,
      isPublished: options?.isPublished,
      sourceSessionId: options?.sourceSessionId,
      kvReads: metrics.kvReads > 0 ? metrics.kvReads : undefined,
      kvWrites: metrics.kvWrites > 0 ? metrics.kvWrites : undefined,
      doRequests: metrics.doRequests > 0 ? metrics.doRequests : undefined,
      warnings: warnings.hasWarnings() ? warnings.get() : undefined,
      deploy: getDeployInfo(env),
      infra: getInfraInfo(request),
      service: getServiceInfo(env),
    };

    // Add error info if status indicates error
    if (status >= 400 && options?.error !== undefined) {
      if (options.errorSlug) {
        event.error = classifyCustomError(
          'Error',
          typeof options.error === 'string' ? options.error : options.error?.message ?? 'Unknown error',
          options.errorSlug,
          options.errorExpected ?? (status < 500),
          routeMatch.action
        );
      } else {
        event.error = classifyError(status, options.error, routeMatch.action);
      }
    }

    ctx.waitUntil(Promise.resolve().then(() => emitHttpRequestEvent(event)));
  };

  // GET /api/debug/logs - DEPRECATED: Legacy logs endpoint
  // Observability 2.0 uses Workers Logs instead of KV-based logging
  if (path === '/api/debug/logs' && method === 'GET') {
    emitEvent(200);
    return new Response(JSON.stringify({
      message: 'Legacy logs endpoint deprecated. Use wrangler tail or Workers Logs dashboard.',
      logs: [],
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/metrics - DEPRECATED: Legacy metrics endpoint
  // Observability 2.0 derives metrics from wide events in Workers Logs
  if (path === '/api/metrics' && method === 'GET') {
    emitEvent(200);
    return new Response(JSON.stringify({
      message: 'Legacy metrics endpoint deprecated. Metrics are now derived from Workers Logs wide events.',
    }, null, 2), {
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
        emitEvent(429, { error: 'Rate limit exceeded', errorSlug: 'rate-limited', errorExpected: true });
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
      emitEvent(413, { error: 'Request body too large', errorSlug: 'payload-too-large', errorExpected: true });
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
            emitEvent(400, { error: nameValidation.errors.join(', '), errorSlug: 'validation-error', errorExpected: true });
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
            emitEvent(400, { error: validation.errors.join(', '), errorSlug: 'validation-error', errorExpected: true });
            return validationErrorResponse(validation.errors);
          }
        }
      }

      metrics.kvWrites++;
      const result = await createSession(env, { initialState, name: sessionName });

      if (!result.success) {
        if (result.quotaExceeded) {
          emitEvent(503, { error: 'KV quota exceeded', errorSlug: 'kv-quota-exceeded', errorExpected: false });
          return quotaExceededResponse();
        }
        emitEvent(500, { error: result.error, errorSlug: 'session-create-failed', errorExpected: false });
        return jsonError('Failed to create session', 500);
      }

      const session = result.data;

      const response: CreateSessionResponse = {
        id: session.id,
        url: `/s/${session.id}`,
      };
      const responseBody = JSON.stringify(response);

      emitEvent(201, {
        sessionId: session.id,
        responseSize: new TextEncoder().encode(responseBody).length,
      });

      return new Response(responseBody, {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      emitEvent(500, { error: error as Error, errorSlug: 'session-create-failed', errorExpected: false });
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
    const wsSessionId = wsMatch[1];

    // Phase 13A: Validate session ID format BEFORE routing to DO
    // This saves DO billing for malformed requests
    if (!isValidUUID(wsSessionId)) {
      emitEvent(400, { sessionId: wsSessionId, error: 'Invalid session ID format', errorSlug: 'invalid-session-id', errorExpected: true });
      return jsonError('Invalid session ID format', 400);
    }

    // Verify session exists
    metrics.kvReads++;
    const session = await getSession(env, wsSessionId, false);
    if (!session) {
      emitEvent(404, { sessionId: wsSessionId, error: 'Session not found', errorSlug: 'session-not-found', errorExpected: true });
      return jsonError('Session not found', 404);
    }

    // Get the Durable Object instance for this session
    const doId = env.LIVE_SESSIONS.idFromName(wsSessionId);
    let stub = env.LIVE_SESSIONS.get(doId);

    // WebSocket upgrade - emit event before returning (101 response cannot be modified)
    // The ws_session event will be emitted by the DO on disconnect
    emitEvent(101, { sessionId: wsSessionId, isPublished: session.immutable });

    try {
      metrics.doRequests++;
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
        emitEvent(503, { sessionId: wsSessionId, error: 'Service overloaded', errorSlug: 'service-overloaded', errorExpected: false });
        return jsonError('Service temporarily unavailable', 503);
      }

      if (e.retryable) {
        // Create fresh stub and retry once
        stub = env.LIVE_SESSIONS.get(doId);
        warnings.add({ type: 'DORequestRetry', message: 'DO stub recreated after error', recoveryAction: 'retry_succeeded', attemptNumber: 2, totalAttempts: 2 });
        try {
          metrics.doRequests++;
          return await stub.fetch(request);
        } catch (retryError) {
          console.error(`[WS] DO retry failed: ${retryError}`);
          emitEvent(500, { sessionId: wsSessionId, error: retryError as Error, errorSlug: 'ws-connection-failed', errorExpected: false });
          return jsonError('Failed to establish WebSocket connection', 500);
        }
      }

      emitEvent(500, { sessionId: wsSessionId, error: error as Error, errorSlug: 'ws-connection-failed', errorExpected: false });
      return jsonError('WebSocket connection failed', 500);
    }
  }

  // GET /api/sessions/:id/live-debug - Forward to Durable Object debug endpoint
  const liveDebugMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/live-debug$/);
  if (liveDebugMatch && method === 'GET') {
    const debugSessionId = liveDebugMatch[1];

    try {
      // Get the Durable Object instance for this session
      const doId = env.LIVE_SESSIONS.idFromName(debugSessionId);
      const stub = env.LIVE_SESSIONS.get(doId);

      // Create debug request URL
      const debugUrl = new URL(request.url);
      debugUrl.pathname = `/api/sessions/${debugSessionId}/debug`;

      // Forward to DO
      metrics.doRequests++;
      const response = await stub.fetch(new Request(debugUrl.toString(), { method: 'GET' }));
      emitEvent(response.status, { sessionId: debugSessionId });
      return response;
    } catch (e) {
      console.error(`[live-debug] Error for session ${debugSessionId}:`, e);
      emitEvent(500, { sessionId: debugSessionId, error: e as Error, errorSlug: 'debug-request-failed', errorExpected: false });
      return jsonError(`Debug request failed: ${e}`, 500);
    }
  }

  // POST /api/sessions/:id/remix - Remix a session (create a copy)
  // Phase 34: Route through DO to get latest source state (may have pending changes)
  if (remixMatch && method === 'POST') {
    const sourceId = remixMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(sourceId)) {
      emitEvent(400, { sessionId: sourceId, error: 'Invalid session ID format', errorSlug: 'invalid-session-id', errorExpected: true });
      return jsonError('Invalid session ID format', 400);
    }

    // Get source session from DO (includes pending changes not yet in KV)
    const doId = env.LIVE_SESSIONS.idFromName(sourceId);
    const stub = env.LIVE_SESSIONS.get(doId);

    let sourceSession: Session | null = null;
    try {
      metrics.doRequests++;
      const doResponse = await stub.fetch(new Request(
        new URL(`/api/sessions/${sourceId}`, request.url).toString(),
        { method: 'GET' }
      ));
      if (doResponse.ok) {
        sourceSession = await doResponse.json() as Session;
      }
    } catch (error) {
      console.error(`[remix] DO error for source ${sourceId}:`, error);
      // Fall back to KV if DO fails
      warnings.add({ type: 'DORequestRetry', message: 'Fell back to KV after DO error', recoveryAction: 'fallback_used' });
      metrics.kvReads++;
      sourceSession = await getSession(env, sourceId, false);
    }

    if (!sourceSession) {
      emitEvent(404, { sessionId: sourceId, error: 'Session not found', errorSlug: 'session-not-found', errorExpected: true });
      return jsonError('Session not found', 404);
    }

    // Create remix using the DO-provided state
    metrics.kvWrites++;
    const result = await remixSessionFromState(env, sourceId, sourceSession);

    if (!result.success) {
      if (result.quotaExceeded) {
        emitEvent(503, { sourceSessionId: sourceId, error: 'KV quota exceeded', errorSlug: 'kv-quota-exceeded', errorExpected: false });
        return quotaExceededResponse();
      }
      emitEvent(500, { sourceSessionId: sourceId, error: result.error, errorSlug: 'remix-failed', errorExpected: false });
      return jsonError('Failed to remix session', 500);
    }

    const remixed = result.data;

    const response: RemixSessionResponse = {
      id: remixed.id,
      remixedFrom: sourceId,
      url: `/s/${remixed.id}`,
    };
    const responseBody = JSON.stringify(response);

    emitEvent(201, {
      sessionId: remixed.id,
      sourceSessionId: sourceId,
      isPublished: false,
      responseSize: new TextEncoder().encode(responseBody).length,
    });

    return new Response(responseBody, {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ==========================================================================
  // Phase 21: Publish endpoint (make session immutable)
  // ==========================================================================

  // POST /api/sessions/:id/publish - Publish a session (make it immutable)
  // Phase 34: Route through DO to get latest source state (may have pending changes)
  if (publishMatch && method === 'POST') {
    const publishSourceId = publishMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(publishSourceId)) {
      emitEvent(400, { sessionId: publishSourceId, error: 'Invalid session ID format', errorSlug: 'invalid-session-id', errorExpected: true });
      return jsonError('Invalid session ID format', 400);
    }

    // Get source session from DO (includes pending changes not yet in KV)
    const doId = env.LIVE_SESSIONS.idFromName(publishSourceId);
    const stub = env.LIVE_SESSIONS.get(doId);

    let sourceSession: Session | null = null;
    try {
      metrics.doRequests++;
      const doResponse = await stub.fetch(new Request(
        new URL(`/api/sessions/${publishSourceId}`, request.url).toString(),
        { method: 'GET' }
      ));
      if (doResponse.ok) {
        sourceSession = await doResponse.json() as Session;
      }
    } catch (error) {
      console.error(`[publish] DO error for source ${publishSourceId}:`, error);
      // Fall back to KV if DO fails
      warnings.add({ type: 'DORequestRetry', message: 'Fell back to KV after DO error', recoveryAction: 'fallback_used' });
      metrics.kvReads++;
      sourceSession = await getSession(env, publishSourceId, false);
    }

    if (!sourceSession) {
      emitEvent(404, { sessionId: publishSourceId, error: 'Session not found', errorSlug: 'session-not-found', errorExpected: true });
      return jsonError('Session not found', 404);
    }

    // Publish using the DO-provided state
    metrics.kvWrites++;
    const result = await publishSessionFromState(env, publishSourceId, sourceSession);

    if (!result.success) {
      if (result.quotaExceeded) {
        emitEvent(503, { sourceSessionId: publishSourceId, error: 'KV quota exceeded', errorSlug: 'kv-quota-exceeded', errorExpected: false });
        return quotaExceededResponse();
      }
      // Handle trying to publish from an already-published session
      if (result.error.includes('already-published')) {
        emitEvent(400, { sourceSessionId: publishSourceId, error: result.error, errorSlug: 'already-published', errorExpected: true });
        return jsonError(result.error, 400);
      }
      emitEvent(500, { sourceSessionId: publishSourceId, error: result.error, errorSlug: 'publish-failed', errorExpected: false });
      return jsonError('Failed to publish session', 500);
    }

    const published = result.data;

    // Purge OG image cache for both source and published sessions
    // Source: may have stale cached OG from before publish
    // Published: defensive purge in case of race conditions
    const baseUrl = new URL(request.url).origin;
    ctx.waitUntil(
      Promise.all([
        purgeOGCache(publishSourceId, baseUrl),  // Source session
        purgeOGCache(published.id, baseUrl),     // New published session
      ]).catch(error => console.error('[OG] Cache purge failed:', error))
    );

    // Return 201 Created - we're creating a NEW immutable session
    // The source session remains editable at its original URL
    const responseBody = JSON.stringify({
      id: published.id,
      immutable: published.immutable,
      url: `/s/${published.id}`,
      sourceId: publishSourceId,  // Include source session ID for reference
    });

    emitEvent(201, {
      sessionId: published.id,
      sourceSessionId: publishSourceId,
      isPublished: true,
      responseSize: new TextEncoder().encode(responseBody).length,
    });

    return new Response(responseBody, {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/sessions/:id - Get session
  // Phase 34: Route through Durable Object to get latest state (source of truth)
  // This fixes the architectural violation where we read stale data from KV
  // while DO had pending changes not yet persisted.
  if (sessionMatch && method === 'GET') {
    const getSessionId = sessionMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(getSessionId)) {
      emitEvent(400, { sessionId: getSessionId, error: 'Invalid session ID format', errorSlug: 'invalid-session-id', errorExpected: true });
      return jsonError('Invalid session ID format', 400);
    }

    // Route through DO - it will return latest state (including pending changes)
    // and merge with KV metadata (name, timestamps, etc.)
    const doId = env.LIVE_SESSIONS.idFromName(getSessionId);
    const stub = env.LIVE_SESSIONS.get(doId);

    try {
      metrics.doRequests++;
      const doResponse = await stub.fetch(new Request(request.url, { method: 'GET' }));

      if (doResponse.status === 404) {
        emitEvent(404, { sessionId: getSessionId, error: 'Session not found', errorSlug: 'session-not-found', errorExpected: true });
        return jsonError('Session not found', 404);
      }

      if (!doResponse.ok) {
        const errorBody = await doResponse.text();
        emitEvent(doResponse.status, { sessionId: getSessionId, error: errorBody, errorSlug: 'do-error', errorExpected: false });
        return new Response(errorBody, {
          status: doResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const session = await doResponse.json() as { state: { tracks: unknown[] }; immutable?: boolean };
      const responseBody = JSON.stringify(session);

      emitEvent(200, {
        sessionId: getSessionId,
        isPublished: session.immutable,
        responseSize: new TextEncoder().encode(responseBody).length,
      });

      return new Response(responseBody, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      // If DO fails, log and return error (don't silently fall back to KV)
      console.error(`[GET] DO error for session ${getSessionId}:`, error);
      emitEvent(500, { sessionId: getSessionId, error: error as Error, errorSlug: 'do-error', errorExpected: false });
      return jsonError('Failed to retrieve session', 500);
    }
  }

  // PUT /api/sessions/:id - Update session
  // Phase 31E: Route through Durable Object to maintain architectural correctness
  // Previously this wrote directly to KV, causing state desync with active DO
  if (sessionMatch && method === 'PUT') {
    const putSessionId = sessionMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(putSessionId)) {
      emitEvent(400, { sessionId: putSessionId, error: 'Invalid session ID format', errorSlug: 'invalid-session-id', errorExpected: true });
      return jsonError('Invalid session ID format', 400);
    }

    // Phase 13A: Validate body size before parsing
    if (!isBodySizeValid(request.headers.get('content-length'))) {
      emitEvent(413, { sessionId: putSessionId, error: 'Request body too large', errorSlug: 'payload-too-large', errorExpected: true });
      return jsonError('Request body too large', 413);
    }

    try {
      // Parse body to validate before forwarding to DO
      const body = await request.json() as { state: SessionState };

      // Phase 13A: Validate session state
      const validation = validateSessionState(body.state);
      if (!validation.valid) {
        emitEvent(400, { sessionId: putSessionId, error: validation.errors.join(', '), errorSlug: 'validation-error', errorExpected: true });
        return validationErrorResponse(validation.errors);
      }

      // Route to Durable Object - this is the architectural fix
      // The DO will:
      // 1. Update its internal state
      // 2. Persist to KV
      // 3. Broadcast to all connected WebSocket clients
      const doId = env.LIVE_SESSIONS.idFromName(putSessionId);
      const stub = env.LIVE_SESSIONS.get(doId);

      // Create a new request with the validated body
      const doRequest = new Request(request.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      metrics.doRequests++;
      const doResponse = await stub.fetch(doRequest);

      // Handle DO response - clone to get mutable headers for CORS
      if (doResponse.status === 403) {
        // Session is immutable
        emitEvent(403, { sessionId: putSessionId, error: 'Session is published and cannot be modified', errorSlug: 'session-immutable', errorExpected: true });
        const responseBody = await doResponse.text();
        return new Response(responseBody, {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!doResponse.ok) {
        const errorBody = await doResponse.text();
        emitEvent(doResponse.status, { sessionId: putSessionId, error: errorBody, errorSlug: 'update-failed', errorExpected: false });
        return new Response(errorBody, {
          status: doResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result = await doResponse.json() as { id: string; updatedAt: number; trackCount: number };

      emitEvent(200, { sessionId: putSessionId });

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      // Provide specific error messages for better debugging
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Distinguish between JSON parse errors and other errors
      if (error instanceof SyntaxError) {
        emitEvent(400, { sessionId: putSessionId, error: 'Invalid JSON', errorSlug: 'invalid-json', errorExpected: true });
        return new Response(
          JSON.stringify({
            error: 'Invalid JSON',
            details: 'Request body is not valid JSON. Check for syntax errors.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // For other errors, include the actual error message
      emitEvent(400, { sessionId: putSessionId, error: errorMessage, errorSlug: 'invalid-request', errorExpected: true });
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
    const patchSessionId = sessionMatch[1];

    // Phase 13A: Validate session ID format
    if (!isValidUUID(patchSessionId)) {
      emitEvent(400, { sessionId: patchSessionId, error: 'Invalid session ID format', errorSlug: 'invalid-session-id', errorExpected: true });
      return jsonError('Invalid session ID format', 400);
    }

    try {
      // Parse body to validate before forwarding to DO
      const body = await request.json() as { name?: string | null; state?: SessionState };

      const hasName = 'name' in body;
      const hasState = 'state' in body && body.state !== undefined;

      // Require at least one of name or state
      if (!hasName && !hasState) {
        emitEvent(400, { sessionId: patchSessionId, error: 'Missing name or state field', errorSlug: 'missing-field', errorExpected: true });
        return jsonError('Missing name or state field', 400);
      }

      // Validate name if provided (XSS prevention)
      if (hasName) {
        const nameValidation = validateSessionName(body.name);
        if (!nameValidation.valid) {
          emitEvent(400, { sessionId: patchSessionId, error: nameValidation.errors.join(', '), errorSlug: 'validation-error', errorExpected: true });
          return validationErrorResponse(nameValidation.errors);
        }
      }

      // Validate state if provided
      if (hasState) {
        const stateValidation = validateSessionState(body.state);
        if (!stateValidation.valid) {
          emitEvent(400, { sessionId: patchSessionId, error: stateValidation.errors.join(', '), errorSlug: 'validation-error', errorExpected: true });
          return validationErrorResponse(stateValidation.errors);
        }
      }

      // Route to Durable Object - this is the architectural fix
      // The DO will:
      // 1. Update KV
      // 2. Broadcast to all connected WebSocket clients
      const doId = env.LIVE_SESSIONS.idFromName(patchSessionId);
      const stub = env.LIVE_SESSIONS.get(doId);

      // Create a new request with the validated body
      const doRequest = new Request(request.url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      metrics.doRequests++;
      const doResponse = await stub.fetch(doRequest);

      // Handle DO response - clone to get mutable headers for CORS
      if (doResponse.status === 403) {
        // Session is immutable
        emitEvent(403, { sessionId: patchSessionId, error: 'Session is published and cannot be modified', errorSlug: 'session-immutable', errorExpected: true });
        const responseBody = await doResponse.text();
        return new Response(responseBody, {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!doResponse.ok) {
        const errorBody = await doResponse.text();
        emitEvent(doResponse.status, { sessionId: patchSessionId, error: errorBody, errorSlug: 'update-failed', errorExpected: false });
        return new Response(errorBody, {
          status: doResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result = await doResponse.json() as { id: string; name: string | null; updatedAt: number };

      emitEvent(200, { sessionId: patchSessionId });

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      // Provide specific error messages for better debugging
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Distinguish between JSON parse errors and other errors
      if (error instanceof SyntaxError) {
        emitEvent(400, { sessionId: patchSessionId, error: 'Invalid JSON', errorSlug: 'invalid-json', errorExpected: true });
        return new Response(
          JSON.stringify({
            error: 'Invalid JSON',
            details: 'Request body is not valid JSON. Check for syntax errors.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // For other errors, include the actual error message
      emitEvent(400, { sessionId: patchSessionId, error: errorMessage, errorSlug: 'invalid-request', errorExpected: true });
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
    const debugSessionId = debugMatch[1];
    metrics.kvReads++;
    const session = await getSession(env, debugSessionId, false); // Don't update access time

    if (!session) {
      emitEvent(404, { sessionId: debugSessionId, error: 'Session not found', errorSlug: 'session-not-found', errorExpected: true });
      return new Response(JSON.stringify({
        id: debugSessionId,
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

    emitEvent(200, { sessionId: debugSessionId });

    return new Response(JSON.stringify(debugInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ==========================================================================
  // Phase 7: Multiplayer Debug Endpoints
  // DEPRECATED: These endpoints used KV-based logging which is replaced by
  // Observability 2.0 wide events. They now return static messages pointing
  // users to Workers Logs.
  // ==========================================================================

  // GET /api/debug/session/:id/connections - DEPRECATED
  const connectionsMatch = path.match(/^\/api\/debug\/session\/([a-f0-9-]{36})\/connections$/);
  if (connectionsMatch && method === 'GET') {
    emitEvent(200, { sessionId: connectionsMatch[1] });
    return new Response(JSON.stringify({
      message: 'Legacy connections endpoint deprecated. Use wrangler tail to see ws_session events.',
      activeConnections: 0,
      players: [],
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/debug/session/:id/clock - Clock sync debug info (still functional)
  const clockMatch = path.match(/^\/api\/debug\/session\/([a-f0-9-]{36})\/clock$/);
  if (clockMatch && method === 'GET') {
    const clockSessionId = clockMatch[1];
    metrics.kvReads++;
    const session = await getSession(env, clockSessionId, false);

    if (!session) {
      emitEvent(404, { sessionId: clockSessionId, error: 'Session not found', errorSlug: 'session-not-found', errorExpected: true });
      return jsonError('Session not found', 404);
    }

    // Clock sync data is stored per-session
    metrics.kvReads++;
    const clockKey = `clock-sync:${clockSessionId}`;
    const clockData = await env.SESSIONS.get(clockKey, 'json') as {
      clients: Array<{ id: string; offset: number; lastPing: number }>;
    } | null;

    const clockInfo = {
      serverTime: Date.now(),
      connectedClients: clockData?.clients ?? [],
    };

    emitEvent(200, { sessionId: clockSessionId });
    return new Response(JSON.stringify(clockInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/debug/session/:id/state-sync - State sync verification (still functional)
  const stateSyncMatch = path.match(/^\/api\/debug\/session\/([a-f0-9-]{36})\/state-sync$/);
  if (stateSyncMatch && method === 'GET') {
    const syncSessionId = stateSyncMatch[1];
    metrics.kvReads++;
    const session = await getSession(env, syncSessionId, false);

    if (!session) {
      emitEvent(404, { sessionId: syncSessionId, error: 'Session not found', errorSlug: 'session-not-found', errorExpected: true });
      return jsonError('Session not found', 404);
    }

    // Use canonicalizeForHash for consistent comparison between client and server
    const canonicalState = canonicalizeForHash({
      tracks: session.state.tracks,
      tempo: session.state.tempo,
      swing: session.state.swing,
    });
    const serverStateHash = hashState(canonicalState);

    // Client hashes are reported via WebSocket
    metrics.kvReads++;
    const clientHashesKey = `state-hashes:${syncSessionId}`;
    const clientHashes = await env.SESSIONS.get(clientHashesKey, 'json') as Array<{
      playerId: string;
      hash: string;
    }> | null;

    const stateSyncInfo = {
      serverStateHash,
      clientHashes: (clientHashes ?? []).map(c => ({
        ...c,
        match: c.hash === serverStateHash,
      })),
    };

    emitEvent(200, { sessionId: syncSessionId });
    return new Response(JSON.stringify(stateSyncInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/debug/durable-object/:id - Durable Object debug info (still functional)
  const doDebugMatch = path.match(/^\/api\/debug\/durable-object\/([a-f0-9-]{36})$/);
  if (doDebugMatch && method === 'GET') {
    const doDebugSessionId = doDebugMatch[1];
    metrics.kvReads++;
    const session = await getSession(env, doDebugSessionId, false);

    if (!session) {
      emitEvent(404, { sessionId: doDebugSessionId, error: 'Session not found', errorSlug: 'session-not-found', errorExpected: true });
      return jsonError('Session not found', 404);
    }

    // Fetch debug info directly from the Durable Object
    try {
      const doId = env.LIVE_SESSIONS.idFromName(doDebugSessionId);
      const stub = env.LIVE_SESSIONS.get(doId);
      const debugUrl = new URL(request.url);
      debugUrl.pathname = `/api/sessions/${doDebugSessionId}/debug`;
      metrics.doRequests++;
      const doResponse = await stub.fetch(new Request(debugUrl.toString()));

      if (doResponse.ok) {
        const doDebug = await doResponse.json();
        emitEvent(200, { sessionId: doDebugSessionId });
        return new Response(JSON.stringify(doDebug, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch {
      // DO may not be active
      console.log('[DEBUG] DO not active');
    }

    // Fallback when DO is not active
    const doInfo = {
      id: doDebugSessionId,
      connectedPlayers: 0,
      playingPlayerIds: [],
      playingCount: 0,
      currentStep: 0,
      messageQueueSize: 0,
      lastActivity: 'unknown (DO not active)',
    };

    emitEvent(200, { sessionId: doDebugSessionId });
    return new Response(JSON.stringify(doInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/debug/session/:id/ws-logs - DEPRECATED
  const wsLogsMatch = path.match(/^\/api\/debug\/session\/([a-f0-9-]{36})\/ws-logs$/);
  if (wsLogsMatch && method === 'GET') {
    emitEvent(200, { sessionId: wsLogsMatch[1] });
    return new Response(JSON.stringify({
      message: 'Legacy ws-logs endpoint deprecated. Use wrangler tail to see ws_session events.',
      logs: [],
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Unknown API route
  emitEvent(404, { error: 'Unknown route', errorSlug: 'not-found', errorExpected: true });
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
