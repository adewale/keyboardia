/**
 * Real collaboration contract.
 *
 * This suite intentionally crosses the Worker, Durable Object, durable storage,
 * and WebSocket boundaries. It replaces the former MockLiveSession tests: a
 * protocol change in production must be observed here without updating a
 * parallel server implementation.
 */
import { afterEach, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface Env {
  LIVE_SESSIONS: DurableObjectNamespace;
}

interface ServerMessage {
  type: string;
  seq?: number;
  clientSeq?: number;
  trackId?: string;
  step?: number;
  value?: boolean;
  playerId?: string;
  serverSeq?: number;
  state?: {
    tracks: Array<{ id: string; steps: boolean[] }>;
    tempo: number;
    swing: number;
  };
  players?: Array<{ id: string }>;
  playingPlayerIds?: string[];
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

function initialState() {
  return {
    tracks: [{
      id: 'shared-track',
      name: 'Shared Track',
      sampleId: 'sampled:808-kick',
      steps: Array(128).fill(false),
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      transpose: 0,
      stepCount: 16,
    }],
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
  const namespace = (env as unknown as Env).LIVE_SESSIONS;
  const stub = namespace.get(namespace.idFromName(sessionId));
  const response = await stub.fetch(
    `http://do/api/sessions/${sessionId}?playerId=${playerId}`,
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
