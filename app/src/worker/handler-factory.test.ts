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

// =============================================================================
// TEST-12: Handler Factory Edge Cases
// =============================================================================

describe('TEST-12: Handler Factory Edge Cases', () => {
  describe('createTrackMutationHandler edge cases', () => {
    it('should handle empty tracks array', () => {
      const context = createMockContext([]);

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

    it('should pass clientSeq to broadcast when provided', () => {
      const track = createMockTrack({ id: 'track-1', volume: 1.0 });
      const context = createMockContext([track]);

      const handler = createTrackMutationHandler({
        getTrackId: (msg: { trackId: string; volume: number; seq?: number }) => msg.trackId,
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

      handler.call(context, mockWs, mockPlayer, { trackId: 'track-1', volume: 0.5, seq: 42 });

      expect(context.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'track_volume_set' }),
        undefined,
        42
      );
    });

    it('should handle validation returning different value', () => {
      const track = createMockTrack({ id: 'track-1', volume: 1.0 });
      const context = createMockContext([track]);

      const handler = createTrackMutationHandler({
        getTrackId: (msg: { trackId: string; volume: number }) => msg.trackId,
        validate: (msg) => ({ ...msg, volume: 0 }), // Always sets to 0
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

      handler.call(context, mockWs, mockPlayer, { trackId: 'track-1', volume: 0.9 });

      expect(track.volume).toBe(0);
    });

    it('should handle multiple tracks with same prefix ID', () => {
      const track1 = createMockTrack({ id: 'track-1' });
      const track10 = createMockTrack({ id: 'track-10' });
      const track100 = createMockTrack({ id: 'track-100' });
      const context = createMockContext([track1, track10, track100]);

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

      handler.call(context, mockWs, mockPlayer, { trackId: 'track-10', volume: 0.5 });

      expect(track1.volume).toBe(1); // Unchanged
      expect(track10.volume).toBe(0.5); // Changed
      expect(track100.volume).toBe(1); // Unchanged
    });
  });

  describe('createGlobalMutationHandler edge cases', () => {
    it('should handle multiple mutations in sequence', () => {
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

      handler.call(context, mockWs, mockPlayer, { tempo: 100 });
      handler.call(context, mockWs, mockPlayer, { tempo: 120 });
      handler.call(context, mockWs, mockPlayer, { tempo: 140 });

      expect(context.state!.tempo).toBe(140);
      expect(context.broadcast).toHaveBeenCalledTimes(3);
    });

    it('should pass clientSeq to broadcast when provided', () => {
      const context = createMockContext([]);

      const handler = createGlobalMutationHandler({
        mutate: (state, msg: { tempo: number; seq?: number }) => {
          state.tempo = msg.tempo;
        },
        toBroadcast: (msg, playerId) => ({
          type: 'tempo_changed',
          tempo: msg.tempo,
          playerId,
        } as ServerMessage),
      });

      handler.call(context, mockWs, mockPlayer, { tempo: 140, seq: 123 });

      expect(context.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tempo_changed' }),
        undefined,
        123
      );
    });

    it('should handle validation that modifies multiple fields', () => {
      const context = createMockContext([]);

      const handler = createGlobalMutationHandler({
        validate: (msg: { tempo: number; swing: number }) => ({
          tempo: Math.max(60, Math.min(180, msg.tempo)),
          swing: Math.max(0, Math.min(100, msg.swing)),
        }),
        mutate: (state, msg) => {
          state.tempo = msg.tempo;
          state.swing = msg.swing;
        },
        toBroadcast: (msg, playerId) => ({
          type: 'tempo_changed',
          tempo: msg.tempo,
          playerId,
        } as ServerMessage),
      });

      handler.call(context, mockWs, mockPlayer, { tempo: 300, swing: 150 });

      expect(context.state!.tempo).toBe(180);
      expect(context.state!.swing).toBe(100);
    });
  });
});
