/**
 * Phase 9-10: React hook for multiplayer state management
 *
 * Connects to the WebSocket server when a session is loaded,
 * and syncs state changes between clients.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import type { GridAction } from '../types';
import {
  multiplayer,
  actionToMessage,
  sendMuteChange,
  sendSoloChange,
  sendAddTrack,
  type MultiplayerState,
  type ConnectionStatus,
} from '../sync/multiplayer';
import type { Track } from '../types';
import { useDebug } from '../debug/DebugContext';

interface UseMultiplayerResult {
  status: ConnectionStatus;
  playerId: string | null;
  playerCount: number;
  error: string | null;
  isConnected: boolean;
  clockOffset: number;
  clockRtt: number;
}

export function useMultiplayer(
  sessionId: string | null,
  dispatch: (action: GridAction) => void,
  isReady: boolean
): UseMultiplayerResult {
  const [state, setState] = useState<MultiplayerState>({
    status: 'disconnected',
    playerId: null,
    players: [],
    error: null,
  });
  const [clockOffset, setClockOffset] = useState(0);
  const [clockRtt, setClockRtt] = useState(0);

  const connectedSessionRef = useRef<string | null>(null);
  const { isDebugMode, updateMultiplayerState, updateClockSyncState } = useDebug();

  // Connect to multiplayer when session is ready
  useEffect(() => {
    if (!sessionId || !isReady) return;

    // Don't reconnect if already connected to this session
    if (connectedSessionRef.current === sessionId) return;

    // Disconnect from previous session if any
    if (connectedSessionRef.current) {
      multiplayer.disconnect();
    }

    connectedSessionRef.current = sessionId;

    // Connect to the new session
    multiplayer.connect(
      sessionId,
      dispatch,
      // State changed callback
      (newState) => {
        setState(newState);
        if (isDebugMode) {
          updateMultiplayerState({
            status: newState.status,
            playerId: newState.playerId,
            playerCount: newState.players.length,
            messagesSent: 0, // TODO: Track these
            messagesReceived: 0,
          });
        }
      },
      // Playback started callback
      (startTime, tempo) => {
        console.log('[Multiplayer] Remote playback started at', startTime, 'tempo:', tempo);
        // TODO: Start scheduler with synced time using:
        // const localStartTime = startTime - multiplayer.clockSync.getOffset();
        dispatch({ type: 'SET_PLAYING', isPlaying: true, isRemote: true });
      },
      // Playback stopped callback
      () => {
        console.log('[Multiplayer] Remote playback stopped');
        dispatch({ type: 'SET_PLAYING', isPlaying: false, isRemote: true });
      }
    );

    // Set up clock sync callback
    const originalHandleSyncResponse = multiplayer.clockSync.handleSyncResponse.bind(multiplayer.clockSync);
    multiplayer.clockSync.handleSyncResponse = (clientTime: number, serverTime: number) => {
      originalHandleSyncResponse(clientTime, serverTime);
      const offset = multiplayer.clockSync.getOffset();
      const rtt = multiplayer.clockSync.getRtt();
      setClockOffset(offset);
      setClockRtt(rtt);
      if (isDebugMode) {
        updateClockSyncState({
          offset,
          rtt,
          quality: rtt < 100 ? 'good' : rtt < 250 ? 'fair' : 'poor',
          lastSync: Date.now(),
        });
      }
    };

    // Cleanup on unmount
    return () => {
      if (connectedSessionRef.current === sessionId) {
        multiplayer.disconnect();
        connectedSessionRef.current = null;
      }
    };
  }, [sessionId, isReady, dispatch, isDebugMode, updateMultiplayerState, updateClockSyncState]);

  return {
    status: state.status,
    playerId: state.playerId,
    playerCount: state.players.length,
    error: state.error,
    isConnected: state.status === 'connected',
    clockOffset,
    clockRtt,
  };
}

/**
 * Create a dispatch wrapper that sends actions to multiplayer
 */
export function useMultiplayerDispatch(
  dispatch: (action: GridAction) => void,
  isConnected: boolean
): (action: GridAction) => void {
  return useCallback(
    (action: GridAction) => {
      // Always dispatch locally first
      dispatch(action);

      // Skip if not connected or if this is a remote action
      if (!isConnected || ('isRemote' in action && action.isRemote)) {
        return;
      }

      // Special handling for toggle actions (need to send explicit state)
      if (action.type === 'TOGGLE_MUTE') {
        // We can't know the new value here without the state
        // This will be handled by the component that knows the state
        return;
      }
      if (action.type === 'TOGGLE_SOLO') {
        return;
      }

      // Convert to message and send
      const message = actionToMessage(action);
      if (message) {
        multiplayer.send(message);
      }
    },
    [dispatch, isConnected]
  );
}

/**
 * Hook to send mute/solo/track changes with explicit values
 */
export function useMultiplayerSync(isConnected: boolean) {
  const handleMuteChange = useCallback(
    (trackId: string, muted: boolean) => {
      if (isConnected) {
        sendMuteChange(trackId, muted);
      }
    },
    [isConnected]
  );

  const handleSoloChange = useCallback(
    (trackId: string, soloed: boolean) => {
      if (isConnected) {
        sendSoloChange(trackId, soloed);
      }
    },
    [isConnected]
  );

  const handleTrackAdded = useCallback(
    (track: Track) => {
      if (isConnected) {
        sendAddTrack(track);
      }
    },
    [isConnected]
  );

  return { handleMuteChange, handleSoloChange, handleTrackAdded };
}

// Backwards compatibility alias
export const useMuteAndSoloSync = useMultiplayerSync;
