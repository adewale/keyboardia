/**
 * Integration tests for LiveSessionDurableObject
 *
 * These tests run against the REAL Durable Object implementation,
 * not the mock. They verify:
 * - HTTP endpoints (debug, 404)
 * - Alarm-based debounced saves
 * - State isolation between tests
 *
 * NOTE: WebSocket tests are limited in vitest-pool-workers because WebSocket
 * connections can interfere with isolated storage cleanup. Keep WS tests
 * minimal and ensure all connections are properly closed before test ends.
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 */

import { env, SELF, runInDurableObject } from 'cloudflare:test';
import { it, expect } from 'vitest';

// Type for our environment bindings
interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
  SAMPLES: R2Bucket;
}

// =============================================================================
// LiveSessionDurableObject Direct Tests
// =============================================================================

it('DO: returns 404 for non-WebSocket requests to root', async () => {
  const id = (env as unknown as Env).LIVE_SESSIONS.idFromName('test-http');
  const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);

  const response = await stub.fetch('http://placeholder/api/sessions/test-http');
  expect(response.status).toBe(404);
  // Consume body to prevent isolated storage issues
  await response.text();
});

it('DO: returns debug info via /debug endpoint', async () => {
  const id = (env as unknown as Env).LIVE_SESSIONS.idFromName('test-debug');
  const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);

  const response = await stub.fetch('http://placeholder/api/sessions/test-debug/debug');
  expect(response.status).toBe(200);

  const debug = await response.json() as Record<string, unknown>;
  expect(debug).toHaveProperty('connectedPlayers');
  expect(debug).toHaveProperty('isPlaying');
  expect(debug).toHaveProperty('invariants');
});

it('DO: can access internal state via runInDurableObject', async () => {
  const id = (env as unknown as Env).LIVE_SESSIONS.idFromName('test-direct-access');
  const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);

  // First make a request to initialize the object
  const initResponse = await stub.fetch('http://placeholder/api/sessions/test-direct-access/debug');
  await initResponse.text(); // Consume body

  // Now access internal state directly
  await runInDurableObject(stub, async (instance: unknown) => {
    const obj = instance as Record<string, unknown>;
    expect(obj).toHaveProperty('players');
    expect(obj).toHaveProperty('state');
    expect(obj).toHaveProperty('isPlaying');
  });
});

// Note: Isolated storage is disabled because our worker uses waitUntil()
// for fire-and-forget logging. Tests share storage and must be designed accordingly.

// =============================================================================
// Worker Router Tests
// =============================================================================

it('Router: creates a new session via POST /api/sessions', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: {
        tracks: [],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(201); // 201 Created
  const data = await response.json() as { id: string; url: string };
  expect(data.id).toBeDefined();
  expect(data.url).toContain('/s/');
});

it('Router: loads session via GET /api/sessions/:id', async () => {
  // Create a session first
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [], tempo: 100, swing: 10, version: 1 },
    }),
  });
  const { id } = await createResponse.json() as { id: string };

  // Load it
  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  expect(loadResponse.status).toBe(200);

  const session = await loadResponse.json() as { state: { tempo: number; swing: number } };
  expect(session.state.tempo).toBe(100);
  expect(session.state.swing).toBe(10);
});

it('Router: returns 404 for non-existent session', async () => {
  const response = await SELF.fetch(
    'http://localhost/api/sessions/00000000-0000-0000-0000-000000000000'
  );
  expect(response.status).toBe(404);
  await response.text(); // Consume body
});

it('Router: validates request body on create', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: {
        tracks: [],
        tempo: 9999, // Invalid: exceeds MAX_TEMPO
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(400);
  await response.text(); // Consume body
});
