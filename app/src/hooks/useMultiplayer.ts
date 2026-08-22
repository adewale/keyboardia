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
  sendCursorMove,
  sendBatchClearSteps,
  sendBatchSetParameterLocks,
  sendReorderTracks,
  type MultiplayerState,
  type ConnectionStatus,
  type PlayerInfo,
  type RemoteCursor,
  type CursorPosition,
} from '../sync/multiplayer';
import type { Track, ParameterLock } from '../types';
import { useDebug } from '../debug/DebugContext';
import { logger } from '../utils/logger';
import { TRACK_ENVELOPE_CAPABILITY, TRACK_ENVELOPE_V2_CAPABILITY } from '../shared/message-types';

interface UseMultiplayerResult {
  status: ConnectionStatus;
  playerId: string | null;
  players: PlayerInfo[];
  playerCount: number;
  error: string | null;
  isConnected: boolean;
  /** V2 editing is available offline and after capability negotiation. */
  supportsEnvelopeV2: boolean;
  clockOffset: number;
  clockRtt: number;
  // Phase 11: Cursors
  cursors: Map<string, RemoteCursor>;
  sendCursor: (position: CursorPosition) => void;
  // Phase 12: Reconnection state
  reconnectAttempts: number;
  queueSize: number;
  retryConnection: () => void;
  // Phase 22: Per-player playback tracking
  playingPlayerIds: Set<string>;
}

export function supportsEnvelopeV2ForConnection(
  status: ConnectionStatus,
  serverSupportsEnvelopeV2: boolean,
): boolean {
  // A connecting client has not necessarily received a capability-bearing
  // snapshot yet. Fail closed on the initial connection, while still allowing
  // a reconnect to a known-v2 Worker (the transport retains its last negotiated
  // capabilities until an intentional disconnect).
  return status === 'connected' || status === 'connecting'
    ? serverSupportsEnvelopeV2
    : true;
}

export function useMultiplayer(
  sessionId: string | null,
  dispatch: (action: GridAction) => void,
  isReady: boolean,
  onRemoteChange?: (trackId: string, step: number, color: string) => void,
  onPlayerEvent?: (player: PlayerInfo, event: 'join' | 'leave') => void,
  getStateForHash?: () => unknown,
  onPublishedChange?: (isPublished: boolean) => void
): UseMultiplayerResult {
  const [state, setState] = useState<MultiplayerState>({
    status: 'disconnected',
    playerId: null,
    players: [],
    error: null,
    cursors: new Map(),
    playingPlayerIds: new Set(),
  });
  const [clockOffset, setClockOffset] = useState(0);
  const [clockRtt, setClockRtt] = useState(0);

  const connectedSessionRef = useRef<string | null>(null);
  const debugConnectionOpenRef = useRef(false);
  const {
    isDebugMode,
    updateMultiplayerState,
    updateClockSyncState,
    updateMutationState,
    trackPlayerConnection,
  } = useDebug();

  // Connect to multiplayer when session is ready
  // Phase 13B: Added cancellation flag to prevent race conditions when sessionId changes rapidly
  useEffect(() => {
    if (!sessionId || !isReady) return;

    // Don't reconnect if already connected to this session
    if (connectedSessionRef.current === sessionId) return;

    // Phase 13B: Cancellation flag to prevent stale callbacks
    let cancelled = false;

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
        // Phase 13B: Skip if this effect was cancelled (sessionId changed)
        if (cancelled) return;
        setState(newState);
        if (isDebugMode) {
          if (newState.status === 'connected' && newState.playerId) {
            if (!debugConnectionOpenRef.current) {
              trackPlayerConnection(newState.playerId);
              debugConnectionOpenRef.current = true;
            }
          } else {
            debugConnectionOpenRef.current = false;
          }
          updateMultiplayerState({
            status: newState.status,
            playerId: newState.playerId,
            playerCount: newState.players.length,
          });
        }
      },
      // Playback started callback - INFORMATIONAL ONLY
      // We do NOT control local playback from remote events
      // "My ears, my control" - playback state is personal
      // Phase 22: playingPlayerIds tracking happens in multiplayer.ts,
      // this callback is for any additional side effects (currently just logging)
      (startTime, tempo, playerId) => {
        if (cancelled) return;
        logger.multiplayer.log('Remote playback started by', playerId, 'at', startTime, 'tempo:', tempo);
      },
      // Playback stopped callback - INFORMATIONAL ONLY
      // Phase 22: playingPlayerIds tracking happens in multiplayer.ts
      (playerId) => {
        if (cancelled) return;
        logger.multiplayer.log('Remote playback stopped by', playerId);
      },
      // Remote change callback (Phase 11: change attribution)
      onRemoteChange ? (trackId, step, color) => {
        if (cancelled) return;
        onRemoteChange(trackId, step, color);
      } : undefined,
      // Player event callback (Phase 11: join/leave notifications)
      onPlayerEvent ? (player, event) => {
        if (cancelled) return;
        onPlayerEvent(player, event);
      } : undefined,
      // Phase 12 Polish: State getter for hash verification
      getStateForHash,
      // Phase 21: Published state change callback
      onPublishedChange ? (isPublished) => {
        if (cancelled) return;
        onPublishedChange(isPublished);
      } : undefined
    );

    // BUG FIX: Use addSyncListener instead of monkey-patching handleSyncResponse
    // The old approach wrapped handleSyncResponse which could cause chaining issues
    // if the hook re-ran before cleanup (e.g., due to React Strict Mode or dep changes)
    const syncListener = (offset: number, rtt: number) => {
      // Phase 13B: Skip if cancelled
      if (cancelled) return;
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
    multiplayer.clockSync.addSyncListener(syncListener);

    // Cleanup on unmount or when sessionId changes
    return () => {
      // Phase 13B: Mark as cancelled to prevent stale callbacks
      cancelled = true;
      // Remove our sync listener (safe, idempotent operation)
      multiplayer.clockSync.removeSyncListener(syncListener);
      if (connectedSessionRef.current === sessionId) {
        multiplayer.disconnect();
        connectedSessionRef.current = null;
        debugConnectionOpenRef.current = false;
      }
    };
  }, [sessionId, isReady, dispatch, isDebugMode, updateMultiplayerState, updateClockSyncState, trackPlayerConnection, onRemoteChange, onPlayerEvent, getStateForHash, onPublishedChange]);

  // Phase 26: Poll mutation stats and message ordering for debug overlay
  useEffect(() => {
    if (!isDebugMode) return;

    // Update immediately
    const updateStats = () => {
      const stats = multiplayer.getMutationStats();
      const oldestAge = multiplayer.getOldestPendingMutationAge();
      updateMutationState({
        pending: stats.pending,
        confirmed: stats.confirmed,
        superseded: stats.superseded,
        lost: stats.lost,
        oldestPendingAge: oldestAge,
      });

      // BUG-03: Update message ordering stats
      const orderingStats = multiplayer.getMessageOrderingStats();
      updateMultiplayerState({
        outOfOrderCount: orderingStats.outOfOrderCount,
        lastServerSeq: orderingStats.lastServerSeq,
      });
    };

    updateStats();

    // Poll every second
    const interval = setInterval(updateStats, 1000);

    return () => clearInterval(interval);
  }, [isDebugMode, updateMutationState, updateMultiplayerState]);

  // Phase 11: Throttled cursor send (50ms throttle)
  const lastCursorSendRef = useRef<number>(0);
  const throttledSendCursor = useCallback((position: CursorPosition) => {
    const now = Date.now();
    if (now - lastCursorSendRef.current < 50) return;
    lastCursorSendRef.current = now;
    sendCursorMove(position);
  }, []);

  // Phase 12: Manual retry after single-player fallback
  const retryConnection = useCallback(() => {
    multiplayer.retryConnection();
  }, []);

  return {
    status: state.status,
    playerId: state.playerId,
    players: state.players,
    playerCount: state.players.length,
    error: state.error,
    isConnected: state.status === 'connected',
    supportsEnvelopeV2: supportsEnvelopeV2ForConnection(
      state.status,
      multiplayer.supportsCapability(TRACK_ENVELOPE_V2_CAPABILITY),
    ),
    clockOffset,
    clockRtt,
    // Phase 11: Cursors
    cursors: state.cursors,
    sendCursor: throttledSendCursor,
    // Phase 12: Reconnection state
    reconnectAttempts: state.reconnectAttempts ?? 0,
    queueSize: state.queueSize ?? 0,
    retryConnection,
    // Phase 22: Per-player playback tracking
    playingPlayerIds: state.playingPlayerIds,
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
      const connectionStatus = multiplayer.getState().status;
      const isServerBound = isConnected
        || connectionStatus === 'connected'
        || connectionStatus === 'connecting';
      const needsEnvelopeCapability = action.type === 'SET_TRACK_ENVELOPE'
        || action.type === 'SET_TRACK_ENVELOPE_TIME_UNIT'
        || action.type === 'SET_TRACK_GATE';
      const needsEnvelopeV2Capability = action.type === 'SET_TRACK_ENVELOPE_V2'
        || action.type === 'CONVERT_TRACK_ENVELOPE_UNITS_V2'
        || action.type === 'SET_TRACK_SAMPLE_PLAYBACK_MODE_V2'
        || action.type === 'SET_TRACK_GATE_V2'
        || action.type === 'SET_ENVELOPE_LOCK_V2';
      if (isServerBound && needsEnvelopeCapability
          && !multiplayer.supportsCapability(TRACK_ENVELOPE_CAPABILITY)) {
        logger.ws.warn('This connected server does not support track envelope edits yet');
        return;
      }
      if (isServerBound && needsEnvelopeV2Capability
          && !multiplayer.supportsCapability(TRACK_ENVELOPE_V2_CAPABILITY)) {
        logger.ws.warn('This connected server does not support v2 envelope edits yet');
        return;
      }

      // Always dispatch locally first
      dispatch(action);

      // Remote actions have already come from the server. A connecting client,
      // however, must pass locally-authored operations to MultiplayerConnection
      // so its reconnect queue can replay them after the authoritative snapshot.
      if (!isServerBound || ('isRemote' in action && action.isRemote)) {
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

  // Phase 31F: Batch operations for multi-select
  const handleBatchClearSteps = useCallback(
    (trackId: string, steps: number[]) => {
      if (isConnected && steps.length > 0) {
        sendBatchClearSteps(trackId, steps);
      }
    },
    [isConnected]
  );

  const handleBatchSetParameterLocks = useCallback(
    (trackId: string, locks: { step: number; lock: ParameterLock }[]) => {
      if (isConnected && locks.length > 0) {
        sendBatchSetParameterLocks(trackId, locks);
      }
    },
    [isConnected]
  );

  // Phase 31G: Track reorder (drag and drop) - uses trackId for commutativity
  const handleTrackReorder = useCallback(
    (trackId: string, toIndex: number) => {
      if (isConnected) {
        sendReorderTracks(trackId, toIndex);
      }
    },
    [isConnected]
  );

  return {
    handleMuteChange,
    handleSoloChange,
    handleTrackAdded,
    handleBatchClearSteps,
    handleBatchSetParameterLocks,
    handleTrackReorder,
  };
}

// Backwards compatibility alias
