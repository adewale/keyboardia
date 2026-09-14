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
import { failWithPbtCounterexample } from '../../src/test/pbt-failure';
import { STATE_MACHINE_KNOWN_FAILURES, type StateMachineOp } from './known-failures';
import { resolveFastCheckSeed } from '../../src/test/fast-check-seed';

interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
  FC_SEED: string;
  FUZZ_SEEDS: string;
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
  coverage: ModelCoverage;
}

type SessionAction = StateMachineOp;
type SessionActionKind = SessionAction['kind'];

interface ModelCoverage {
  accepted: number;
  dirtyDisconnects: number;
  byKind: Record<SessionActionKind, number>;
}

function createModelCoverage(): ModelCoverage {
  return {
    accepted: 0,
    dirtyDisconnects: 0,
    byKind: {
      ws_tempo: 0,
      ws_swing: 0,
      rest_put: 0,
      rest_patch_state: 0,
      rest_patch_name: 0,
      hibernate: 0,
      hard_evict: 0,
      disconnect: 0,
      connect: 0,
    },
  };
}

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
  // The socket's readyState is the independent transport observation. A
  // non-null harness reference alone stays truthy when a socket dies.
  const transportConnected = real.connection?.ws.readyState === WebSocket.OPEN;
  expect(transportConnected).toBe(model.connected);
}

class SessionCommand implements fc.AsyncCommand<SessionModel, SessionReal> {
  constructor(readonly action: SessionAction) {}

  check(model: Readonly<SessionModel>): boolean {
    if (this.action.kind === 'ws_tempo' || this.action.kind === 'ws_swing' || this.action.kind === 'disconnect') {
      return model.connected;
    }
    if (this.action.kind === 'connect') return !model.connected;
    return true;
  }

  async run(model: SessionModel, real: SessionReal): Promise<void> {
    const action = this.action;
    real.coverage.accepted += 1;
    real.coverage.byKind[action.kind] += 1;
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
        if (
          model.tempo !== model.kvTempo ||
          model.swing !== model.kvSwing ||
          model.name !== model.kvName
        ) {
          real.coverage.dirtyDisconnects += 1;
        }
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

function replayableActions(commands: { toString(): string }): StateMachineOp[] {
  // CommandsIterable.toString() is fast-check's public replay rendering: it
  // includes only commands that actually ran, followed by optional /*...*/
  // replay metadata. SessionCommand renders each command as JSON, so stripping
  // the metadata and wrapping the comma-separated sequence gives us stable,
  // data-only regression input without reaching into fast-check internals.
  const rendered = commands.toString();
  const metadataStart = rendered.lastIndexOf(' /*');
  const actions = metadataStart === -1 ? rendered : rendered.slice(0, metadataStart);
  return actions.length === 0 ? [] : JSON.parse(`[${actions}]`) as StateMachineOp[];
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

// Preserve main's committed regression seeds while making FC_SEED the shared
// repository default. A soak can replace the list through FUZZ_SEEDS; the
// weekly workflow binds both controls to the same logged run id.
const DEFAULT_REGRESSION_SEEDS = [1, 7, 42, 1337, 90210, 0xc0ffee, 2024, 555, 31337, 4096];
const DEFAULT_MODEL_SEEDS = [...new Set([FAST_CHECK_SEED, ...DEFAULT_REGRESSION_SEEDS])];
const MODEL_SEEDS = parseSeedOverride(
  (env as unknown as Env).FUZZ_SEEDS,
  DEFAULT_MODEL_SEEDS,
);
const MIN_MODEL_CAMPAIGNS = 30;
const RUNS_PER_SEED = Math.ceil(MIN_MODEL_CAMPAIGNS / MODEL_SEEDS.length);
const MODEL_TIMEOUT_MS = Math.max(120_000, MODEL_SEEDS.length * 15_000);

async function createConnectedModelRun(coverage: ModelCoverage): Promise<{
  model: SessionModel;
  real: SessionReal;
}> {
  const id = await createSession(120, 0);
  const playerId = `model-${id}`;
  const connection = await connect(id, playerId);
  return {
    model: {
      tempo: 120,
      swing: 0,
      name: null,
      kvTempo: 120,
      kvSwing: 0,
      kvName: null,
      connected: true,
    },
    real: { id, playerId, connection, sequence: 0, coverage },
  };
}

async function replayKnownFailure(schedule: StateMachineOp[]): Promise<void> {
  const run = await createConnectedModelRun(createModelCoverage());
  try {
    for (const action of schedule) {
      const command = new SessionCommand(action);
      if (command.check(run.model)) await command.run(run.model, run.real);
    }
  } finally {
    run.real.connection?.ws.close(1000, 'known failure replay done');
  }
}

function assertModelCoverage(coverage: ModelCoverage): void {
  const summary = JSON.stringify(coverage);
  expect(coverage.accepted, summary).toBeGreaterThanOrEqual(100);
  expect(coverage.byKind.ws_tempo, summary).toBeGreaterThan(0);
  expect(coverage.byKind.ws_swing, summary).toBeGreaterThan(0);
  expect(coverage.dirtyDisconnects, summary).toBeGreaterThan(0);
}

it('model: read-your-writes through the DO holds across shrunk command sequences; KV converges at write/disconnect points', async () => {
  // Re-run promoted counterexamples before exploring generated schedules.
  for (const [index, schedule] of STATE_MACHINE_KNOWN_FAILURES.entries()) {
    try {
      await replayKnownFailure(schedule);
    } catch (error) {
      throw new Error(`known-failure #${index} regressed: ${(error as Error).message}`);
    }
  }

  const coverage = createModelCoverage();
  for (const seed of MODEL_SEEDS) {
    const details = await fc.check(
      fc.asyncProperty(fc.commands(commandArbs, { maxCommands: 18 }), async (commands) => {
        const run = await createConnectedModelRun(coverage);
        try {
          await fc.asyncModelRun(() => run, commands);
        } finally {
          run.real.connection?.ws.close(1000, 'model done');
        }
      }),
      {
        seed: seed | 0,
        numRuns: RUNS_PER_SEED,
        interruptAfterTimeLimit: Math.max(
          30_000,
          Math.floor(MODEL_TIMEOUT_MS / MODEL_SEEDS.length) - 5_000,
        ),
        markInterruptAsFailure: true,
      },
    );
    if (details.failed) {
      if (details.counterexample) {
        failWithPbtCounterexample(
          'stateMachine',
          replayableActions(details.counterexample[0]),
          details,
        );
      }
      throw new Error(`stateMachine property interrupted before producing a counterexample (seed=${details.seed})`);
    }
  }

  // A total command count can hide a missing transition class. These witnesses
  // keep the fixed and rotating campaigns honest about the WS/KV lifecycle they
  // claim to cover.
  assertModelCoverage(coverage);
}, MODEL_TIMEOUT_MS);
