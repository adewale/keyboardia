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
            const state = JSON.parse(body || '{}');
            const id = randomUUID();
            const session = {
              id,
              state: state,
              name: null,
              remixedFrom: null,
              remixedFromName: null,
              remixCount: 0,
              lastAccessedAt: Date.now(),
            };
            mockSessions.set(id, session);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(session));
          });
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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime - loaded on every page
          'vendor-react': ['react', 'react-dom'],
          // Audio engine - only needed after session starts
          'vendor-audio': ['tone'],
          // Utility libraries - lazy loaded on demand
          'vendor-util': ['qrcode', 'midi-writer-js'],
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
  test: {
    globals: true,
    environment: 'node',
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
