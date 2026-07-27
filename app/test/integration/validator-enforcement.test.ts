/**
 * Server-side validation, enforced on the real path.
 *
 * `test/unit/validators.test.ts` proves the validators module *works*. This
 * suite proves the server *applies* validation — a different claim, and the one
 * that matters. A correct validator that nothing calls protects nothing, which
 * is the failure mode `test/unit/sync-layer-coverage.test.ts` was written after:
 *
 *   "Phase 31B pattern operations were listed in SYNCED_ACTIONS but never wired
 *    up. The test skipped them with 'pending implementation' comment, so the
 *    bug shipped."
 *
 * So these tests never import a validator. They open a real WebSocket to a real
 * Durable Object, send hostile input, and assert on what the server broadcasts
 * and stores. If validation is removed or bypassed, this fails regardless of
 * which module was supposed to do it.
 */
import { afterEach, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface Env {
  LIVE_SESSIONS: DurableObjectNamespace;
}

interface ServerMessage {
  type: string;
  clientSeq?: number;
  tempo?: number;
  swing?: number;
  playerId?: string;
  state?: {
    tracks: Array<{ id: string; steps: boolean[]; volume: number; transpose: number }>;
    tempo: number;
    swing: number;
  };
}

const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    try {
      socket.close(1000, 'test complete');
    } catch {
      // Already closed.
    }
  }
});

function track(id: string) {
  return {
    id,
    name: 'Track',
    sampleId: 'sampled:808-kick',
    steps: Array(128).fill(false),
    parameterLocks: Array(128).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
  };
}

async function createSession(): Promise<string> {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [track('t1')], tempo: 120, swing: 0, version: 1 },
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

function listen(socket: WebSocket) {
  const buffered: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  socket.addEventListener('message', (event: MessageEvent) => {
    const raw = typeof event.data === 'string'
      ? event.data
      : new TextDecoder().decode(event.data as ArrayBuffer);
    const message = JSON.parse(raw) as ServerMessage;
    const index = waiters.findIndex(({ predicate }) => predicate(message));
    if (index === -1) {
      buffered.push(message);
      return;
    }
    const [waiter] = waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  });

  return {
    waitFor(predicate: (m: ServerMessage) => boolean, label: string, timeoutMs = 4000) {
      const i = buffered.findIndex(predicate);
      if (i !== -1) return Promise.resolve(buffered.splice(i, 1)[0]);
      return new Promise<ServerMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          const wi = waiters.findIndex((w) => w.timer === timer);
          if (wi !== -1) waiters.splice(wi, 1);
          reject(new Error(`Timed out waiting for ${label}`));
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timer });
      });
    },
    seen: () => [...buffered],
  };
}

async function connect(sessionId: string, playerId = 'validator-probe') {
  const response = await SELF.fetch(
    `http://localhost/api/sessions/${sessionId}/ws?playerId=${playerId}`,
    { headers: { Upgrade: 'websocket' } },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  sockets.push(socket);
  socket.accept();
  const inbox = listen(socket);
  const snapshot = await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');
  return { socket, inbox, snapshot };
}

interface DebugState {
  tempo: number;
  swing: number;
  trackCount: number;
  invariants: { valid: boolean; violations: string[]; warnings: string[] };
}

/**
 * Read authoritative state back from the DO rather than trusting a broadcast:
 * a broadcast can carry a clamped value while storage keeps the raw one.
 *
 * The /debug payload reports tempo/swing at the top level (live-session.ts:2578)
 * and also runs validateStateInvariants, which gives a second, independent
 * oracle: hostile input must not leave the session in a state the server itself
 * considers invalid.
 */
async function serverState(sessionId: string): Promise<DebugState> {
  const id = (env as unknown as Env).LIVE_SESSIONS.idFromName(sessionId);
  const stub = (env as unknown as Env).LIVE_SESSIONS.get(id);
  const res = await stub.fetch(`http://placeholder/api/sessions/${sessionId}/debug`);
  return (await res.json()) as DebugState;
}

// ---------------------------------------------------------------------------
// Range clamping
// ---------------------------------------------------------------------------

it('clamps an over-max tempo instead of storing it', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({ type: 'set_tempo', tempo: 999, seq: 1 }));
  const broadcast = await client.inbox.waitFor(
    (m) => m.type === 'tempo_changed',
    'tempo_changed',
  );

  expect(broadcast.tempo).toBe(180);
  expect((await serverState(sessionId)).tempo).toBe(180);
});

it('clamps an under-min tempo instead of storing it', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({ type: 'set_tempo', tempo: 1, seq: 1 }));
  const broadcast = await client.inbox.waitFor(
    (m) => m.type === 'tempo_changed',
    'tempo_changed',
  );

  expect(broadcast.tempo).toBe(60);
  expect((await serverState(sessionId)).tempo).toBe(60);
});

it('clamps swing to its range', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({ type: 'set_swing', swing: 500, seq: 1 }));
  const broadcast = await client.inbox.waitFor(
    (m) => m.type === 'swing_changed',
    'swing_changed',
  );

  expect(broadcast.swing).toBe(100);
  expect((await serverState(sessionId)).swing).toBe(100);
});

// ---------------------------------------------------------------------------
// Type hostility
//
// Clamping is `Math.max(min, Math.min(max, value))`. That is range control, not
// type control: a non-numeric input propagates through it as NaN. Session state
// must never reach a state where tempo is not a finite number — it would be
// broadcast to every collaborator and persisted.
// ---------------------------------------------------------------------------

it('does not let a non-numeric tempo corrupt session state', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({ type: 'set_tempo', tempo: 'fast', seq: 1 }));

  // Whatever the server chooses to do — reject, ignore, or coerce — the stored
  // tempo must remain a usable number. Settle the exchange first by sending a
  // valid message and waiting for its effect, so this is not a race.
  client.socket.send(JSON.stringify({ type: 'set_swing', swing: 25, seq: 2 }));
  await client.inbox.waitFor((m) => m.type === 'swing_changed', 'swing_changed');

  const state = await serverState(sessionId);
  expect(Number.isFinite(state.tempo), `tempo became ${state.tempo}`).toBe(true);
  expect(state.tempo).toBeGreaterThanOrEqual(60);
  expect(state.tempo).toBeLessThanOrEqual(180);
  expect(state.invariants.violations, 'state invariants after hostile input').toEqual([]);
});

it('does not let a null swing corrupt session state', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({ type: 'set_swing', swing: null, seq: 1 }));

  client.socket.send(JSON.stringify({ type: 'set_tempo', tempo: 130, seq: 2 }));
  await client.inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');

  const state = await serverState(sessionId);
  expect(Number.isFinite(state.swing), `swing became ${state.swing}`).toBe(true);
  expect(state.swing).toBeGreaterThanOrEqual(0);
  expect(state.swing).toBeLessThanOrEqual(100);
  expect(state.invariants.violations, 'state invariants after hostile input').toEqual([]);
});

// ---------------------------------------------------------------------------
// Referential validity
// ---------------------------------------------------------------------------

it('ignores a step toggle for a track that does not exist', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({
    type: 'toggle_step', trackId: 'no-such-track', step: 0, seq: 1,
  }));

  // Follow with a valid edit and wait for it: if the bogus one had been
  // applied, the track list would have grown or thrown by now.
  client.socket.send(JSON.stringify({
    type: 'toggle_step', trackId: 't1', step: 3, seq: 2,
  }));
  await client.inbox.waitFor(
    (m) => m.type === 'step_toggled' && m.clientSeq === 2,
    'valid step_toggled',
  );

  const fresh = await connect(sessionId, 'observer');
  const tracks = fresh.snapshot.state!.tracks;
  expect(tracks).toHaveLength(1);
  expect(tracks[0].id).toBe('t1');
  expect(tracks[0].steps[3]).toBe(true);
});

it('ignores a step toggle outside the step range', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({
    type: 'toggle_step', trackId: 't1', step: 9999, seq: 1,
  }));

  client.socket.send(JSON.stringify({
    type: 'toggle_step', trackId: 't1', step: 2, seq: 2,
  }));
  await client.inbox.waitFor(
    (m) => m.type === 'step_toggled' && m.clientSeq === 2,
    'valid step_toggled',
  );

  const fresh = await connect(sessionId, 'observer');
  const steps = fresh.snapshot.state!.tracks[0].steps;
  expect(steps).toHaveLength(128);
  expect(steps[2]).toBe(true);
  expect(steps.filter(Boolean)).toHaveLength(1);
});

// Same class of gap, on the *other* handler factory. handleSetTrackVolume and
// handleSetTrackTranspose validate with a bare clamp() through
// createTrackMutationHandler, so they inherit the NaN problem that tempo and
// swing had — Math.round(clamp(NaN)) is still NaN.

async function trackState(sessionId: string, playerId: string) {
  const observer = await connect(sessionId, playerId);
  return observer.snapshot.state!.tracks[0];
}

it('does not let a non-numeric track volume corrupt session state', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({
    type: 'set_track_volume', trackId: 't1', volume: 'loud', seq: 1,
  }));

  client.socket.send(JSON.stringify({ type: 'set_tempo', tempo: 130, seq: 2 }));
  await client.inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');

  const track = await trackState(sessionId, 'volume-observer');
  expect(Number.isFinite(track.volume), `volume became ${track.volume}`).toBe(true);
  expect(track.volume).toBeGreaterThanOrEqual(0);
  expect(track.volume).toBeLessThanOrEqual(1);
});

it('does not let a non-numeric transpose corrupt session state', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({
    type: 'set_track_transpose', trackId: 't1', transpose: {}, seq: 1,
  }));

  client.socket.send(JSON.stringify({ type: 'set_tempo', tempo: 130, seq: 2 }));
  await client.inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');

  const track = await trackState(sessionId, 'transpose-observer');
  expect(Number.isFinite(track.transpose), `transpose became ${track.transpose}`).toBe(true);
});


// ---------------------------------------------------------------------------
// The same gap, found by looking for the family rather than the bug.
//
// tempo/swing and volume/transpose were fixed one pair at a time. Searching for
// every clamp() reachable from a client message turned up six more sites with
// no type guard: per-track swing, and five of the nine numeric effect
// parameters. The effects handler checked `typeof x === 'number'` on the four
// `wet` values only, so decay, feedback, frequency, depth and amount reached
// clamp() unchecked.
// ---------------------------------------------------------------------------

it('does not let a non-numeric per-track swing corrupt session state', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({
    type: 'set_track_swing', trackId: 't1', swing: 'shuffle', seq: 1,
  }));

  client.socket.send(JSON.stringify({ type: 'set_tempo', tempo: 130, seq: 2 }));
  await client.inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');

  const track = await trackState(sessionId, 'swing-observer') as unknown as { swing?: number };
  if (track.swing !== undefined) {
    expect(Number.isFinite(track.swing), `track swing became ${track.swing}`).toBe(true);
    expect(track.swing).toBeGreaterThanOrEqual(0);
    expect(track.swing).toBeLessThanOrEqual(100);
  }
  expect((await serverState(sessionId)).invariants.violations).toEqual([]);
});

it('rejects an effects payload whose non-wet numbers are not numbers', async () => {
  const sessionId = await createSession();
  const client = await connect(sessionId);

  // Every `wet` is a valid number, so the old guard passed this straight
  // through and clamp() turned five fields into NaN.
  client.socket.send(JSON.stringify({
    type: 'set_effects',
    seq: 1,
    effects: {
      reverb: { decay: 'long', wet: 0.5 },
      delay: { time: '8n', feedback: {}, wet: 0.2 },
      chorus: { frequency: [], depth: 'deep', wet: 0.1 },
      distortion: { amount: 'crunchy', wet: 0.3 },
    },
  }));

  client.socket.send(JSON.stringify({ type: 'set_tempo', tempo: 140, seq: 2 }));
  await client.inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');

  const fresh = await connect(sessionId, 'effects-observer');
  const effects = (fresh.snapshot.state as unknown as { effects?: Record<string, Record<string, unknown>> }).effects;

  // Either the payload was rejected outright (no effects stored) or every
  // numeric parameter is a finite number.
  //
  // `if (typeof value !== 'number') continue` was the first version of this
  // loop and it could not fail: a NaN written into session state comes back
  // through the snapshot as `null`, because JSON.stringify serialises NaN and
  // ±Infinity as null. Skipping non-numbers skipped exactly the corruption
  // being tested. Naming the expected fields instead of iterating whatever
  // survived also means a rejected payload cannot masquerade as a clean one.
  const NUMERIC_PARAMS: Array<[string, string]> = [
    ['reverb', 'decay'], ['reverb', 'wet'],
    ['delay', 'feedback'], ['delay', 'wet'],
    ['chorus', 'frequency'], ['chorus', 'depth'], ['chorus', 'wet'],
    ['distortion', 'amount'], ['distortion', 'wet'],
  ];

  if (effects) {
    for (const [group, name] of NUMERIC_PARAMS) {
      const value = effects[group]?.[name];
      if (value === undefined) continue; // group absent entirely: nothing stored
      expect(
        typeof value === 'number' && Number.isFinite(value),
        `effects.${group}.${name} is ${JSON.stringify(value)} — a NaN serialises as null`
      ).toBe(true);
    }
  }
  expect((await serverState(sessionId)).invariants.violations).toEqual([]);
});

it('still accepts a fully valid effects payload', async () => {
  // The guard must reject bad input without rejecting good input — otherwise
  // the fix silently disables the feature and the tests above still pass.
  const sessionId = await createSession();
  const client = await connect(sessionId);

  client.socket.send(JSON.stringify({
    type: 'set_effects',
    seq: 1,
    effects: {
      reverb: { decay: 2.5, wet: 0.4 },
      delay: { time: '8n', feedback: 0.3, wet: 0.2 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0.1 },
      distortion: { amount: 0.2, wet: 0.15 },
    },
  }));

  await client.inbox.waitFor((m) => m.type === 'effects_changed', 'effects_changed');

  const fresh = await connect(sessionId, 'valid-effects-observer');
  const effects = (fresh.snapshot.state as unknown as {
    effects?: { reverb?: { decay?: number; wet?: number } };
  }).effects;
  expect(effects?.reverb?.decay, 'a valid decay was not stored').toBe(2.5);
  expect(effects?.reverb?.wet).toBe(0.4);
});

// ---------------------------------------------------------------------------
// Connection limit.
//
// MAX_PLAYERS is enforced at live-session.ts:727, and until now nothing CI runs
// checked it. The test that did — "should reject the 11th connection" — lived
// in mock-durable-object.test.ts and went when that 980-line second
// implementation of the DO was deleted, correctly. Its replacement is in
// test/staging/failure-modes.test.ts, which needs a deployed backend and is
// excluded from every CI lane, so the limit has been unverified in CI since.
//
// This belongs here rather than in staging: the limit is enforced during the
// WebSocket upgrade by a real Durable Object, which is exactly what this tier
// drives.
// ---------------------------------------------------------------------------

const MAX_PLAYERS = 10;

it('refuses the connection past the player limit and keeps serving the ones it took', async () => {
  const sessionId = await createSession();

  const accepted: WebSocket[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const { socket } = await connect(sessionId, `player-${i}`);
    accepted.push(socket);
  }
  expect(accepted, `only ${accepted.length} of ${MAX_PLAYERS} players connected`)
    .toHaveLength(MAX_PLAYERS);

  // The upgrade itself must be refused — not accepted and then closed, which
  // would look identical to a healthy connection until the client sent
  // something.
  const overflow = await SELF.fetch(
    `http://localhost/api/sessions/${sessionId}/ws?playerId=one-too-many`,
    { headers: { Upgrade: 'websocket' } },
  );
  expect(overflow.status, 'the 11th connection was not refused').not.toBe(101);
  expect(overflow.webSocket).toBeFalsy();

  // Refusing the extra player must not disturb the session: the ones already
  // in it keep working.
  const survivor = accepted[0];
  survivor.send(JSON.stringify({ type: 'set_tempo', tempo: 141, seq: 99 }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect((await serverState(sessionId)).tempo).toBe(141);
});
