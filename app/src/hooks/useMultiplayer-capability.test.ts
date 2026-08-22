// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { multiplayer } from '../sync/multiplayer';
import {
  supportsEnvelopeV2ForConnection,
  useMultiplayerDispatch,
} from './useMultiplayer';

describe('v2 envelope capability UX', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['disconnected', 'single_player'] as const)(
    'keeps local v2 editing available while %s',
    status => {
      expect(supportsEnvelopeV2ForConnection(status, false)).toBe(true);
    },
  );

  it('fails closed while the first server capability negotiation is pending', () => {
    expect(supportsEnvelopeV2ForConnection('connecting', false)).toBe(false);
    expect(supportsEnvelopeV2ForConnection('connecting', true)).toBe(true);
  });

  it('reflects the negotiated server capability once connected', () => {
    expect(supportsEnvelopeV2ForConnection('connected', false)).toBe(false);
    expect(supportsEnvelopeV2ForConnection('connected', true)).toBe(true);
  });

  it('hands a reconnecting v2 edit to the transport queue after applying it locally', () => {
    const localDispatch = vi.fn();
    vi.spyOn(multiplayer, 'getState').mockReturnValue({
      status: 'connecting', playerId: 'player-a', players: [], error: null,
      cursors: new Map(), playingPlayerIds: new Set(),
    });
    vi.spyOn(multiplayer, 'supportsCapability').mockReturnValue(true);
    const send = vi.spyOn(multiplayer, 'send').mockImplementation(() => undefined);
    const { result } = renderHook(() => useMultiplayerDispatch(localDispatch, false));
    const action = {
      type: 'SET_TRACK_ENVELOPE_V2' as const,
      trackId: 'track-1',
      envelope: {
        model: 'ar' as const,
        attack: { value: 0.01, unit: 'seconds' as const },
        release: { value: 0.25, unit: 'seconds' as const },
      },
      operationId: 'reconnect-operation-1',
    };

    act(() => result.current(action));

    expect(localDispatch).toHaveBeenCalledWith(action);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'set_track_envelope_v2', operationId: 'reconnect-operation-1',
    }));
  });

  it('does not optimistically apply or queue v2 edits before capability negotiation', () => {
    const localDispatch = vi.fn();
    vi.spyOn(multiplayer, 'getState').mockReturnValue({
      status: 'connecting', playerId: null, players: [], error: null,
      cursors: new Map(), playingPlayerIds: new Set(),
    });
    vi.spyOn(multiplayer, 'supportsCapability').mockReturnValue(false);
    const send = vi.spyOn(multiplayer, 'send').mockImplementation(() => undefined);
    const { result } = renderHook(() => useMultiplayerDispatch(localDispatch, false));

    act(() => result.current({
      type: 'SET_TRACK_GATE_V2', trackId: 'track-1', gate: 80,
      operationId: 'initial-operation-1',
    }));

    expect(localDispatch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
