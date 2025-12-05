/**
 * Cloudflare Worker entry point
 * Handles API routes and serves static assets
 */

import type { Env, SessionState, CreateSessionResponse, ForkSessionResponse, ErrorResponse } from './types';
import { createSession, getSession, updateSession, forkSession, deleteSession } from './sessions';

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

  // POST /api/sessions - Create new session
  if (path === '/api/sessions' && method === 'POST') {
    try {
      let initialState: Partial<SessionState> | undefined;

      // Check if request has a body
      const contentType = request.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const body = await request.json() as { state?: Partial<SessionState> };
        initialState = body.state;
      }

      const session = await createSession(env, initialState);
      const response: CreateSessionResponse = {
        id: session.id,
        url: `/s/${session.id}`,
      };

      return new Response(JSON.stringify(response), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return jsonError('Failed to create session', 500);
    }
  }

  // Match /api/sessions/:id patterns
  const sessionMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})$/);
  const forkMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/fork$/);

  // POST /api/sessions/:id/fork - Fork a session
  if (forkMatch && method === 'POST') {
    const sourceId = forkMatch[1];
    const forked = await forkSession(env, sourceId);

    if (!forked) {
      return jsonError('Session not found', 404);
    }

    const response: ForkSessionResponse = {
      id: forked.id,
      forkedFrom: sourceId,
      url: `/s/${forked.id}`,
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
      return jsonError('Session not found', 404);
    }

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
      const updated = await updateSession(env, id, body.state);

      if (!updated) {
        return jsonError('Session not found', 404);
      }

      return new Response(JSON.stringify({ id: updated.id, updatedAt: updated.updatedAt }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return jsonError('Invalid request body', 400);
    }
  }

  // DELETE /api/sessions/:id - Delete session
  if (sessionMatch && method === 'DELETE') {
    const id = sessionMatch[1];
    const deleted = await deleteSession(env, id);

    if (!deleted) {
      return jsonError('Session not found', 404);
    }

    return new Response(null, { status: 204 });
  }

  // Unknown API route
  return jsonError('Not found', 404);
}

function jsonError(message: string, status: number): Response {
  const error: ErrorResponse = { error: message };
  return new Response(JSON.stringify(error), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
