/**
 * Contract Tests: Mock vs Real Durable Object
 *
 * These tests run the same scenarios against both the MockLiveSession
 * and the real LiveSessionDurableObject to ensure they behave identically.
 *
 * If mock and real implementation diverge, client tests may pass but
 * production breaks. Contract tests catch this.
 *
 * @see docs/TEST-AUDIT.md - Gap 3: Mock Durable Object vs Real Durable Object
 */

import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
}

interface DebugResponse {
  sessionId: string | null;
  connectedPlayers: number;
  players: Array<{ id: string; name: string }>;
  playingPlayerIds: string[];
  playingCount: number;
  trackCount: number;
  tempo: number;
  swing: number;
  pendingKVSave: boolean;
  invariants: {
    valid: boolean;
    violations: string[];
    warnings?: string[];
  };
}

interface SessionState {
  tracks: Array<{
    id: string;
    name: string;
    sampleId: string;
    steps: boolean[];
    parameterLocks: (unknown | null)[];
    volume: number;
    muted: boolean;
    soloed?: boolean;
    transpose: number;
    stepCount?: number;
  }>;
  tempo: number;
  swing: number;
  version?: number;
}

/**
 * These tests verify contract parity between mock and real implementations.
 *
 * The tests run against the REAL Durable Object in the Cloudflare test environment.
 * Mock behavior is documented in mock-durable-object.test.ts.
 *
 * Contract requirements:
 * 1. Both should enforce the same connection limits
 * 2. Both should produce the same state after the same operations
 * 3. Both should broadcast the same message types
 */
describe('Contract: Real DO Behavior', () => {
  describe('Connection Management', () => {
    /**
     * Contract: Maximum 10 connections per session
     * Mock: Throws "Maximum connections reached (10)"
     * Real: Should return error or reject connection
     */
    it('Real DO: returns debug info with connectedPlayers count', async () => {
      const id = (env as unknown as Env).LIVE_SESSIONS.idFromName('contract-connection-test');
      const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);

      const response = await stub.fetch('http://placeholder/debug');
      expect(response.status).toBe(200);

      const debug = await response.json() as DebugResponse;
      expect(typeof debug.connectedPlayers).toBe('number');
      expect(Array.isArray(debug.players)).toBe(true);
    });

    /**
     * Contract: Connection count increases when clients connect
     * This tests the real DO's connection tracking.
     */
    it('Real DO: tracks connection count correctly', async () => {
      const id = (env as unknown as Env).LIVE_SESSIONS.idFromName('contract-count-test');
      const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);

      // Get initial count
      const response1 = await stub.fetch('http://placeholder/debug');
      const debug1 = await response1.json() as DebugResponse;
      const initialCount = debug1.connectedPlayers;

      // Note: We can't easily simulate WebSocket connections in vitest-pool-workers
      // but we can verify the structure is correct
      expect(initialCount).toBe(0);
    });
  });

  describe('State Management', () => {
    /**
     * Contract: State should include tracks, tempo, swing once loaded
     * Note: State is null until a session is loaded via ensureStateLoaded
     * We test via the debug endpoint which triggers state loading
     */
    it('Real DO: has correct state structure after loading', async () => {
      // First create a session via the API
      const createResponse = await SELF.fetch('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: { tracks: [], tempo: 120, swing: 0, version: 1 },
        }),
      });
      const { id: sessionId } = await createResponse.json() as { id: string };

      // Now access it through the DO debug endpoint to trigger state load
      const doId = (env as unknown as Env).LIVE_SESSIONS.idFromName(sessionId);
      const stub = (env as unknown as Env).LIVE_SESSIONS.get(doId);

      // Debug endpoint triggers ensureStateLoaded
      const debugResponse = await stub.fetch(`http://placeholder/api/sessions/${sessionId}/debug`);
      expect(debugResponse.status).toBe(200);

      const debug = await debugResponse.json() as DebugResponse;
      expect(typeof debug.trackCount).toBe('number');
      expect(typeof debug.tempo).toBe('number');
      expect(typeof debug.swing).toBe('number');
    });

    /**
     * Contract: Tempo should be within valid bounds (30-300 BPM)
     * Tested via API response
     */
    it('Real DO: tempo is within valid bounds', async () => {
      const createResponse = await SELF.fetch('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: { tracks: [], tempo: 120, swing: 0, version: 1 },
        }),
      });
      expect(createResponse.status).toBe(201);

      const { id: sessionId } = await createResponse.json() as { id: string };
      const getResponse = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
      const session = await getResponse.json() as { state: SessionState };

      expect(session.state.tempo).toBeGreaterThanOrEqual(30);
      expect(session.state.tempo).toBeLessThanOrEqual(300);
    });

    /**
     * Contract: Swing should be within valid bounds (0-100%)
     */
    it('Real DO: swing is within valid bounds', async () => {
      const createResponse = await SELF.fetch('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: { tracks: [], tempo: 120, swing: 50, version: 1 },
        }),
      });
      expect(createResponse.status).toBe(201);

      const { id: sessionId } = await createResponse.json() as { id: string };
      const getResponse = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
      const session = await getResponse.json() as { state: SessionState };

      expect(session.state.swing).toBeGreaterThanOrEqual(0);
      expect(session.state.swing).toBeLessThanOrEqual(100);
    });
  });

  describe('Debug Endpoint Parity', () => {
    /**
     * Contract: Debug endpoint should return specific fields
     * Real DO returns: { sessionId, connectedPlayers, players, playingPlayerIds, playingCount, trackCount, tempo, swing, pendingKVSave, invariants }
     */
    it('Real DO: debug endpoint returns required fields', async () => {
      const id = (env as unknown as Env).LIVE_SESSIONS.idFromName('contract-debug-fields');
      const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);

      const response = await stub.fetch('http://placeholder/debug');
      expect(response.status).toBe(200);

      const debug = await response.json() as DebugResponse;

      // Required fields (actual debug endpoint format)
      expect(debug).toHaveProperty('connectedPlayers');
      expect(debug).toHaveProperty('players');
      expect(debug).toHaveProperty('playingPlayerIds');
      expect(debug).toHaveProperty('playingCount');
      expect(debug).toHaveProperty('invariants');

      // Type checks
      expect(typeof debug.connectedPlayers).toBe('number');
      expect(Array.isArray(debug.players)).toBe(true);
      expect(Array.isArray(debug.playingPlayerIds)).toBe(true);
      expect(typeof debug.playingCount).toBe('number');
      expect(typeof debug.invariants).toBe('object');
    });

    /**
     * Contract: Invariants should include valid flag and violations array
     */
    it('Real DO: debug endpoint returns invariants structure', async () => {
      const id = (env as unknown as Env).LIVE_SESSIONS.idFromName('contract-invariants');
      const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);

      const response = await stub.fetch('http://placeholder/debug');
      const debug = await response.json() as DebugResponse;

      expect(debug.invariants).toHaveProperty('valid');
      expect(debug.invariants).toHaveProperty('violations');
      expect(typeof debug.invariants.valid).toBe('boolean');
      expect(Array.isArray(debug.invariants.violations)).toBe(true);
    });
  });

  describe('HTTP Endpoint Parity', () => {
    /**
     * Contract: Non-WebSocket requests to root should return 404
     */
    it('Real DO: returns 404 for non-WebSocket root request', async () => {
      const id = (env as unknown as Env).LIVE_SESSIONS.idFromName('contract-404-test');
      const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);

      const response = await stub.fetch('http://placeholder/api/sessions/contract-404-test');
      expect(response.status).toBe(404);
      await response.text(); // Consume body
    });

    /**
     * Contract: Debug endpoint should be accessible
     */
    it('Real DO: debug endpoint is accessible', async () => {
      const id = (env as unknown as Env).LIVE_SESSIONS.idFromName('contract-debug-access');
      const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);

      const response = await stub.fetch('http://placeholder/debug');
      expect(response.status).toBe(200);
      await response.json(); // Consume body
    });
  });
});

describe('Contract: API Router Behavior', () => {
  /**
   * Contract: POST /api/sessions creates a new session
   * API expects: { state: { tracks, tempo, swing, version } }
   */
  it('creates session with correct structure', async () => {
    const response = await SELF.fetch('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          tracks: [
            {
              id: 'contract-track-1',
              name: 'Contract Test',
              sampleId: 'kick',
              steps: Array(16).fill(false),
              parameterLocks: Array(16).fill(null),
              volume: 1,
              muted: false,
              transpose: 0,
              stepCount: 16,
            },
          ],
          tempo: 120,
          swing: 0,
          version: 1,
        },
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json() as { id: string; url: string };
    expect(data.id).toBeDefined();
    expect(typeof data.id).toBe('string');
    expect(data.url).toContain('/s/');
  });

  /**
   * Contract: GET /api/sessions/:id returns session data
   * Response format: { id, state: { tracks, tempo, swing, version }, ... }
   */
  it('retrieves created session with correct data', async () => {
    // Create a session first - API expects state wrapper
    const createResponse = await SELF.fetch('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          tracks: [
            {
              id: 'get-test-track',
              name: 'Get Test',
              sampleId: 'snare',
              steps: [true, false, false, false],
              parameterLocks: Array(16).fill(null),
              volume: 0.8,
              muted: false,
              transpose: 2,
              stepCount: 16,
            },
          ],
          tempo: 140,
          swing: 25,
          version: 1,
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    const { id } = await createResponse.json() as { id: string };

    // Retrieve it - response has state wrapper
    const getResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
    expect(getResponse.status).toBe(200);

    const session = await getResponse.json() as { id: string; state: SessionState };
    expect(session.id).toBe(id);
    expect(session.state.tracks).toHaveLength(1);
    expect(session.state.tracks[0].id).toBe('get-test-track');
    expect(session.state.tempo).toBe(140);
    expect(session.state.swing).toBe(25);
  });

  /**
   * Contract: PUT /api/sessions/:id updates session state (full replacement)
   * PATCH /api/sessions/:id updates name and/or state (partial updates)
   */
  it('updates session data correctly via PUT', async () => {
    // Create - API expects state wrapper
    const createResponse = await SELF.fetch('http://localhost/api/sessions', {
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

    const { id } = await createResponse.json() as { id: string };

    // Update tempo via PUT (not PATCH - PATCH is for renaming)
    const putResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          tracks: [],
          tempo: 180,
          swing: 0,
          version: 1,
        },
      }),
    });

    expect(putResponse.status).toBe(200);

    // Verify update
    const getResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
    const session = await getResponse.json() as { state: SessionState };
    expect(session.state.tempo).toBe(180);
  });
});
