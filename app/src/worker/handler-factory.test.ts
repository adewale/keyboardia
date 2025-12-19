/**
 * Server Handler Factory Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createTrackMutationHandler,
  createGlobalMutationHandler,
  type LiveSessionContext,
} from './handler-factory';
import type { SessionTrack, PlayerInfo, ServerMessage } from './types';

// Helper to create a mock track
function createMockTrack(overrides: Partial<SessionTrack> = {}): SessionTrack {
  return {
    id: 'track-1',
    name: 'Test Track',
    sampleId: 'kick',
    steps: Array(16).fill(false),
    parameterLocks: Array(16).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    playbackMode: 'oneshot',
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

// Helper to create mock context
function createMockContext(tracks: SessionTrack[] = []): LiveSessionContext & {
  broadcast: ReturnType<typeof vi.fn>;
  scheduleKVSave: ReturnType<typeof vi.fn>;
} {
  return {
    state: { tracks, tempo: 120, swing: 0, version: 1 },
    broadcast: vi.fn(),
    scheduleKVSave: vi.fn(),
  };
}

// Mock player
const mockPlayer: PlayerInfo = {
  id: 'player-1',
  connectedAt: Date.now(),
  lastMessageAt: Date.now(),
  messageCount: 0,
  color: '#E53935',
  colorIndex: 0,
  animal: 'Fox',
  name: 'Red Fox',
};

// Mock WebSocket
const mockWs = {} as WebSocket;

describe('createTrackMutationHandler', () => {
  it('should return early if state is null', () => {
    const handler = createTrackMutationHandler({
      getTrackId: (msg: { trackId: string; volume: number }) => msg.trackId,
      mutate: (track, msg) => {
        track.volume = msg.volume;
      },
      toBroadcast: (msg, playerId) => ({
        type: 'track_volume_set',
        trackId: msg.trackId,
        volume: msg.volume,
        playerId,
      } as ServerMessage),
    });

    const context = { state: null, broadcast: vi.fn(), scheduleKVSave: vi.fn() };
    handler.call(context, mockWs, mockPlayer, { trackId: 't1', volume: 0.5 });

    expect(context.broadcast).not.toHaveBeenCalled();
    expect(context.scheduleKVSave).not.toHaveBeenCalled();
  });

  it('should return early if track not found', () => {
    const context = createMockContext([createMockTrack({ id: 'other-track' })]);

    const handler = createTrackMutationHandler({
      getTrackId: (msg: { trackId: string; volume: number }) => msg.trackId,
      mutate: (track, msg) => {
        track.volume = msg.volume;
      },
      toBroadcast: (msg, playerId) => ({
        type: 'track_volume_set',
        trackId: msg.trackId,
        volume: msg.volume,
        playerId,
      } as ServerMessage),
    });

    handler.call(context, mockWs, mockPlayer, { trackId: 'nonexistent', volume: 0.5 });

    expect(context.broadcast).not.toHaveBeenCalled();
    expect(context.scheduleKVSave).not.toHaveBeenCalled();
  });

  it('should mutate track and broadcast without validation', () => {
    const track = createMockTrack({ id: 'track-1', volume: 1.0 });
    const context = createMockContext([track]);

    const handler = createTrackMutationHandler({
      getTrackId: (msg: { trackId: string; volume: number }) => msg.trackId,
      mutate: (t, msg) => {
        t.volume = msg.volume;
      },
      toBroadcast: (msg, playerId) => ({
        type: 'track_volume_set',
        trackId: msg.trackId,
        volume: msg.volume,
        playerId,
      } as ServerMessage),
    });

    handler.call(context, mockWs, mockPlayer, { trackId: 'track-1', volume: 0.5 });

    expect(track.volume).toBe(0.5);
    // Phase 26: broadcast now includes clientSeq (undefined when not provided)
    expect(context.broadcast).toHaveBeenCalledWith(
      {
        type: 'track_volume_set',
        trackId: 'track-1',
        volume: 0.5,
        playerId: 'player-1',
      },
      undefined,
      undefined
    );
    expect(context.scheduleKVSave).toHaveBeenCalled();
  });

  it('should apply validation before mutation', () => {
    const track = createMockTrack({ id: 'track-1', volume: 1.0 });
    const context = createMockContext([track]);

    const handler = createTrackMutationHandler({
      getTrackId: (msg: { trackId: string; volume: number }) => msg.trackId,
      validate: (msg) => ({ ...msg, volume: Math.min(msg.volume, 1) }),
      mutate: (t, msg) => {
        t.volume = msg.volume;
      },
      toBroadcast: (msg, playerId) => ({
        type: 'track_volume_set',
        trackId: msg.trackId,
        volume: msg.volume,
        playerId,
      } as ServerMessage),
    });

    // Send volume > 1, should be clamped
    handler.call(context, mockWs, mockPlayer, { trackId: 'track-1', volume: 1.5 });

    expect(track.volume).toBe(1);
    // Phase 26: broadcast now includes clientSeq (undefined when not provided)
    expect(context.broadcast).toHaveBeenCalledWith(
      {
        type: 'track_volume_set',
        trackId: 'track-1',
        volume: 1,
        playerId: 'player-1',
      },
      undefined,
      undefined
    );
  });

  it('should handle complex message types', () => {
    const track = createMockTrack({ id: 'track-1' });
    const context = createMockContext([track]);

    const handler = createTrackMutationHandler({
      getTrackId: (msg: { trackId: string; fmParams: { harmonicity: number; modulationIndex: number } }) => msg.trackId,
      mutate: (t, msg) => {
        t.fmParams = msg.fmParams;
      },
      toBroadcast: (msg, playerId) => ({
        type: 'fm_params_changed',
        trackId: msg.trackId,
        fmParams: msg.fmParams,
        playerId,
      } as ServerMessage),
    });

    handler.call(context, mockWs, mockPlayer, {
      trackId: 'track-1',
      fmParams: { harmonicity: 2.5, modulationIndex: 5 },
    });

    expect(track.fmParams).toEqual({ harmonicity: 2.5, modulationIndex: 5 });
  });
});

describe('createGlobalMutationHandler', () => {
  it('should return early if state is null', () => {
    const handler = createGlobalMutationHandler({
      mutate: (state, msg: { tempo: number }) => {
        state.tempo = msg.tempo;
      },
      toBroadcast: (msg, playerId) => ({
        type: 'tempo_changed',
        tempo: msg.tempo,
        playerId,
      } as ServerMessage),
    });

    const context = { state: null, broadcast: vi.fn(), scheduleKVSave: vi.fn() };
    handler.call(context, mockWs, mockPlayer, { tempo: 140 });

    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it('should mutate global state and broadcast', () => {
    const context = createMockContext([]);

    const handler = createGlobalMutationHandler({
      mutate: (state, msg: { tempo: number }) => {
        state.tempo = msg.tempo;
      },
      toBroadcast: (msg, playerId) => ({
        type: 'tempo_changed',
        tempo: msg.tempo,
        playerId,
      } as ServerMessage),
    });

    handler.call(context, mockWs, mockPlayer, { tempo: 140 });

    expect(context.state!.tempo).toBe(140);
    // Phase 26: broadcast now includes clientSeq (undefined when not provided)
    expect(context.broadcast).toHaveBeenCalledWith(
      {
        type: 'tempo_changed',
        tempo: 140,
        playerId: 'player-1',
      },
      undefined,
      undefined
    );
    expect(context.scheduleKVSave).toHaveBeenCalled();
  });

  it('should apply validation before mutation', () => {
    const context = createMockContext([]);

    const handler = createGlobalMutationHandler({
      validate: (msg: { tempo: number }) => ({
        ...msg,
        tempo: Math.max(60, Math.min(180, msg.tempo)),
      }),
      mutate: (state, msg) => {
        state.tempo = msg.tempo;
      },
      toBroadcast: (msg, playerId) => ({
        type: 'tempo_changed',
        tempo: msg.tempo,
        playerId,
      } as ServerMessage),
    });

    // Send tempo > 180, should be clamped
    handler.call(context, mockWs, mockPlayer, { tempo: 200 });

    expect(context.state!.tempo).toBe(180);
    // Phase 26: broadcast now includes clientSeq (undefined when not provided)
    expect(context.broadcast).toHaveBeenCalledWith(
      {
        type: 'tempo_changed',
        tempo: 180,
        playerId: 'player-1',
      },
      undefined,
      undefined
    );
  });
});
