/**
 * Phase 9-10: Multiplayer WebSocket connection manager
 *
 * Handles real-time synchronization between clients via Durable Objects.
 * Features:
 * - WebSocket connection management with auto-reconnect
 * - State sync on connect
 * - Broadcast changes to all players
 * - Clock synchronization for audio sync
 */

import type { GridAction, Track, ParameterLock, EffectsState, FMParams } from '../types';
import { logger } from '../utils/logger';
import { canonicalizeForHash, hashState, type StateForHash } from './canonicalHash';
import { calculateBackoffDelay } from '../utils/retry';
import { createRemoteHandler } from './handler-factory';
import { createConnectionStormDetector, type ConnectionStormDetector } from '../utils/connection-storm';
import { SyncHealth, type SyncHealthMetrics } from './sync-health';

// ============================================================================
// Types (mirrored from worker/types.ts for frontend use)
// ============================================================================

export interface PlayerInfo {
  id: string;
  connectedAt: number;
  lastMessageAt: number;
  messageCount: number;
  // Phase 11: Identity
  color: string;       // Hex color like '#E53935'
  colorIndex: number;  // Index into color array for consistent styling
  animal: string;      // Animal name like 'Fox'
  name: string;        // Full name like 'Red Fox'
}

// Phase 11: Cursor position for presence
export interface CursorPosition {
  x: number;       // Percentage (0-100) relative to grid container
  y: number;       // Percentage (0-100) relative to grid container
  trackId?: string;  // Optional: which track the cursor is over
  step?: number;     // Optional: which step the cursor is over
}

// Phase 11: Remote cursor state
export interface RemoteCursor {
  playerId: string;
  position: CursorPosition;
  color: string;
  name: string;
  lastUpdate: number;
}

/**
 * Phase 13B: Message sequence number support
 * Optional sequence numbers for ordering and conflict detection.
 */
interface MessageSequence {
  seq?: number;    // Message sequence number (client-incremented)
  ack?: number;    // Last acknowledged server sequence
}

// Client → Server messages (base types)
type ClientMessageBase =
  | { type: 'toggle_step'; trackId: string; step: number }
  | { type: 'set_tempo'; tempo: number }
  | { type: 'set_swing'; swing: number }
  | { type: 'mute_track'; trackId: string; muted: boolean }
  | { type: 'solo_track'; trackId: string; soloed: boolean }
  | { type: 'set_parameter_lock'; trackId: string; step: number; lock: ParameterLock | null }
  | { type: 'add_track'; track: Track }
  | { type: 'delete_track'; trackId: string }
  | { type: 'clear_track'; trackId: string }
  | { type: 'set_track_sample'; trackId: string; sampleId: string; name: string }
  | { type: 'set_track_volume'; trackId: string; volume: number }
  | { type: 'set_track_transpose'; trackId: string; transpose: number }
  | { type: 'set_track_step_count'; trackId: string; stepCount: number }
  | { type: 'set_effects'; effects: EffectsState }  // Phase 25: Audio effects sync
  | { type: 'set_fm_params'; trackId: string; fmParams: FMParams }  // Phase 24: FM synth params
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'state_hash'; hash: string }
  | { type: 'request_snapshot' }
  | { type: 'clock_sync_request'; clientTime: number }
  | { type: 'cursor_move'; position: CursorPosition };

// Client → Server messages with sequence numbers
type ClientMessage = ClientMessageBase & MessageSequence;

// Server → Client messages (base types)
type ServerMessageBase =
  | { type: 'snapshot'; state: SessionState; players: PlayerInfo[]; playerId: string; immutable?: boolean; snapshotTimestamp?: number; playingPlayerIds?: string[] }
  | { type: 'step_toggled'; trackId: string; step: number; value: boolean; playerId: string }
  | { type: 'tempo_changed'; tempo: number; playerId: string }
  | { type: 'swing_changed'; swing: number; playerId: string }
  | { type: 'track_muted'; trackId: string; muted: boolean; playerId: string }
  | { type: 'track_soloed'; trackId: string; soloed: boolean; playerId: string }
  | { type: 'parameter_lock_set'; trackId: string; step: number; lock: ParameterLock | null; playerId: string }
  | { type: 'track_added'; track: Track; playerId: string }
  | { type: 'track_deleted'; trackId: string; playerId: string }
  | { type: 'track_cleared'; trackId: string; playerId: string }
  | { type: 'track_sample_set'; trackId: string; sampleId: string; name: string; playerId: string }
  | { type: 'track_volume_set'; trackId: string; volume: number; playerId: string }
  | { type: 'track_transpose_set'; trackId: string; transpose: number; playerId: string }
  | { type: 'track_step_count_set'; trackId: string; stepCount: number; playerId: string }
  | { type: 'effects_changed'; effects: EffectsState; playerId: string }  // Phase 25: Audio effects sync
  | { type: 'fm_params_changed'; trackId: string; fmParams: FMParams; playerId: string }  // Phase 24: FM synth params
  | { type: 'playback_started'; playerId: string; startTime: number; tempo: number }
  | { type: 'playback_stopped'; playerId: string }
  | { type: 'player_joined'; player: PlayerInfo }
  | { type: 'player_left'; playerId: string }
  | { type: 'state_mismatch'; serverHash: string }
  | { type: 'state_hash_match' }
  | { type: 'clock_sync_response'; clientTime: number; serverTime: number }
  | { type: 'cursor_moved'; playerId: string; position: CursorPosition; color: string; name: string }
  | { type: 'error'; message: string; code?: string };

// Phase 13B: Server message sequence wrapper
interface ServerMessageSequence {
  seq?: number;       // Server broadcast sequence number
  clientSeq?: number; // Client message seq being responded to
}

// Server → Client messages with sequence numbers
type ServerMessage = ServerMessageBase & ServerMessageSequence;

interface SessionState {
  tracks: Track[];
  tempo: number;
  swing: number;
  effects?: EffectsState;  // Phase 25: Audio effects
  version: number;
}

// ============================================================================
// Connection Status
// ============================================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'single_player';

export interface MultiplayerState {
  status: ConnectionStatus;
  playerId: string | null;
  players: PlayerInfo[];
  error: string | null;
  // Phase 11: Remote cursors
  cursors: Map<string, RemoteCursor>;
  // Phase 12: Additional state for connection UI
  reconnectAttempts?: number;
  queueSize?: number;
  // Phase 22: Per-player playback tracking (which players are currently playing)
  playingPlayerIds: Set<string>;
}

// ============================================================================
// Phase 26: Mutation Tracking Types
// ============================================================================

// Import shared message constants (canonical definitions in src/shared/messages.ts)
import { MUTATING_MESSAGE_TYPES } from '../shared/messages';

/**
 * Phase 26 (REFACTOR-03): Simplified mutation tracking
 *
 * Tracks pending mutations for delivery confirmation and debug overlay.
 * Previous complex states (superseded/lost) removed - were diagnostic only,
 * no behavioral difference in recovery.
 */
export interface MutationStats {
  pending: number;
  confirmed: number;
}

// Timeout for mutation confirmation (30 seconds)
const MUTATION_TIMEOUT_MS = 30000;

// ============================================================================
// Phase 26 (REFACTOR-04): Simplified Recovery State
// ============================================================================
// Replaced 3-state enum with simple boolean + debounce.
// Prevents concurrent/rapid snapshot requests without over-engineering.

// Debounce window for recovery requests (2 seconds)
const RECOVERY_DEBOUNCE_MS = 2000;

// ============================================================================
// Clock Sync
// ============================================================================

const CLOCK_SYNC_SAMPLES = 5;
const CLOCK_SYNC_INTERVAL_MS = 5000;

// Phase 12 Polish: State hash check interval (every 30 seconds for stale session detection)
const STATE_HASH_CHECK_INTERVAL_MS = 30000;
// REFACTOR-05: MAX_CONSECUTIVE_MISMATCHES moved to SyncHealth

// ============================================================================
// Debug Assertions (non-fatal logging for diagnosing mobile toggle bug)
// ============================================================================

/**
 * Tracks recent toggle_step messages sent for debugging.
 * If we see a revert, we can check if it correlates with these.
 */
interface ToggleRecord {
  trackId: string;
  step: number;
  sentAt: number;
}

/**
 * Non-fatal assertion logger. Logs violations of expected invariants.
 * These help diagnose the mobile toggle revert bug.
 */
const debugAssert = {
  /**
   * Assert that snapshot is expected (initial connect, not after recent toggle)
   */
  snapshotExpected(wasConnected: boolean, lastToggle: ToggleRecord | null): void {
    if (wasConnected && lastToggle) {
      const timeSinceToggle = Date.now() - lastToggle.sentAt;
      if (timeSinceToggle < 5000) {
        logger.ws.warn(`[ASSERT] UNEXPECTED_SNAPSHOT: Received snapshot ${timeSinceToggle}ms after toggle_step (track=${lastToggle.trackId}, step=${lastToggle.step}). This may cause revert!`);
      } else {
        logger.ws.log(`[ASSERT] Snapshot received (recovery), last toggle was ${timeSinceToggle}ms ago - OK`);
      }
    } else if (wasConnected) {
      logger.ws.log(`[ASSERT] Snapshot received (recovery), no recent toggles - OK`);
    } else {
      logger.ws.log(`[ASSERT] Snapshot received (initial connect) - OK`);
    }
  },

  /**
   * Assert that LOAD_STATE dispatch is expected
   */
  loadStateExpected(reason: string, source: string): void {
    logger.ws.log(`[ASSERT] LOAD_STATE dispatched: reason=${reason}, source=${source}`);
  },

  /**
   * Log toggle_step being sent
   */
  toggleSent(trackId: string, step: number): void {
    logger.ws.log(`[ASSERT] toggle_step SENT: track=${trackId}, step=${step}, time=${Date.now()}`);
  },

  /**
   * Log step_toggled received from server
   */
  stepToggledReceived(trackId: string, step: number, value: boolean, playerId: string, isOwnMessage: boolean): void {
    if (isOwnMessage) {
      logger.ws.log(`[ASSERT] step_toggled RECEIVED (own message, skipped): track=${trackId}, step=${step}, value=${value}`);
    } else {
      logger.ws.log(`[ASSERT] step_toggled RECEIVED (remote): track=${trackId}, step=${step}, value=${value}, from=${playerId}`);
    }
  },

  /**
   * Assert that state_mismatch is expected (not within grace period of toggle)
   */
  mismatchReceived(serverHash: string, lastToggle: ToggleRecord | null): void {
    if (lastToggle) {
      const timeSinceToggle = Date.now() - lastToggle.sentAt;
      if (timeSinceToggle < 5000) {
        logger.ws.warn(`[ASSERT] MISMATCH_NEAR_TOGGLE: state_mismatch ${timeSinceToggle}ms after toggle (track=${lastToggle.trackId}, step=${lastToggle.step}), serverHash=${serverHash}. May cause revert!`);
      } else {
        logger.ws.log(`[ASSERT] state_mismatch received, serverHash=${serverHash}, last toggle was ${timeSinceToggle}ms ago - probably OK`);
      }
    } else {
      logger.ws.log(`[ASSERT] state_mismatch received, serverHash=${serverHash}, no recent toggles`);
    }
  },
};

/**
 * Phase 12 Polish: Clock synchronization metrics for observability
 * REFACTOR-05: Hash check tracking moved to SyncHealth
 */
export interface ClockSyncMetrics {
  // RTT measurements
  rttMs: number;           // Current average RTT
  rttP95Ms: number;        // 95th percentile RTT (from last 20 samples)
  rttSamples: number[];    // Recent RTT samples for percentile calculation

  // Clock sync
  offsetMs: number;        // Current clock offset
  maxDriftMs: number;      // Maximum observed drift between syncs
  syncCount: number;       // Total sync operations
}

/**
 * Phase 12 Polish: Combined sync metrics for observability
 * Includes both clock sync and sync health metrics
 */
export interface SyncMetrics extends ClockSyncMetrics, SyncHealthMetrics {}

/**
 * REFACTOR-05: ClockSync now focuses only on clock synchronization (offset, RTT)
 * Hash check tracking moved to SyncHealth
 */
class ClockSync {
  private offset: number = 0;
  private rtt: number = 0;
  private samples: { offset: number; rtt: number }[] = [];
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private onSync: ((offset: number, rtt: number) => void) | null = null;

  // Phase 12 Polish: Clock sync metrics (hash tracking moved to SyncHealth)
  private metrics: ClockSyncMetrics = {
    rttMs: 0,
    rttP95Ms: 0,
    rttSamples: [],
    offsetMs: 0,
    maxDriftMs: 0,
    syncCount: 0,
  };
  private lastOffset: number = 0;

  start(requestSync: () => void, onSync: (offset: number, rtt: number) => void): void {
    this.onSync = onSync;
    // Initial sync
    requestSync();
    // Periodic sync
    this.syncInterval = setInterval(requestSync, CLOCK_SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.samples = [];
    this.offset = 0;
    this.rtt = 0;
    // Keep metrics for debugging, but reset drift tracking
    this.lastOffset = 0;
  }

  handleSyncResponse(clientTime: number, serverTime: number): void {
    const now = Date.now();
    const rtt = now - clientTime;
    const offset = serverTime - now + rtt / 2;

    this.samples.push({ offset, rtt });
    if (this.samples.length > CLOCK_SYNC_SAMPLES) {
      this.samples.shift();
    }

    // Calculate average offset (excluding outliers)
    const sortedOffsets = [...this.samples].sort((a, b) => a.offset - b.offset);
    const median = sortedOffsets[Math.floor(sortedOffsets.length / 2)].offset;
    this.offset = median;
    this.rtt = this.samples.reduce((sum, s) => sum + s.rtt, 0) / this.samples.length;

    // Phase 12 Polish: Track metrics
    this.metrics.syncCount++;
    this.metrics.rttMs = this.rtt;
    this.metrics.offsetMs = this.offset;

    // Track RTT samples for P95 calculation (keep last 20)
    this.metrics.rttSamples.push(rtt);
    if (this.metrics.rttSamples.length > 20) {
      this.metrics.rttSamples.shift();
    }
    // Calculate P95 (95th percentile) using nearest-rank method
    // For N samples: P95 index = floor((N - 1) * 0.95)
    // E.g., for 20 samples: floor(19 * 0.95) = floor(18.05) = 18 → value at index 18
    if (this.metrics.rttSamples.length >= 5) {
      const sorted = [...this.metrics.rttSamples].sort((a, b) => a - b);
      const p95Index = Math.floor((sorted.length - 1) * 0.95);
      this.metrics.rttP95Ms = sorted[p95Index];
    }

    // Track maximum drift between syncs
    if (this.lastOffset !== 0) {
      const drift = Math.abs(this.offset - this.lastOffset);
      this.metrics.maxDriftMs = Math.max(this.metrics.maxDriftMs, drift);
    }
    this.lastOffset = this.offset;

    if (this.onSync) {
      this.onSync(this.offset, this.rtt);
    }
  }

  getServerTime(): number {
    return Date.now() + this.offset;
  }

  getOffset(): number {
    return this.offset;
  }

  getRtt(): number {
    return this.rtt;
  }

  // Phase 12 Polish: Get clock sync metrics
  getMetrics(): ClockSyncMetrics {
    return { ...this.metrics };
  }
}

// ============================================================================
// Multiplayer Connection
// ============================================================================

// Phase 12: Reconnection configuration with exponential backoff + jitter
// Uses centralized retry utility - see src/utils/retry.ts
const MAX_RECONNECT_ATTEMPTS = 10; // Fall back to single-player after this many attempts

// Connection storm detection moved to src/utils/connection-storm.ts

type DispatchFn = (action: GridAction) => void;
type StateChangedCallback = (state: MultiplayerState) => void;
type PlaybackCallback = (startTime: number, tempo: number, playerId: string) => void;
type PlaybackStopCallback = (playerId: string) => void;
type RemoteChangeCallback = (trackId: string, step: number, color: string) => void;
type PlayerEventCallback = (player: PlayerInfo, event: 'join' | 'leave') => void;

// Phase 12: Offline message queue
// Phase 13B: Message priority for queue management
type MessagePriority = 'high' | 'normal' | 'low';

interface QueuedMessage {
  message: ClientMessage;
  timestamp: number;
  priority: MessagePriority;
}

/**
 * Phase 13B: Get priority level for a message type
 * High: Critical state changes (add_track, delete_track, request_snapshot)
 * Normal: User interactions (toggle_step, mute, solo, tempo, swing)
 * Low: Transient updates (cursor_move, play, stop)
 */
function getMessagePriority(messageType: ClientMessage['type']): MessagePriority {
  switch (messageType) {
    // High priority: structural changes that must not be lost
    case 'add_track':
    case 'delete_track':
    case 'set_track_sample':
    case 'request_snapshot':
      return 'high';
    // Low priority: transient/time-sensitive (can be regenerated)
    case 'cursor_move':
    case 'play':
    case 'stop':
    case 'clock_sync_request':
      return 'low';
    // Normal priority: everything else
    default:
      return 'normal';
  }
}

class MultiplayerConnection {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  // Note: dispatch is public (not private) for HandlerContext compatibility
  // The handler-factory.ts createRemoteHandler needs access to this.dispatch
  dispatch: DispatchFn | null = null;
  private reconnectAttempts: number = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private stateCallback: StateChangedCallback | null = null;
  private playbackStartCallback: PlaybackCallback | null = null;
  private playbackStopCallback: PlaybackStopCallback | null = null;
  private remoteChangeCallback: RemoteChangeCallback | null = null;
  private playerEventCallback: PlayerEventCallback | null = null;
  // Phase 21: Callback when session's published state is detected
  private publishedChangeCallback: ((isPublished: boolean) => void) | null = null;

  // Connection storm detection - uses extracted utility
  private connectionStormDetector: ConnectionStormDetector = createConnectionStormDetector();

  // Phase 12: Offline queue for buffering messages during disconnect
  private offlineQueue: QueuedMessage[] = [];
  private maxQueueSize: number = 100;
  private maxQueueAge: number = 30000; // 30 seconds max age for queued messages

  // Phase 13B: Message sequence tracking
  private clientSeq: number = 0;        // Next sequence number for outgoing messages

  // REFACTOR-05: Unified sync health tracking (replaces lastServerSeq, outOfOrderCount, and hash check tracking)
  private syncHealth = new SyncHealth();

  // Phase 12 Polish: Stale session detection
  private stateHashInterval: ReturnType<typeof setInterval> | null = null;
  private getStateForHash: (() => unknown) | null = null; // Function to get current state for hashing

  // Debug: Track last toggle_step sent for assertion logging
  private lastToggle: ToggleRecord | null = null;

  // Phase 21.5: Track last applied snapshot timestamp to prevent stale snapshots
  private lastAppliedSnapshotTimestamp: number = 0;

  // Phase 26 (REFACTOR-03): Simplified mutation tracking - just seq -> sentAt timestamp
  private pendingMutations: Map<number, number> = new Map();  // clientSeq -> sentAt
  private mutationStats: MutationStats = {
    pending: 0,
    confirmed: 0,
  };

  // Phase 26: Confirmed state tracking for snapshot regression detection
  // Tracks what we KNOW exists on the server (from broadcasts), not just pending mutations
  private confirmedTracks: Set<string> = new Set();  // Track IDs confirmed to exist
  private confirmedSteps: Map<string, Set<number>> = new Map();  // trackId -> active step indices
  private lastConfirmedAt: number = 0;  // Timestamp of last confirmed change

  // Phase 26 (REFACTOR-04): Simplified recovery state - boolean + debounce
  private recoveryInProgress = false;
  private lastRecoveryRequest = 0;

  // Note: state is public (not private) for HandlerContext compatibility
  // The handler-factory.ts createRemoteHandler needs access to this.state.playerId
  state: MultiplayerState = {
    status: 'disconnected',
    playerId: null,
    players: [],
    error: null,
    cursors: new Map(),
    playingPlayerIds: new Set(),
  };

  public readonly clockSync = new ClockSync();

  /**
   * Connect to multiplayer session
   * @param getStateForHash - Optional function to get current state for hash verification
   */
  connect(
    sessionId: string,
    dispatch: DispatchFn,
    onStateChanged?: StateChangedCallback,
    onPlaybackStart?: PlaybackCallback,
    onPlaybackStop?: PlaybackStopCallback,
    onRemoteChange?: RemoteChangeCallback,
    onPlayerEvent?: PlayerEventCallback,
    getStateForHash?: () => unknown,
    onPublishedChange?: (isPublished: boolean) => void
  ): void {
    this.sessionId = sessionId;
    this.dispatch = dispatch;
    this.stateCallback = onStateChanged ?? null;
    this.playbackStartCallback = onPlaybackStart ?? null;
    this.playbackStopCallback = onPlaybackStop ?? null;
    this.remoteChangeCallback = onRemoteChange ?? null;
    this.playerEventCallback = onPlayerEvent ?? null;
    this.getStateForHash = getStateForHash ?? null;
    this.publishedChangeCallback = onPublishedChange ?? null;

    this.updateState({ status: 'connecting', error: null });
    this.createWebSocket();
  }

  /**
   * Disconnect from multiplayer session
   */
  disconnect(): void {
    this.cleanup();
    this.updateState({
      status: 'disconnected',
      playerId: null,
      players: [],
      playingPlayerIds: new Set(),
    });
  }

  /**
   * Send a message to the server
   * Phase 12: Queue messages when disconnected for replay on reconnect
   * Phase 13B: Add sequence numbers for ordering
   */
  send(message: ClientMessage): void {
    // Debug: Track toggle_step messages for assertion logging
    if (message.type === 'toggle_step') {
      this.lastToggle = {
        trackId: message.trackId,
        step: message.step,
        sentAt: Date.now(),
      };
      debugAssert.toggleSent(message.trackId, message.step);
    }

    // Phase 13B: Add sequence number to message
    // Skip seq for certain message types that don't need ordering
    const needsSeq = message.type !== 'clock_sync_request' &&
                     message.type !== 'cursor_move' &&
                     message.type !== 'state_hash';

    const messageWithSeq: ClientMessage = needsSeq
      ? { ...message, seq: ++this.clientSeq, ack: this.lastServerSeq }
      : message;

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(messageWithSeq));

      // Phase 26: Hook Point 1 - Track mutations for delivery confirmation
      if (needsSeq && MUTATING_MESSAGE_TYPES.has(message.type)) {
        this.trackMutation(messageWithSeq, message);
      }
    } else if (this.state.status === 'connecting') {
      // Queue message for replay when connection is established
      this.queueMessage(messageWithSeq);
    }
    // Note: If disconnected (not connecting), we don't queue
    // because the state will be synced fresh on reconnect
  }

  /**
   * Phase 26 (REFACTOR-03): Track a mutation for delivery confirmation
   * Simplified: just track clientSeq and timestamp
   */
  private trackMutation(messageWithSeq: ClientMessage, originalMessage: ClientMessage): void {
    const seq = messageWithSeq.seq;
    if (seq === undefined) return;

    this.pendingMutations.set(seq, Date.now());
    this.mutationStats.pending++;

    logger.ws.log(`[MUTATION-TRACK] Tracking ${originalMessage.type} seq=${seq}`);
  }

  /**
   * Phase 26 (REFACTOR-03): Confirm a mutation was delivered via clientSeq echo
   */
  private confirmMutation(clientSeq: number): void {
    if (this.pendingMutations.has(clientSeq)) {
      this.pendingMutations.delete(clientSeq);
      this.mutationStats.pending--;
      this.mutationStats.confirmed++;

      logger.ws.log(`[MUTATION-TRACK] Confirmed seq=${clientSeq}`);
    }
  }

  /**
   * Phase 26 (REFACTOR-03): Prune old pending mutations
   * Called on snapshot receipt to clean up stale tracking
   */
  private pruneOldMutations(): void {
    const now = Date.now();

    for (const [seq, sentAt] of this.pendingMutations) {
      if (now - sentAt > MUTATION_TIMEOUT_MS) {
        this.pendingMutations.delete(seq);
        this.mutationStats.pending--;
        logger.ws.warn('[MUTATION TIMEOUT] Mutation never confirmed', { seq, age: now - sentAt });
      }
    }
  }

  /**
   * Phase 26: Get mutation tracking statistics for debugging
   */
  getMutationStats(): MutationStats {
    return { ...this.mutationStats };
  }

  /**
   * Phase 26: Get count of pending mutations (for debug overlay)
   */
  getPendingMutationCount(): number {
    return this.pendingMutations.size;
  }

  /**
   * Phase 26: Get the age of the oldest pending mutation (for debug overlay)
   * Returns 0 if no pending mutations
   */
  getOldestPendingMutationAge(): number {
    if (this.pendingMutations.size === 0) return 0;

    const now = Date.now();
    let oldest = now;

    for (const sentAt of this.pendingMutations.values()) {
      if (sentAt < oldest) {
        oldest = sentAt;
      }
    }

    return oldest === now ? 0 : now - oldest;
  }

  /**
   * Phase 26 (BUG-03): Get message ordering stats for debug overlay
   * REFACTOR-05: Now delegates to SyncHealth
   */
  getMessageOrderingStats(): { outOfOrderCount: number; lastServerSeq: number } {
    return {
      outOfOrderCount: this.syncHealth.getOutOfOrderCount(),
      lastServerSeq: this.syncHealth.getLastServerSeq(),
    };
  }

  /**
   * Phase 26 (REFACTOR-04): Request snapshot with debounce protection
   *
   * Prevents duplicate/rapid snapshot requests without complex state machine.
   * Returns true if the request was sent, false if debounced.
   */
  private requestSnapshotRecovery(reason: string): boolean {
    const now = Date.now();

    // Check debounce window
    if (this.recoveryInProgress || now - this.lastRecoveryRequest < RECOVERY_DEBOUNCE_MS) {
      logger.ws.log(`[RECOVERY] Skipping snapshot request (${reason}) - debounced`);
      return false;
    }

    this.recoveryInProgress = true;
    this.lastRecoveryRequest = now;
    logger.ws.log(`[RECOVERY] Requesting snapshot: ${reason}`);

    this.send({ type: 'request_snapshot' });
    return true;
  }

  /**
   * Phase 26 (REFACTOR-04): Reset recovery state after snapshot application
   */
  private completeRecovery(): void {
    this.recoveryInProgress = false;
    logger.ws.log('[RECOVERY] Recovery complete');
  }

  /**
   * Phase 26: Update confirmed state based on server broadcast
   *
   * Called when we receive confirmation that state exists on the server:
   * - track_added: Add track to confirmed set
   * - track_deleted: Remove track from confirmed set
   * - step_toggled: Add/remove step from confirmed set
   * - On our own mutation confirmed (clientSeq echo)
   */
  private updateConfirmedState(
    type: 'track_added' | 'track_deleted' | 'step_toggled',
    trackId: string,
    step?: number,
    stepValue?: boolean
  ): void {
    this.lastConfirmedAt = Date.now();

    switch (type) {
      case 'track_added':
        this.confirmedTracks.add(trackId);
        // Initialize step set for this track
        if (!this.confirmedSteps.has(trackId)) {
          this.confirmedSteps.set(trackId, new Set());
        }
        logger.ws.log(`[CONFIRMED] Track added: ${trackId}`);
        break;

      case 'track_deleted':
        this.confirmedTracks.delete(trackId);
        this.confirmedSteps.delete(trackId);
        logger.ws.log(`[CONFIRMED] Track deleted: ${trackId}`);
        break;

      case 'step_toggled':
        if (step !== undefined) {
          // Ensure step set exists
          if (!this.confirmedSteps.has(trackId)) {
            this.confirmedSteps.set(trackId, new Set());
          }
          const steps = this.confirmedSteps.get(trackId)!;

          if (stepValue) {
            steps.add(step);
            logger.ws.log(`[CONFIRMED] Step on: ${trackId}:${step}`);
          } else {
            steps.delete(step);
            logger.ws.log(`[CONFIRMED] Step off: ${trackId}:${step}`);
          }
        }
        break;
    }
  }

  /**
   * Phase 26: Check if snapshot would regress confirmed state
   *
   * Logs [SNAPSHOT REGRESSION] if confirmed tracks or steps are missing.
   * Does NOT block the snapshot - just logs for debugging.
   */
  private checkSnapshotRegression(snapshot: SessionState, snapshotTimestamp: number): void {
    // Skip if this is initial connect (no confirmed state yet)
    if (this.confirmedTracks.size === 0 && this.confirmedSteps.size === 0) {
      return;
    }

    const snapshotTrackIds = new Set(snapshot.tracks.map(t => t.id));
    let regressionCount = 0;

    // Check for missing tracks
    for (const confirmedTrackId of this.confirmedTracks) {
      if (!snapshotTrackIds.has(confirmedTrackId)) {
        regressionCount++;
        logger.ws.error('[SNAPSHOT REGRESSION] Confirmed track missing from snapshot', {
          trackId: confirmedTrackId,
          snapshotTimestamp,
          lastConfirmedAt: this.lastConfirmedAt,
          gap: snapshotTimestamp - this.lastConfirmedAt,
          sessionId: this.sessionId,
          confirmedTrackCount: this.confirmedTracks.size,
          snapshotTrackCount: snapshot.tracks.length,
        });
      }
    }

    // Check for missing steps
    for (const [trackId, confirmedStepSet] of this.confirmedSteps) {
      const snapshotTrack = snapshot.tracks.find(t => t.id === trackId);

      if (!snapshotTrack) {
        // Track is missing - already logged above if it was confirmed
        continue;
      }

      for (const step of confirmedStepSet) {
        if (!snapshotTrack.steps[step]) {
          regressionCount++;
          logger.ws.error('[SNAPSHOT REGRESSION] Confirmed step missing from snapshot', {
            trackId,
            step,
            snapshotTimestamp,
            lastConfirmedAt: this.lastConfirmedAt,
            gap: snapshotTimestamp - this.lastConfirmedAt,
            sessionId: this.sessionId,
          });
        }
      }
    }

    if (regressionCount > 0) {
      logger.ws.error(`[SNAPSHOT REGRESSION SUMMARY] ${regressionCount} confirmed items missing`, {
        confirmedTracks: Array.from(this.confirmedTracks),
        confirmedStepCount: Array.from(this.confirmedSteps.values()).reduce((sum, s) => sum + s.size, 0),
        snapshotTrackIds: Array.from(snapshotTrackIds),
        sessionId: this.sessionId,
      });
    }
  }

  /**
   * Phase 26: Reset confirmed state (on disconnect or snapshot application)
   */
  private resetConfirmedState(): void {
    this.confirmedTracks.clear();
    this.confirmedSteps.clear();
    this.lastConfirmedAt = 0;
  }

  /**
   * Phase 12: Queue a message for replay on reconnect
   * Phase 13B: Add priority-based queue management
   */
  private queueMessage(message: ClientMessage): void {
    // Don't queue certain message types that are time-sensitive
    if (message.type === 'clock_sync_request' || message.type === 'state_hash') {
      return;
    }

    const priority = getMessagePriority(message.type);

    // Phase 13B: Priority-based eviction when queue is full
    // Try to drop lowest priority message first
    if (this.offlineQueue.length >= this.maxQueueSize) {
      const evicted = this.evictLowestPriority();
      if (!evicted) {
        // Couldn't evict anything (all high priority), drop this message
        logger.ws.log(`Queue full, dropping ${priority} priority message: ${message.type}`);
        return;
      }
    }

    this.offlineQueue.push({
      message,
      timestamp: Date.now(),
      priority,
    });

    logger.ws.log(`Queued ${priority} priority message: ${message.type} (queue size: ${this.offlineQueue.length})`);
  }

  /**
   * Phase 13B: Evict the lowest priority message from the queue
   * Prefers evicting: low > normal > high (oldest first within same priority)
   * Returns true if a message was evicted, false if queue is empty or all high priority
   */
  private evictLowestPriority(): boolean {
    // Find index of lowest priority message (oldest first within same priority)
    let lowIndex = -1;
    let normalIndex = -1;

    for (let i = 0; i < this.offlineQueue.length; i++) {
      const p = this.offlineQueue[i].priority;
      if (p === 'low' && lowIndex === -1) {
        lowIndex = i;
        break; // Found oldest low priority, evict immediately
      }
      if (p === 'normal' && normalIndex === -1) {
        normalIndex = i;
      }
    }

    // Evict in order: low > normal (never evict high priority to make room)
    const evictIndex = lowIndex !== -1 ? lowIndex : normalIndex;
    if (evictIndex !== -1) {
      const evicted = this.offlineQueue.splice(evictIndex, 1)[0];
      logger.ws.log(`Evicted ${evicted.priority} priority message: ${evicted.message.type}`);
      return true;
    }

    return false;
  }

  /**
   * Phase 12: Replay queued messages after reconnect
   * Phase 13B: Send high priority messages first
   */
  private replayQueuedMessages(): void {
    const now = Date.now();
    let replayed = 0;
    let dropped = 0;

    // Phase 13B: Sort by priority (high first), then by timestamp (oldest first)
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    const sortedQueue = [...this.offlineQueue].sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });

    for (const queued of sortedQueue) {
      // Drop messages that are too old
      if (now - queued.timestamp > this.maxQueueAge) {
        dropped++;
        continue;
      }

      // Replay the message
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(queued.message));
        replayed++;
      }
    }

    if (replayed > 0 || dropped > 0) {
      logger.ws.log(`Replayed ${replayed} queued messages (by priority), dropped ${dropped} stale messages`);
    }

    // Clear the queue
    this.offlineQueue = [];
  }

  /**
   * Phase 12: Get queue size (for debugging/UI)
   */
  getQueueSize(): number {
    return this.offlineQueue.length;
  }

  /**
   * Get current connection state
   */
  getState(): MultiplayerState {
    return { ...this.state };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state.status === 'connected';
  }

  /**
   * Get server time (adjusted for clock sync)
   */
  getServerTime(): number {
    return this.clockSync.getServerTime();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createWebSocket(): void {
    if (!this.sessionId) return;

    // Connection storm detection - warns if rapid reconnections indicate a bug
    // See docs/bug-patterns.md "Unstable Callback in useEffect Dependency" for details.
    this.connectionStormDetector.recordConnection();
    if (this.connectionStormDetector.isStorm() && !this.connectionStormDetector.hasWarned()) {
      this.connectionStormDetector.markWarned();
      const connections = this.connectionStormDetector.getConnectionCount();
      logger.ws.error(
        `🚨 CONNECTION STORM DETECTED! ${connections} connections in detection window.\n` +
        `This likely indicates an unstable callback in a useEffect dependency array.\n` +
        `Check for useCallback with state dependencies used in useEffect.\n` +
        `See docs/bug-patterns.md "Unstable Callback in useEffect Dependency" for details.`
      );
      console.error(
        `[Keyboardia] CONNECTION STORM DETECTED: ${connections} WebSocket connections. ` +
        `This is a bug - please report it. See console for details.`
      );
    }

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/sessions/${this.sessionId}/ws`;

    logger.ws.log('Connecting to', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
    } catch (e) {
      logger.ws.error('Failed to create WebSocket:', e);
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    logger.ws.log('Connected');
    this.reconnectAttempts = 0;

    // Start clock sync
    this.clockSync.start(
      () => this.send({ type: 'clock_sync_request', clientTime: Date.now() }),
      (offset, rtt) => logger.ws.log(`Clock sync: offset=${offset}ms, rtt=${rtt}ms`)
    );

    // Phase 12 Polish: Start periodic state hash checking for stale session detection
    this.startStateHashCheck();
  }

  /**
   * Phase 12 Polish: Start periodic state hash checking
   * Detects state divergence between client and server
   */
  private startStateHashCheck(): void {
    // Clear any existing interval
    if (this.stateHashInterval) {
      clearInterval(this.stateHashInterval);
    }

    // Only check if we have a state getter function
    if (!this.getStateForHash) {
      logger.ws.log('State hash checking disabled (no state getter provided)');
      return;
    }

    // Periodic hash check
    this.stateHashInterval = setInterval(() => {
      this.sendStateHash();
    }, STATE_HASH_CHECK_INTERVAL_MS);

    logger.ws.log(`State hash checking enabled (every ${STATE_HASH_CHECK_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Phase 12 Polish: Stop state hash checking
   */
  private stopStateHashCheck(): void {
    if (this.stateHashInterval) {
      clearInterval(this.stateHashInterval);
      this.stateHashInterval = null;
    }
  }

  /**
   * Phase 12 Polish: Send current state hash to server for verification.
   * Uses canonicalizeForHash to ensure consistent hashing between client and server.
   */
  private sendStateHash(): void {
    if (!this.getStateForHash || this.state.status !== 'connected') {
      return;
    }

    const state = this.getStateForHash() as StateForHash;
    const canonicalState = canonicalizeForHash(state);
    const hash = hashState(canonicalState);
    logger.ws.log(`Sending state hash: ${hash}`);
    this.send({ type: 'state_hash', hash });
  }

  private handleClose(event: CloseEvent): void {
    logger.ws.log('Disconnected:', event.code, event.reason);
    this.clockSync.stop();
    this.stopStateHashCheck();

    if (event.code !== 1000) {
      // Abnormal close - try to reconnect
      this.scheduleReconnect();
    } else {
      this.updateState({ status: 'disconnected' });
    }
  }

  private handleError(event: Event): void {
    logger.ws.error('Error:', event);
    this.updateState({ error: 'Connection error' });
  }

  private handleMessage(event: MessageEvent): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      logger.ws.error('Invalid message:', e);
      return;
    }

    // REFACTOR-05: Use SyncHealth for sequence tracking
    if (msg.seq !== undefined) {
      const seqResult = this.syncHealth.recordServerSeq(msg.seq);

      // Log gaps and out-of-order for debugging
      if (seqResult.missed > 0) {
        logger.ws.warn(`Missed ${seqResult.missed} message(s) at seq ${msg.seq}`);
      }
      if (seqResult.outOfOrder) {
        logger.ws.warn(`Out-of-order message: seq ${msg.seq}`);
      }

      // Check if recovery is needed based on sync health
      const recoveryDecision = this.syncHealth.needsRecovery();
      if (recoveryDecision.needed && !this.recoveryInProgress) {
        // Check what kind of recovery is needed
        if (recoveryDecision.reason?.includes('out-of-order')) {
          // Too many out-of-order messages - trigger reconnect
          logger.ws.warn(`Triggering reconnect: ${recoveryDecision.reason}`);
          this.scheduleReconnect();
        } else if (recoveryDecision.reason?.includes('gap')) {
          // Large gap - request snapshot
          this.requestSnapshotRecovery(recoveryDecision.reason);
        }
      }
    }

    // Phase 26: Hook Point 2 - Confirm delivery via clientSeq echo
    if (msg.clientSeq !== undefined) {
      this.confirmMutation(msg.clientSeq);
    }

    logger.ws.log('Received:', msg.type, msg.seq !== undefined ? `seq=${msg.seq}` : '');

    switch (msg.type) {
      case 'snapshot':
        this.handleSnapshot(msg);
        break;
      case 'step_toggled':
        this.handleStepToggled(msg);
        // Phase 26: Track confirmed state from server broadcast
        this.updateConfirmedState('step_toggled', msg.trackId, msg.step, msg.value);
        break;
      case 'tempo_changed':
        this.handleTempoChanged(msg);
        break;
      case 'swing_changed':
        this.handleSwingChanged(msg);
        break;
      case 'track_muted':
        this.handleTrackMuted(msg);
        break;
      case 'track_soloed':
        this.handleTrackSoloed(msg);
        break;
      case 'parameter_lock_set':
        this.handleParameterLockSet(msg);
        break;
      case 'track_added':
        this.handleTrackAdded(msg);
        // Phase 26: Track confirmed state from server broadcast
        this.updateConfirmedState('track_added', msg.track.id);
        // Also record any active steps in the track
        msg.track.steps.forEach((active, idx) => {
          if (active) {
            this.updateConfirmedState('step_toggled', msg.track.id, idx, true);
          }
        });
        break;
      case 'track_deleted':
        this.handleTrackDeleted(msg);
        // Phase 26: Track confirmed state from server broadcast
        this.updateConfirmedState('track_deleted', msg.trackId);
        break;
      case 'track_cleared':
        this.handleTrackCleared(msg);
        // Phase 26: Clear confirmed steps for this track (track still exists, but no active steps)
        if (this.confirmedSteps.has(msg.trackId)) {
          this.confirmedSteps.get(msg.trackId)!.clear();
        }
        break;
      case 'track_sample_set':
        this.handleTrackSampleSet(msg);
        break;
      case 'track_volume_set':
        this.handleTrackVolumeSet(msg);
        break;
      case 'track_transpose_set':
        this.handleTrackTransposeSet(msg);
        break;
      case 'track_step_count_set':
        this.handleTrackStepCountSet(msg);
        break;
      case 'effects_changed':
        this.handleEffectsChanged(msg);
        break;
      case 'fm_params_changed':
        this.handleFMParamsChanged(msg);
        break;
      case 'playback_started':
        this.handlePlaybackStarted(msg);
        break;
      case 'playback_stopped':
        this.handlePlaybackStopped(msg);
        break;
      case 'player_joined':
        this.handlePlayerJoined(msg);
        break;
      case 'player_left':
        this.handlePlayerLeft(msg);
        break;
      case 'clock_sync_response':
        this.clockSync.handleSyncResponse(msg.clientTime, msg.serverTime);
        break;
      case 'state_mismatch':
        logger.ws.warn('State mismatch detected, server hash:', msg.serverHash);
        this.handleStateMismatch(msg.serverHash);
        break;
      case 'state_hash_match':
        logger.ws.log('State hash match confirmed by server');
        this.syncHealth.recordHashCheck(true);
        break;
      case 'cursor_moved':
        this.handleCursorMoved(msg);
        break;
      case 'error':
        logger.ws.error('Server error:', msg.message);
        this.updateState({ error: msg.message });
        break;
    }
  }

  // ============================================================================
  // Message Handlers
  // ============================================================================

  private handleSnapshot(msg: { state: SessionState; players: PlayerInfo[]; playerId: string; immutable?: boolean; snapshotTimestamp?: number; playingPlayerIds?: string[] }): void {
    // Debug assertion: check if snapshot is expected
    const wasConnected = this.state.status === 'connected';
    debugAssert.snapshotExpected(wasConnected, this.lastToggle);

    // REFACTOR-04: Recovery in progress flag stays set until completeRecovery is called

    // Phase 21.5: Check for stale snapshots (network reordering protection)
    // Only check if we have a timestamp and have applied a previous snapshot
    if (msg.snapshotTimestamp && this.lastAppliedSnapshotTimestamp > 0) {
      if (msg.snapshotTimestamp < this.lastAppliedSnapshotTimestamp) {
        logger.multiplayer.warn('Ignoring stale snapshot', {
          received: msg.snapshotTimestamp,
          lastApplied: this.lastAppliedSnapshotTimestamp,
          delta: this.lastAppliedSnapshotTimestamp - msg.snapshotTimestamp,
        });
        return;
      }
    }

    // Update timestamp tracking
    if (msg.snapshotTimestamp) {
      this.lastAppliedSnapshotTimestamp = msg.snapshotTimestamp;
    }

    // Phase 26: Check for snapshot regression BEFORE applying
    // This logs warnings if confirmed state would be lost
    this.checkSnapshotRegression(msg.state, msg.snapshotTimestamp ?? Date.now());

    // Phase 22: Initialize playingPlayerIds from snapshot
    const playingPlayerIds = new Set(msg.playingPlayerIds ?? []);

    this.updateState({
      status: 'connected',
      playerId: msg.playerId,
      players: msg.players,
      playingPlayerIds,
    });

    // Load state into grid
    if (this.dispatch) {
      const reason = wasConnected ? 'snapshot_recovery' : 'initial_connect';
      debugAssert.loadStateExpected(reason, 'handleSnapshot');

      this.dispatch({
        type: 'LOAD_STATE',
        tracks: msg.state.tracks,
        tempo: msg.state.tempo,
        swing: msg.state.swing,
        // Phase 22: Include effects from snapshot for session persistence
        effects: msg.state.effects,
        isRemote: true,
      });
    }

    // Phase 21: Notify about published state (for disabling UI)
    if (this.publishedChangeCallback && msg.immutable !== undefined) {
      this.publishedChangeCallback(msg.immutable);
    }

    // REFACTOR-05: Reset sync health recovery flags after successful snapshot load
    // This ensures we don't keep requesting snapshots after recovery
    this.syncHealth.resetRecoveryFlags();

    // Phase 26 (REFACTOR-03): Prune old mutations on snapshot receipt
    this.pruneOldMutations();

    // Phase 26: Reset and rebuild confirmed state from snapshot
    // Snapshot becomes the new source of truth
    this.resetConfirmedState();
    for (const track of msg.state.tracks) {
      this.confirmedTracks.add(track.id);
      const stepSet = new Set<number>();
      track.steps.forEach((active, idx) => {
        if (active) stepSet.add(idx);
      });
      if (stepSet.size > 0) {
        this.confirmedSteps.set(track.id, stepSet);
      }
    }
    this.lastConfirmedAt = Date.now();
    logger.ws.log(`[CONFIRMED] Rebuilt from snapshot: ${this.confirmedTracks.size} tracks, ${Array.from(this.confirmedSteps.values()).reduce((sum, s) => sum + s.size, 0)} steps`);

    // Phase 12: Replay any queued messages after receiving snapshot
    // This handles changes made while reconnecting
    this.replayQueuedMessages();

    // Phase 26 (REFACTOR-03): Clear pending mutations on snapshot (fresh start)
    this.clearPendingMutationsOnSnapshot(msg.state);

    // REFACTOR-04: Complete recovery after snapshot is fully applied
    if (this.recoveryInProgress) {
      this.completeRecovery();
    }
  }

  /**
   * Phase 26 (REFACTOR-03): Clear pending mutations on snapshot
   *
   * Snapshot becomes the new source of truth. Any pending mutations
   * are considered superseded by the authoritative server state.
   */
  private clearPendingMutationsOnSnapshot(_snapshotState: SessionState): void {
    if (this.pendingMutations.size === 0) return;

    const count = this.pendingMutations.size;
    this.mutationStats.pending -= count;
    this.pendingMutations.clear();

    if (count > 0) {
      logger.ws.log(`[MUTATION-TRACK] Cleared ${count} pending mutations on snapshot (fresh start)`);
    }
  }

  private handleStepToggled(msg: { trackId: string; step: number; value: boolean; playerId: string }): void {
    const isOwnMessage = msg.playerId === this.state.playerId;
    debugAssert.stepToggledReceived(msg.trackId, msg.step, msg.value, msg.playerId, isOwnMessage);

    if (isOwnMessage) return; // Skip own messages

    if (this.dispatch) {
      // Use REMOTE_STEP_SET to set specific value without toggling
      this.dispatch({
        type: 'REMOTE_STEP_SET',
        trackId: msg.trackId,
        step: msg.step,
        value: msg.value,
        isRemote: true,
      });
    }

    // Trigger colored flash for change attribution
    if (this.remoteChangeCallback) {
      const player = this.state.players.find(p => p.id === msg.playerId);
      if (player?.color) {
        this.remoteChangeCallback(msg.trackId, msg.step, player.color);
      }
    }
  }

  // Migrated to use createRemoteHandler factory
  private handleTempoChanged = createRemoteHandler<{ tempo: number; playerId: string }>(
    (msg) => ({ type: 'SET_TEMPO', tempo: msg.tempo })
  );

  private handleSwingChanged = createRemoteHandler<{ swing: number; playerId: string }>(
    (msg) => ({ type: 'SET_SWING', swing: msg.swing })
  );

  private handleTrackMuted(msg: { trackId: string; muted: boolean; playerId: string }): void {
    // Mute is LOCAL ONLY - "my ears, my control"
    // We receive the message but don't apply it to local state
    // Each user controls their own mix
    if (msg.playerId === this.state.playerId) return;
    logger.multiplayer.log('Remote mute (not applied locally):', msg.trackId, msg.muted, 'by', msg.playerId);
  }

  private handleTrackSoloed(msg: { trackId: string; soloed: boolean; playerId: string }): void {
    // Solo is LOCAL ONLY - "my ears, my control"
    // We receive the message but don't apply it to local state
    // Each user controls their own focus
    if (msg.playerId === this.state.playerId) return;
    logger.multiplayer.log('Remote solo (not applied locally):', msg.trackId, msg.soloed, 'by', msg.playerId);
  }

  private handleParameterLockSet = createRemoteHandler<{
    trackId: string;
    step: number;
    lock: ParameterLock | null;
    playerId: string;
  }>((msg) => ({
    type: 'SET_PARAMETER_LOCK',
    trackId: msg.trackId,
    step: msg.step,
    lock: msg.lock,
  }));

  private handleTrackAdded = createRemoteHandler<{ track: Track; playerId: string }>(
    (msg) => ({
      type: 'ADD_TRACK',
      sampleId: msg.track.sampleId,
      name: msg.track.name,
      track: msg.track,
    })
  );

  private handleTrackDeleted = createRemoteHandler<{ trackId: string; playerId: string }>(
    (msg) => ({ type: 'DELETE_TRACK', trackId: msg.trackId })
  );

  private handleTrackCleared = createRemoteHandler<{ trackId: string; playerId: string }>(
    (msg) => ({ type: 'CLEAR_TRACK', trackId: msg.trackId })
  );

  private handleTrackSampleSet = createRemoteHandler<{
    trackId: string;
    sampleId: string;
    name: string;
    playerId: string;
  }>((msg) => ({
    type: 'SET_TRACK_SAMPLE',
    trackId: msg.trackId,
    sampleId: msg.sampleId,
    name: msg.name,
  }));

  private handleTrackVolumeSet = createRemoteHandler<{
    trackId: string;
    volume: number;
    playerId: string;
  }>((msg) => ({
    type: 'SET_TRACK_VOLUME',
    trackId: msg.trackId,
    volume: msg.volume,
  }));

  private handleTrackTransposeSet = createRemoteHandler<{
    trackId: string;
    transpose: number;
    playerId: string;
  }>((msg) => ({
    type: 'SET_TRACK_TRANSPOSE',
    trackId: msg.trackId,
    transpose: msg.transpose,
  }));

  private handleTrackStepCountSet = createRemoteHandler<{
    trackId: string;
    stepCount: number;
    playerId: string;
  }>((msg) => ({
    type: 'SET_TRACK_STEP_COUNT',
    trackId: msg.trackId,
    stepCount: msg.stepCount,
  }));

  /** Phase 25: Handle effects state change from another player */
  private handleEffectsChanged = createRemoteHandler<{
    effects: EffectsState;
    playerId: string;
  }>((msg) => ({
    type: 'SET_EFFECTS',
    effects: msg.effects,
  }));

  /** Phase 24: Handle FM params change from another player */
  private handleFMParamsChanged = createRemoteHandler<{
    trackId: string;
    fmParams: FMParams;
    playerId: string;
  }>((msg) => ({
    type: 'SET_FM_PARAMS',
    trackId: msg.trackId,
    fmParams: msg.fmParams,
  }));

  private handlePlaybackStarted(msg: { playerId: string; startTime: number; tempo: number }): void {
    logger.ws.log('Playback started by', msg.playerId, 'at', msg.startTime);

    // Phase 22: Track which players are playing
    const playingPlayerIds = new Set(this.state.playingPlayerIds);
    playingPlayerIds.add(msg.playerId);
    this.updateState({ playingPlayerIds });

    if (this.playbackStartCallback) {
      this.playbackStartCallback(msg.startTime, msg.tempo, msg.playerId);
    }
  }

  private handlePlaybackStopped(msg: { playerId: string }): void {
    logger.ws.log('Playback stopped by', msg.playerId);

    // Phase 22: Track which players are playing
    const playingPlayerIds = new Set(this.state.playingPlayerIds);
    playingPlayerIds.delete(msg.playerId);
    this.updateState({ playingPlayerIds });

    if (this.playbackStopCallback) {
      this.playbackStopCallback(msg.playerId);
    }
  }

  private handlePlayerJoined(msg: { player: PlayerInfo }): void {
    const players = [...this.state.players, msg.player];
    this.updateState({ players });
    logger.ws.log('Player joined:', msg.player.name, 'Total:', players.length);

    // Phase 11: Player join notification
    if (this.playerEventCallback) {
      this.playerEventCallback(msg.player, 'join');
    }
  }

  private handlePlayerLeft(msg: { playerId: string }): void {
    // Find the player before removing them (for notification)
    const leavingPlayer = this.state.players.find(p => p.id === msg.playerId);
    const players = this.state.players.filter(p => p.id !== msg.playerId);

    // Phase 11: Remove their cursor
    const cursors = new Map(this.state.cursors);
    cursors.delete(msg.playerId);

    // Phase 22: Remove from playing players (server broadcasts stop on disconnect,
    // but we also clean up here for consistency)
    const playingPlayerIds = new Set(this.state.playingPlayerIds);
    playingPlayerIds.delete(msg.playerId);

    this.updateState({ players, cursors, playingPlayerIds });
    logger.ws.log('Player left:', msg.playerId, 'Total:', players.length);

    // Phase 11: Player leave notification
    if (this.playerEventCallback && leavingPlayer) {
      this.playerEventCallback(leavingPlayer, 'leave');
    }
  }

  /**
   * Phase 11: Handle cursor movement from another player
   */
  private handleCursorMoved(msg: {
    playerId: string;
    position: CursorPosition;
    color: string;
    name: string;
  }): void {
    // Update cursor position for this player
    const cursors = new Map(this.state.cursors);
    cursors.set(msg.playerId, {
      playerId: msg.playerId,
      position: msg.position,
      color: msg.color,
      name: msg.name,
      lastUpdate: Date.now(),
    });

    // Update state (this triggers re-render via callback)
    this.updateState({ cursors });
  }

  // ============================================================================
  // State Mismatch Recovery
  // ============================================================================

  /**
   * Phase 12 Polish: Handle state mismatch by tracking and potentially requesting recovery
   * REFACTOR-05: Now uses SyncHealth for mismatch tracking
   */
  private handleStateMismatch(serverHash: string): void {
    // Debug assertion: check if mismatch is near a recent toggle
    debugAssert.mismatchReceived(serverHash, this.lastToggle);

    // Record the mismatch in SyncHealth
    this.syncHealth.recordHashCheck(false);

    const metrics = this.syncHealth.getMetrics();
    logger.ws.warn(`State mismatch #${metrics.consecutiveMismatches}: local hash differs from server hash ${serverHash}`);

    // Check if we should request a full snapshot
    const recovery = this.syncHealth.needsRecovery();
    if (recovery.needed && recovery.reason?.includes('mismatch')) {
      this.requestSnapshotRecovery(recovery.reason);
    } else {
      logger.ws.log(`Waiting for next hash check (${metrics.consecutiveMismatches}/2 before snapshot)`);
    }
  }

  // ============================================================================
  // Reconnection (Phase 12: with exponential backoff + jitter)
  // ============================================================================

  private scheduleReconnect(): void {
    // Phase 12: Fall back to single-player mode after max attempts
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.ws.log(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, falling back to single-player mode`);
      this.updateState({
        status: 'single_player',
        error: 'Unable to connect to multiplayer server. Working in single-player mode.',
        reconnectAttempts: this.reconnectAttempts,
      });
      // Don't clear offline queue - might be useful for debugging
      return;
    }

    const delay = calculateBackoffDelay(this.reconnectAttempts);
    this.reconnectAttempts++;

    logger.ws.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}, jitter applied)`);
    this.updateState({
      status: 'connecting',
      error: null,
      reconnectAttempts: this.reconnectAttempts,
      queueSize: this.offlineQueue.length,
    });

    this.reconnectTimeout = setTimeout(() => {
      this.createWebSocket();
    }, delay);
  }

  /**
   * Phase 12: Manually retry connection after falling back to single-player
   */
  retryConnection(): void {
    if (this.state.status !== 'single_player') return;
    if (!this.sessionId || !this.dispatch) return;

    logger.ws.log('Manual retry requested');
    this.reconnectAttempts = 0;
    this.updateState({ status: 'connecting', error: null });
    this.createWebSocket();
  }

  /**
   * Phase 12: Get current reconnect attempt count (for UI)
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Phase 12 Polish: Get sync metrics for debugging/observability
   * REFACTOR-05: Combines clock sync and sync health metrics
   */
  getSyncMetrics(): SyncMetrics {
    const clockMetrics = this.clockSync.getMetrics();
    const healthMetrics = this.syncHealth.getMetrics();
    return { ...clockMetrics, ...healthMetrics };
  }

  private cleanup(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
    }

    this.clockSync.stop();
    this.stopStateHashCheck();
    this.reconnectAttempts = 0;

    // Phase 13B: Reset sequence tracking on disconnect
    this.clientSeq = 0;

    // REFACTOR-05: Reset sync health on disconnect
    this.syncHealth.reset();

    // Phase 21.5: Reset snapshot timestamp on disconnect
    this.lastAppliedSnapshotTimestamp = 0;

    // Phase 26: Reset mutation tracking on disconnect
    this.pendingMutations.clear();
    // Note: We don't reset mutationStats - keep cumulative stats for debugging

    // Phase 26: Reset confirmed state tracking on disconnect
    this.resetConfirmedState();

    // REFACTOR-04: Reset recovery state on disconnect
    this.recoveryInProgress = false;
    this.lastRecoveryRequest = 0;

    // Reset connection storm detection on intentional disconnect
    this.connectionStormDetector.reset();
  }

  private updateState(update: Partial<MultiplayerState>): void {
    this.state = { ...this.state, ...update };
    if (this.stateCallback) {
      this.stateCallback(this.state);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const multiplayer = new MultiplayerConnection();

/**
 * Convert a GridAction to a ClientMessage for sending over WebSocket
 * Returns null if the action shouldn't be sent (e.g., local-only actions)
 */
export function actionToMessage(action: GridAction): ClientMessage | null {
  // Skip remote actions (prevent echo)
  if ('isRemote' in action && action.isRemote) {
    return null;
  }

  switch (action.type) {
    case 'TOGGLE_STEP':
      return { type: 'toggle_step', trackId: action.trackId, step: action.step };
    case 'SET_TEMPO':
      return { type: 'set_tempo', tempo: action.tempo };
    case 'SET_SWING':
      return { type: 'set_swing', swing: action.swing };
    case 'TOGGLE_MUTE':
      // TOGGLE_MUTE doesn't have the final value, we need to handle this differently
      // The server will toggle, but we should send the intended state
      // For now, skip toggle actions and rely on REMOTE_MUTE_SET pattern
      return null;
    case 'TOGGLE_SOLO':
      return null; // Same as TOGGLE_MUTE
    case 'SET_PARAMETER_LOCK':
      return {
        type: 'set_parameter_lock',
        trackId: action.trackId,
        step: action.step,
        lock: action.lock,
      };
    case 'ADD_TRACK':
      // ADD_TRACK doesn't have a full track object, just sampleId and name
      // The track is created by the reducer, so we skip sending here
      // The track will be synced when handleTrackAdded receives the broadcast
      return null;
    case 'DELETE_TRACK':
      return { type: 'delete_track', trackId: action.trackId };
    case 'CLEAR_TRACK':
      return { type: 'clear_track', trackId: action.trackId };
    case 'SET_TRACK_SAMPLE':
      return {
        type: 'set_track_sample',
        trackId: action.trackId,
        sampleId: action.sampleId,
        name: action.name ?? action.sampleId, // Default to sampleId if name not provided
      };
    case 'SET_TRACK_VOLUME':
      return {
        type: 'set_track_volume',
        trackId: action.trackId,
        volume: action.volume,
      };
    case 'SET_TRACK_TRANSPOSE':
      return {
        type: 'set_track_transpose',
        trackId: action.trackId,
        transpose: action.transpose,
      };
    case 'SET_TRACK_STEP_COUNT':
      return {
        type: 'set_track_step_count',
        trackId: action.trackId,
        stepCount: action.stepCount,
      };
    case 'SET_EFFECTS':
      return {
        type: 'set_effects',
        effects: action.effects,
      };
    case 'SET_FM_PARAMS':
      return {
        type: 'set_fm_params',
        trackId: action.trackId,
        fmParams: action.fmParams,
      };
    case 'SET_PLAYING':
      return action.isPlaying ? { type: 'play' } : { type: 'stop' };
    default:
      return null;
  }
}

/**
 * Send mute state change (with explicit value, not toggle)
 */
export function sendMuteChange(trackId: string, muted: boolean): void {
  // Mute is LOCAL ONLY - don't send over the wire
  // Each user controls their own mix
  logger.multiplayer.log('Mute change (local only, not synced):', trackId, muted);
}

/**
 * Send solo state change (with explicit value, not toggle)
 */
export function sendSoloChange(trackId: string, soloed: boolean): void {
  // Solo is LOCAL ONLY - don't send over the wire
  // Each user controls their own focus
  logger.multiplayer.log('Solo change (local only, not synced):', trackId, soloed);
}

/**
 * Send add track with full track data
 * Called after the reducer creates the track
 */
export function sendAddTrack(track: Track): void {
  multiplayer.send({ type: 'add_track', track });
}

/**
 * Phase 11: Send cursor position to other players
 * Should be throttled by the caller (e.g., 50-100ms)
 */
export function sendCursorMove(position: CursorPosition): void {
  multiplayer.send({ type: 'cursor_move', position });
}

/**
 * Phase 11: Get current remote cursors
 */
export function getRemoteCursors(): Map<string, RemoteCursor> {
  return multiplayer.getState().cursors;
}
