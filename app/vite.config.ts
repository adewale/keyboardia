/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { randomUUID } from 'crypto'
import type { Plugin } from 'vite'

/**
 * Development Backend Configuration
 *
 * By default, Vite proxies to wrangler dev (localhost:8787) for real backend.
 * This ensures development exercises the same code paths as production,
 * including WebSocket connections to Durable Objects.
 *
 * Set USE_MOCK_API=1 to use mock API instead (for offline development).
 *
 * IMPORTANT: The mock API does NOT support WebSockets!
 * To test multiplayer features, you MUST use the real backend:
 *   1. Run: npm run build && npx wrangler dev
 *   2. Then: npm run dev (in another terminal)
 */
const USE_MOCK_API = process.env.USE_MOCK_API === '1';
const WRANGLER_PORT = process.env.WRANGLER_PORT || '8787';
const WRANGLER_URL = `http://localhost:${WRANGLER_PORT}`;

// In CI, proxy to production since wrangler isn't running
const PROXY_TARGET = process.env.CI
  ? 'https://keyboardia.adewale-883.workers.dev'
  : WRANGLER_URL;

interface MockSessionState {
  tracks: unknown[];
  tempo: number;
  swing: number;
  version: number;
  [key: string]: unknown;
}

interface MockSession {
  id: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  remixedFrom: string | null;
  remixedFromName: string | null;
  remixCount: number;
  immutable: boolean;
  state: MockSessionState;
}

// The only in-memory HTTP backend used by offline development and browser CI.
const mockSessions = new Map<string, MockSession>();

/**
 * Mock API plugin - only used when USE_MOCK_API=1
 * WARNING: Does not support WebSockets! Use real backend for multiplayer testing.
 */
function createMockApiPlugin(): Plugin {
  return {
    name: 'mock-api',
    configureServer(server) {
      console.log('\n⚠️  Using MOCK API - WebSockets are NOT supported!');
      console.log('   For multiplayer testing, run wrangler dev and restart without USE_MOCK_API\n');

      const sendJson = (
        res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void },
        status: number,
        body: unknown,
      ) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(body))
      }

      const cloneState = (state: MockSessionState): MockSessionState =>
        structuredClone(state)

      // Create session. Keep the response shape/status identical to the Worker.
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?', 1)[0]
        if (path === '/api/sessions' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const data = JSON.parse(body || '{}') as Record<string, unknown>
              const nestedState = data.state
              const directState = data.tracks !== undefined ||
                data.tempo !== undefined ||
                data.swing !== undefined
                ? data
                : undefined
              const supplied = nestedState && typeof nestedState === 'object'
                ? nestedState as Partial<MockSessionState>
                : directState as Partial<MockSessionState> | undefined
              const state: MockSessionState = {
                tracks: supplied?.tracks ?? [],
                tempo: supplied?.tempo ?? 120,
                swing: supplied?.swing ?? 0,
                version: supplied?.version ?? 1,
                ...supplied,
              }
              const id = randomUUID()
              const now = Date.now()
              mockSessions.set(id, {
                id,
                state,
                name: typeof data.name === 'string' ? data.name : null,
                createdAt: now,
                updatedAt: now,
                lastAccessedAt: now,
                remixedFrom: null,
                remixedFromName: null,
                remixCount: 0,
                immutable: false,
              })
              sendJson(res, 201, { id, url: `/s/${id}` })
            } catch {
              sendJson(res, 400, {
                error: 'Invalid JSON',
                details: 'Request body is not valid JSON. Check for syntax errors.',
              })
            }
          });
          return;
        }
        next();
      });

      // Publish session (make immutable)
      server.middlewares.use((req, res, next) => {
        const publishMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/publish$/);
        if (!publishMatch) return next();

        if (req.method === 'POST') {
          const sourceId = publishMatch[1];
          const sourceSession = mockSessions.get(sourceId);

          if (!sourceSession) {
            sendJson(res, 404, { error: 'Session not found' })
            return;
          }
          if (sourceSession.immutable) {
            sendJson(res, 400, {
              error: 'Cannot publish from an already-published session. Remix it first to create an editable copy.',
            })
            return
          }

          const publishedId = randomUUID()
          const now = Date.now()
          const sourceName = sourceSession.name ??
            ((sourceSession.state.tracks[0] as { name?: string } | undefined)?.name ?? 'Untitled Session')
          const publishedSession: MockSession = {
            id: publishedId,
            state: cloneState(sourceSession.state),
            name: sourceSession.name,
            createdAt: now,
            updatedAt: now,
            lastAccessedAt: now,
            remixedFrom: sourceId,
            remixedFromName: sourceName,
            remixCount: 0,
            immutable: true,
          }
          mockSessions.set(publishedId, publishedSession)
          sendJson(res, 201, {
            id: publishedId,
            immutable: true,
            url: `/s/${publishedId}`,
            sourceId,
          })
          return;
        }
        next();
      });

      // Remix session
      server.middlewares.use((req, res, next) => {
        const remixMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/remix$/);
        if (!remixMatch) return next();

        if (req.method === 'POST') {
          const sourceId = remixMatch[1];
          const sourceSession = mockSessions.get(sourceId);

          if (!sourceSession) {
            sendJson(res, 404, { error: 'Session not found' })
            return;
          }

          const newId = randomUUID()
          const now = Date.now()
          const sourceName = sourceSession.name ??
            ((sourceSession.state.tracks[0] as { name?: string } | undefined)?.name ?? 'Untitled Session')
          const newSession: MockSession = {
            id: newId,
            state: cloneState(sourceSession.state),
            name: null,
            createdAt: now,
            updatedAt: now,
            lastAccessedAt: now,
            remixedFrom: sourceId,
            remixedFromName: sourceName,
            remixCount: 0,
            immutable: false,
          }
          sourceSession.remixCount++
          mockSessions.set(newId, newSession)
          sendJson(res, 201, {
            id: newId,
            remixedFrom: sourceId,
            url: `/s/${newId}`,
          })
          return;
        }
        next();
      });

      // Get/Update session
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/api\/sessions\/([^/?]+)/);
        if (!match) return next();

        const id = match[1];

        if (req.method === 'GET') {
          const session = mockSessions.get(id);
          if (session) {
            session.lastAccessedAt = Date.now()
            sendJson(res, 200, session)
          } else {
            sendJson(res, 404, { error: 'Session not found' })
          }
          return;
        }

        if (req.method === 'PUT' || req.method === 'PATCH') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            const session = mockSessions.get(id)
            if (!session) {
              sendJson(res, 404, { error: 'Session not found' })
              return
            }
            if (session.immutable) {
              sendJson(res, 403, { error: 'Cannot modify published session' })
              return
            }

            try {
              const updates = JSON.parse(body || '{}') as {
                name?: string | null
                state?: MockSessionState
              }
              const now = Date.now()

              if (req.method === 'PUT') {
                if (!updates.state || typeof updates.state !== 'object') {
                  sendJson(res, 400, { error: 'Invalid session state' })
                  return
                }
                session.state = cloneState(updates.state)
                session.updatedAt = now
                sendJson(res, 200, {
                  id,
                  updatedAt: now,
                  trackCount: session.state.tracks.length,
                })
                return
              }

              if (!('name' in updates) && !('state' in updates)) {
                sendJson(res, 400, { error: 'Missing name or state field' })
                return
              }
              if ('name' in updates) {
                session.name = typeof updates.name === 'string'
                  ? updates.name.trim().slice(0, 100) || null
                  : null
              }
              if (updates.state && typeof updates.state === 'object') {
                session.state = cloneState(updates.state)
              }
              session.updatedAt = now
              sendJson(res, 200, { id, name: session.name, updatedAt: now })
            } catch {
              sendJson(res, 400, {
                error: 'Invalid JSON',
                details: 'Request body is not valid JSON. Check for syntax errors.',
              })
            }
          });
          return;
        }

        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Only use mock API if explicitly requested
    ...(USE_MOCK_API ? [createMockApiPlugin()] : []),
  ],
  build: {
    rollupOptions: {
      output: {
        // Phase 34: Manual chunk splitting for better caching
        manualChunks: {
          // Tone.js is large (~500KB) - split into its own chunk
          'tone': ['tone'],
          // React core libraries - stable, can be cached long-term
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    // Proxy to wrangler dev for real backend (unless using mock)
    // In CI, proxies to production instead
    proxy: USE_MOCK_API ? undefined : {
      // Proxy all API requests to backend
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
        // Handle WebSocket upgrades for multiplayer
        ws: true,
        // Rewrite for HTTPS in CI (WebSocket upgrade)
        secure: process.env.CI ? true : false,
        // Log proxy errors but don't fail
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if (process.env.CI) {
              console.error(`\n❌ Proxy error to production: ${err.message}`);
            } else {
              console.error(`\n❌ Proxy error: ${err.message}`);
              console.error('   Is wrangler dev running? Start it with: npx wrangler dev\n');
            }
          });
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', (err) => {
              console.error(`WebSocket proxy error: ${err.message}`);
            });
          });
        },
      },
    },
  },
  // NOTE: Test configuration lives in vitest.config.ts (jsdom environment).
  // Do NOT add a test block here — vitest ignores it when vitest.config.ts exists,
  // and it creates phantom failures if someone runs vitest from the repo root.
  // See docs/LESSONS-LEARNED.md - Lesson 19.
})
