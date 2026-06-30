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

  ws.addEventListener('message', (event: MessageEvent) => {
    const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
    const msg = JSON.parse(raw) as ServerMsg;
    buf.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(msg)) {
        clearTimeout(waiters[i].timer);
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });

  return {
    buf,
    waitFor(pred: (m: ServerMsg) => boolean, label: string, timeoutMs = 4000): Promise<ServerMsg> {
      const existing = buf.find(pred);
      if (existing) return Promise.resolve(existing);
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
  const snapshot = await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');
  expect(snapshot.tempo === undefined || snapshot.tempo === 120).toBe(true);

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

  // Unlike the default, this terminates the client connection rather than
  // hibernating it.
  const { code } = await closed;
  expect(typeof code).toBe('number');

  // And the next cold start has no restored players.
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
