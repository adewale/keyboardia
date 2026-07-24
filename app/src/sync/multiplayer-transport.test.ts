// @vitest-environment jsdom
/**
 * Fault-injection tests around the real multiplayer client.
 *
 * The transport is controllable, but queueing, sequencing, recovery, dispatch,
 * and reconnection all run through MultiplayerConnection itself. These replace
 * the former chaos tests, which only sent messages between two fake sockets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiplayerConnection, type WebSocketFactory } from './multiplayer';
import type { GridAction } from '../types';

class ControlledWebSocket {
  readonly url: string;
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(message: object): void {
    this.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify(message),
    }));
  }

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sent.push(data);
  }

  close(code = 1000, reason = 'normal'): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  drop(): void {
    this.close(1006, 'connection lost');
  }
}

function snapshot(tempo = 120) {
  return {
    type: 'snapshot',
    state: {
      tracks: [],
      tempo,
      swing: 0,
      version: 1,
    },
    players: [{ id: 'player-a', name: 'Player A', color: '#fff' }],
    playerId: 'player-a',
    immutable: false,
    snapshotTimestamp: Date.now(),
    serverSeq: 0,
    playingPlayerIds: [],
  };
}

describe('MultiplayerConnection with transport faults', () => {
  let sockets: ControlledWebSocket[];
  let connection: MultiplayerConnection;
  let dispatch: ReturnType<typeof vi.fn<(action: GridAction) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    window.history.replaceState({}, '', '/s/00000000-0000-0000-0000-000000000001');
    sessionStorage.clear();
    sockets = [];
    const factory: WebSocketFactory = (url) => {
      const socket = new ControlledWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    };
    connection = new MultiplayerConnection(factory);
    dispatch = vi.fn<(action: GridAction) => void>();
  });

  afterEach(() => {
    connection.disconnect();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('queues an edit while connecting and replays it only after the authoritative snapshot', () => {
    connection.connect('00000000-0000-0000-0000-000000000001', dispatch);
    connection.send({ type: 'set_tempo', tempo: 132 });

    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toEqual([]);
    expect(connection.getQueueSize()).toBe(1);

    sockets[0].open();
    expect(sockets[0].sent.map((raw) => JSON.parse(raw))).not.toContainEqual(
      expect.objectContaining({ type: 'set_tempo' }),
    );

    sockets[0].receive(snapshot());

    expect(connection.getState().status).toBe('connected');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LOAD_STATE',
      tempo: 120,
      isRemote: true,
    }));
    expect(sockets[0].sent.map((raw) => JSON.parse(raw))).toContainEqual(
      expect.objectContaining({ type: 'set_tempo', tempo: 132, seq: 1 }),
    );
    expect(connection.getQueueSize()).toBe(0);
  });

  it('reconnects the real client after a dropped socket and applies the new snapshot', async () => {
    connection.connect('00000000-0000-0000-0000-000000000001', dispatch);
    sockets[0].open();
    sockets[0].receive(snapshot(120));
    expect(connection.getState().status).toBe('connected');

    sockets[0].drop();
    expect(connection.getState()).toMatchObject({
      status: 'connecting',
      reconnectAttempts: 1,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);

    sockets[1].open();
    sockets[1].receive(snapshot(144));

    expect(connection.getState().status).toBe('connected');
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'LOAD_STATE',
      tempo: 144,
      isRemote: true,
    }));
  });

  it('requests a production snapshot when delivered messages reveal a large gap', async () => {
    connection.connect('00000000-0000-0000-0000-000000000001', dispatch);
    sockets[0].open();
    sockets[0].receive(snapshot());

    sockets[0].receive({
      type: 'tempo_changed',
      tempo: 121,
      playerId: 'player-b',
      seq: 1,
    });
    sockets[0].receive({
      type: 'tempo_changed',
      tempo: 125,
      playerId: 'player-b',
      seq: 5,
    });

    expect(connection.getSyncMetrics()).toMatchObject({
      lastServerSeq: 5,
      totalMissedMessages: 3,
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets[0].sent.map((raw) => JSON.parse(raw))).toContainEqual(
      expect.objectContaining({ type: 'request_snapshot', ack: 5 }),
    );
  });
});
