/**
 * Server half of the sequence-regression consequence pair
 * (client half: src/sync/seq-regression.test.ts).
 *
 * Proves the trigger condition against the real Worker + DO + storage:
 *
 *   1. `serverSeq` is persisted only every 100 mutating broadcasts (or on a
 *      graceful KV flush), so an ungraceful eviction rewinds it and the DO
 *      re-issues sequence numbers already sent on the SAME hibernated
 *      socket — the input that drives the client-side churn.
 *
 *   2. The server's ack-gap recovery only fires for positive gaps
 *      (`ackGap > ACK_GAP_THRESHOLD`), so a client acking a seq from the
 *      pre-eviction epoch (ack > serverSeq, negative gap) gets NO snapshot —
 *      the window is silent. The same test proves the positive-gap path DOES
 *      push a snapshot, so the absence assertion is backed by a working
 *      detector, not a listener that never sees snapshots.
 */
import { env, SELF, evictDurableObject } from 'cloudflare:test';
import { it, expect, afterEach } from 'vitest';

interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
}

const LIVE_SESSIONS = (env as unknown as Env).LIVE_SESSIONS;
const stubFor = (id: string) => LIVE_SESSIONS.get(LIVE_SESSIONS.idFromName(id));

const sockets: WebSocket[] = [];
afterEach(() => {
  for (const ws of sockets.splice(0)) {
    try { ws.close(1000, 'test done'); } catch { /* already closed */ }
  }
});

async function createSession(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { tracks: [], tempo: 120, swing: 0, version: 1 } }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

interface ServerMsg { type: string; seq?: number; tempo?: number; [k: string]: unknown }

function listen(ws: WebSocket) {
  const buf: ServerMsg[] = [];
  const waiters: {
    pred: (m: ServerMsg) => boolean;
    resolve: (m: ServerMsg) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

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
    waitFor(pred: (m: ServerMsg) => boolean, tag: string, timeoutMs = 5_000): Promise<ServerMsg> {
      const idx = buf.findIndex(pred);
      if (idx >= 0) return Promise.resolve(buf.splice(idx, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timeout waiting for ${tag}`)),
          timeoutMs,
        );
        waiters.push({ pred, resolve, timer });
      });
    },
    /** Bounded absence check: true if no buffered/incoming frame matches within windowMs. */
    absent(pred: (m: ServerMsg) => boolean, windowMs: number): Promise<boolean> {
      if (buf.some(pred)) return Promise.resolve(false);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const i = waiters.findIndex((w) => w.resolve === hit);
          if (i >= 0) waiters.splice(i, 1);
          resolve(true);
        }, windowMs);
        const hit = () => { clearTimeout(timer); resolve(false); };
        waiters.push({ pred, resolve: hit as unknown as (m: ServerMsg) => void, timer });
      });
    },
  };
}

async function connect(stub: DurableObjectStub, sessionId: string, playerId: string) {
  const res = await stub.fetch(`http://do/api/sessions/${sessionId}?playerId=${playerId}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  sockets.push(ws);
  return { ws, inbox: listen(ws) };
}

const setTempo = (tempo: number, seq: number, ack?: number) =>
  JSON.stringify({ type: 'set_tempo', tempo, seq, ...(ack !== undefined ? { ack } : {}) });

it('ungraceful eviction rewinds serverSeq and re-issues sequence numbers on the same hibernated socket', async () => {
  const id = await createSession();
  const stub = stubFor(id);
  const { ws, inbox } = await connect(stub, id, 'seq-reuse-probe');

  // Three mutations: broadcasts carry seq 1, 2, 3.
  for (let i = 1; i <= 3; i++) {
    ws.send(setTempo(100 + i, i));
    const msg = await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 100 + i, `tempo ${100 + i}`);
    expect(msg.seq, 'pre-eviction epoch').toBe(i);
  }

  // Ungraceful eviction: in-memory serverSeq (3) is discarded — it was never
  // persisted (< 100 broadcasts, no graceful flush). The socket hibernates
  // and survives.
  await evictDurableObject(stub);

  // Same socket, new mutation: the restored counter re-issues seq 1.
  ws.send(setTempo(140, 4));
  const post = await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 140, 'post-eviction tempo');
  expect(post.seq, 'post-eviction epoch reuses already-sent seq').toBe(1);

  // Server-side state is intact — the regression is a protocol-counter
  // problem, not a data-loss problem.
  const get = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  expect(((await get.json()) as { state: { tempo: number } }).state.tempo).toBe(140);
}, 30_000);

it('negative ack gap is silent; the same detector proves positive gaps push a snapshot', async () => {
  const id = await createSession();
  const stub = stubFor(id);
  const { ws, inbox } = await connect(stub, id, 'ack-gap-probe');

  // Consume the handshake snapshot the worker queues right after the
  // upgrade, so the absence assertion below measures only snapshots sent in
  // RESPONSE to the negative ack, not connection setup.
  await inbox.waitFor((m) => m.type === 'snapshot', 'handshake snapshot');

  // Advance serverSeq to 1.
  ws.send(setTempo(101, 1));
  await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 101, 'first tempo');

  // A client from the pre-eviction epoch acks 50 while serverSeq is 1:
  // ackGap = 1 - 50 = -49. The threshold check (`ackGap > 50`) is false, so
  // the server does nothing — no snapshot, no log, no resync.
  ws.send(setTempo(102, 2, 50));
  await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 102, 'negative-ack tempo');
  expect(
    await inbox.absent((m) => m.type === 'snapshot', 400),
    'no snapshot for a negative ack gap — the window is silent',
  ).toBe(true);

  // Positive control for the absence oracle: push serverSeq past the
  // threshold (50), then ack 0 — gap > 50 must push a snapshot.
  for (let i = 3; i <= 53; i++) {
    ws.send(setTempo(60 + (i % 60), i));
    await inbox.waitFor((m) => m.type === 'tempo_changed' && m.seq === i, `seq ${i}`);
  }
  ws.send(setTempo(150, 54, 0));
  const snap = await inbox.waitFor((m) => m.type === 'snapshot', 'recovery snapshot', 5_000);
  expect(snap.type).toBe('snapshot');
}, 60_000);
