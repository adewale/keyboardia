/**
 * Overlap fuzz: concurrent multi-client mutation waves against the real
 * Worker + DO + WebSocket stack.
 *
 * The state-machine fuzz awaits every op to completion before the next
 * begins — it explores SEQUENCES. This lane explores OVERLAPS: three real
 * WebSocket clients fire generated mutation waves with no awaits between
 * sends, so the DO receives genuinely concurrent traffic (the WAL-Reset
 * shape: operations in flight together).
 *
 * Schedules are GENERATED AND SHRUNK BY FAST-CHECK (issue #97, T1): on
 * failure, fast-check minimizes the wave schedule to the smallest failing
 * counterexample and prints it with the seed. Promote that value into
 * known-failures.ts — those replay first on every run. (The previous
 * mulberry32 form explored but could not shrink; hegel-skill mistake #6.)
 *
 * Oracles — all generic, none reimplement server logic:
 *   1. Sequence conservation: N mutations in a wave produce exactly the
 *      seqs (prev, prev+N], and EVERY client observes EVERY seq exactly
 *      once. A lost, duplicated, or reused seq fails loudly (quiescence
 *      throws fast with the observed set, so shrinking stays cheap).
 *   2. Last-broadcast-wins: the final state equals what the server's own
 *      broadcast stream implies.
 *   3. Cross-client convergence: at quiescence every client's
 *      request_snapshot returns the same state, equal to the REST read.
 *   4. Server invariants hold (debug endpoint violations list is empty).
 *
 * Scoped v1 (bounded): WS mutations only — no REST writes or evictions
 * inside a wave. Eviction seq behavior is covered by
 * seq-regression.test.ts; REST-vs-WS overlap is a named follow-up.
 */
import { env, SELF } from 'cloudflare:test';
import { it, expect, afterEach } from 'vitest';
// Resolved from app/node_modules (this sub-package intentionally adds no
// dependency of its own; fast-check is already a repo dev dependency).
import fc from 'fast-check';
import { parseSeedOverride } from '../../src/test/seeded-random';
import { OVERLAP_KNOWN_FAILURES, type OverlapOp, type OverlapSchedule } from './known-failures';

interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
  /** Comma-separated decimal soak seeds; empty/absent = committed regression seeds. */
  FUZZ_SEEDS?: string;
}

const LIVE_SESSIONS = (env as unknown as Env).LIVE_SESSIONS;
const stubFor = (id: string) => LIVE_SESSIONS.get(LIVE_SESSIONS.idFromName(id));

// Soak-mode override. NOTE: the FUZZ_SEEDS binding (vitest.config.ts) drives
// BOTH this lane and state-machine-fuzz.test.ts; the parse fails closed so a
// malformed override can never become a zero-seed vacuous pass.
const SEEDS = parseSeedOverride((env as unknown as Env).FUZZ_SEEDS, [11, 23, 37]);
const RUNS_PER_SEED = 2;
const CLIENTS = 3;
const TIMEOUT_MS = Math.max(90_000, SEEDS.length * 30_000);
// On a genuine failure, bound generation+shrinking so fast-check reports the
// best counterexample found rather than being killed mid-shrink by vitest.
const FC_TIME_LIMIT_MS = Math.floor(TIMEOUT_MS / Math.max(1, SEEDS.length)) - 10_000;

// ---------------------------------------------------------------------------
// Schedule generator (shrinkable): waves of client ops.
// ---------------------------------------------------------------------------

const opArb: fc.Arbitrary<OverlapOp> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant<'toggle'>('toggle'),
      track: fc.constantFrom<'t1' | 't2'>('t1', 't2'),
      step: fc.integer({ min: 0, max: 15 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant<'tempo'>('tempo'),
      tempo: fc.integer({ min: 60, max: 180 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant<'swing'>('swing'),
      swing: fc.integer({ min: 0, max: 100 }),
    }),
  },
);

const scheduleArb: fc.Arbitrary<OverlapSchedule> = fc.array(
  fc.array(opArb, { minLength: 3, maxLength: 12 }),
  { minLength: 1, maxLength: 3 },
);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const track = (id: string) => ({
  id,
  name: `Track ${id}`,
  sampleId: 'kick',
  steps: Array(16).fill(false) as boolean[],
  parameterLocks: Array(16).fill(null),
  volume: 0.8,
  muted: false,
  soloed: false,
  transpose: 0,
  stepCount: 16,
});

const sockets: WebSocket[] = [];
// ws.close() starts async DO work (webSocketClose -> last-player KV flush)
// that outlives synchronous teardown; under singleWorker + shared storage it
// would land inside the next test. Close, then give it a beat to settle.
async function closeAllSockets(reason: string): Promise<void> {
  for (const ws of sockets.splice(0)) {
    try { ws.close(1000, reason); } catch { /* already closed */ }
  }
  await new Promise((r) => setTimeout(r, 20));
}
afterEach(() => closeAllSockets('test done'));

interface ServerMsg {
  type: string;
  seq?: number;
  tempo?: number;
  swing?: number;
  trackId?: string;
  step?: number;
  value?: boolean;
  state?: { tracks: { id: string; steps: boolean[] }[]; tempo: number; swing: number };
  [k: string]: unknown;
}

function listen(ws: WebSocket) {
  const all: ServerMsg[] = [];
  let waiters: { pred: () => boolean; resolve: () => void }[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
    all.push(JSON.parse(raw) as ServerMsg);
    waiters = waiters.filter((w) => {
      if (!w.pred()) return true;
      w.resolve();
      return false;
    });
  });
  return {
    all,
    seqd: () => all.filter((m) => m.seq !== undefined),
    waitUntil(pred: () => boolean, tag: () => string, timeoutMs: number): Promise<void> {
      if (pred()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout: ${tag()}`)), timeoutMs);
        waiters.push({ pred, resolve: () => { clearTimeout(timer); resolve(); } });
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
  const inbox = listen(ws);
  await inbox.waitUntil(() => inbox.all.some((m) => m.type === 'snapshot'), () => `handshake ${playerId}`, 10_000);
  return { ws, inbox, playerId };
}

const opToFrame = (op: OverlapOp, seq: number): string => {
  switch (op.kind) {
    case 'toggle': return JSON.stringify({ type: 'toggle_step', trackId: op.track, step: op.step, seq });
    case 'tempo': return JSON.stringify({ type: 'set_tempo', tempo: op.tempo, seq });
    case 'swing': return JSON.stringify({ type: 'set_swing', swing: op.swing, seq });
  }
};

/**
 * Execute one schedule against a fresh session and run every oracle.
 * Throws (fast) on any violation — fast-check shrinks on the thrown error.
 */
async function runSchedule(schedule: OverlapSchedule): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [track('t1'), track('t2')], tempo: 120, swing: 0, version: 1 },
    }),
  });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { id: string }).id;
  const stub = stubFor(id);

  try {
    const clients = [];
    for (let c = 0; c < CLIENTS; c++) {
      clients.push(await connect(stub, id, `overlap-c${c}`));
    }

    let clientSeqCounter = 0;
    let expectedSeqHigh = 0;

    for (const [waveIndex, wave] of schedule.entries()) {
      // Fire the whole wave with NO awaits between sends — ops round-robin
      // across the three real sockets, genuinely concurrent server-side.
      for (const [i, op] of wave.entries()) {
        clients[i % CLIENTS].ws.send(opToFrame(op, ++clientSeqCounter));
      }

      const low = expectedSeqHigh;
      expectedSeqHigh += wave.length;

      // Quiescence: every client observes every seq in (low, high]. The
      // timeout is short and the error carries the observed set, so a
      // conservation violation fails each shrink candidate in ~3s.
      for (const client of clients) {
        const seen = () => new Set(
          client.inbox.seqd().map((m) => m.seq).filter((s): s is number => s !== undefined && s > low),
        );
        await client.inbox.waitUntil(
          () => seen().size >= wave.length,
          () => `wave=${waveIndex} ${client.playerId} saw seqs [${[...seen()].sort((a, b) => a - b)}] of (${low}, ${expectedSeqHigh}]`,
          3_000,
        );
      }

      // ORACLE 1 — sequence conservation, per client: exactly (low, high].
      for (const client of clients) {
        const seqs = client.inbox
          .seqd()
          .map((m) => m.seq!)
          .filter((s) => s > low)
          .sort((a, b) => a - b);
        expect(seqs, `wave=${waveIndex} ${client.playerId} seq conservation`).toEqual(
          Array.from({ length: wave.length }, (_, i) => low + i + 1),
        );
      }
    }

    // ORACLE 2 — last-broadcast-wins over client 0's seq-ordered stream.
    const reference = clients[0].inbox.seqd().sort((a, b) => a.seq! - b.seq!);
    const expectedSteps = new Map<string, boolean>();
    let expectedTempo = 120;
    let expectedSwing = 0;
    for (const m of reference) {
      if (m.type === 'step_toggled') expectedSteps.set(`${m.trackId}:${m.step}`, m.value!);
      if (m.type === 'tempo_changed') expectedTempo = m.tempo!;
      if (m.type === 'swing_changed') expectedSwing = m.swing!;
    }

    // ORACLE 3 — convergence: snapshots on every client + the REST read.
    const finals: { tempo: number; swing: number; steps: Map<string, boolean> }[] = [];
    for (const client of clients) {
      const before = client.inbox.all.filter((m) => m.type === 'snapshot').length;
      client.ws.send(JSON.stringify({ type: 'request_snapshot' }));
      await client.inbox.waitUntil(
        () => client.inbox.all.filter((m) => m.type === 'snapshot').length > before,
        () => `${client.playerId} final snapshot`,
        5_000,
      );
      const snaps = client.inbox.all.filter((m) => m.type === 'snapshot');
      const state = snaps[snaps.length - 1].state!;
      const steps = new Map<string, boolean>();
      for (const t of state.tracks) t.steps.forEach((v, i) => steps.set(`${t.id}:${i}`, v));
      finals.push({ tempo: state.tempo, swing: state.swing, steps });
    }

    for (const [i, final] of finals.entries()) {
      expect(final.tempo, `client${i} tempo`).toBe(expectedTempo);
      expect(final.swing, `client${i} swing`).toBe(expectedSwing);
      for (const [key, value] of expectedSteps) {
        expect(final.steps.get(key), `client${i} ${key}`).toBe(value);
      }
      expect(final.steps, `client${i} full grid equals client0`).toEqual(finals[0].steps);
    }

    const restRes = await SELF.fetch(`http://localhost/api/sessions/${id}`);
    const rest = ((await restRes.json()) as { state: { tempo: number; swing: number } }).state;
    expect(rest.tempo, 'REST tempo').toBe(expectedTempo);
    expect(rest.swing, 'REST swing').toBe(expectedSwing);

    // ORACLE 4 — server structural invariants.
    const dbg = await stub.fetch(`http://do/api/sessions/${id}/debug`);
    const invariants = ((await dbg.json()) as { invariants: { valid: boolean; violations: string[] } }).invariants;
    expect(invariants.violations, 'invariant violations').toEqual([]);
  } finally {
    await closeAllSockets('schedule done');
  }
}

it('concurrent mutation waves conserve sequence numbers and converge on every client', async () => {
  // Known failures replay first (committed example database, issue #97 T2).
  for (const [i, schedule] of OVERLAP_KNOWN_FAILURES.entries()) {
    try {
      await runSchedule(schedule);
    } catch (e) {
      throw new Error(`known-failure #${i} regressed: ${(e as Error).message}`);
    }
  }

  for (const seed of SEEDS) {
    await fc.assert(
      fc.asyncProperty(scheduleArb, runSchedule),
      {
        seed: seed | 0, // fc seeds are int32; soak values (e.g. a CI run id) fold in
        numRuns: RUNS_PER_SEED,
        interruptAfterTimeLimit: FC_TIME_LIMIT_MS,
        markInterruptAsFailure: true,
      },
    );
  }
}, TIMEOUT_MS);
