/**
 * DO <-> WebSocket <-> KV state-machine tests + fuzzing.
 *
 * There is an implicit state machine across three persistence/transport layers:
 *
 *   - KV (`session:<id>`): metadata (name, immutable, timestamps) + a `state`
 *     mirror. Written by createSession, by REST PUT/PATCH(state), and by the
 *     last-player-disconnect flush. NOT written by plain WS mutations.
 *   - DO storage (`state`): the source of truth for an active session. Written
 *     on every WS mutation and every REST PUT/PATCH(state).
 *   - In-memory + connected WS clients: discarded on hibernation/eviction.
 *
 * Transitions: cold -> active -> (hibernated | evicted) -> active, driven by WS
 * connect/mutate/disconnect, REST GET/PUT/PATCH, and eviction.
 *
 * The contract we assert:
 *   (1) Read-your-writes through the DO: after ANY interleaving of WS mutations,
 *       REST writes, hibernation, eviction and (dis)connects, a REST GET (which
 *       routes through the DO) returns the last write. This must always hold.
 *   (2) KV convergence: KV equals the canonical state immediately after a REST
 *       PUT/PATCH(state), and catches up after a graceful disconnect. Between a
 *       WS mutation and the next KV-writing event, KV is allowed to lag — and we
 *       assert exactly that window rather than pretend it doesn't exist.
 */

import {
  env,
  SELF,
  evictDurableObject,
} from 'cloudflare:test';
import { it, expect } from 'vitest';

interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
}

const LIVE_SESSIONS = (env as unknown as Env).LIVE_SESSIONS;
const KV = (env as unknown as Env).SESSIONS;

const stubFor = (id: string) => LIVE_SESSIONS.get(LIVE_SESSIONS.idFromName(id));

interface SessionState { tracks: unknown[]; tempo: number; swing: number; version: number }
const mkState = (tempo: number, swing: number): SessionState => ({ tracks: [], tempo, swing, version: 1 });

async function createSession(tempo: number, swing: number): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: mkState(tempo, swing) }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function restGet(id: string) {
  const res = await SELF.fetch(`http://localhost/api/sessions/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { name: string | null; state: { tempo: number; swing: number } };
}

async function restPutState(id: string, tempo: number, swing: number) {
  const res = await SELF.fetch(`http://localhost/api/sessions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: mkState(tempo, swing) }),
  });
  expect(res.status).toBe(200);
  await res.text();
}

async function restPatchState(id: string, tempo: number, swing: number) {
  const res = await SELF.fetch(`http://localhost/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: mkState(tempo, swing) }),
  });
  expect(res.status).toBe(200);
  await res.text();
}

async function restPatchName(id: string, name: string) {
  const res = await SELF.fetch(`http://localhost/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(200);
  await res.text();
}

async function readKv(id: string) {
  return (await KV.get(`session:${id}`, 'json')) as
    | { name: string | null; state: { tempo: number; swing: number } }
    | null;
}

async function ensureRunning(id: string) {
  // evictDurableObject rejects unless the DO is currently running.
  const res = await stubFor(id).fetch(`http://do/api/sessions/${id}/debug`);
  await res.text();
}

// ---- WebSocket harness (consuming inbox) -------------------------------------

interface ServerMsg { type: string; tempo?: number; swing?: number; [k: string]: unknown }

function listen(ws: WebSocket) {
  const buf: ServerMsg[] = [];
  const waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
    const msg = JSON.parse(raw) as ServerMsg;
    const idx = waiters.findIndex((w) => w.pred(msg));
    if (idx >= 0) { const [w] = waiters.splice(idx, 1); clearTimeout(w.timer); w.resolve(msg); }
    else buf.push(msg);
  });
  return {
    waitFor(pred: (m: ServerMsg) => boolean, label: string, timeoutMs = 4000): Promise<ServerMsg> {
      const i = buf.findIndex(pred);
      if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const wi = waiters.findIndex((w) => w.timer === timer);
          if (wi >= 0) waiters.splice(wi, 1);
          reject(new Error(`timeout: ${label}`));
        }, timeoutMs);
        waiters.push({ pred, resolve, timer });
      });
    },
  };
}

async function connect(id: string, playerId: string) {
  const res = await stubFor(id).fetch(`http://do/api/sessions/${id}?playerId=${playerId}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const inbox = listen(ws);
  await inbox.waitFor((m) => m.type === 'snapshot', 'snapshot');
  return { ws, inbox };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// =============================================================================
// Targeted transition tests (the edges most likely to desync)
// =============================================================================

it('WS mutation makes KV lag, GET stays authoritative, disconnect converges KV', async () => {
  const id = await createSession(120, 0);
  const { ws, inbox } = await connect(id, 'p1');

  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 150, seq: 1 }));
  await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 150, 'ack');

  // DO is authoritative immediately; KV still holds the pre-mutation value.
  expect((await restGet(id)).state.tempo).toBe(150);
  expect((await readKv(id))!.state.tempo).toBe(120);

  // Graceful disconnect flushes DO -> KV.
  ws.close(1000, 'bye');
  for (let i = 0; i < 100; i++) {
    if ((await readKv(id))!.state.tempo === 150) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect((await readKv(id))!.state.tempo).toBe(150);
});

it('REST PUT then WS mutation: DO storage and GET reflect the WS write (last-writer-wins)', async () => {
  const id = await createSession(120, 0);
  const { ws, inbox } = await connect(id, 'p1');

  await restPutState(id, 90, 10); // writes DO + KV, broadcasts snapshot to client
  expect((await restGet(id)).state).toMatchObject({ tempo: 90, swing: 10 });
  expect((await readKv(id))!.state.tempo).toBe(90); // REST write hit KV synchronously

  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 175, seq: 1 }));
  await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 175, 'ack');

  expect((await restGet(id)).state.tempo).toBe(175); // DO authoritative
  expect((await readKv(id))!.state.tempo).toBe(90);  // KV lags the WS write again

  ws.close(1000, 'bye');
});

it('WS mutation -> hibernate -> REST PUT -> GET reflects the REST write', async () => {
  const id = await createSession(120, 0);
  const { ws, inbox } = await connect(id, 'p1');
  ws.send(JSON.stringify({ type: 'set_swing', swing: 40, seq: 1 }));
  await inbox.waitFor((m) => m.type === 'swing_changed' && m.swing === 40, 'ack');

  await ensureRunning(id);
  await evictDurableObject(stubFor(id)); // hibernate

  // REST PUT after a cold start must load-then-replace and stay consistent.
  await restPutState(id, 100, 25);
  expect((await restGet(id)).state).toMatchObject({ tempo: 100, swing: 25 });
  expect((await readKv(id))!.state).toMatchObject({ tempo: 100, swing: 25 });

  ws.close(1000, 'bye');
});

it('PATCH name (KV-only) composes with WS state (DO-only) in the GET merge', async () => {
  const id = await createSession(120, 0);
  const { ws, inbox } = await connect(id, 'p1');

  ws.send(JSON.stringify({ type: 'set_tempo', tempo: 133, seq: 1 }));
  await inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 133, 'ack');
  await restPatchName(id, 'Renamed');

  const got = await restGet(id);
  expect(got.name).toBe('Renamed');     // from KV
  expect(got.state.tempo).toBe(133);    // from DO storage

  ws.close(1000, 'bye');
});

it('multi-client: KV flushes only when the LAST client disconnects', async () => {
  const id = await createSession(120, 0);
  const a = await connect(id, 'A');
  const b = await connect(id, 'B');

  a.ws.send(JSON.stringify({ type: 'set_tempo', tempo: 165, seq: 1 }));
  await a.inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === 165, 'A ack');

  // GET is authoritative regardless of connection count.
  expect((await restGet(id)).state.tempo).toBe(165);

  // A leaves but B is still connected -> no flush, KV stays lagged.
  a.ws.close(1000, 'bye');
  await new Promise((r) => setTimeout(r, 200));
  expect((await readKv(id))!.state.tempo).toBe(120);

  // B (the last) leaves -> flush; KV converges.
  b.ws.close(1000, 'bye');
  for (let i = 0; i < 100; i++) {
    if ((await readKv(id))!.state.tempo === 165) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect((await readKv(id))!.state.tempo).toBe(165);
});

// =============================================================================
// Fuzz: random interleavings of the whole state machine
// =============================================================================

it('fuzz: read-your-writes through the DO holds across any interleaving; KV converges at write/disconnect points', async () => {
  const SEEDS = [1, 7, 42, 1337, 90210, 0xc0ffee, 2024, 555, 31337, 4096];

  for (const seed of SEEDS) {
    const rng = mulberry32(seed);
    const id = await createSession(120, 0);

    // Oracle of the canonical (DO-authoritative) state.
    const canonical = { tempo: 120, swing: 0, name: null as string | null };
    // What KV is expected to hold (only updated at KV-writing events).
    const kvExpect = { tempo: 120, swing: 0, name: null as string | null };

    let conn: { ws: WebSocket; inbox: ReturnType<typeof listen> } | null = null;
    const playerId = `fuzz-${seed}`;
    const opCount = randInt(rng, 10, 18);
    const tag = (op: string, i: number) => `seed=${seed} op#${i}=${op}`;

    for (let i = 0; i < opCount; i++) {
      const roll = rng();

      if (roll < 0.22 && conn) {
        // WS mutation (DO storage only; KV lags)
        if (rng() < 0.5) {
          const tempo = randInt(rng, 60, 180);
          conn.ws.send(JSON.stringify({ type: 'set_tempo', tempo, seq: i + 1 }));
          await conn.inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === tempo, tag('ws_tempo', i));
          canonical.tempo = tempo;
        } else {
          const swing = randInt(rng, 0, 100);
          conn.ws.send(JSON.stringify({ type: 'set_swing', swing, seq: i + 1 }));
          await conn.inbox.waitFor((m) => m.type === 'swing_changed' && m.swing === swing, tag('ws_swing', i));
          canonical.swing = swing;
        }
      } else if (roll < 0.4) {
        // REST PUT (DO + KV)
        const tempo = randInt(rng, 60, 180), swing = randInt(rng, 0, 100);
        await restPutState(id, tempo, swing);
        canonical.tempo = tempo; canonical.swing = swing;
        kvExpect.tempo = tempo; kvExpect.swing = swing;
      } else if (roll < 0.52) {
        // REST PATCH state (DO + KV)
        const tempo = randInt(rng, 60, 180), swing = randInt(rng, 0, 100);
        await restPatchState(id, tempo, swing);
        canonical.tempo = tempo; canonical.swing = swing;
        kvExpect.tempo = tempo; kvExpect.swing = swing;
      } else if (roll < 0.6) {
        // REST PATCH name (KV only)
        const name = `n${randInt(rng, 0, 9999)}`;
        await restPatchName(id, name);
        canonical.name = name; kvExpect.name = name;
      } else if (roll < 0.72) {
        // Hibernate (state survives; socket, if any, resumes)
        await ensureRunning(id);
        await evictDurableObject(stubFor(id));
      } else if (roll < 0.8) {
        // Evict + close sockets
        await ensureRunning(id);
        await evictDurableObject(stubFor(id), { webSockets: 'close' });
        conn = null;
      } else if (roll < 0.9) {
        // Graceful disconnect (flushes KV) -> KV must converge to canonical
        if (conn) {
          conn.ws.close(1000, 'bye');
          conn = null;
          kvExpect.tempo = canonical.tempo; kvExpect.swing = canonical.swing; kvExpect.name = canonical.name;
          for (let k = 0; k < 100; k++) {
            const kv = await readKv(id);
            if (kv && kv.state.tempo === canonical.tempo && kv.state.swing === canonical.swing) break;
            await new Promise((r) => setTimeout(r, 20));
          }
        }
      } else {
        // (Re)connect
        if (!conn) conn = await connect(id, playerId);
      }

      // ---- INVARIANT 1: read-your-writes through the DO, after every op ----
      // NOTE: restGet routes through the DO and triggers ensureStateLoaded(), so
      // it also reloads state on the HTTP path. This fuzz therefore validates the
      // cross-layer *consistency* contract, not the pure-WS-wake reload bug — that
      // path is covered deterministically by eviction-recovery.test.ts (Layer 10.5
      // + the Layer 11 fuzz, which deliberately omits any HTTP call after eviction).
      const got = await restGet(id);
      expect(got.state.tempo, `tempo ${tag('-', i)}`).toBe(canonical.tempo);
      expect(got.state.swing, `swing ${tag('-', i)}`).toBe(canonical.swing);
      expect(got.name, `name ${tag('-', i)}`).toBe(canonical.name);

      // ---- INVARIANT 2: KV convergence at the points where it must hold ----
      const kv = await readKv(id);
      expect(kv, `kv present ${tag('-', i)}`).not.toBeNull();
      expect(kv!.state.tempo, `kv tempo ${tag('-', i)}`).toBe(kvExpect.tempo);
      expect(kv!.state.swing, `kv swing ${tag('-', i)}`).toBe(kvExpect.swing);
      expect(kv!.name, `kv name ${tag('-', i)}`).toBe(kvExpect.name);
    }

    if (conn) conn.ws.close(1000, 'fuzz done');
  }
}, 120_000);
