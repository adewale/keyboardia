/**
 * Overlap fuzz: concurrent multi-client mutation waves against the real
 * Worker + DO + WebSocket stack.
 *
 * The state-machine fuzz in state-machine-fuzz.test.ts awaits every op to
 * completion before the next begins — it explores SEQUENCES. This lane
 * explores OVERLAPS: three real WebSocket clients fire seeded mutation
 * waves with no awaits between sends, so the DO receives genuinely
 * concurrent traffic (the WAL-Reset shape: operations in flight together).
 *
 * Oracles — all generic, none reimplement server logic:
 *   1. Sequence conservation: N mutations in a wave produce exactly the
 *      seqs (prev, prev+N], and EVERY client observes EVERY seq exactly
 *      once. A lost, duplicated, or reused seq fails loudly.
 *   2. Last-broadcast-wins: the final state equals what the server's own
 *      broadcast stream implies (per (track,step) key: the value in the
 *      last step_toggled for that key in seq order; tempo/swing likewise).
 *   3. Cross-client convergence: at quiescence every client's
 *      request_snapshot returns the same state, equal to the REST read.
 *   4. Server invariants hold (debug endpoint invariants.valid).
 *
 * Scoped v1 (bounded): WS mutations only — no REST writes or evictions
 * inside a wave. Eviction seq behavior is covered by
 * seq-regression.test.ts; REST-vs-WS overlap is a named follow-up.
 */
import { env, SELF } from 'cloudflare:test';
import { it, expect, afterEach } from 'vitest';

interface Env {
  SESSIONS: KVNamespace;
  LIVE_SESSIONS: DurableObjectNamespace;
}

const LIVE_SESSIONS = (env as unknown as Env).LIVE_SESSIONS;
const stubFor = (id: string) => LIVE_SESSIONS.get(LIVE_SESSIONS.idFromName(id));

// Same seed-override mechanism as the state-machine fuzz (vitest.config.ts).
const SEED_OVERRIDE = (env as unknown as { FUZZ_SEEDS?: string }).FUZZ_SEEDS;
const SEEDS = SEED_OVERRIDE
  ? SEED_OVERRIDE.split(',').map((s) => Number.parseInt(s.trim(), 10)).filter(Number.isFinite)
  : [11, 23, 37];
const WAVES_PER_SEED = 3;
const OPS_PER_CLIENT_PER_WAVE = 4;
const CLIENTS = 3;
const TIMEOUT_MS = Math.max(60_000, SEEDS.length * 20_000);

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
afterEach(() => {
  for (const ws of sockets.splice(0)) {
    try { ws.close(1000, 'test done'); } catch { /* already closed */ }
  }
});

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
    waitUntil(pred: () => boolean, tag: string, timeoutMs = 10_000): Promise<void> {
      if (pred()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout: ${tag}`)), timeoutMs);
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
  // Consume nothing — just wait for the handshake snapshot so the session is live.
  await inbox.waitUntil(() => inbox.all.some((m) => m.type === 'snapshot'), `handshake ${playerId}`);
  return { ws, inbox, playerId };
}

it('concurrent mutation waves conserve sequence numbers and converge on every client', async () => {
  for (const seed of SEEDS) {
    const rng = mulberry32(seed);

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

    const clients = [];
    for (let c = 0; c < CLIENTS; c++) {
      clients.push(await connect(stub, id, `overlap-${seed}-c${c}`));
    }

    let clientSeqCounter = 0;
    let expectedSeqHigh = 0;

    for (let wave = 0; wave < WAVES_PER_SEED; wave++) {
      // Build the wave: seeded ops for each client, then a seeded shuffle of
      // (client, op) pairs so send order interleaves across connections.
      const sends: { ws: WebSocket; frame: string }[] = [];
      for (const client of clients) {
        for (let k = 0; k < OPS_PER_CLIENT_PER_WAVE; k++) {
          const roll = rng();
          const seq = ++clientSeqCounter;
          let frame: object;
          if (roll < 0.6) {
            frame = {
              type: 'toggle_step',
              trackId: rng() < 0.5 ? 't1' : 't2',
              step: randInt(rng, 0, 15),
              seq,
            };
          } else if (roll < 0.85) {
            frame = { type: 'set_tempo', tempo: randInt(rng, 60, 180), seq };
          } else {
            frame = { type: 'set_swing', swing: randInt(rng, 0, 100), seq };
          }
          sends.push({ ws: client.ws, frame: JSON.stringify(frame) });
        }
      }
      for (let i = sends.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [sends[i], sends[j]] = [sends[j], sends[i]];
      }

      // Fire the whole wave with NO awaits between sends — genuine overlap.
      for (const { ws, frame } of sends) ws.send(frame);

      const waveSize = sends.length;
      const low = expectedSeqHigh;
      expectedSeqHigh += waveSize;

      // Quiescence: every client has observed every seq in (low, high].
      for (const client of clients) {
        await client.inbox.waitUntil(
          () => {
            const seen = new Set(
              client.inbox.seqd().map((m) => m.seq).filter((s): s is number => s !== undefined && s > low),
            );
            return seen.size >= waveSize;
          },
          `seed=${seed} wave=${wave} ${client.playerId} quiescence`,
        );
      }

      // ORACLE 1 — sequence conservation, per client: exactly (low, high],
      // each seq exactly once. Reuse, loss, or duplication fails here.
      for (const client of clients) {
        const seqs = client.inbox
          .seqd()
          .map((m) => m.seq!)
          .filter((s) => s > low)
          .sort((a, b) => a - b);
        expect(seqs, `seed=${seed} wave=${wave} ${client.playerId} seq conservation`).toEqual(
          Array.from({ length: waveSize }, (_, i) => low + i + 1),
        );
      }
    }

    // ORACLE 2 — last-broadcast-wins: fold each client's seq-ordered
    // broadcast stream into expected final values; all clients must imply
    // the same values (they saw identical streams by oracle 1).
    const reference = clients[0].inbox.seqd().sort((a, b) => a.seq! - b.seq!);
    const expectedSteps = new Map<string, boolean>();
    let expectedTempo = 120;
    let expectedSwing = 0;
    for (const m of reference) {
      if (m.type === 'step_toggled') expectedSteps.set(`${m.trackId}:${m.step}`, m.value!);
      if (m.type === 'tempo_changed') expectedTempo = m.tempo!;
      if (m.type === 'swing_changed') expectedSwing = m.swing!;
    }

    // ORACLE 3 — convergence: every client's snapshot and the REST read
    // agree with the broadcast-implied state and with each other.
    const finals: { tempo: number; swing: number; steps: Map<string, boolean> }[] = [];
    for (const client of clients) {
      const before = client.inbox.all.filter((m) => m.type === 'snapshot').length;
      client.ws.send(JSON.stringify({ type: 'request_snapshot' }));
      await client.inbox.waitUntil(
        () => client.inbox.all.filter((m) => m.type === 'snapshot').length > before,
        `seed=${seed} ${client.playerId} final snapshot`,
      );
      const snaps = client.inbox.all.filter((m) => m.type === 'snapshot');
      const state = snaps[snaps.length - 1].state!;
      const steps = new Map<string, boolean>();
      for (const t of state.tracks) t.steps.forEach((v, i) => steps.set(`${t.id}:${i}`, v));
      finals.push({ tempo: state.tempo, swing: state.swing, steps });
    }

    for (const [i, final] of finals.entries()) {
      expect(final.tempo, `seed=${seed} client${i} tempo`).toBe(expectedTempo);
      expect(final.swing, `seed=${seed} client${i} swing`).toBe(expectedSwing);
      for (const [key, value] of expectedSteps) {
        expect(final.steps.get(key), `seed=${seed} client${i} ${key}`).toBe(value);
      }
      expect(final.steps, `seed=${seed} client${i} full grid equals client0`).toEqual(finals[0].steps);
    }

    const restRes = await SELF.fetch(`http://localhost/api/sessions/${id}`);
    const rest = ((await restRes.json()) as { state: { tempo: number; swing: number } }).state;
    expect(rest.tempo, `seed=${seed} REST tempo`).toBe(expectedTempo);
    expect(rest.swing, `seed=${seed} REST swing`).toBe(expectedSwing);

    // ORACLE 4 — server structural invariants.
    const dbg = await stub.fetch(`http://do/api/sessions/${id}/debug`);
    const invariants = ((await dbg.json()) as { invariants: { valid: boolean; violations: string[] } }).invariants;
    expect(invariants.violations, `seed=${seed} invariant violations`).toEqual([]);
    expect(invariants.valid, `seed=${seed} invariants valid`).toBe(true);

    for (const ws of sockets.splice(0)) ws.close(1000, 'seed done');
  }
}, TIMEOUT_MS);
