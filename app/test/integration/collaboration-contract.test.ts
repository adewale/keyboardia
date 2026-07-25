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
