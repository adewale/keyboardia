/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { randomUUID } from 'crypto'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { sanitizeSessionName } from './src/shared/validation'
import { MAX_MESSAGE_SIZE } from './src/shared/constants'
import { createInitialSessionState } from './src/shared/session-defaults'
import type { SessionState } from './src/shared/state'

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
  state: SessionState;
}

// The only in-memory HTTP backend used by offline development and browser CI.
const holbyArtifact = JSON.parse(
  readFileSync(new URL('./scripts/demo-sessions/holby.json', import.meta.url), 'utf8'),
) as { name: string; state: SessionState }
const holbyTimestamp = Date.parse('2026-07-10T00:00:00.000Z')
const mockSessions = new Map<string, MockSession>([
  ['8444f694-0a9a-41f3-815d-b9c6eb518c50', {
    id: '8444f694-0a9a-41f3-815d-b9c6eb518c50',
    name: holbyArtifact.name,
    state: structuredClone(holbyArtifact.state),
    createdAt: holbyTimestamp,
    updatedAt: holbyTimestamp,
    lastAccessedAt: holbyTimestamp,
    remixedFrom: null,
    remixedFromName: null,
    remixCount: 0,
    immutable: true,
  }],
]);

/**
 * Mock API plugin - only used when USE_MOCK_API=1
 * WARNING: Does not support WebSockets! Use real backend for multiplayer testing.
 */
function createMockApiPlugin(): Plugin {
  return {
    name: 'mock-api',
    async configureServer(server) {
      // Load the Worker's validators through Vite so this Node-only config
      // reuses production behavior without pulling the Worker tree into
      // tsconfig.node's compilation boundary.
      const productionValidation = await server.ssrLoadModule('/src/worker/validation.ts')
      const isValidUUID = productionValidation.isValidUUID as (id: string) => boolean
      const validateSessionName = productionValidation.validateSessionName as (
        name: unknown,
      ) => { valid: boolean; errors: string[] }
      const validateSessionState = productionValidation.validateSessionState as (
        state: unknown,
      ) => { valid: boolean; errors: string[] }
      const validateCompleteSessionState = productionValidation.validateCompleteSessionState as (
        state: unknown,
      ) => { valid: boolean; errors: string[] }

      // The Durable Object repairs invariants on every load and every REST
      // write, so a session read back from the real Worker is always
      // normalized (steps padded to MAX_STEPS, duplicate track ids dropped).
      // Reuse the production repair here or this backend answers reads with
      // state the Worker would never return.
      const productionInvariants = await server.ssrLoadModule('/src/worker/invariants.ts')
      const repairStateInvariants = productionInvariants.repairStateInvariants as (
        state: SessionState,
      ) => { repairedState: SessionState; repairs: string[] }
      const validateStateInvariants = productionInvariants.validateStateInvariants as (
        state: SessionState,
      ) => { valid: boolean }

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

      // Mirrors LiveSessionDurableObject.validateAndRepairState.
      const repaired = (state: SessionState): SessionState =>
        validateStateInvariants(state).valid
          ? state
          : repairStateInvariants(state).repairedState

      const cloneState = (state: SessionState): SessionState =>
        repaired(structuredClone(state))

      // Mirrors LiveSessionDurableObject.mergeStateReplacement: REST clients
      // replace state without the WebSocket-only collaborative fields.
      const mergeStateReplacement = (
        replacement: SessionState,
        previous: SessionState | undefined,
      ): SessionState => previous
        ? {
            ...replacement,
            effects: replacement.effects ?? previous.effects,
            scale: replacement.scale ?? previous.scale,
            loopRegion: replacement.loopRegion !== undefined
              ? replacement.loopRegion
              : previous.loopRegion,
          }
        : replacement

      const pathname = (url: string | undefined): string =>
        new URL(url ?? '/', 'http://localhost').pathname

      const validationError = (
        res: Parameters<typeof sendJson>[0],
        errors: string[],
      ) => sendJson(res, 400, {
        error: 'Validation failed',
        details: errors,
      })

      // Create session. Keep the response shape/status identical to the Worker.
      server.middlewares.use((req, res, next) => {
        const path = pathname(req.url)
        if (path === '/api/sessions' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            if (Buffer.byteLength(body) > MAX_MESSAGE_SIZE) {
              sendJson(res, 413, { error: 'Request body too large' })
              return
            }
            try {
              // The Worker only reads the body when the caller declares JSON;
              // anything else creates a default session rather than failing.
              const declaresJson = (req.headers['content-type'] ?? '')
                .includes('application/json')
              const data = declaresJson
                ? JSON.parse(body || '{}') as Record<string, unknown>
                : {} as Record<string, unknown>
              const nestedState = data.state
              const directState: Partial<SessionState> | undefined = data.tracks !== undefined ||
                data.tempo !== undefined ||
                data.swing !== undefined ||
                data.effects !== undefined ||
                data.scale !== undefined ||
                data.loopRegion !== undefined
                ? {
                    tracks: data.tracks as SessionState['tracks'],
                    tempo: data.tempo as number,
                    swing: data.swing as number,
                    effects: data.effects as SessionState['effects'],
                    scale: data.scale as SessionState['scale'],
                    loopRegion: data.loopRegion as SessionState['loopRegion'],
                    version: (data.version as number) ?? 1,
                  }
                : undefined
              const supplied = nestedState && typeof nestedState === 'object'
                ? nestedState as Partial<SessionState>
                : directState

              if (data.name !== undefined) {
                const nameValidation = validateSessionName(data.name)
                if (!nameValidation.valid) {
                  validationError(res, nameValidation.errors)
                  return
                }
              }
              if (supplied) {
                const stateValidation = validateSessionState(supplied)
                if (!stateValidation.valid) {
                  validationError(res, stateValidation.errors)
                  return
                }
              }

              // Mirrors createSession: undefined entries are dropped so a
              // partial create cannot overwrite a default with undefined.
              const defined: Partial<SessionState> = {}
              for (const [key, value] of Object.entries(supplied ?? {})) {
                if (value !== undefined) {
                  (defined as Record<string, unknown>)[key] = value
                }
              }
              // Share the Worker's default construction, then mirror the DO's
              // invariant repair before exposing the session to a browser.
              const state = cloneState(createInitialSessionState(defined))
              const id = randomUUID()
              const now = Date.now()
              mockSessions.set(id, {
                id,
                state,
                name: data.name === undefined ? null : data.name as string | null,
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
        const publishMatch = pathname(req.url).match(
          /^\/api\/sessions\/([a-f0-9-]{36})\/publish$/,
        );
        if (!publishMatch) return next();

        if (req.method === 'POST') {
          const sourceId = publishMatch[1];
          if (!isValidUUID(sourceId)) {
            sendJson(res, 400, { error: 'Invalid session ID format' })
            return
          }
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
        const remixMatch = pathname(req.url).match(
          /^\/api\/sessions\/([a-f0-9-]{36})\/remix$/,
        );
        if (!remixMatch) return next();

        if (req.method === 'POST') {
          const sourceId = remixMatch[1];
          if (!isValidUUID(sourceId)) {
            sendJson(res, 400, { error: 'Invalid session ID format' })
            return
          }
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
        const match = pathname(req.url).match(
          /^\/api\/sessions\/([a-f0-9-]{36})$/,
        );
        if (!match) return next();

        const id = match[1];
        if (!isValidUUID(id)) {
          sendJson(res, 400, { error: 'Invalid session ID format' })
          return
        }

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
            if (Buffer.byteLength(body) > MAX_MESSAGE_SIZE) {
              sendJson(res, 413, { error: 'Request body too large' })
              return
            }
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
                name?: unknown
                state?: unknown
              }
              const now = Date.now()

              if (req.method === 'PUT') {
                const stateValidation = validateCompleteSessionState(updates.state)
                if (!stateValidation.valid) {
                  validationError(res, stateValidation.errors)
                  return
                }
                const replacement = cloneState(mergeStateReplacement(
                  updates.state as SessionState,
                  session.state,
                ))
                const trackCount = replacement.tracks.length
                session.state = replacement
                session.updatedAt = now
                sendJson(res, 200, {
                  id,
                  updatedAt: now,
                  trackCount,
                })
                return
              }

              const hasName = 'name' in updates
              const hasState = 'state' in updates && updates.state !== undefined
              if (!hasName && !hasState) {
                sendJson(res, 400, { error: 'Missing name or state field' })
                return
              }

              if (hasName) {
                const nameValidation = validateSessionName(updates.name)
                if (!nameValidation.valid) {
                  validationError(res, nameValidation.errors)
                  return
                }
              }
              if (hasState) {
                const stateValidation = validateCompleteSessionState(updates.state)
                if (!stateValidation.valid) {
                  validationError(res, stateValidation.errors)
                  return
                }
              }

              const replacement = hasState
                ? cloneState(mergeStateReplacement(
                    updates.state as SessionState,
                    session.state,
                  ))
                : undefined
              if (hasName) {
                session.name = sanitizeSessionName(updates.name as string | null)
              }
              if (replacement) {
                session.state = replacement
              }
              session.updatedAt = now
              sendJson(res, 200, {
                id,
                // Match the DO response: state-only PATCH reports no renamed value.
                name: hasName ? session.name : null,
                updatedAt: now,
              })
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

      // Health check, matching the Worker's /api/health response exactly.
      // The full-stack runner polls this endpoint to detect readiness.
      server.middlewares.use((req, res, next) => {
        if (pathname(req.url) === '/api/health' && req.method === 'GET') {
          sendJson(res, 200, { status: 'ok' })
          return
        }
        next()
      })

      // Do not let any unknown API route fall through to Vite's SPA HTML.
      // The Worker answers unknown /api/ paths with a JSON 404; returning an
      // HTML 200 here would let a broken request look successful.
      server.middlewares.use((req, res, next) => {
        if (pathname(req.url).startsWith('/api/')) {
          sendJson(res, 404, { error: 'Not found' })
          return
        }
        next()
      })
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
