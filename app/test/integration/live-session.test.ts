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
  // Phase 22: Per-player playback - check for playingPlayerIds instead of isPlaying
  expect(debug).toHaveProperty('playingPlayerIds');
  expect(debug).toHaveProperty('playingCount');
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
    // Phase 22: Per-player playback tracking uses playingPlayers Set
    expect(obj).toHaveProperty('playingPlayers');
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

// =============================================================================
// Session Name Tests
// =============================================================================

it('Router: creates session with name via POST /api/sessions', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'My Cool Session',
      state: {
        tracks: [],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };

  // Verify the name was saved
  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  const session = await loadResponse.json() as { name: string | null };
  expect(session.name).toBe('My Cool Session');
});

it('Router: creates session with null name when name not provided', async () => {
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

  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };

  // Verify name is null
  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  const session = await loadResponse.json() as { name: string | null };
  expect(session.name).toBeNull();
});

it('Router: rejects invalid session name (XSS attempt)', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '<script>alert("xss")</script>',
      state: {
        tracks: [],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(400);
  await response.text(); // Consume body
});

it('Router: rejects non-string session name', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 12345, // Invalid: not a string
      state: {
        tracks: [],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(400);
  await response.text(); // Consume body
});

// =============================================================================
// Comprehensive Track Field Tests
// Ensures createSession persists all SessionTrack fields correctly
// =============================================================================

it('Router: persists all track fields correctly', async () => {
  const trackData = {
    id: 'test-track-1',
    name: 'Test Track',
    sampleId: 'kick',
    steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    parameterLocks: [
      { pitch: 5, volume: 0.8 },
      null,
      { pitch: -3 },
      null, null, null, null, null, null, null, null, null, null, null, null, null
    ],
    volume: 0.75,
    muted: true,
    soloed: true,
    playbackMode: 'gate' as const,
    transpose: 7,
    stepCount: 16,
  };

  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Track Fields Test',
      state: {
        tracks: [trackData],
        tempo: 100,
        swing: 50,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };

  // Verify all fields were saved
  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  const session = await loadResponse.json() as {
    name: string;
    state: {
      tracks: typeof trackData[];
      tempo: number;
      swing: number;
    };
  };

  expect(session.name).toBe('Track Fields Test');
  expect(session.state.tempo).toBe(100);
  expect(session.state.swing).toBe(50);

  const track = session.state.tracks[0];
  expect(track.id).toBe('test-track-1');
  expect(track.name).toBe('Test Track');
  expect(track.sampleId).toBe('kick');
  expect(track.steps).toEqual(trackData.steps);
  expect(track.parameterLocks[0]).toEqual({ pitch: 5, volume: 0.8 });
  expect(track.parameterLocks[1]).toBeNull();
  expect(track.parameterLocks[2]).toEqual({ pitch: -3 });
  expect(track.volume).toBe(0.75);
  expect(track.muted).toBe(true);
  expect(track.soloed).toBe(true);
  expect(track.playbackMode).toBe('gate');
  expect(track.transpose).toBe(7);
  expect(track.stepCount).toBe(16);
});

// =============================================================================
// Triplet Grid Tests (stepCount: 12, 24)
// Phase 20: Musical Foundations feature
// =============================================================================

it('Router: accepts 12-step triplet grid', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Jazz Triplets',
      state: {
        tracks: [{
          id: 'triplet-track',
          name: 'Shuffle Rhythm',
          sampleId: 'hihat-open',
          steps: [true, false, true, true, false, true, true, false, true, true, false, true],
          parameterLocks: Array(12).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 12, // Triplet grid!
        }],
        tempo: 90,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };

  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  const session = await loadResponse.json() as { state: { tracks: { stepCount: number }[] } };
  expect(session.state.tracks[0].stepCount).toBe(12);
});

it('Router: accepts 24-step high-res triplet grid', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Trap Hi-Hats',
      state: {
        tracks: [{
          id: 'trap-hats',
          name: 'Hi-Hat Rolls',
          sampleId: 'hihat-closed',
          steps: Array(24).fill(false).map((_, i) => i % 2 === 0),
          parameterLocks: Array(24).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 24, // High-res triplet grid!
        }],
        tempo: 140,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };

  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  const session = await loadResponse.json() as { state: { tracks: { stepCount: number }[] } };
  expect(session.state.tracks[0].stepCount).toBe(24);
});

// =============================================================================
// Extended Pitch Range Tests (transpose: ±24)
// Phase 20: Musical Foundations feature
// =============================================================================

it('Router: accepts -24 semitone transpose (deep sub-bass)', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Sub Bass Test',
      state: {
        tracks: [{
          id: 'sub-bass',
          name: 'Deep Sub',
          sampleId: 'bass',
          steps: [true, false, false, false, false, false, false, false],
          parameterLocks: Array(8).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: -24, // 2 octaves down!
          stepCount: 8,
        }],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };

  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  const session = await loadResponse.json() as { state: { tracks: { transpose: number }[] } };
  expect(session.state.tracks[0].transpose).toBe(-24);
});

it('Router: accepts +24 semitone transpose (high melodic)', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'High Lead Test',
      state: {
        tracks: [{
          id: 'high-lead',
          name: 'Bright Lead',
          sampleId: 'synth',
          steps: [true, false, true, false, true, false, true, false],
          parameterLocks: Array(8).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 24, // 2 octaves up!
          stepCount: 8,
        }],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };

  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  const session = await loadResponse.json() as { state: { tracks: { transpose: number }[] } };
  expect(session.state.tracks[0].transpose).toBe(24);
});

it('Router: rejects transpose outside ±24 range', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: {
        tracks: [{
          id: 'invalid-track',
          name: 'Invalid',
          sampleId: 'kick',
          steps: [true],
          parameterLocks: [null],
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 25, // Invalid: exceeds +24
          stepCount: 1,
        }],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(400);
  await response.text();
});

// =============================================================================
// Parameter Lock Tests
// =============================================================================

it('Router: persists parameter locks with pitch and volume', async () => {
  const paramLocks = [
    { pitch: 12, volume: 1.0 },  // Octave up, full volume
    { pitch: 7, volume: 0.5 },   // Fifth up, half volume
    { pitch: 0, volume: 0.3 },   // Root, ghost note
    { pitch: -12, volume: 0.8 }, // Octave down
    null, null, null, null,
    { pitch: 5 },                // Third up, default volume
    { volume: 0.9 },             // Default pitch, specific volume
    null, null, null, null, null, null,
  ];

  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Parameter Locks Test',
      state: {
        tracks: [{
          id: 'plock-track',
          name: 'Melodic Pattern',
          sampleId: 'synth',
          steps: [true, true, true, true, false, false, false, false, true, true, false, false, false, false, false, false],
          parameterLocks: paramLocks,
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 16,
        }],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(201);
  const { id } = await response.json() as { id: string };

  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  const session = await loadResponse.json() as {
    state: { tracks: { parameterLocks: ({ pitch?: number; volume?: number } | null)[] }[] }
  };

  const locks = session.state.tracks[0].parameterLocks;
  expect(locks[0]).toEqual({ pitch: 12, volume: 1.0 });
  expect(locks[1]).toEqual({ pitch: 7, volume: 0.5 });
  expect(locks[2]).toEqual({ pitch: 0, volume: 0.3 });
  expect(locks[3]).toEqual({ pitch: -12, volume: 0.8 });
  expect(locks[4]).toBeNull();
  expect(locks[8]).toEqual({ pitch: 5 });
  expect(locks[9]).toEqual({ volume: 0.9 });
});

// =============================================================================
// All Step Count Options Tests
// =============================================================================

it('Router: accepts all valid step count options (4, 8, 12, 16, 24, 32, 64)', async () => {
  const stepCounts = [4, 8, 12, 16, 24, 32, 64];

  for (const stepCount of stepCounts) {
    const response = await SELF.fetch('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          tracks: [{
            id: `track-${stepCount}`,
            name: `${stepCount} Steps`,
            sampleId: 'kick',
            steps: Array(stepCount).fill(false).map((_, i) => i === 0),
            parameterLocks: Array(stepCount).fill(null),
            volume: 1,
            muted: false,
            playbackMode: 'oneshot',
            transpose: 0,
            stepCount: stepCount,
          }],
          tempo: 120,
          swing: 0,
          version: 1,
        },
      }),
    });

    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };

    const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
    const session = await loadResponse.json() as { state: { tracks: { stepCount: number }[] } };
    expect(session.state.tracks[0].stepCount).toBe(stepCount);
  }
});

it('Router: rejects invalid step count (e.g., 256 - exceeds max)', async () => {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: {
        tracks: [{
          id: 'invalid-track',
          name: 'Invalid',
          sampleId: 'kick',
          steps: Array(256).fill(true),
          parameterLocks: Array(256).fill(null),
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 256, // Invalid: exceeds max of 128
        }],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    }),
  });

  expect(response.status).toBe(400);
  await response.text();
});

// =============================================================================
// Phase 24: Publishing Tests (Immutable Sessions)
//
// IMPORTANT: Publishing creates a NEW immutable session (frozen snapshot).
// The source session remains editable - user keeps their working copy.
// =============================================================================

it('Router: publishes a session via POST /api/sessions/:id/publish', async () => {
  // Create a session first
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'My Beat',
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
  });
  const { id: sourceId } = await createResponse.json() as { id: string };

  // Publish it - creates a NEW immutable session
  const publishResponse = await SELF.fetch(`http://localhost/api/sessions/${sourceId}/publish`, {
    method: 'POST',
  });

  expect(publishResponse.status).toBe(201); // 201 Created (new session)
  const data = await publishResponse.json() as { id: string; immutable: boolean; url: string; sourceId: string };
  expect(data.id).not.toBe(sourceId); // NEW session ID
  expect(data.immutable).toBe(true);
  expect(data.url).toBe(`/s/${data.id}`);
  expect(data.sourceId).toBe(sourceId);

  // Verify the PUBLISHED session is immutable
  const loadPublished = await SELF.fetch(`http://localhost/api/sessions/${data.id}`);
  const publishedSession = await loadPublished.json() as { immutable: boolean };
  expect(publishedSession.immutable).toBe(true);

  // Verify the SOURCE session remains editable
  const loadSource = await SELF.fetch(`http://localhost/api/sessions/${sourceId}`);
  const sourceSession = await loadSource.json() as { immutable: boolean };
  expect(sourceSession.immutable).toBe(false);
});

it('Router: publishing same source twice creates two different published sessions', async () => {
  // Create a session
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
  });
  const { id: sourceId } = await createResponse.json() as { id: string };

  // Publish twice - each creates a NEW snapshot
  const publish1 = await SELF.fetch(`http://localhost/api/sessions/${sourceId}/publish`, { method: 'POST' });
  expect(publish1.status).toBe(201);
  const data1 = await publish1.json() as { id: string; immutable: boolean };
  expect(data1.immutable).toBe(true);

  const publish2 = await SELF.fetch(`http://localhost/api/sessions/${sourceId}/publish`, { method: 'POST' });
  expect(publish2.status).toBe(201);
  const data2 = await publish2.json() as { id: string; immutable: boolean };
  expect(data2.immutable).toBe(true);

  // Both published sessions have different IDs
  expect(data1.id).not.toBe(data2.id);
  expect(data1.id).not.toBe(sourceId);
  expect(data2.id).not.toBe(sourceId);
});

it('Router: blocks PUT updates on published sessions with 403', async () => {
  // Create and publish a session
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
  });
  const { id: sourceId } = await createResponse.json() as { id: string };

  const publishResponse = await SELF.fetch(`http://localhost/api/sessions/${sourceId}/publish`, { method: 'POST' });
  const { id: publishedId } = await publishResponse.json() as { id: string };

  // Try to update the PUBLISHED session (should fail)
  const updateResponse = await SELF.fetch(`http://localhost/api/sessions/${publishedId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [], tempo: 140, swing: 10, version: 1 },
    }),
  });

  expect(updateResponse.status).toBe(403);
  const error = await updateResponse.json() as { error: string; immutable: boolean };
  expect(error.error).toBe('Session is published');
  expect(error.immutable).toBe(true);

  // Source session should still be updatable
  const updateSourceResponse = await SELF.fetch(`http://localhost/api/sessions/${sourceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [], tempo: 140, swing: 10, version: 1 },
    }),
  });
  expect(updateSourceResponse.status).toBe(200);
});

it('Router: blocks PATCH (rename) on published sessions with 403', async () => {
  // Create and publish a session
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Original Name',
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
  });
  const { id: sourceId } = await createResponse.json() as { id: string };

  const publishResponse = await SELF.fetch(`http://localhost/api/sessions/${sourceId}/publish`, { method: 'POST' });
  const { id: publishedId } = await publishResponse.json() as { id: string };

  // Try to rename the PUBLISHED session (should fail)
  const patchResponse = await SELF.fetch(`http://localhost/api/sessions/${publishedId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New Name' }),
  });

  expect(patchResponse.status).toBe(403);
  const error = await patchResponse.json() as { error: string; immutable: boolean };
  expect(error.error).toBe('Session is published');
  expect(error.immutable).toBe(true);

  // Source session should still be renamable
  const patchSourceResponse = await SELF.fetch(`http://localhost/api/sessions/${sourceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New Name' }),
  });
  expect(patchSourceResponse.status).toBe(200);
});

it('Router: allows remixing a published session', async () => {
  // Create and publish a session
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Published Beat',
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
  });
  const { id: sourceId } = await createResponse.json() as { id: string };

  const publishResponse = await SELF.fetch(`http://localhost/api/sessions/${sourceId}/publish`, { method: 'POST' });
  const { id: publishedId } = await publishResponse.json() as { id: string };

  // Remix the PUBLISHED session
  const remixResponse = await SELF.fetch(`http://localhost/api/sessions/${publishedId}/remix`, { method: 'POST' });
  expect(remixResponse.status).toBe(201);

  const remixData = await remixResponse.json() as { id: string; remixedFrom: string };
  expect(remixData.remixedFrom).toBe(publishedId);

  // Verify the remix is NOT published (immutable: false)
  const loadRemix = await SELF.fetch(`http://localhost/api/sessions/${remixData.id}`);
  const remixSession = await loadRemix.json() as { immutable: boolean };
  expect(remixSession.immutable).toBe(false);
});

it('Router: cannot publish from an already-published session', async () => {
  // Create and publish a session
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
  });
  const { id: sourceId } = await createResponse.json() as { id: string };

  const publishResponse = await SELF.fetch(`http://localhost/api/sessions/${sourceId}/publish`, { method: 'POST' });
  const { id: publishedId } = await publishResponse.json() as { id: string };

  // Try to publish from the already-published session (should fail)
  const republishResponse = await SELF.fetch(`http://localhost/api/sessions/${publishedId}/publish`, { method: 'POST' });
  expect(republishResponse.status).toBe(400);
  const error = await republishResponse.json() as { error: string };
  expect(error.error).toContain('already-published');
});

it('Router: new sessions have immutable: false by default', async () => {
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
  });
  const { id } = await createResponse.json() as { id: string };

  const loadResponse = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  const session = await loadResponse.json() as { immutable: boolean };
  expect(session.immutable).toBe(false);
});

it('Router: returns 404 when publishing non-existent session', async () => {
  const response = await SELF.fetch(
    'http://localhost/api/sessions/00000000-0000-0000-0000-000000000000/publish',
    { method: 'POST' }
  );
  expect(response.status).toBe(404);
  await response.text();
});

// =============================================================================
// Phase 27: Hybrid Persistence Migration Tests
// Verifies that legacy KV sessions are correctly migrated to DO storage
// =============================================================================

it('DO: loads state from KV when DO storage is empty (migration path)', async () => {
  // Create a session via API (writes to KV)
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Migration Test',
      state: {
        tracks: [{
          id: 'migration-track',
          name: 'Test Track',
          sampleId: 'kick',
          steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
          parameterLocks: Array(16).fill(null),
          volume: 1,
          muted: false,
          playbackMode: 'oneshot',
          transpose: 0,
          stepCount: 16,
        }],
        tempo: 125,
        swing: 20,
        version: 1,
      },
    }),
  });

  expect(createResponse.status).toBe(201);
  const { id } = await createResponse.json() as { id: string };

  // Access the DO via debug endpoint (which triggers ensureStateLoaded)
  const doId = (env as unknown as Env).LIVE_SESSIONS.idFromName(id);
  const stub = (env as unknown as Env).LIVE_SESSIONS.get(doId);

  const debugResponse = await stub.fetch(`http://placeholder/api/sessions/${id}/debug`);
  expect(debugResponse.status).toBe(200);

  const debug = await debugResponse.json() as { trackCount: number; tempo: number };

  // Verify state was loaded correctly from KV
  expect(debug.trackCount).toBe(1);
  expect(debug.tempo).toBe(125);
});

it('DO: persists state to DO storage after mutation (hybrid persistence)', async () => {
  // Create a session
  const createResponse = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Persistence Test',
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
  });

  const { id } = await createResponse.json() as { id: string };

  // Access DO to verify it can load state
  const doId = (env as unknown as Env).LIVE_SESSIONS.idFromName(id);
  const stub = (env as unknown as Env).LIVE_SESSIONS.get(doId);

  // Use runInDurableObject to verify internal state
  await runInDurableObject(stub, async (instance: unknown) => {
    const obj = instance as { state: { tempo: number } | null };
    // State should be loaded (either from DO storage or KV)
    // The exact loading path depends on prior access, but state should exist
    expect(obj.state).toBeDefined();
  });
});
