/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { randomUUID } from 'crypto'

// Mock session storage for local development
const mockSessions = new Map<string, unknown>();

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Mock API plugin for local development without backend
    {
      name: 'mock-api',
      configureServer(server) {
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
    },
  ],
  test: {
    globals: true,
    environment: 'node',
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
