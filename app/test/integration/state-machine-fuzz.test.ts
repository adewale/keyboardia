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
import { resolveFastCheckSeed } from '../../src/test/fast-check-seed';

interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
  FC_SEED: string;
}

const LIVE_SESSIONS = (env as unknown as Env).LIVE_SESSIONS;
const KV = (env as unknown as Env).SESSIONS;
const seedBinding = (env as unknown as Env).FC_SEED;
if (typeof seedBinding !== 'string') {
  throw new Error('Workers integration config must bind the replayable FC_SEED');
}
const FAST_CHECK_SEED = resolveFastCheckSeed(seedBinding);

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
// Model-based interleavings of the whole state machine
// =============================================================================

type Connection = Awaited<ReturnType<typeof connect>>;

interface SessionModel {
  tempo: number;
  swing: number;
  name: string | null;
  kvTempo: number;
  kvSwing: number;
  kvName: string | null;
  connected: boolean;
}

interface SessionReal {
  id: string;
  playerId: string;
  connection: Connection | null;
  sequence: number;
}

type SessionAction =
  | { kind: 'ws_tempo'; tempo: number }
  | { kind: 'ws_swing'; swing: number }
  | { kind: 'rest_put'; tempo: number; swing: number }
  | { kind: 'rest_patch_state'; tempo: number; swing: number }
  | { kind: 'rest_patch_name'; name: string }
  | { kind: 'hibernate' }
  | { kind: 'hard_evict' }
  | { kind: 'disconnect' }
  | { kind: 'connect' };

async function waitForKvConvergence(id: string, model: SessionModel): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const kv = await readKv(id);
    if (kv && kv.state.tempo === model.tempo && kv.state.swing === model.swing) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function assertSessionModel(model: SessionModel, real: SessionReal): Promise<void> {
  // restGet routes through the DO and triggers ensureStateLoaded(), so this
  // validates cross-layer consistency. Pure WS wake-up remains covered by
  // eviction-recovery.test.ts, which deliberately omits the HTTP reload path.
  const got = await restGet(real.id);
  expect(got.state.tempo).toBe(model.tempo);
  expect(got.state.swing).toBe(model.swing);
  expect(got.name).toBe(model.name);

  const kv = await readKv(real.id);
  expect(kv).not.toBeNull();
  expect(kv!.state.tempo).toBe(model.kvTempo);
  expect(kv!.state.swing).toBe(model.kvSwing);
  expect(kv!.name).toBe(model.kvName);
  expect(real.connection !== null).toBe(model.connected);
}

class SessionCommand implements fc.AsyncCommand<SessionModel, SessionReal> {
  constructor(private readonly action: SessionAction) {}

  check(model: Readonly<SessionModel>): boolean {
    if (this.action.kind === 'ws_tempo' || this.action.kind === 'ws_swing' || this.action.kind === 'disconnect') {
      return model.connected;
    }
    if (this.action.kind === 'connect') return !model.connected;
    return true;
  }

  async run(model: SessionModel, real: SessionReal): Promise<void> {
    const action = this.action;
    switch (action.kind) {
      case 'ws_tempo':
        real.connection!.ws.send(JSON.stringify({ type: 'set_tempo', tempo: action.tempo, seq: ++real.sequence }));
        await real.connection!.inbox.waitFor(
          (message) => message.type === 'tempo_changed' && message.tempo === action.tempo,
          this.toString(),
        );
        model.tempo = action.tempo;
        break;
      case 'ws_swing':
        real.connection!.ws.send(JSON.stringify({ type: 'set_swing', swing: action.swing, seq: ++real.sequence }));
        await real.connection!.inbox.waitFor(
          (message) => message.type === 'swing_changed' && message.swing === action.swing,
          this.toString(),
        );
        model.swing = action.swing;
        break;
      case 'rest_put':
        await restPutState(real.id, action.tempo, action.swing);
        model.tempo = model.kvTempo = action.tempo;
        model.swing = model.kvSwing = action.swing;
        break;
      case 'rest_patch_state':
        await restPatchState(real.id, action.tempo, action.swing);
        model.tempo = model.kvTempo = action.tempo;
        model.swing = model.kvSwing = action.swing;
        break;
      case 'rest_patch_name':
        await restPatchName(real.id, action.name);
        model.name = model.kvName = action.name;
        break;
      case 'hibernate':
        await ensureRunning(real.id);
        await evictDurableObject(stubFor(real.id));
        break;
      case 'hard_evict':
        await ensureRunning(real.id);
        await evictDurableObject(stubFor(real.id), { webSockets: 'close' });
        real.connection = null;
        model.connected = false;
        break;
      case 'disconnect':
        real.connection!.ws.close(1000, 'model disconnect');
        real.connection = null;
        model.connected = false;
        model.kvTempo = model.tempo;
        model.kvSwing = model.swing;
        model.kvName = model.name;
        await waitForKvConvergence(real.id, model);
        break;
      case 'connect':
        real.connection = await connect(real.id, real.playerId);
        model.connected = true;
        break;
    }
    await assertSessionModel(model, real);
  }

  toString(): string {
    return JSON.stringify(this.action);
  }
}

const tempoArb = fc.integer({ min: 60, max: 180 });
const swingArb = fc.integer({ min: 0, max: 100 });
const commandArbs = [
  tempoArb.map((tempo) => new SessionCommand({ kind: 'ws_tempo', tempo })),
  swingArb.map((swing) => new SessionCommand({ kind: 'ws_swing', swing })),
  fc.tuple(tempoArb, swingArb).map(([tempo, swing]) => new SessionCommand({ kind: 'rest_put', tempo, swing })),
  fc.tuple(tempoArb, swingArb).map(([tempo, swing]) => new SessionCommand({ kind: 'rest_patch_state', tempo, swing })),
  fc.integer({ min: 0, max: 9999 }).map((n) => new SessionCommand({ kind: 'rest_patch_name', name: `n${n}` })),
  fc.constant(new SessionCommand({ kind: 'hibernate' })),
  fc.constant(new SessionCommand({ kind: 'hard_evict' })),
  fc.constant(new SessionCommand({ kind: 'disconnect' })),
  fc.constant(new SessionCommand({ kind: 'connect' })),
];

it('model: read-your-writes through the DO holds across shrunk command sequences; KV converges at write/disconnect points', async () => {
  await fc.assert(
    fc.asyncProperty(fc.commands(commandArbs, { maxCommands: 18 }), async (commands) => {
      const id = await createSession(120, 0);
      const real: SessionReal = { id, playerId: `model-${id}`, connection: null, sequence: 0 };
      try {
        await fc.asyncModelRun(() => ({
          model: {
            tempo: 120,
            swing: 0,
            name: null,
            kvTempo: 120,
            kvSwing: 0,
            kvName: null,
            connected: false,
          },
          real,
        }), commands);
      } finally {
        real.connection?.ws.close(1000, 'model done');
      }
    }),
    // Keep at least the exploration budget of the former ten 10-18 step
    // campaigns while gaining command-aware shrinking. `maxCommands` is only
    // an upper bound, so ten runs would execute materially fewer transitions.
    { numRuns: 30, seed: FAST_CHECK_SEED },
  );
}, 120_000);
