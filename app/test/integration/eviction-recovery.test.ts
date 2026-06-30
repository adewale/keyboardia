/**
 * Eviction & recovery integration tests for LiveSessionDurableObject.
 *
 * These exercise the `evictDurableObject` / `evictAllDurableObjects` helpers
 * (new in @cloudflare/vitest-pool-workers v0.16.20). They tear down a running
 * Durable Object instance to reset its in-memory state while preserving durable
 * storage and (by default) hibernating live WebSockets — the closest thing to
 * a production eviction/hibernation event we can drive from a test.
 *
 * Verisimilitude notes — what makes these "real" rather than synthetic:
 *   - State is changed by sending genuine client messages over a genuine
 *     WebSocket (`set_tempo`, ...), so the worker's real persistence code
 *     (`persistToDoStorage`, `saveToKV`) runs — we never poke private fields.
 *   - We assert the actual durability *boundary*: `state` is written on every
 *     mutation, but `serverSeq` only lands in storage on a graceful disconnect
 *     (or every 100 broadcasts), so an ungraceful eviction resets it. One test
 *     documents that tradeoff instead of pretending it doesn't exist.
 *   - We connect, hibernate (evict), and resume on the *same* socket to prove
 *     the constructor's `getWebSockets()` restoration loop actually works — the
 *     headline use case, and the one the previous suite said it "can't easily
 *     simulate".
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/
 */

import {
  env,
  SELF,
  runInDurableObject,
  evictDurableObject,
  evictAllDurableObjects,
} from 'cloudflare:test';
import { it, expect } from 'vitest';

interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
  SAMPLES: R2Bucket;
}

const LIVE_SESSIONS = (env as unknown as Env).LIVE_SESSIONS;

function stubFor(sessionId: string): DurableObjectStub {
  return LIVE_SESSIONS.get(LIVE_SESSIONS.idFromName(sessionId));
}

// Create a session through the real REST path (writes KV, mirroring how a
// browser bootstraps a session). Returns the session id; the DO is addressed
// by idFromName(id) exactly as the worker does internally.
async function createSession(tempo: number, swing: number): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { tracks: [], tempo, swing, version: 1 } }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function debugInfo(stub: DurableObjectStub, sessionId: string) {
  const res = await stub.fetch(`http://do/api/sessions/${sessionId}/debug`);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    tempo: number;
    swing: number;
    connectedPlayers: number;
    invariants: { valid: boolean; violations: string[] };
  };
}

// Open a real hibernatable WebSocket against the DO. The worker returns a
// `101` with a `webSocket` we accept and drive directly.
async function connect(
  stub: DurableObjectStub,
  sessionId: string,
  playerId?: string,
): Promise<WebSocket> {
  const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
  const res = await stub.fetch(`http://do/api/sessions/${sessionId}${query}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  expect(ws).not.toBeNull();
  ws!.accept();
  return ws!;
}

interface ServerMsg {
  type: string;
  seq?: number;
  tempo?: number;
  [k: string]: unknown;
}

// Buffer every inbound frame and let tests await the first one matching a
// predicate (checking already-received frames too, to avoid races with the
// snapshot that the worker sends via queueMicrotask right after the handshake).
function listen(ws: WebSocket) {
  const buf: ServerMsg[] = [];
  const waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  // Each frame is matched (and CONSUMED) by at most one waiter. Consuming
  // matters: two toggles of the same step both broadcast `step_toggled
  // step=N`, so a non-consuming `find` would let the second wait re-match the
  // first frame and read a stale value. Oldest matching waiter wins.
  ws.addEventListener('message', (event: MessageEvent) => {
    const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
    const msg = JSON.parse(raw) as ServerMsg;
    const idx = waiters.findIndex((w) => w.pred(msg));
    if (idx >= 0) {
      const [w] = waiters.splice(idx, 1);
      clearTimeout(w.timer);
      w.resolve(msg);
    } else {
      buf.push(msg);
    }
  });

  return {
    buf,
    waitFor(pred: (m: ServerMsg) => boolean, label: string, timeoutMs = 4000): Promise<ServerMsg> {
      const existingIdx = buf.findIndex(pred);
      if (existingIdx >= 0) return Promise.resolve(buf.splice(existingIdx, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.timer === timer);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`Timed out waiting for ${label}. Saw: [${buf.map((m) => m.type).join(', ')}]`));
        }, timeoutMs);
        waiters.push({ pred, resolve, timer });
      });
    },
  };
}

function waitForClose(ws: WebSocket, timeoutMs = 4000): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket close')), timeoutMs);
    ws.addEventListener('close', (event: CloseEvent) => {
      clearTimeout(timer);
      resolve({ code: event.code });
    });
  });
}

// Poll the DO's durable storage until `pred` holds. Each read runs inside the
// instance, which also keeps it alive/"running" for a subsequent eviction.
async function pollStorage<T>(
  stub: DurableObjectStub,
  key: string,
  pred: (v: T | undefined) => boolean,
  label: string,
  attempts = 100,
): Promise<T | undefined> {
  for (let i = 0; i < attempts; i++) {
    const val = await runInDurableObject(stub, (_instance, state) => state.storage.get<T>(key));
    if (pred(val)) return val;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`storage["${key}"] never satisfied: ${label}`);
}

// Poll the legacy KV mirror (written on disconnect) until `pred` holds.
async function pollKvTempo(
  kv: KVNamespace,
  sessionId: string,
  pred: (tempo: number | undefined) => boolean,
  label: string,
  attempts = 100,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const session = (await kv.get(`session:${sessionId}`, 'json')) as { state?: { tempo?: number } } | null;
    if (pred(session?.state?.tempo)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`KV tempo never satisfied: ${label}`);
}

// Deterministic PRNG (mulberry32) so fuzz failures are reproducible from the
// logged seed. We avoid Math.random() precisely so a red run can be replayed.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: () => number, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));

async function connectWithSnapshot(stub: DurableObjectStub, sessionId: string, playerId?: string) {
  const ws = await connect(stub, sessionId, playerId);
  const inbox = listen(ws);
  await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');
  return { ws, inbox };
}

// A minimal valid track; the backend pads steps/parameterLocks to MAX_STEPS.
function makeTrack(id: string) {
  return {
    id,
    name: 'Fuzz',
    sampleId: 'kick',
    steps: Array(16).fill(false),
    parameterLocks: Array(16).fill(null),
    volume: 1,
    muted: false,
    transpose: 0,
    stepCount: 16,
  };
}

async function createSessionWithTrack(tempo: number, trackId: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { tracks: [makeTrack(trackId)], tempo, swing: 0, version: 1 } }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

// Read the DO's *recovered* in-memory state after a cold start: the debug call
// forces ensureStateLoaded(), then we snapshot the loaded state directly.
async function readLoadedState(stub: DurableObjectStub, sessionId: string) {
  await debugInfo(stub, sessionId);
  return runInDurableObject(stub, (instance) => {
    const st = (instance as unknown as { state: { tempo: number; swing: number; tracks: { id: string; steps: boolean[] }[] } | null }).state;
    if (!st) return null;
    return {
      tempo: st.tempo,
      swing: st.swing,
      tracks: st.tracks.map((t) => ({ id: t.id, steps: t.steps.slice() })),
    };
  });
}

// ===========================================================================
// Layer 1 — real mutation round-trip; per-mutation state survives eviction
// ===========================================================================

it('persists a real WebSocket mutation to storage and recovers it after an ungraceful eviction', async () => {
  const id = await createSession(120, 0);
  expect(id).toBeTruthy();
  const stub = stubFor(id);

  const ws = await connect(stub, id);
  const inbox = listen(ws);

  // The DO greets every connection with a snapshot of current (KV) state.
  // The snapshot nests state under `snapshot.state`, not on the top-level msg.
  const snapshot = await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');
  expect((snapshot.state as { tempo: number }).tempo).toBe(120);

  // Send a genuine mutation and wait for the authoritative broadcast back.
  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 150, seq: 1 }));
  const echo = await inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');
  expect(echo.tempo).toBe(150);
  expect(typeof echo.seq).toBe('number'); // serverSeq stamped on mutating broadcasts

  // `persistToDoStorage()` runs on every mutation, so the new tempo is durable
  // even though the client never disconnected. Evict abruptly (still running)…
  await evictDurableObject(stub);

  // …and a fresh instance must serve the persisted tempo, not the default.
  const after = await debugInfo(stub, id);
  expect(after.tempo).toBe(150);

  ws.close(1000, 'test done');
});

// ===========================================================================
// Layer 2 — serverSeq survives eviction *after a graceful disconnect*
// ===========================================================================

it('restores serverSeq from storage after a graceful disconnect + eviction', async () => {
  const id = await createSession(100, 0);
  const stub = stubFor(id);

  const ws = await connect(stub, id);
  const inbox = listen(ws);
  await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');

  // One mutation -> serverSeq becomes 1 in memory (not yet at the %100 checkpoint).
  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 131, seq: 1 }));
  const echo = await inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');
  expect(echo.seq).toBe(1);

  // Graceful close: as the last player leaves, flushPendingKVSave() -> saveToKV()
  // persists serverSeq to storage. Wait until that has actually landed.
  ws.close(1000, 'graceful');
  await pollStorage<number>(stub, 'serverSeq', (v) => v === 1, 'serverSeq persisted on disconnect');

  await evictDurableObject(stub);

  // The constructor reloads serverSeq inside blockConcurrencyWhile(); a fresh
  // instance must come back at 1, so new mutations don't reuse old sequence ids.
  await runInDurableObject(stub, (instance) => {
    expect((instance as unknown as Record<string, unknown>)['serverSeq']).toBe(1);
  });
});

// ===========================================================================
// Layer 3 — documented durability boundary (NOT a bug): an ungraceful
// eviction before the next checkpoint resets serverSeq, while state survives.
// ===========================================================================

it('documents that serverSeq below the persistence checkpoint resets on ungraceful eviction (state still survives)', async () => {
  const id = await createSession(110, 0);
  const stub = stubFor(id);

  const ws = await connect(stub, id);
  const inbox = listen(ws);
  await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');

  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 142, seq: 1 }));
  await inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');

  // serverSeq is 1 in memory but only persisted at multiples of 100, and we
  // evict WITHOUT a graceful disconnect, so saveToKV() never runs.
  await evictDurableObject(stub);

  // state survives (per-mutation persistence) ...
  expect((await debugInfo(stub, id)).tempo).toBe(142);

  // ... but serverSeq is reset to 0. This is the accepted tradeoff behind the
  // "persist every 100 messages" comment in broadcast(); clients recover via
  // the ack-gap snapshot path. If this ever becomes 1, persistence cadence
  // changed and the assumption above should be revisited.
  await runInDurableObject(stub, (instance) => {
    expect((instance as unknown as Record<string, unknown>)['serverSeq']).toBe(0);
  });

  ws.close(1000, 'test done');
});

// ===========================================================================
// Layer 4 — WebSocket HIBERNATION: a live connection is restored from
// getWebSockets() after eviction and can resume on the same socket.
// ===========================================================================

it('hibernates a live WebSocket across eviction and restores + resumes it', async () => {
  const id = await createSession(120, 0);
  const stub = stubFor(id);

  const ws = await connect(stub, id, 'player-hibernate');
  const inbox = listen(ws);
  await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');

  // Per the lifecycle docs, hibernated WebSocket connections "remain connected
  // despite memory removal" — so a default eviction must NOT surface a close.
  let closedDuringHibernate = false;
  ws.addEventListener('close', () => { closedDuringHibernate = true; });

  // Default eviction hibernates (does not close) WebSockets.
  await evictDurableObject(stub);

  // The fresh instance's constructor walks ctx.getWebSockets() and rebuilds the
  // players map from each socket's serialized attachment — so the player count
  // is preserved across the cold start without a reconnect.
  expect((await debugInfo(stub, id)).connectedPlayers).toBe(1);

  // creatorIdentity (first connection) is also reloaded by the constructor.
  await runInDurableObject(stub, (instance) => {
    expect((instance as unknown as Record<string, unknown>)['creatorIdentity']).toBeTruthy();
  });

  // The original socket is still live: a message sent after eviction is handled
  // by the restored connection and broadcast back.
  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 158, seq: 2 }));
  const echo = await inbox.waitFor((m) => m.type === 'tempo_changed', 'post-eviction tempo_changed');
  expect(echo.tempo).toBe(158);

  // The hibernate path never closed the client socket (it stayed connected and
  // resumed above).
  expect(closedDuringHibernate).toBe(false);

  ws.close(1000, 'test done');
});

// ===========================================================================
// Layer 5 — webSockets:"close" actually closes the live socket (earns its name)
// ===========================================================================

it('closes live WebSockets when evicted with { webSockets: "close" }', async () => {
  const id = await createSession(120, 0);
  const stub = stubFor(id);

  const ws = await connect(stub, id);
  const inbox = listen(ws);
  await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');

  const closed = waitForClose(ws);
  await evictDurableObject(stub, { webSockets: 'close' });

  // The load-bearing assertion is that this resolves at all: under the default
  // (hibernate) eviction the socket stays open and `waitForClose` would time
  // out. Resolution proves the socket was actually closed.
  await closed;

  // And the next cold start has no restored players (the socket was not
  // hibernated into getWebSockets()).
  expect((await debugInfo(stub, id)).connectedPlayers).toBe(0);
});

// ===========================================================================
// Layer 6 — KV fallback branch: a session whose DO storage was never written
// still recovers (from KV) across eviction.
// ===========================================================================

it('recovers from the KV fallback path after eviction when DO storage was never written', async () => {
  const id = await createSession(96, 24);
  const stub = stubFor(id);

  // A plain debug read loads state from KV but does NOT write the 'state' key
  // (only mutations call persistToDoStorage). Confirm the fallback precondition.
  expect((await debugInfo(stub, id)).tempo).toBe(96);
  await runInDurableObject(stub, async (_instance, state) => {
    expect(await state.storage.get('state')).toBeUndefined();
  });

  await evictDurableObject(stub);

  // With storage still empty, ensureStateLoaded() must fall back to KV again.
  const after = await debugInfo(stub, id);
  expect(after.tempo).toBe(96);
  expect(after.swing).toBe(24);
});

// ===========================================================================
// Layer 7 — evictAllDurableObjects: bulk eviction recovers each instance from
// its own real, persisted mutation.
// ===========================================================================

it('evictAllDurableObjects recovers each instance from its own persisted mutation', async () => {
  const sessions = [
    { id: await createSession(120, 0), tempo: 88 },
    { id: await createSession(120, 0), tempo: 144 },
  ];

  const sockets: WebSocket[] = [];
  for (const s of sessions) {
    const stub = stubFor(s.id);
    const ws = await connect(stub, s.id);
    const inbox = listen(ws);
    await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');
    ws.send(JSON.stringify({ type: 'set_tempo', tempo: s.tempo, seq: 1 }));
    await inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');
    sockets.push(ws);
  }

  // Graceful bulk eviction of every running DO (state preserved, WS hibernated).
  await evictAllDurableObjects();

  for (const s of sessions) {
    const info = await debugInfo(stubFor(s.id), s.id);
    expect(info.tempo).toBe(s.tempo);
  }

  for (const ws of sockets) ws.close(1000, 'test done');
});

// ===========================================================================
// Layer 8 — MULTI-CLIENT hibernation: two players are both restored from
// getWebSockets() and cross-client broadcast still works after eviction.
// ===========================================================================

it('hibernates and restores TWO live WebSockets, preserving cross-client broadcast', async () => {
  const id = await createSession(120, 0);
  const stub = stubFor(id);

  const a = await connectWithSnapshot(stub, id, 'player-A');
  const b = await connectWithSnapshot(stub, id, 'player-B');
  // A learns about B joining (proves both are registered pre-eviction).
  await a.inbox.waitFor((m) => m.type === 'player_joined', 'A sees B join');
  expect((await debugInfo(stub, id)).connectedPlayers).toBe(2);

  // Hibernate both across the cold start.
  await evictDurableObject(stub);

  // The constructor rebuilds BOTH players from their serialized attachments.
  expect((await debugInfo(stub, id)).connectedPlayers).toBe(2);

  // A mutates after eviction; B must receive the broadcast on its restored
  // socket — i.e. the rebuilt players map drives fan-out, not just self-echo.
  a.ws.send(JSON.stringify({ type: 'set_tempo', tempo: 155, seq: 1 }));
  const onA = await a.inbox.waitFor((m) => m.type === 'tempo_changed', 'A echo');
  const onB = await b.inbox.waitFor((m) => m.type === 'tempo_changed', 'B receives A mutation');
  expect(onA.tempo).toBe(155);
  expect(onB.tempo).toBe(155);

  a.ws.close(1000, 'done');
  b.ws.close(1000, 'done');
});

it('closes ALL live WebSockets when two players are evicted with { webSockets: "close" }', async () => {
  const id = await createSession(120, 0);
  const stub = stubFor(id);

  const a = await connectWithSnapshot(stub, id, 'player-A');
  const b = await connectWithSnapshot(stub, id, 'player-B');
  await a.inbox.waitFor((m) => m.type === 'player_joined', 'A sees B join');

  const closedA = waitForClose(a.ws);
  const closedB = waitForClose(b.ws);
  await evictDurableObject(stub, { webSockets: 'close' });

  await Promise.all([closedA, closedB]);
  expect((await debugInfo(stub, id)).connectedPlayers).toBe(0);
});

it('restores only the still-connected player when a peer disconnected before eviction', async () => {
  const id = await createSession(120, 0);
  const stub = stubFor(id);

  const a = await connectWithSnapshot(stub, id, 'player-A');
  const b = await connectWithSnapshot(stub, id, 'player-B');
  await a.inbox.waitFor((m) => m.type === 'player_joined', 'A sees B join');
  expect((await debugInfo(stub, id)).connectedPlayers).toBe(2);

  // B leaves gracefully; wait until A observes the departure so the server has
  // removed B before we evict.
  b.ws.close(1000, 'bye');
  await a.inbox.waitFor((m) => m.type === 'player_left', 'A sees B leave');
  expect((await debugInfo(stub, id)).connectedPlayers).toBe(1);

  // Eviction hibernates the survivors. getWebSockets() must yield only A's still
  // -live socket — the closed B must not be resurrected.
  await evictDurableObject(stub);
  expect((await debugInfo(stub, id)).connectedPlayers).toBe(1);

  // And A keeps working on its restored socket.
  a.ws.send(JSON.stringify({ type: 'set_tempo', tempo: 151, seq: 1 }));
  const echo = await a.inbox.waitFor((m) => m.type === 'tempo_changed', 'A still works');
  expect(echo.tempo).toBe(151);

  a.ws.close(1000, 'done');
});

// ===========================================================================
// Layer 9 — IN-FLIGHT request draining: concurrent requests issued just before
// a graceful eviction all complete (the drain-with-timeout behaviour), and a
// mutation racing the eviction never corrupts state.
// ===========================================================================

it('drains a burst of in-flight WebSocket mutations across eviction without corruption', async () => {
  const id = await createSession(120, 0);
  const stub = stubFor(id);
  const { ws } = await connectWithSnapshot(stub, id);

  // Fire several mutations back-to-back, then evict WITHOUT waiting for acks.
  // evictDurableObject() drains in-flight requests (up to 30s) before tearing
  // down; whichever message handlers have landed, storage must stay consistent
  // — we assert that invariant rather than a specific drain count, since "which
  // WS frames count as in-flight requests at teardown" is timing-dependent.
  //
  // (Note: firing un-awaited stub.fetch() calls and then evicting deadlocks the
  // drain wait in the test harness, so we exercise this via the WS path, which
  // is also closer to how the DO is actually loaded in production.)
  const tempos = [131, 142, 158, 175, 161];
  tempos.forEach((tempo, i) => {
    ws.send(JSON.stringify({ type: 'set_tempo', tempo, seq: i + 1 }));
  });
  await evictDurableObject(stub);

  const after = await debugInfo(stub, id);
  expect(after.invariants.valid).toBe(true);
  // Whatever drained, tempo is one of the values we sent (or the initial) —
  // never a partially-applied/garbage value.
  expect([120, ...tempos]).toContain(after.tempo);

  ws.close(1000, 'done');
});

it('keeps state consistent when a mutation races an eviction', async () => {
  const id = await createSession(120, 0);
  const stub = stubFor(id);
  const { ws } = await connectWithSnapshot(stub, id);

  // Fire a mutation and evict in the same tick, WITHOUT waiting for the ack —
  // the persist may or may not win the race, but either outcome must be a
  // valid, uncorrupted state.
  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 149, seq: 1 }));
  await evictDurableObject(stub);

  const after = await debugInfo(stub, id);
  expect(after.invariants.valid).toBe(true);
  expect([120, 149]).toContain(after.tempo); // drained-new or pre-mutation, never garbage

  // Whatever the race outcome, the DO must be fully functional afterwards: a
  // fresh mutation applies cleanly and recovers across another eviction.
  const { ws: ws2, inbox } = await connectWithSnapshot(stub, id);
  ws2.send(JSON.stringify({ type: 'set_tempo', tempo: 137, seq: 1 }));
  await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 137, 'post-race mutation');
  await evictDurableObject(stub);
  expect((await debugInfo(stub, id)).tempo).toBe(137);

  ws.close(1000, 'done');
  ws2.close(1000, 'done');
});

// ===========================================================================
// Layer 10 — resilience: repeated evictions in a row keep recovering.
// ===========================================================================

it('survives repeated back-to-back evictions', async () => {
  const id = await createSession(120, 0);
  const stub = stubFor(id);
  const { ws, inbox } = await connectWithSnapshot(stub, id);

  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 133, seq: 1 }));
  await inbox.waitFor((m) => m.type === 'tempo_changed', 'tempo_changed');

  for (let i = 0; i < 3; i++) {
    await evictDurableObject(stub);
    const info = await debugInfo(stub, id);
    expect(info.tempo).toBe(133);
    expect(info.invariants.valid).toBe(true);
  }

  ws.close(1000, 'done');
});

// ===========================================================================
// Layer 10.5 — REGRESSION: a hibernated DO woken purely by a WebSocket message
// (no intervening HTTP request) must lazily reload state, not silently drop the
// mutation. Fuzzing found that webSocketMessage() never called
// ensureStateLoaded(), so after hibernation every mutating handler early-returned
// on null state — the edit got no ack and never persisted. Guards that fix.
// ===========================================================================

it('regression: mutations on a WebSocket that woke a hibernated DO are applied (no HTTP load)', async () => {
  const id = await createSession(120, 0);
  const stub = stubFor(id);
  const { ws, inbox } = await connectWithSnapshot(stub, id);

  // Hibernate, then drive the socket WITHOUT any HTTP request in between — the
  // message itself is what wakes the DO.
  await evictDurableObject(stub);

  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 166, seq: 1 }));
  const echo = await inbox.waitFor((m) => m.type === 'tempo_changed', 'ack after pure-WS wake');
  expect(echo.tempo).toBe(166);

  // A second mutation on the now-loaded instance also works.
  ws.send(JSON.stringify({ type: 'set_swing', swing: 33, seq: 2 }));
  await inbox.waitFor((m) => m.type === 'swing_changed' && m.swing === 33, 'second mutation');

  // And both persist across a further eviction.
  await evictDurableObject(stub);
  const after = await debugInfo(stub, id);
  expect(after.tempo).toBe(166);
  expect(after.swing).toBe(33);

  ws.close(1000, 'done');
});

// ===========================================================================
// Layer 10.6 — REGRESSION: a close event that wakes a hibernated DO must flush
// the latest state to KV. flushPendingKVSave() previously bailed on null state
// after a cold start, leaving the legacy KV mirror stale. (Reads route through
// the DO so this isn't a read-correctness bug, but KV is the disconnect-time
// backup and should be current.)
// ===========================================================================

it('flushes the latest state to KV when a disconnect wakes a hibernated DO', async () => {
  const SESSIONS = (env as unknown as Env).SESSIONS;
  const id = await createSession(120, 0);
  const stub = stubFor(id);

  const { ws, inbox } = await connectWithSnapshot(stub, id);
  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 145, seq: 1 }));
  await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 145, 'tempo ack');

  // Hybrid persistence: the mutation is in DO storage, but KV is only written on
  // disconnect — so KV still has the original tempo at this point.
  await pollKvTempo(SESSIONS, id, (t) => t === 120, 'KV starts at 120');

  // Hibernate (discards in-memory state + the pendingKVSave flag), then close.
  // The close event wakes the DO; flushPendingKVSave() must reload state and
  // write 145 to KV instead of skipping on null state.
  await evictDurableObject(stub);
  ws.close(1000, 'bye');

  await pollKvTempo(SESSIONS, id, (t) => t === 145, 'KV flushed to 145 after wake-disconnect');
});

// ===========================================================================
// Layer 10.7 — the immutable (published) flag must be reloaded from KV after a
// cold start. ensureStateLoaded() sets this.immutable from the KV record; if a
// wake skipped that reload, a published session would silently become editable.
// ===========================================================================

it('keeps a published session immutable across eviction (immutable flag reloaded on wake)', async () => {
  const id = await createSession(120, 0);
  // Publish -> creates a NEW immutable session; mutate that one.
  const pubRes = await SELF.fetch(`http://localhost/api/sessions/${id}/publish`, { method: 'POST' });
  expect(pubRes.status).toBe(201);
  const publishedId = ((await pubRes.json()) as { id: string }).id;
  const stub = stubFor(publishedId);

  const ws = await connect(stub, publishedId);
  const inbox = listen(ws);
  await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');

  // Cold start, then drive the published DO purely over WS.
  await evictDurableObject(stub);

  // A mutation must be rejected with SESSION_PUBLISHED — proving immutable was
  // reloaded from KV during the wake, not lost to the discarded in-memory state.
  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 150, seq: 1 }));
  const err = await inbox.waitFor((m) => m.type === 'error', 'published rejection');
  expect(err.code).toBe('SESSION_PUBLISHED');

  // REST PUT is likewise rejected with 403 after the cold start.
  const put = await SELF.fetch(`http://localhost/api/sessions/${publishedId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { tracks: [], tempo: 150, swing: 0, version: 1 } }),
  });
  expect(put.status).toBe(403);
  await put.text();

  ws.close(1000, 'done');
});

// ===========================================================================
// Layer 11 — FUZZ: for randomized mutation sequences with a mid-sequence
// hibernation, the recovered state always reflects every acked mutation.
// Seeded so any failure is reproducible from the printed seed.
// ===========================================================================

it('fuzz: recovered state reflects all acked mutations (global + track ops) across a mid-sequence eviction', async () => {
  const SEEDS = [1, 7, 42, 1337, 90210, 0xc0ffee];
  const TRACK_ID = 'fuzz-track';

  for (const seed of SEEDS) {
    const rng = mulberry32(seed);
    const id = await createSessionWithTrack(120, TRACK_ID);
    const stub = stubFor(id);
    const { ws, inbox } = await connectWithSnapshot(stub, id);

    const opCount = randInt(rng, 4, 10);
    const evictAt = randInt(rng, 1, opCount - 1); // hibernate partway through
    const expected = { tempo: 120, swing: 0, steps: new Map<number, boolean>() };

    for (let i = 0; i < opCount; i++) {
      if (i === evictAt) {
        // Hibernate mid-stream. Deliberately NO http call here: the next WS op
        // must wake the DO and lazily reload state on its own. (An earlier
        // version called debugInfo() here, which masked the hibernation-wake
        // bug by triggering the load via the HTTP path.) connectedPlayers
        // restoration is asserted in the dedicated hibernation tests above.
        await evictDurableObject(stub);
      }

      const roll = rng();
      const tag = `seed=${seed} op=${i} evictAt=${evictAt}/${opCount}`;
      if (roll < 0.4) {
        const tempo = randInt(rng, 60, 180);
        ws.send(JSON.stringify({ type: 'set_tempo', tempo, seq: i + 1 }));
        await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === tempo, `tempo=${tempo} ${tag}`);
        expected.tempo = tempo;
      } else if (roll < 0.7) {
        const swing = randInt(rng, 0, 100);
        ws.send(JSON.stringify({ type: 'set_swing', swing, seq: i + 1 }));
        await inbox.waitFor((m) => m.type === 'swing_changed' && m.swing === swing, `swing=${swing} ${tag}`);
        expected.swing = swing;
      } else {
        // Track-level op: toggle a random step and trust the broadcast's
        // resulting value (handles repeat-toggles on the same index).
        const step = randInt(rng, 0, 15);
        ws.send(JSON.stringify({ type: 'toggle_step', trackId: TRACK_ID, step, seq: i + 1 }));
        const ack = await inbox.waitFor(
          (m) => m.type === 'step_toggled' && (m as { step?: number }).step === step,
          `toggle step=${step} ${tag}`,
        );
        expected.steps.set(step, (ack as { value?: boolean }).value === true);
      }
    }

    // Final ungraceful eviction, then assert full recovery of every acked op.
    await evictDurableObject(stub);
    const recovered = await readLoadedState(stub, id);
    expect(recovered, `recovered seed=${seed}`).not.toBeNull();
    expect(recovered!.tempo, `tempo seed=${seed} evictAt=${evictAt}/${opCount}`).toBe(expected.tempo);
    expect(recovered!.swing, `swing seed=${seed} evictAt=${evictAt}/${opCount}`).toBe(expected.swing);

    const recoveredTrack = recovered!.tracks.find((t) => t.id === TRACK_ID);
    expect(recoveredTrack, `track present seed=${seed}`).toBeDefined();
    for (const [step, value] of expected.steps) {
      expect(recoveredTrack!.steps[step], `step ${step} seed=${seed} evictAt=${evictAt}/${opCount}`).toBe(value);
    }

    ws.close(1000, 'fuzz done');
  }
});
