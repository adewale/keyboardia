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
import fc from 'fast-check';
import { parseSeedOverride } from '../../src/test/seeded-random';
import { STATE_MACHINE_KNOWN_FAILURES, type StateMachineOp } from './known-failures';

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

// Fixed regression seeds by default; a soak run overrides them via the
// FUZZ_SEEDS binding (see vitest.config.ts). A seed that fails in a soak
// gets promoted into this list with a comment naming what it caught.
// The timeout scales with seed count so a soak batch cannot time out and
// masquerade as an oracle failure (a graceful-disconnect op alone may poll
// KV for up to 2s, so the per-seed budget is generous).
const DEFAULT_SEEDS = [1, 7, 42, 1337, 90210, 0xc0ffee, 2024, 555, 31337, 4096];
// Fail-closed parse: a malformed override (e.g. "abc", or "0xc0ffee" which
// parseInt would silently coerce to 0) throws instead of degrading this lane
// to a zero-seed vacuous pass. NOTE: the FUZZ_SEEDS binding drives BOTH this
// lane and overlap-fuzz.test.ts.
const FUZZ_SEEDS = parseSeedOverride(
  (env as unknown as { FUZZ_SEEDS?: string }).FUZZ_SEEDS,
  DEFAULT_SEEDS,
);
const FUZZ_TIMEOUT_MS = Math.max(120_000, FUZZ_SEEDS.length * 12_000);

// Schedules are generated and shrunk by fast-check (issue #97, T1): on
// failure the op sequence minimizes to the smallest failing schedule, and
// known failures in known-failures.ts replay first as a committed example
// database (T2). Per-op value randomness also comes from fast-check, so
// individual decisions shrink too (hegel-skill mistake #6 retired).

const smOpArb: fc.Arbitrary<StateMachineOp> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant<'ws_tempo'>('ws_tempo'), tempo: fc.integer({ min: 60, max: 180 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant<'ws_swing'>('ws_swing'), swing: fc.integer({ min: 0, max: 100 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant<'rest_put'>('rest_put'), tempo: fc.integer({ min: 60, max: 180 }), swing: fc.integer({ min: 0, max: 100 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant<'rest_patch'>('rest_patch'), tempo: fc.integer({ min: 60, max: 180 }), swing: fc.integer({ min: 0, max: 100 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant<'patch_name'>('patch_name'), n: fc.nat(9999) }) },
  { weight: 1, arbitrary: fc.constant<StateMachineOp>({ kind: 'hibernate' }) },
  { weight: 1, arbitrary: fc.constant<StateMachineOp>({ kind: 'evict_close' }) },
  { weight: 1, arbitrary: fc.constant<StateMachineOp>({ kind: 'disconnect' }) },
  { weight: 2, arbitrary: fc.constant<StateMachineOp>({ kind: 'reconnect' }) },
);
const smScheduleArb = fc.array(smOpArb, { minLength: 8, maxLength: 18 });

/** Execute one schedule; assert both cross-layer invariants after every op. */
async function runStateMachineSchedule(ops: StateMachineOp[]): Promise<void> {
  const id = await createSession(120, 0);

  // Oracle of the canonical (DO-authoritative) state.
  const canonical = { tempo: 120, swing: 0, name: null as string | null };
  // What KV is expected to hold (only updated at KV-writing events).
  const kvExpect = { tempo: 120, swing: 0, name: null as string | null };

  let conn: { ws: WebSocket; inbox: ReturnType<typeof listen> } | null = null;
  const playerId = 'fuzz-fc';

  try {
    for (const [i, op] of ops.entries()) {
      const tag = (label: string) => `op#${i}=${op.kind} ${label}`;

      switch (op.kind) {
        case 'ws_tempo':
          if (conn) {
            conn.ws.send(JSON.stringify({ type: 'set_tempo', tempo: op.tempo, seq: i + 1 }));
            await conn.inbox.waitFor((m) => m.type === 'tempo_changed' && m.tempo === op.tempo, tag('ws_tempo'));
            canonical.tempo = op.tempo;
          }
          break;
        case 'ws_swing':
          if (conn) {
            conn.ws.send(JSON.stringify({ type: 'set_swing', swing: op.swing, seq: i + 1 }));
            await conn.inbox.waitFor((m) => m.type === 'swing_changed' && m.swing === op.swing, tag('ws_swing'));
            canonical.swing = op.swing;
          }
          break;
        case 'rest_put':
          await restPutState(id, op.tempo, op.swing);
          canonical.tempo = op.tempo; canonical.swing = op.swing;
          kvExpect.tempo = op.tempo; kvExpect.swing = op.swing;
          break;
        case 'rest_patch':
          await restPatchState(id, op.tempo, op.swing);
          canonical.tempo = op.tempo; canonical.swing = op.swing;
          kvExpect.tempo = op.tempo; kvExpect.swing = op.swing;
          break;
        case 'patch_name': {
          const name = `n${op.n}`;
          await restPatchName(id, name);
          canonical.name = name; kvExpect.name = name;
          break;
        }
        case 'hibernate':
          // State survives; the socket, if any, resumes on the same connection.
          await ensureRunning(id);
          await evictDurableObject(stubFor(id));
          break;
        case 'evict_close':
          await ensureRunning(id);
          await evictDurableObject(stubFor(id), { webSockets: 'close' });
          conn = null;
          break;
        case 'disconnect':
          // Graceful disconnect flushes KV -> KV must converge to canonical.
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
          break;
        case 'reconnect':
          if (!conn) conn = await connect(id, playerId);
          break;
      }

      // ---- INVARIANT 1: read-your-writes through the DO, after every op ----
      // NOTE: restGet routes through the DO and triggers ensureStateLoaded(), so
      // it also reloads state on the HTTP path. This fuzz therefore validates the
      // cross-layer *consistency* contract, not the pure-WS-wake reload bug — that
      // path is covered deterministically by eviction-recovery.test.ts.
      const got = await restGet(id);
      expect(got.state.tempo, tag('tempo')).toBe(canonical.tempo);
      expect(got.state.swing, tag('swing')).toBe(canonical.swing);
      expect(got.name, tag('name')).toBe(canonical.name);

      // ---- INVARIANT 2: KV convergence at the points where it must hold ----
      const kv = await readKv(id);
      expect(kv, tag('kv present')).not.toBeNull();
      expect(kv!.state.tempo, tag('kv tempo')).toBe(kvExpect.tempo);
      expect(kv!.state.swing, tag('kv swing')).toBe(kvExpect.swing);
      expect(kv!.name, tag('kv name')).toBe(kvExpect.name);
    }
  } finally {
    if (conn) conn.ws.close(1000, 'fuzz done');
  }
}

it('fuzz: read-your-writes through the DO holds across any interleaving; KV converges at write/disconnect points', async () => {
  // Known failures replay first (committed example database, issue #97 T2).
  for (const [i, schedule] of STATE_MACHINE_KNOWN_FAILURES.entries()) {
    try {
      await runStateMachineSchedule(schedule);
    } catch (e) {
      throw new Error(`known-failure #${i} regressed: ${(e as Error).message}`);
    }
  }

  for (const seed of FUZZ_SEEDS) {
    await fc.assert(
      fc.asyncProperty(smScheduleArb, runStateMachineSchedule),
      {
        seed: seed | 0, // fc seeds are int32; soak values (e.g. a CI run id) fold in
        numRuns: 1,
        interruptAfterTimeLimit: Math.max(30_000, Math.floor(FUZZ_TIMEOUT_MS / FUZZ_SEEDS.length) - 5_000),
        markInterruptAsFailure: true,
      },
    );
  }
}, FUZZ_TIMEOUT_MS);
