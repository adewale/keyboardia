// @vitest-environment jsdom
/**
 * Client behavior when the server's sequence counter regresses beneath a
 * live (hibernated) connection.
 *
 * Trigger, proven server-side in test/integration/seq-regression.test.ts:
 * `serverSeq` is persisted every 100 mutating broadcasts (or on a graceful
 * flush), so an ungraceful Durable Object eviction restores an older value
 * and the server re-issues sequence numbers the client has already seen —
 * on the SAME WebSocket, because hibernation preserves sockets across
 * eviction. The client never gets a close event, so nothing calls the
 * `disconnect()` cleanup that resets `SyncHealth`.
 *
 * These tests pin the actual client behavior in that regime rather than the
 * behavior we might assume:
 *   1. Regressed-epoch broadcasts are still APPLIED (out-of-order frames are
 *      counted, not dropped) — no remote-update loss.
 *   2. Eleven out-of-order frames trip the recovery path, which calls
 *      scheduleReconnect() — but neither the reconnect nor handleOpen()
 *      resets SyncHealth, so the stale high-water `lastServerSeq` survives
 *      the reconnect and the stale value is sent as `ack` on outgoing
 *      mutations (the value the server silently ignores, since its
 *      ack-gap check only fires for positive gaps).
 *   3. Consequence: reconnect churn recurs every ~11 mutating frames until
 *      the new epoch's counter climbs past the old high-water mark.
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
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    this.sent.push(data);
  }

  close(code = 1000, reason = 'normal'): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}

const SESSION = '00000000-0000-0000-0000-0000000000aa';

function snapshot(serverSeq: number, tempo = 120) {
  return {
    type: 'snapshot',
    state: { tracks: [], tempo, swing: 0, version: 1 },
    players: [{ id: 'player-a', name: 'Player A', color: '#fff' }],
    playerId: 'player-a',
    immutable: false,
    snapshotTimestamp: Date.now(),
    serverSeq,
    playingPlayerIds: [],
  };
}

const tempoChanged = (seq: number, tempo: number) => ({ type: 'tempo_changed', tempo, seq });

describe('client under server sequence regression (hibernated-socket eviction)', () => {
  let sockets: ControlledWebSocket[];
  let connection: MultiplayerConnection;
  let dispatch: ReturnType<typeof vi.fn<(action: GridAction) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    window.history.replaceState({}, '', `/s/${SESSION}`);
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

  /** Connect, receive the authoritative snapshot, and advance the epoch to `upTo`. */
  function establishEpoch(upTo: number): void {
    connection.connect(SESSION, dispatch);
    sockets[0].open();
    sockets[0].receive(snapshot(0));
    expect(connection.getState().status).toBe('connected');
    for (let seq = 1; seq <= upTo; seq++) {
      sockets[0].receive(tempoChanged(seq, 100 + seq));
    }
    expect(connection.getMessageOrderingStats().lastServerSeq).toBe(upTo);
  }

  it('applies regressed-epoch broadcasts instead of dropping them', () => {
    establishEpoch(30);
    dispatch.mockClear();

    // Post-eviction epoch: the server re-issues seq 1 for a NEW mutation.
    sockets[0].receive(tempoChanged(1, 77));

    // The frame is counted out-of-order but still dispatched.
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ tempo: 77 }));
    const stats = connection.getMessageOrderingStats();
    expect(stats.outOfOrderCount).toBe(1);
    // The stale epoch high-water mark is retained, not rewound.
    expect(stats.lastServerSeq).toBe(30);
  });

  it('reconnects after the 11th regressed frame, but the reconnect does not clear the stale epoch', () => {
    establishEpoch(30);

    // Feed regressed-epoch frames until the out-of-order threshold (10) is
    // exceeded. Frame 11 makes outOfOrderCount = 11 > 10 -> scheduleReconnect.
    for (let seq = 1; seq <= 11; seq++) {
      sockets[0].receive(tempoChanged(seq, 60 + seq));
    }
    expect(connection.getState().status).toBe('connecting');
    expect(sockets).toHaveLength(1);

    // Backoff elapses; the client opens a second socket and resyncs.
    vi.advanceTimersByTime(30_000);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    sockets[1].receive(snapshot(11));
    expect(connection.getState().status).toBe('connected');

    // THE FINDING: the reconnect performed no SyncHealth reset. The client
    // still believes the epoch high-water mark is 30, so the very next
    // regressed-epoch frame is again out-of-order — the churn cycle re-arms.
    sockets[1].receive(tempoChanged(12, 90));
    const stats = connection.getMessageOrderingStats();
    expect(stats.lastServerSeq).toBe(30);
    expect(stats.outOfOrderCount).toBe(1);

    // And the stale epoch leaks to the server: an outgoing mutation carries
    // ack=30 while the server's counter is at 12 — a negative gap the server
    // silently ignores (see the integration test for the server half).
    connection.send({ type: 'set_tempo', tempo: 140 });
    const lastSent = JSON.parse(sockets[1].sent[sockets[1].sent.length - 1]);
    expect(lastSent).toMatchObject({ type: 'set_tempo', tempo: 140, ack: 30 });
  });

  it('churns through a second reconnect while the regressed epoch persists', () => {
    establishEpoch(30);
    for (let seq = 1; seq <= 11; seq++) sockets[0].receive(tempoChanged(seq, 60 + seq));
    vi.advanceTimersByTime(30_000);
    sockets[1].open();
    sockets[1].receive(snapshot(11));

    // Snapshot reset the out-of-order counter but not the epoch, so eleven
    // more regressed frames trip recovery again: reconnect #2.
    for (let seq = 12; seq <= 22; seq++) {
      sockets[1].receive(tempoChanged(seq, 60 + seq));
    }
    expect(connection.getState().status).toBe('connecting');
    vi.advanceTimersByTime(30_000);
    expect(sockets).toHaveLength(3);

    // The cycle only ends once the new epoch passes the stale mark (seq > 30):
    sockets[2].open();
    sockets[2].receive(snapshot(22));
    for (let seq = 23; seq <= 31; seq++) {
      sockets[2].receive(tempoChanged(seq, 60 + seq));
    }
    // seq 31 sits above the stale mark: sequential again, epoch healed.
    expect(connection.getMessageOrderingStats().lastServerSeq).toBe(31);
    expect(connection.getState().status).toBe('connected');
  });
});
