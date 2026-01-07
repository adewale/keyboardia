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

// Mock session storage for offline development
const mockSessions = new Map<string, unknown>();

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

      // Create session
      server.middlewares.use('/api/sessions', (req, res, next) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            const data = JSON.parse(body || '{}');
            const id = randomUUID();
            // Extract name from top-level, put rest in state
            const { name, ...state } = data;
            const session = {
              id,
              state: state,
              name: name || null,
              remixedFrom: null,
              remixedFromName: null,
              remixCount: 0,
              lastAccessedAt: Date.now(),
              immutable: false,
            };
            mockSessions.set(id, session);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(session));
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
          const sourceSession = mockSessions.get(sourceId) as Record<string, unknown> | undefined;

          if (!sourceSession) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Source session not found' }));
            return;
          }

          // Create published (immutable) version
          const publishedId = randomUUID();
          const publishedSession = {
            id: publishedId,
            state: sourceSession.state,
            name: (sourceSession.name as string) || null,
            remixedFrom: null,
            remixedFromName: null,
            remixCount: 0,
            lastAccessedAt: Date.now(),
            immutable: true, // Published sessions are immutable
          };
          mockSessions.set(publishedId, publishedSession);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(publishedSession));
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
          const sourceSession = mockSessions.get(sourceId) as Record<string, unknown> | undefined;

          if (!sourceSession) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Source session not found' }));
            return;
          }

          const newId = randomUUID();
          const newSession = {
            id: newId,
            state: sourceSession.state,
            name: null,
            remixedFrom: sourceId,
            remixedFromName: (sourceSession.name as string) || null,
            remixCount: 0,
            lastAccessedAt: Date.now(),
          };
          mockSessions.set(newId, newSession);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(newSession));
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
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(session));
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
          }
          return;
        }

        if (req.method === 'PUT' || req.method === 'PATCH') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            const updates = JSON.parse(body || '{}');
            const session = mockSessions.get(id) as Record<string, unknown> | undefined;
            if (session) {
              Object.assign(session, updates);
              mockSessions.set(id, session);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(session));
            } else {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Not found' }));
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
  test: {
    globals: true,
    environment: 'node',
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
