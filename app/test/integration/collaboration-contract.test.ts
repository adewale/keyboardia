/**
 * Real collaboration contract.
 *
 * This suite intentionally crosses the Worker, Durable Object, durable storage,
 * and WebSocket boundaries. It replaces the former MockLiveSession tests: a
 * protocol change in production must be observed here without updating a
 * parallel server implementation.
 */
import { afterEach, expect, it } from 'vitest';
import { env, evictDurableObject, SELF } from 'cloudflare:test';
import { setTrackInstrument } from '../../src/shared/track-instrument';

interface Env {
  LIVE_SESSIONS: DurableObjectNamespace;
}

interface ServerMessage {
  type: string;
  seq?: number;
  clientSeq?: number;
  trackId?: string;
  track?: SessionTrack;
  step?: number;
  value?: boolean;
  playerId?: string;
  serverSeq?: number;
  effects?: EffectsState;
  state?: {
    tracks: SessionTrack[];
    tempo: number;
    swing: number;
    effects?: EffectsState;
    loopRegion?: { start: number; end: number } | null;
  };
  players?: Array<{ id: string }>;
  playingPlayerIds?: string[];
}

interface SessionTrack {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: null[];
  volume: number;
  muted: boolean;
  soloed: boolean;
  transpose: number;
  stepCount: number;
}

interface EffectsState {
  bypass: boolean;
  reverb: { decay: number; wet: number };
  delay: { time: string; feedback: number; wet: number };
  chorus: { frequency: number; depth: number; wet: number };
  distortion: { amount: number; wet: number };
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

function track(id: string, name = 'Shared Track'): SessionTrack {
  return {
    id,
    name,
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

function initialState() {
  return {
    tracks: [track('shared-track')],
    tempo: 120,
    swing: 0,
    version: 1,
  };
}

async function createSession(): Promise<string> {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: initialState() }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

function listen(socket: WebSocket) {
  const buffered: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
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
    waitFor(
      predicate: (message: ServerMessage) => boolean,
      label: string,
      timeoutMs = 4000,
    ): Promise<ServerMessage> {
      const bufferedIndex = buffered.findIndex(predicate);
      if (bufferedIndex !== -1) {
        return Promise.resolve(buffered.splice(bufferedIndex, 1)[0]);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.timer === timer);
          if (waiterIndex !== -1) waiters.splice(waiterIndex, 1);
          reject(new Error(`Timed out waiting for ${label}`));
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timer });
      });
    },
  };
}

async function connect(sessionId: string, playerId: string) {
  const response = await SELF.fetch(
    `http://localhost/api/sessions/${sessionId}/ws?playerId=${playerId}`,
    { headers: { Upgrade: 'websocket' } },
  );
  expect(response.status).toBe(101);

  const socket = response.webSocket!;
  sockets.push(socket);
  socket.accept();
  const inbox = listen(socket);
  const snapshot = await inbox.waitFor(
    (message) => message.type === 'snapshot',
    `${playerId} initial snapshot`,
  );
  return { socket, inbox, snapshot };
}

it('greets every collaborator with the production snapshot protocol', async () => {
  const sessionId = await createSession();
  const collaborator = await connect(sessionId, 'player-a');

  expect(collaborator.snapshot).toMatchObject({
    type: 'snapshot',
    playerId: 'player-a',
    serverSeq: 0,
    state: {
      tempo: 120,
      swing: 0,
      tracks: [{ id: 'shared-track' }],
    },
    players: [{ id: 'player-a' }],
    playingPlayerIds: [],
  });
});

it('merges different-cell edits and orders same-cell edits without replacing the session', async () => {
  const sessionId = await createSession();
  const a = await connect(sessionId, 'player-a');
  const b = await connect(sessionId, 'player-b');

  a.socket.send(JSON.stringify({
    type: 'toggle_step',
    trackId: 'shared-track',
    step: 0,
    seq: 101,
  }));
  const firstOnA = await a.inbox.waitFor(
    (message) => message.type === 'step_toggled' && message.clientSeq === 101,
    'first edit on A',
  );
  const firstOnB = await b.inbox.waitFor(
    (message) => message.type === 'step_toggled' && message.clientSeq === 101,
    'first edit on B',
  );

  b.socket.send(JSON.stringify({
    type: 'toggle_step',
    trackId: 'shared-track',
    step: 1,
    seq: 201,
  }));
  const secondOnA = await a.inbox.waitFor(
    (message) => message.type === 'step_toggled' && message.clientSeq === 201,
    'second edit on A',
  );
  const secondOnB = await b.inbox.waitFor(
    (message) => message.type === 'step_toggled' && message.clientSeq === 201,
    'second edit on B',
  );

  expect(firstOnA).toMatchObject({ trackId: 'shared-track', step: 0, value: true });
  expect(firstOnB).toEqual(firstOnA);
  expect(secondOnA).toMatchObject({ trackId: 'shared-track', step: 1, value: true });
  expect(secondOnB).toEqual(secondOnA);
  expect(secondOnA.seq).toBe((firstOnA.seq ?? 0) + 1);

  a.socket.send(JSON.stringify({
    type: 'toggle_step',
    trackId: 'shared-track',
    step: 2,
    seq: 102,
  }));
  const sameCellFirst = await a.inbox.waitFor(
    (message) => message.type === 'step_toggled' && message.clientSeq === 102,
    'same-cell first edit',
  );

  b.socket.send(JSON.stringify({
    type: 'toggle_step',
    trackId: 'shared-track',
    step: 2,
    seq: 202,
  }));
  const sameCellLast = await b.inbox.waitFor(
    (message) => message.type === 'step_toggled' && message.clientSeq === 202,
    'same-cell last edit',
  );

  expect(sameCellFirst.value).toBe(true);
  expect(sameCellLast.value).toBe(false);
  expect(sameCellLast.seq).toBe((sameCellFirst.seq ?? 0) + 1);

  const response = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
  expect(response.status).toBe(200);
  const session = (await response.json()) as {
    state: { tracks: Array<{ id: string; steps: boolean[] }> };
  };
  const track = session.state.tracks.find(({ id }) => id === 'shared-track');
  expect(track?.steps.slice(0, 3)).toEqual([true, true, false]);
});

it('shares playback presence through play, stop, join, and disconnect', async () => {
  const sessionId = await createSession();
  const a = await connect(sessionId, 'player-a');
  const b = await connect(sessionId, 'player-b');

  a.socket.send(JSON.stringify({ type: 'play' }));
  const startedOnA = await a.inbox.waitFor(
    (message) => message.type === 'playback_started' && message.playerId === 'player-a',
    'A playback start',
  );
  const startedOnB = await b.inbox.waitFor(
    (message) => message.type === 'playback_started' && message.playerId === 'player-a',
    'B sees A playback start',
  );
  expect(startedOnB).toEqual(startedOnA);

  // Repeating play is idempotent in the canonical presence set even though
  // collaborators still receive the fresh playback timing event.
  a.socket.send(JSON.stringify({ type: 'play' }));
  await a.inbox.waitFor(
    (message) => message.type === 'playback_started' && message.playerId === 'player-a',
    'A duplicate playback start',
  );
  await b.inbox.waitFor(
    (message) => message.type === 'playback_started' && message.playerId === 'player-a',
    'B sees A duplicate playback start',
  );

  b.socket.send(JSON.stringify({ type: 'play' }));
  await a.inbox.waitFor(
    (message) => message.type === 'playback_started' && message.playerId === 'player-b',
    'A sees B playback start',
  );
  await b.inbox.waitFor(
    (message) => message.type === 'playback_started' && message.playerId === 'player-b',
    'B playback start',
  );

  const c = await connect(sessionId, 'player-c');
  expect(c.snapshot.playingPlayerIds?.sort()).toEqual(['player-a', 'player-b']);

  a.socket.send(JSON.stringify({ type: 'stop' }));
  await expect(b.inbox.waitFor(
    (message) => message.type === 'playback_stopped' && message.playerId === 'player-a',
    'B sees A playback stop',
  )).resolves.toMatchObject({ type: 'playback_stopped', playerId: 'player-a' });
  await expect(c.inbox.waitFor(
    (message) => message.type === 'playback_stopped' && message.playerId === 'player-a',
    'C sees A playback stop',
  )).resolves.toMatchObject({ type: 'playback_stopped', playerId: 'player-a' });

  a.socket.send(JSON.stringify({ type: 'play' }));
  await b.inbox.waitFor(
    (message) => message.type === 'playback_started' && message.playerId === 'player-a',
    'B sees A restart playback',
  );
  a.socket.close(1000, 'leave while playing');

  await expect(b.inbox.waitFor(
    (message) => message.type === 'playback_stopped' && message.playerId === 'player-a',
    'disconnect releases A playback presence',
  )).resolves.toMatchObject({ type: 'playback_stopped', playerId: 'player-a' });
  await expect(b.inbox.waitFor(
    (message) => message.type === 'player_left' && message.playerId === 'player-a',
    'disconnect removes A',
  )).resolves.toMatchObject({ type: 'player_left', playerId: 'player-a' });

  const d = await connect(sessionId, 'player-d');
  expect(d.snapshot.playingPlayerIds).not.toContain('player-a');
  expect(d.snapshot.playingPlayerIds).toContain('player-b');
  expect(d.snapshot.players?.map(({ id }) => id)).not.toContain('player-a');
});

it('acknowledges duplicate track operations without duplicating or losing state', async () => {
  const sessionId = await createSession();
  const a = await connect(sessionId, 'player-a');
  const b = await connect(sessionId, 'player-b');
  const duplicate = track('shared-track', 'Duplicate should not replace the original');

  a.socket.send(JSON.stringify({ type: 'add_track', track: duplicate, seq: 301 }));
  const duplicateOnA = await a.inbox.waitFor(
    (message) => message.type === 'track_added' && message.clientSeq === 301,
    'duplicate add acknowledgement on A',
  );
  const duplicateOnB = await b.inbox.waitFor(
    (message) => message.type === 'track_added' && message.clientSeq === 301,
    'duplicate add acknowledgement on B',
  );
  expect(duplicateOnB).toEqual(duplicateOnA);

  let response = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
  let session = (await response.json()) as { state: { tracks: SessionTrack[] } };
  expect(session.state.tracks).toHaveLength(1);
  expect(session.state.tracks[0].name).toBe('Shared Track');

  a.socket.send(JSON.stringify({ type: 'delete_track', trackId: 'shared-track', seq: 302 }));
  await a.inbox.waitFor(
    (message) => message.type === 'track_deleted' && message.clientSeq === 302,
    'first delete acknowledgement',
  );

  b.socket.send(JSON.stringify({ type: 'delete_track', trackId: 'shared-track', seq: 303 }));
  const repeatedDeleteOnA = await a.inbox.waitFor(
    (message) => message.type === 'track_deleted' && message.clientSeq === 303,
    'repeated delete acknowledgement on A',
  );
  const repeatedDeleteOnB = await b.inbox.waitFor(
    (message) => message.type === 'track_deleted' && message.clientSeq === 303,
    'repeated delete acknowledgement on B',
  );
  expect(repeatedDeleteOnB).toEqual(repeatedDeleteOnA);

  response = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
  session = (await response.json()) as { state: { tracks: SessionTrack[] } };
  expect(session.state.tracks).toEqual([]);
});

it('broadcasts validated effects and recovers them from durable storage', async () => {
  const sessionId = await createSession();
  const a = await connect(sessionId, 'player-a');
  const b = await connect(sessionId, 'player-b');
  const requestedEffects: EffectsState = {
    bypass: true,
    reverb: { decay: 20, wet: 1.2 },
    delay: { time: 'invalid', feedback: 2, wet: -1 },
    chorus: { frequency: 20, depth: 2, wet: 0.4 },
    distortion: { amount: -1, wet: 0.6 },
  };

  a.socket.send(JSON.stringify({
    type: 'set_effects',
    effects: requestedEffects,
    seq: 401,
  }));
  const effectsOnA = await a.inbox.waitFor(
    (message) => message.type === 'effects_changed' && message.clientSeq === 401,
    'effects acknowledgement on A',
  );
  const effectsOnB = await b.inbox.waitFor(
    (message) => message.type === 'effects_changed' && message.clientSeq === 401,
    'effects acknowledgement on B',
  );
  expect(effectsOnB).toEqual(effectsOnA);
  expect(effectsOnA.effects).toEqual({
    bypass: true,
    reverb: { decay: 10, wet: 1 },
    delay: { time: '8n', feedback: 0.95, wet: 0 },
    chorus: { frequency: 10, depth: 1, wet: 0.4 },
    distortion: { amount: 0, wet: 0.6 },
  });

  const namespace = (env as unknown as Env).LIVE_SESSIONS;
  const stub = namespace.get(namespace.idFromName(sessionId));
  await evictDurableObject(stub);

  const response = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
  expect(response.status).toBe(200);
  const session = (await response.json()) as { state: { effects?: EffectsState } };
  expect(session.state.effects).toEqual(effectsOnA.effects);
});

it('accepts ten collaborators and rejects the eleventh through the Worker route', async () => {
  const sessionId = await createSession();
  for (let index = 0; index < 10; index++) {
    await connect(sessionId, `player-${index}`);
  }

  const overflow = await SELF.fetch(
    `http://localhost/api/sessions/${sessionId}/ws?playerId=player-overflow`,
    { headers: { Upgrade: 'websocket' } },
  );
  expect(overflow.status).toBe(503);
  expect(overflow.headers.get('Access-Control-Allow-Origin')).toBe('*');
  await expect(overflow.text()).resolves.toContain('Session full');
});

it('keeps collaborative state that a REST replacement does not carry', async () => {
  const sessionId = await createSession();
  const a = await connect(sessionId, 'player-a');

  a.socket.send(JSON.stringify({
    type: 'set_effects',
    effects: {
      bypass: false,
      reverb: { decay: 4, wet: 0.5 },
      delay: { time: '8n', feedback: 0.3, wet: 0.2 },
      chorus: { frequency: 2, depth: 0.4, wet: 0.1 },
      distortion: { amount: 0.25, wet: 0.3 },
    },
    seq: 501,
  }));
  const acknowledged = await a.inbox.waitFor(
    (message) => message.type === 'effects_changed' && message.clientSeq === 501,
    'effects acknowledgement',
  );

  a.socket.send(JSON.stringify({
    type: 'set_scale',
    scale: { root: 'C', scaleId: 'minor', locked: true },
    seq: 502,
  }));
  await a.inbox.waitFor(
    (message) => message.type === 'scale_changed' && message.clientSeq === 502,
    'scale acknowledgement',
  );

  // saveSessionNow in the browser PUTs exactly these four fields. Effects and
  // scale only ever arrive over the WebSocket, so a replacement that dropped
  // them would erase collaborative state on the next autosave.
  const replace = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: { tracks: [track('shared-track')], tempo: 128, swing: 0, version: 1 },
    }),
  });
  expect(replace.status).toBe(200);

  const response = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
  expect(response.status).toBe(200);
  const session = (await response.json()) as {
    state: {
      tempo: number;
      effects?: EffectsState;
      scale?: { root: string; scaleId: string; locked: boolean };
    };
  };
  expect(session.state.tempo).toBe(128);
  expect(session.state.effects).toEqual(acknowledged.effects);
  expect(session.state.scale).toEqual({ root: 'C', scaleId: 'minor', locked: true });
});

it('offers an existing loop region to a collaborator who joins later', async () => {
  const sessionId = await createSession();
  const a = await connect(sessionId, 'player-a');

  a.socket.send(JSON.stringify({
    type: 'set_loop_region',
    region: { start: 4, end: 12 },
    seq: 601,
  }));
  await a.inbox.waitFor(
    (message) => message.type === 'loop_region_changed',
    'loop region acknowledgement',
  );

  // A late joiner only learns the loop region from the snapshot; it receives
  // no loop_region_changed for a region set before it connected.
  const b = await connect(sessionId, 'player-b');
  expect(b.snapshot.state?.loopRegion).toEqual({ start: 4, end: 12 });

  // And it survives hibernation, so a reload gets it from storage too.
  const namespace = (env as unknown as Env).LIVE_SESSIONS;
  const stub = namespace.get(namespace.idFromName(sessionId));
  await evictDurableObject(stub);

  const response = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
  expect(response.status).toBe(200);
  const session = (await response.json()) as {
    state: { loopRegion?: { start: number; end: number } | null };
  };
  expect(session.state.loopRegion).toEqual({ start: 4, end: 12 });
});

it('reports live Durable Object state through the debug route', async () => {
  const sessionId = await createSession();
  const a = await connect(sessionId, 'player-a');
  await connect(sessionId, 'player-b');

  a.socket.send(JSON.stringify({ type: 'play' }));
  await a.inbox.waitFor(
    (message) => message.type === 'playback_started' && message.playerId === 'player-a',
    'playback start before debug read',
  );

  const response = await SELF.fetch(
    `http://localhost/api/debug/durable-object/${sessionId}`,
  );
  expect(response.status).toBe(200);
  const debug = (await response.json()) as {
    connectedPlayers: number;
    players: Array<{ id: string }>;
    playingPlayerIds: string[];
    playingCount: number;
    invariants: { valid: boolean; violations: string[] };
  };

  expect(debug.connectedPlayers).toBe(2);
  expect(debug.players.map(({ id }) => id).sort()).toEqual(['player-a', 'player-b']);
  expect(debug.playingPlayerIds).toEqual(['player-a']);
  expect(debug.playingCount).toBe(1);
  expect(debug.invariants.valid).toBe(true);
  expect(debug.invariants.violations).toEqual([]);
});

it('rejects a WebSocket route request that is not an upgrade', async () => {
  const sessionId = await createSession();

  const response = await SELF.fetch(`http://localhost/api/sessions/${sessionId}/ws`);
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({ error: 'Not found' });

  // The Durable Object answers only upgrades, debug reads, and the three REST
  // methods the Worker forwards. Anything else falls through to 404 rather
  // than reaching a handler that mutates the session.
  const namespace = (env as unknown as Env).LIVE_SESSIONS;
  const stub = namespace.get(namespace.idFromName(sessionId));
  const unsupported = await stub.fetch(
    `http://placeholder/api/sessions/${sessionId}`,
    { method: 'DELETE' },
  );
  expect(unsupported.status).toBe(404);
  await unsupported.text();
});

// ============================================================================
// Change Instrument (issue #63)
//
// The browser, the WebSocket protocol, and MCP all run one shared operation
// (src/shared/track-instrument.ts). These tests pin the WebSocket half of that
// parity against the real Durable Object; app/test/integration/mcp-journeys.test.ts
// pins the MCP half. See specs/CHANGE-INSTRUMENT.md.
// ============================================================================

/** A track carrying the kind of work an instrument change must not destroy. */
function workedOnTrack(): SessionTrack {
  const worked = track('shared-track', 'Ada’s Lead');
  worked.sampleId = 'tone:fm-bass';
  worked.steps[0] = true;
  worked.steps[6] = true;
  worked.parameterLocks[6] = null;
  worked.volume = 0.42;
  worked.transpose = -5;
  worked.stepCount = 12;
  return worked;
}

async function createSessionWith(tracks: SessionTrack[]): Promise<string> {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { ...initialState(), tracks } }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function readTracks(sessionId: string): Promise<SessionTrack[]> {
  const response = await SELF.fetch(`http://localhost/api/sessions/${sessionId}`);
  return ((await response.json()) as { state: { tracks: SessionTrack[] } }).state.tracks;
}

it('changes a track instrument for every collaborator without disturbing the track', async () => {
  const sessionId = await createSessionWith([workedOnTrack()]);
  const a = await connect(sessionId, 'player-a');
  const b = await connect(sessionId, 'player-b');

  a.socket.send(JSON.stringify({
    type: 'set_track_instrument',
    trackId: 'shared-track',
    sampleId: 'sampled:808-kick',
    seq: 601,
  }));

  const onA = await a.inbox.waitFor(
    (message) => message.type === 'track_sample_set' && message.clientSeq === 601,
    'instrument change acknowledgement on A',
  );
  const onB = await b.inbox.waitFor(
    (message) => message.type === 'track_sample_set',
    'instrument change broadcast on B',
  );

  // A collaborator sees the change without asking for a new snapshot.
  expect(onB).toMatchObject({
    type: 'track_sample_set',
    trackId: 'shared-track',
    sampleId: 'sampled:808-kick',
    playerId: 'player-a',
  });
  expect(onA).toMatchObject({ sampleId: 'sampled:808-kick' });

  const [persisted] = await readTracks(sessionId);
  expect(persisted.sampleId).toBe('sampled:808-kick');
  // The whole point of the operation: only the sound source moved.
  expect(persisted.id).toBe('shared-track');
  expect(persisted.name).toBe('Ada’s Lead');
  expect(persisted.steps[0]).toBe(true);
  expect(persisted.steps[6]).toBe(true);
  expect(persisted.volume).toBe(0.42);
  expect(persisted.transpose).toBe(-5);
  expect(persisted.stepCount).toBe(12);
});

it('keeps the legacy rollout envelope validated, name-safe, and acknowledged on no-op', async () => {
  const withFm = workedOnTrack();
  (withFm as SessionTrack & { fmParams?: unknown }).fmParams = {
    harmonicity: 9,
    modulationIndex: 19,
  };
  const sessionId = await createSessionWith([withFm]);
  const a = await connect(sessionId, 'player-a');

  a.socket.send(JSON.stringify({
    type: 'set_track_sample',
    trackId: 'shared-track',
    sampleId: 'sampled:808-kick',
    name: 'Hostile overwrite',
    seq: 609,
  }));

  expect(await a.inbox.waitFor(
    (message) => message.type === 'track_sample_set' && message.clientSeq === 609,
    'rollout-compatible instrument acknowledgement',
  )).toMatchObject({
    type: 'track_sample_set',
    sampleId: 'sampled:808-kick',
    name: 'Ada’s Lead',
  });

  let [persisted] = await readTracks(sessionId);
  expect(persisted.name).toBe('Ada’s Lead');
  expect((persisted as SessionTrack & { fmParams?: unknown }).fmParams).toBeUndefined();

  // The optimistic client still tracks this mutation, so an identical retry
  // needs an ordered acknowledgement even though storage does not change.
  a.socket.send(JSON.stringify({
    type: 'set_track_sample',
    trackId: 'shared-track',
    sampleId: 'sampled:808-kick',
    name: 'Hostile overwrite',
    seq: 610,
  }));
  expect(await a.inbox.waitFor(
    (message) => message.type === 'track_sample_set' && message.clientSeq === 610,
    'no-op instrument acknowledgement',
  )).toMatchObject({ name: 'Ada’s Lead' });

  [persisted] = await readTracks(sessionId);
  expect(persisted.name).toBe('Ada’s Lead');
});

it('drops engine-scoped parameters the new instrument cannot interpret', async () => {
  const withFm = workedOnTrack();
  (withFm as SessionTrack & { fmParams?: unknown }).fmParams = {
    harmonicity: 9,
    modulationIndex: 19,
  };
  const sessionId = await createSessionWith([withFm]);
  const a = await connect(sessionId, 'player-a');

  a.socket.send(JSON.stringify({
    type: 'set_track_instrument',
    trackId: 'shared-track',
    sampleId: 'tone:fm-bell',
    seq: 602,
  }));
  await a.inbox.waitFor(
    (message) => message.type === 'track_sample_set' && message.clientSeq === 602,
    'instrument change acknowledgement',
  );

  const [persisted] = await readTracks(sessionId);
  expect(persisted.sampleId).toBe('tone:fm-bell');
  // Bass-tuned FM depth must not follow the track onto a bell.
  expect((persisted as SessionTrack & { fmParams?: unknown }).fmParams).toBeUndefined();
});

it('drops an instrument change the catalog does not know, without mutating', async () => {
  const sessionId = await createSessionWith([workedOnTrack()]);
  const a = await connect(sessionId, 'player-a');

  a.socket.send(JSON.stringify({
    type: 'set_track_instrument',
    trackId: 'shared-track',
    sampleId: 'definitely-not-an-instrument',
    seq: 603,
  }));
  // A rejected message must produce no broadcast at all. Proven by sending a
  // valid follow-up and showing it is the first thing that comes back.
  a.socket.send(JSON.stringify({
    type: 'set_track_instrument',
    trackId: 'shared-track',
    sampleId: 'kick',
    seq: 604,
  }));

  const next = await a.inbox.waitFor(
    (message) => message.type === 'track_sample_set',
    'the valid follow-up broadcast',
  );
  expect(next).toMatchObject({ sampleId: 'kick', clientSeq: 604 });

  const [persisted] = await readTracks(sessionId);
  expect(persisted.sampleId).toBe('kick');
});

it('drops an instrument change for a track that does not exist', async () => {
  const sessionId = await createSessionWith([workedOnTrack()]);
  const a = await connect(sessionId, 'player-a');

  a.socket.send(JSON.stringify({
    type: 'set_track_instrument',
    trackId: 'no-such-track',
    sampleId: 'kick',
    seq: 605,
  }));
  a.socket.send(JSON.stringify({ type: 'set_tempo', tempo: 128, seq: 606 }));

  await a.inbox.waitFor(
    (message) => message.type === 'tempo_changed' && message.clientSeq === 606,
    'the follow-up tempo change',
  );

  const tracks = await readTracks(sessionId);
  expect(tracks).toHaveLength(1);
  expect(tracks[0].sampleId).toBe('tone:fm-bass');
});

it('refuses an instrument change on a published session', async () => {
  const sourceId = await createSessionWith([workedOnTrack()]);
  const publishResponse = await SELF.fetch(
    `http://localhost/api/sessions/${sourceId}/publish`,
    { method: 'POST' },
  );
  expect(publishResponse.status).toBe(201);
  const { id: publishedId } = (await publishResponse.json()) as { id: string };

  const a = await connect(publishedId, 'player-a');
  expect(a.snapshot).toMatchObject({ immutable: true });

  a.socket.send(JSON.stringify({
    type: 'set_track_instrument',
    trackId: 'shared-track',
    sampleId: 'kick',
    seq: 607,
  }));

  const error = await a.inbox.waitFor(
    (message) => message.type === 'error',
    'published-session rejection',
  );
  expect(error).toMatchObject({ type: 'error' });

  const [persisted] = await readTracks(publishedId);
  expect(persisted.sampleId).toBe('tone:fm-bass');
});

it('applies the same result through the Durable Object as the shared operation', async () => {
  // The engine-state policy is invisible to the sync state hash, so a
  // divergence between the server and the browser reducer would never be
  // caught by the periodic hash check. This pins them together directly.
  const before = workedOnTrack();
  (before as SessionTrack & { fmParams?: unknown }).fmParams = {
    harmonicity: 9,
    modulationIndex: 19,
  };
  const sessionId = await createSessionWith([before]);
  const a = await connect(sessionId, 'player-a');

  a.socket.send(JSON.stringify({
    type: 'set_track_instrument',
    trackId: 'shared-track',
    sampleId: 'sampled:acoustic-snare',
    seq: 608,
  }));
  await a.inbox.waitFor(
    (message) => message.type === 'track_sample_set' && message.clientSeq === 608,
    'instrument change acknowledgement',
  );

  const pure = setTrackInstrument(
    { ...initialState(), tracks: [before] } as never,
    { trackId: 'shared-track', sampleId: 'sampled:acoustic-snare' },
  );
  expect(pure.ok).toBe(true);

  const [fromServer] = await readTracks(sessionId);
  expect(fromServer).toEqual(pure.state.tracks[0]);
});
