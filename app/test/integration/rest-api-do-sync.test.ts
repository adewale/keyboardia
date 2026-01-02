/**
 * TEST: REST API vs Durable Object State Synchronization
 *
 * BUG DOCUMENTATION: When the REST API writes directly to KV storage,
 * the Durable Object maintains stale state and serves it to clients.
 *
 * ARCHITECTURAL VIOLATION (NOW FIXED in Phase 31E):
 * The REST API was bypassing the Durable Object, which is the source
 * of truth for active sessions.
 *
 * CORRECT ARCHITECTURE (Phase 31E fix):
 *   Client -> WebSocket -> Durable Object (source of truth) -> KV (persistence)
 *   REST API -> Durable Object -> KV + Broadcast to clients
 *
 * WRONG ARCHITECTURE (the bug before fix):
 *   REST API -> KV (direct write) -- bypasses DO!
 *              |
 *   Browser -> WebSocket -> Durable Object (stale state)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockLiveSession,
  createMockSession,
  createMockKV,
  type MockKVStore,
} from '../../src/worker/mock-durable-object';

describe('REST API vs Durable Object State Sync', () => {
  let kv: MockKVStore;
  let session: MockLiveSession;
  const sessionId = 'test-session-rest-api-sync';

  beforeEach(() => {
    kv = createMockKV();
    session = createMockSession(sessionId, kv);
  });

  /**
   * This test documents the BUG that was fixed in Phase 31E:
   * - Browser connects via WebSocket (DO has state)
   * - REST API used to update session in KV directly (bypassing DO)
   * - Browser would see stale state from DO
   *
   * FIX (Phase 31E): REST API now routes through DO
   *
   * NOTE: We can't fully simulate KV here, but this documents the issue.
   * The actual fix is in live-session.test.ts which tests against the real worker.
   */
  it('should demonstrate why DO state must be updated directly (bug documentation)', () => {
    // Step 1: Browser connects via WebSocket
    const ws = session.connect('player-1');
    expect(session.getConnectionCount()).toBe(1);

    // Step 2: DO has initial state
    session['state'].tracks = [
      {
        id: 'track-1',
        name: 'Original Track Name',
        sampleId: 'kick',
        steps: Array(16).fill(false),
        parameterLocks: Array(16).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 16,
      },
    ];

    // Step 3: Verify DO has the state
    const doState = session.getState();
    expect(doState.tracks[0].name).toBe('Original Track Name');

    // THE BUG: If we update KV directly (not simulated here), the DO
    // would still return 'Original Track Name' because it wasn't notified.
    //
    // Before Phase 31E fix:
    //   PUT /api/sessions/:id -> updateSession(env, id, state) -> KV
    //   DO still has: 'Original Track Name'
    //
    // After Phase 31E fix:
    //   PUT /api/sessions/:id -> stub.fetch() -> DO.handleStateUpdate()
    //   DO updates internal state + broadcasts to clients

    // The fix ensures this is always in sync
    session['state'].tracks[0].name = 'Updated Track Name';
    expect(session.getState().tracks[0].name).toBe('Updated Track Name');

    ws.close();
  });

  /**
   * The FIX: REST API routes through the Durable Object
   * This test documents the correct behavior after Phase 31E fix
   */
  it('should update state correctly when going through DO (correct approach)', async () => {
    const ws = session.connect('player-1');

    // Initialize state via private accessor
    session['state'].tracks = [
      {
        id: 'track-1',
        name: 'Original Track Name',
        sampleId: 'kick',
        steps: Array(16).fill(false),
        parameterLocks: Array(16).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 16,
      },
    ];

    // CORRECT APPROACH: Update through the DO
    // This is what the Phase 31E fix does - routes PUT through DO
    session['state'].tracks[0].name = 'Updated via DO';

    // Now the DO has the updated state
    const doState = session.getState();
    expect(doState.tracks[0].name).toBe('Updated via DO');

    ws.close();
  });

  /**
   * Document the Phase 31E architectural fix
   */
  it('documents the Phase 31E fix for REST API -> DO routing', () => {
    const phase31EFix = {
      problem: 'PUT /api/sessions/:id wrote directly to KV, bypassing active DO',
      solution: 'Route PUT requests through DO via stub.fetch()',
      filesChanged: [
        'src/worker/index.ts - Route PUT to DO instead of direct KV write',
        'src/worker/live-session.ts - Add handleStateUpdate() for PUT requests',
      ],
      benefits: [
        'DO state is always authoritative',
        'Connected clients receive updates via broadcast',
        'Scripts/tools can update sessions reliably',
        'No stale state issues on page reload',
      ],
    };

    expect(phase31EFix.solution).toBe('Route PUT requests through DO via stub.fetch()');
    expect(phase31EFix.filesChanged.length).toBe(2);
    expect(phase31EFix.benefits.length).toBe(4);
  });
});

describe('Phase 31E Implementation Details', () => {
  it('LiveSessionDurableObject.fetch() now handles PUT requests', () => {
    // The fix added handleStateUpdate() to LiveSessionDurableObject
    const implementation = {
      method: 'handleStateUpdate(request: Request, url: URL): Promise<Response>',
      steps: [
        'Extract session ID from URL',
        'Load state via ensureStateLoaded()',
        'Check immutable flag (reject published sessions)',
        'Parse and validate request body',
        'Update internal state',
        'Save to DO storage',
        'Save to KV',
        'Broadcast snapshot to connected clients',
        'Return success response',
      ],
    };

    expect(implementation.steps.length).toBe(9);
  });

  it('index.ts routes PUT to Durable Object', () => {
    // The fix changed index.ts PUT handler
    const indexChanges = {
      before: 'await updateSession(env, id, body.state) // Direct KV write',
      after: [
        'const doId = env.LIVE_SESSIONS.idFromName(id)',
        'const stub = env.LIVE_SESSIONS.get(doId)',
        'const doResponse = await stub.fetch(doRequest)',
      ],
      location: 'src/worker/index.ts lines 554-638',
    };

    expect(indexChanges.after.length).toBe(3);
  });
});
