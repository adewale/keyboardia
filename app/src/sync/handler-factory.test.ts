/**
 * Client Handler Factory Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRemoteHandler,
  createRemoteOnlyHandler,
  type HandlerContext,
} from './handler-factory';

describe('createRemoteHandler', () => {
  it('should skip messages from own player', () => {
    const dispatch = vi.fn();
    const context: HandlerContext = {
      state: { playerId: 'player-1' },
      dispatch,
    };

    const handler = createRemoteHandler<{ value: number; playerId: string }>(
      (msg) => ({ type: 'SET_TEMPO', tempo: msg.value })
    );

    // Call with own playerId - should be skipped
    handler.call(context, { value: 120, playerId: 'player-1' });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('should dispatch for remote messages', () => {
    const dispatch = vi.fn();
    const context: HandlerContext = {
      state: { playerId: 'player-1' },
      dispatch,
    };

    const handler = createRemoteHandler<{ value: number; playerId: string }>(
      (msg) => ({ type: 'SET_TEMPO', tempo: msg.value })
    );

    // Call with different playerId - should dispatch
    handler.call(context, { value: 140, playerId: 'player-2' });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_TEMPO',
      tempo: 140,
      isRemote: true,
    });
  });

  it('should handle null dispatch gracefully', () => {
    const context: HandlerContext = {
      state: { playerId: 'player-1' },
      dispatch: null,
    };

    const handler = createRemoteHandler<{ value: number; playerId: string }>(
      (msg) => ({ type: 'SET_TEMPO', tempo: msg.value })
    );

    // Should not throw even with null dispatch
    expect(() => {
      handler.call(context, { value: 120, playerId: 'player-2' });
    }).not.toThrow();
  });

  it('should handle null playerId in context', () => {
    const dispatch = vi.fn();
    const context: HandlerContext = {
      state: { playerId: null },
      dispatch,
    };

    const handler = createRemoteHandler<{ value: number; playerId: string }>(
      (msg) => ({ type: 'SET_TEMPO', tempo: msg.value })
    );

    // Should dispatch since local playerId is null (not connected yet)
    handler.call(context, { value: 120, playerId: 'player-2' });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_TEMPO',
      tempo: 120,
      isRemote: true,
    });
  });

  it('should pass all message fields except playerId to action creator', () => {
    const dispatch = vi.fn();
    const context: HandlerContext = {
      state: { playerId: 'player-1' },
      dispatch,
    };

    const handler = createRemoteHandler<{
      trackId: string;
      volume: number;
      playerId: string;
    }>((msg) => ({
      type: 'SET_TRACK_VOLUME',
      trackId: msg.trackId,
      volume: msg.volume,
    }));

    handler.call(context, {
      trackId: 'track-123',
      volume: 0.75,
      playerId: 'player-2',
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_TRACK_VOLUME',
      trackId: 'track-123',
      volume: 0.75,
      isRemote: true,
    });
  });

  it('should work with complex action types', () => {
    const dispatch = vi.fn();
    const context: HandlerContext = {
      state: { playerId: 'player-1' },
      dispatch,
    };

    const handler = createRemoteHandler<{
      trackId: string;
      step: number;
      lock: { pitch?: number; volume?: number } | null;
      playerId: string;
    }>((msg) => ({
      type: 'SET_PARAMETER_LOCK',
      trackId: msg.trackId,
      step: msg.step,
      lock: msg.lock,
    }));

    handler.call(context, {
      trackId: 'track-1',
      step: 4,
      lock: { pitch: 7, volume: 0.5 },
      playerId: 'player-2',
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_PARAMETER_LOCK',
      trackId: 'track-1',
      step: 4,
      lock: { pitch: 7, volume: 0.5 },
      isRemote: true,
    });
  });
});

describe('createRemoteOnlyHandler', () => {
  it('should skip messages from own player', () => {
    const callback = vi.fn();
    const context: HandlerContext = {
      state: { playerId: 'player-1' },
      dispatch: null,
    };

    const handler = createRemoteOnlyHandler<{ data: string; playerId: string }>(
      callback
    );

    handler.call(context, { data: 'test', playerId: 'player-1' });

    expect(callback).not.toHaveBeenCalled();
  });

  it('should call callback for remote messages', () => {
    const callback = vi.fn();
    const context: HandlerContext = {
      state: { playerId: 'player-1' },
      dispatch: null,
    };

    const handler = createRemoteOnlyHandler<{ data: string; playerId: string }>(
      callback
    );

    handler.call(context, { data: 'test', playerId: 'player-2' });

    expect(callback).toHaveBeenCalledWith({ data: 'test', playerId: 'player-2' });
  });

  it('should pass full message including playerId to callback', () => {
    const callback = vi.fn();
    const context: HandlerContext = {
      state: { playerId: 'player-1' },
      dispatch: null,
    };

    const handler = createRemoteOnlyHandler<{
      startTime: number;
      tempo: number;
      playerId: string;
    }>(callback);

    handler.call(context, { startTime: 1000, tempo: 120, playerId: 'player-2' });

    expect(callback).toHaveBeenCalledWith({
      startTime: 1000,
      tempo: 120,
      playerId: 'player-2',
    });
  });
});
