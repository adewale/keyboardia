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
import { TRACK_ENVELOPE_CAPABILITIES, TRACK_ENVELOPE_CAPABILITY } from '../shared/message-types';

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

function snapshot(tempo = 120, capabilities: string[] = [...TRACK_ENVELOPE_CAPABILITIES]) {
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
    capabilities,
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
    expect(new URL(sockets[0].url).searchParams.get('capabilities'))
      .toBe(TRACK_ENVELOPE_CAPABILITIES.join(','));
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
    expect(connection.supportsCapability(TRACK_ENVELOPE_CAPABILITY)).toBe(true);
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

  it('keeps the connection alive when a future server sends an unknown message', () => {
    connection.connect('00000000-0000-0000-0000-000000000001', dispatch);
    sockets[0].open();
    sockets[0].receive(snapshot());

    expect(() => sockets[0].receive({ type: 'future_server_feature', value: 1 }))
      .not.toThrow();
    expect(connection.getState().status).toBe('connected');
  });

  it('applies v2 acknowledgements and reconciles a structured rejection', () => {
    const showToast = vi.fn();
    const rejected = vi.fn();
    window.addEventListener('show-toast', showToast);
    window.addEventListener('keyboardia-envelope-mutation-rejected', rejected);
    connection.connect('00000000-0000-0000-0000-000000000001', dispatch);
    sockets[0].open();
    sockets[0].receive(snapshot());

    sockets[0].receive({
      type: 'track_envelope_v2_set',
      trackId: 'track-1',
      envelope: {
        model: 'ar',
        attack: { value: .02, unit: 'seconds' },
        release: { value: 2, unit: 'steps' },
      },
      operationId: 'operation-1',
      playerId: 'player-a',
      seq: 1,
      clientSeq: 1,
    });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SET_TRACK_ENVELOPE_V2',
      trackId: 'track-1',
      operationId: 'operation-1',
      isRemote: true,
    }));

    sockets[0].receive({
      type: 'mutation_rejected',
      operationId: 'operation-2',
      code: 'INVALID_ENVELOPE',
      message: 'Invalid envelope',
      trackId: 'track-1',
      authoritativeTrack: {
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: Array(16).fill(false),
        parameterLocks: Array(16).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
      },
      clientSeq: 2,
    });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'REPLACE_TRACK_AUTHORITATIVE',
      track: expect.objectContaining({ id: 'track-1', name: 'Kick' }),
      isRemote: true,
    }));
    expect(showToast).toHaveBeenCalledOnce();
    expect((showToast.mock.calls[0][0] as CustomEvent).detail).toEqual({
      message: 'Invalid envelope',
      type: 'error',
    });
    expect((rejected.mock.calls[0][0] as CustomEvent).detail).toEqual({ operationId: 'operation-2' });
    window.removeEventListener('show-toast', showToast);
    window.removeEventListener('keyboardia-envelope-mutation-rejected', rejected);
  });

  it('announces an authoritative lossy unit conversion', () => {
    const showToast = vi.fn();
    window.addEventListener('show-toast', showToast);
    connection.connect('00000000-0000-0000-0000-000000000001', dispatch);
    sockets[0].open();
    sockets[0].receive(snapshot());

    sockets[0].receive({
      type: 'track_envelope_units_v2_converted',
      trackId: 'track-1',
      envelope: {
        model: 'ar',
        attack: { value: 4, unit: 'seconds' },
        release: { value: 8, unit: 'seconds' },
      },
      clampedStages: ['attack', 'release'],
      operationId: 'operation-clamped',
      playerId: 'player-a',
      seq: 1,
      clientSeq: 1,
    });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SET_TRACK_ENVELOPE_V2',
      operationId: 'operation-clamped',
      isRemote: true,
    }));
    expect((showToast.mock.calls[0][0] as CustomEvent).detail).toEqual({
      message: 'Envelope conversion reached the limit for attack, release.',
      type: 'warning',
    });
    window.removeEventListener('show-toast', showToast);
  });

  it('projects hashes to the pre-v2 shape when connected to an older server', () => {
    const hashState = {
      tracks: [{
        id: 'track-1', name: 'Kick', sampleId: 'kick', steps: [true],
        parameterLocks: [{ attackDuration: { value: 2, unit: 'steps' as const } }],
        volume: 1, muted: false, transpose: 0,
        envelopeV2: {
          model: 'ar' as const,
          attack: { value: .02, unit: 'seconds' as const },
          release: { value: 2, unit: 'steps' as const },
        },
        samplePlaybackMode: 'loop' as const,
      }],
      tempo: 120,
      swing: 0,
    };
    connection.connect(
      '00000000-0000-0000-0000-000000000001',
      dispatch,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => hashState,
    );
    sockets[0].open();
    sockets[0].receive(snapshot(120, [TRACK_ENVELOPE_CAPABILITY]));
    vi.advanceTimersByTime(30_000);

    const hashMessage = sockets[0].sent
      .map(raw => JSON.parse(raw) as { type: string; hash?: string })
      .find(message => message.type === 'state_hash');
    expect(hashMessage?.hash).toBeDefined();

    // A v2-capable snapshot changes the projected shape and therefore the hash.
    sockets[0].receive(snapshot(120, [...TRACK_ENVELOPE_CAPABILITIES]));
    vi.advanceTimersByTime(30_000);
    const hashes = sockets[0].sent
      .map(raw => JSON.parse(raw) as { type: string; hash?: string })
      .filter(message => message.type === 'state_hash')
      .map(message => message.hash);
    expect(hashes.at(-1)).not.toBe(hashes[0]);
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
