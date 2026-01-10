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

import type { GridAction, Track, ParameterLock, EffectsState, FMParams, ScaleState } from '../types';
import { sessionTrackToTrack, sessionTracksToTracks, DEFAULT_STEP_COUNT } from '../types';
import { logger } from '../utils/logger';
import { canonicalizeForHash, hashState, type StateForHash } from './canonicalHash';
import { calculateBackoffDelay } from '../utils/retry';
import { createRemoteHandler } from './handler-factory';
import { createConnectionStormDetector, type ConnectionStormDetector } from '../utils/connection-storm';
import { SyncHealth, type SyncHealthMetrics } from './sync-health';
import { MutationTracker, type MutationStats } from './mutation-tracker';
import { MessageQueue } from './MessageQueue';
import { RecoveryManager } from './RecoveryManager';
import { registerHmrDispose } from '../utils/hmr';

// ============================================================================
// Types (imported from shared module - canonical definitions)
// ============================================================================

// Re-export shared types for consumers that import from multiplayer.ts
export type { PlayerInfo, CursorPosition, RemoteCursor } from '../shared/player';
import type { PlayerInfo, CursorPosition, RemoteCursor } from '../shared/player';

// Import message types from shared module (SINGLE SOURCE OF TRUTH)
import type {
  ClientMessage,
  ServerMessage,
} from '../shared/message-types';

// Re-export for consumers
export type { ClientMessage, ServerMessage } from '../shared/message-types';

// Import SessionState and SessionTrack from shared for snapshot handling
import type { SessionState, SessionTrack } from '../shared/state';

// Import shared constants
import { MAX_MESSAGE_SIZE } from '../shared/constants';

// NOTE: Message type definitions (ClientMessage, ServerMessage, etc.) have been
// consolidated into src/shared/message-types.ts and are imported above.
// This eliminates the duplicate definitions that previously existed here.

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
  // Session metadata sync
  sessionName?: string | null;
}

// ============================================================================
// Phase 26: Mutation Tracking Types
// ============================================================================

// Import shared message constants (canonical definitions in src/shared/messages.ts)
import { isStateMutatingMessage, assertNever } from '../shared/messages';

// Phase 26: Re-export mutation tracking types from standalone module
export type { TrackedMutation, MutationStats } from './mutation-tracker';

// ============================================================================
// Phase 32: Pattern Handler Types (TASK-002 from DUPLICATION-REMEDIATION-PLAN.md)
// ============================================================================

/** Base pattern message containing all fields needed for SET_TRACK_STEPS dispatch */
interface PatternMessage {
  trackId: string;
  steps: boolean[];
  parameterLocks: (ParameterLock | null)[];
  stepCount: number;
  playerId: string;
}

/** Pattern rotated message with direction field */
interface PatternRotatedMessage extends PatternMessage {
  direction: 'left' | 'right';
}

/** Pattern mirrored message with direction field */
interface PatternMirroredMessage extends PatternMessage {
  direction: 'left-to-right' | 'right-to-left';
}

/** Euclidean fill message with hits field */
interface PatternEuclideanMessage extends PatternMessage {
  hits: number;
}

// Timeout for mutation confirmation (30 seconds)
const MUTATION_TIMEOUT_MS = 30000;

// Interval for periodic mutation pruning (5 seconds)
// This ensures lost mutations are detected even without snapshots
const MUTATION_PRUNE_INTERVAL_MS = 5000;

// NOTE: Recovery state management has been extracted to RecoveryManager (TASK-012)

// ============================================================================
// Clock Sync
// ============================================================================

const CLOCK_SYNC_SAMPLES = 5;
const CLOCK_SYNC_INTERVAL_MS = 5000;

// Phase 12 Polish: State hash check interval (every 30 seconds for stale session detection)
const STATE_HASH_CHECK_INTERVAL_MS = 30000;
// REFACTOR-05: MAX_CONSECUTIVE_MISMATCHES moved to SyncHealth

// BUG-06: Stale session detection threshold (no messages received for this long = stale)
const STALE_SESSION_THRESHOLD_MS = 60000; // 60 seconds

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
  // BUG FIX: External sync listeners to avoid monkey-patching handleSyncResponse
  // Previously useMultiplayer wrapped handleSyncResponse which could cause chaining issues
  private syncListeners: Set<(offset: number, rtt: number) => void> = new Set();

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

    // Notify external sync listeners (used by useMultiplayer hook)
    for (const listener of this.syncListeners) {
      try {
        listener(this.offset, this.rtt);
      } catch (e) {
        // Don't let one listener break others
        logger.ws.warn('Sync listener error:', e);
      }
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

  /**
   * Add an external sync listener (safe alternative to monkey-patching)
   * Used by useMultiplayer to get sync updates without modifying handleSyncResponse
   */
  addSyncListener(listener: (offset: number, rtt: number) => void): void {
    this.syncListeners.add(listener);
  }

  /**
   * Remove a previously added sync listener
   */
  removeSyncListener(listener: (offset: number, rtt: number) => void): void {
    this.syncListeners.delete(listener);
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

// NOTE: MessagePriority, QueuedMessage, and getMessagePriority have been
// extracted to MessageQueue.ts (TASK-011)

class MultiplayerConnection {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  // Note: dispatch is public (not private) for HandlerContext compatibility
  // The handler-factory.ts createRemoteHandler needs access to this.dispatch
  dispatch: DispatchFn | null = null;
  private reconnectAttempts: number = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private stateCallback: StateChangedCallback | null = null;
  private subscribers: Set<StateChangedCallback> = new Set();
  private playbackStartCallback: PlaybackCallback | null = null;
  private playbackStopCallback: PlaybackStopCallback | null = null;
  private remoteChangeCallback: RemoteChangeCallback | null = null;
  private playerEventCallback: PlayerEventCallback | null = null;
  // Phase 21: Callback when session's published state is detected
  private publishedChangeCallback: ((isPublished: boolean) => void) | null = null;

  // Connection storm detection - uses extracted utility
  private connectionStormDetector: ConnectionStormDetector = createConnectionStormDetector();

  // Phase 12: Offline queue for buffering messages during disconnect
  // TASK-011: Extracted to MessageQueue class
  private messageQueue = new MessageQueue({ maxSize: 100, maxAge: 30000 });

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

  // Phase 26: Full mutation tracking for invariant violation detection
  // Using standalone MutationTracker for testability (no mocks needed)
  private mutationTracker = new MutationTracker({
    mutationTimeoutMs: MUTATION_TIMEOUT_MS,
  });
  private mutationPruneInterval: ReturnType<typeof setInterval> | null = null;

  // Phase 26: Track keys touched by other players (for supersession detection)
  // Key format: "trackId:step" for toggle_step, or "trackId" for track-level mutations
  private supersededKeys: Set<string> = new Set();

  // Phase 26: Confirmed state tracking for snapshot regression detection
  // Tracks what we KNOW exists on the server (from broadcasts), not just pending mutations
  private confirmedTracks: Set<string> = new Set();  // Track IDs confirmed to exist
  private confirmedSteps: Map<string, Set<number>> = new Map();  // trackId -> active step indices
  private lastConfirmedAt: number = 0;  // Timestamp of last confirmed change

  // Phase 26 (REFACTOR-04): Recovery state management
  // TASK-012: Extracted to RecoveryManager class
  private recoveryManager = new RecoveryManager({
    debounceMs: 2000,
    timeoutMs: 30000,
  });

  // BUG-06: Track last message received for stale session detection
  private lastMessageReceivedAt: number = 0;

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
    // Connection storm prevention: refuse if already connected or connecting
    // This guards against buggy useEffect dependencies causing rapid reconnects
    // See: Connection Storm Prevention tests in multiplayer.test.ts
    if (this.ws?.readyState === WebSocket.OPEN ||
        this.ws?.readyState === WebSocket.CONNECTING) {
      logger.ws.log('connect() called but already connected/connecting, ignoring');
      return;
    }

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
      ? { ...message, seq: ++this.clientSeq, ack: this.syncHealth.getLastServerSeq() }
      : message;

    // Client-side message size validation (matches server limit)
    // Validate before send OR queue to fail fast in all cases
    const serialized = JSON.stringify(messageWithSeq);
    if (serialized.length > MAX_MESSAGE_SIZE) {
      logger.ws.error(`Message too large: ${serialized.length} bytes (max ${MAX_MESSAGE_SIZE})`);
      this.updateState({ error: `Message too large (${Math.round(serialized.length / 1024)}KB > 64KB limit)` });
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(serialized);

      // Phase 26: Hook Point 1 - Track mutations for delivery confirmation
      if (needsSeq && isStateMutatingMessage(message.type)) {
        this.trackMutation(messageWithSeq, message);
      }
    } else if (this.state.status === 'connecting') {
      // Queue message for replay when connection is established
      this.messageQueue.enqueue(messageWithSeq);
    }
    // Note: If disconnected (not connecting), we don't queue
    // because the state will be synced fresh on reconnect
  }

  /**
   * Phase 26: Track a mutation for delivery confirmation and invariant detection
   * Stores full mutation context for:
   * - Delivery confirmation via clientSeq echo
   * - Invariant violation detection when snapshot contradicts
   * - Supersession detection when other players touch same step
   */
  private trackMutation(messageWithSeq: ClientMessage, originalMessage: ClientMessage): void {
    const seq = messageWithSeq.seq;
    if (seq === undefined) return;

    // Build mutation key for supersession tracking
    let trackId = '';
    let step: number | undefined;
    let intendedValue: boolean | undefined;

    if ('trackId' in originalMessage && typeof originalMessage.trackId === 'string') {
      trackId = originalMessage.trackId;
    } else if (originalMessage.type === 'add_track' && 'track' in originalMessage && originalMessage.track) {
      // add_track has track object instead of trackId
      trackId = (originalMessage.track as { id: string }).id;
    }
    if (originalMessage.type === 'toggle_step') {
      step = originalMessage.step;
      // For toggle_step, capture the intended value from current local state
      // By the time send() is called, the local reducer has already applied the toggle,
      // so the current step value IS what we intend the server to have.
      if (this.getStateForHash && trackId && step !== undefined) {
        const currentState = this.getStateForHash() as { tracks: Array<{ id: string; steps: boolean[] }> };
        const track = currentState.tracks.find(t => t.id === trackId);
        if (track && track.steps && step < track.steps.length) {
          intendedValue = track.steps[step];
        }
      }
    }

    // Delegate to MutationTracker (testable without mocks)
    this.mutationTracker.trackMutation({
      seq,
      type: originalMessage.type,
      trackId,
      step,
      intendedValue,
      sentAt: Date.now(),
      sentAtServerTime: this.clockSync.getServerTime(),
    });
  }

  /**
   * Phase 26: Confirm a mutation was delivered via clientSeq echo
   * Stores confirmedAtServerSeq for Option C selective clearing.
   * Mutation stays in tracker until snapshot clears it.
   */
  private confirmMutation(clientSeq: number, serverSeq?: number): void {
    // Delegate to MutationTracker (testable without mocks)
    this.mutationTracker.confirmMutation(clientSeq, serverSeq);
  }

  /**
   * Phase 26: Mark a mutation as superseded (another player touched the same key)
   * This is not a bug - it's expected in multiplayer when edits overlap
   */
  private markMutationSuperseded(clientSeq: number, byPlayerId: string): void {
    // Delegate to MutationTracker (testable without mocks)
    this.mutationTracker.markSuperseded(clientSeq, byPlayerId);
  }

  /**
   * Phase 26: Mark a mutation as lost (timed out without confirmation)
   * This indicates a potential sync issue
   */
  private markMutationLost(clientSeq: number): void {
    // Delegate to MutationTracker (testable without mocks)
    this.mutationTracker.markLost(clientSeq);
  }

  /**
   * Phase 26: Prune old pending mutations (mark as lost after timeout)
   * Called periodically and on snapshot receipt
   */
  private pruneOldMutations(): void {
    // Delegate to MutationTracker (testable without mocks)
    this.mutationTracker.pruneOldMutations();
  }

  /**
   * Phase 26: Check pending mutations against snapshot for invariant violations
   *
   * This is the CORE MUTATION-TRACKING deliverable. It detects when:
   * 1. A pending mutation was NOT applied to the snapshot (lost)
   * 2. A pending mutation was overwritten by another player (superseded - not a bug)
   *
   * Logs [INVARIANT VIOLATION] for lost mutations that indicate sync bugs.
   */
  private checkMutationInvariant(snapshot: SessionState): void {
    if (this.mutationTracker.getTotalInMap() === 0) return;

    const snapshotTrackMap = new Map<string, { steps: boolean[]; muted: boolean; volume: number }>();
    for (const track of snapshot.tracks) {
      snapshotTrackMap.set(track.id, {
        steps: track.steps,
        muted: track.muted,
        volume: track.volume,
      });
    }

    for (const mutation of this.mutationTracker.getAllMutations()) {
      if (mutation.state !== 'pending') continue;
      const seq = mutation.seq;

      const mutationKey = mutation.step !== undefined
        ? `${mutation.trackId}:${mutation.step}`
        : mutation.trackId;

      // Check if this key was touched by another player (supersession)
      if (this.supersededKeys.has(mutationKey)) {
        this.markMutationSuperseded(seq, 'unknown');
        continue;
      }

      // Check mutation against snapshot
      const snapshotTrack = snapshotTrackMap.get(mutation.trackId);

      switch (mutation.type) {
        case 'toggle_step': {
          if (!snapshotTrack) {
            // Track doesn't exist in snapshot - invariant violation
            logger.ws.error(`[INVARIANT VIOLATION] Pending toggle_step for missing track`, {
              seq,
              trackId: mutation.trackId,
              step: mutation.step,
              age: Date.now() - mutation.sentAt,
              sessionId: this.sessionId,
            });
            this.markMutationLost(seq);
          } else if (
            mutation.intendedValue !== undefined &&
            mutation.step !== undefined &&
            mutation.step < snapshotTrack.steps.length
          ) {
            // We have intended value - verify step matches what we expected
            // Note: Supersession was already checked above (lines 703-707), so any mismatch here
            // means the mutation was truly lost, not overwritten by another player
            const actualValue = snapshotTrack.steps[mutation.step];
            if (actualValue !== mutation.intendedValue) {
              logger.ws.error(`[INVARIANT VIOLATION] toggle_step value mismatch`, {
                seq,
                trackId: mutation.trackId,
                step: mutation.step,
                intendedValue: mutation.intendedValue,
                actualValue,
                age: Date.now() - mutation.sentAt,
                sessionId: this.sessionId,
              });
              this.markMutationLost(seq);
            }
          }
          break;
        }

        case 'add_track': {
          if (!snapshotTrack) {
            // We added a track but it's not in snapshot - invariant violation
            logger.ws.error(`[INVARIANT VIOLATION] Pending add_track not in snapshot`, {
              seq,
              trackId: mutation.trackId,
              age: Date.now() - mutation.sentAt,
              sessionId: this.sessionId,
            });
            this.markMutationLost(seq);
          }
          break;
        }

        case 'delete_track': {
          if (snapshotTrack) {
            // We deleted a track but it's still in snapshot - invariant violation
            logger.ws.error(`[INVARIANT VIOLATION] Pending delete_track still in snapshot`, {
              seq,
              trackId: mutation.trackId,
              age: Date.now() - mutation.sentAt,
              sessionId: this.sessionId,
            });
            this.markMutationLost(seq);
          }
          break;
        }

        // For other mutation types, we can't easily verify without more context
        // The confirmedState tracking handles those cases
        default:
          break;
      }
    }

    // Clear superseded keys after checking (they're stale after snapshot)
    this.supersededKeys.clear();
  }

  /**
   * Phase 26: Record that another player touched a key (for supersession detection)
   * Called when we receive a broadcast from another player
   */
  private recordSupersession(trackId: string, step?: number): void {
    const key = step !== undefined ? `${trackId}:${step}` : trackId;
    this.supersededKeys.add(key);
  }

  /**
   * Phase 26: Get mutation tracking statistics for debugging
   */
  getMutationStats(): MutationStats {
    return this.mutationTracker.getStats();
  }

  /**
   * Phase 26: Get count of pending mutations (for debug overlay)
   */
  getPendingMutationCount(): number {
    return this.mutationTracker.getTotalInMap();
  }

  /**
   * Phase 26: Get the age of the oldest pending mutation (for debug overlay)
   * Returns 0 if no pending mutations
   */
  getOldestPendingMutationAge(): number {
    const mutations = this.mutationTracker.getAllMutations();
    if (mutations.length === 0) return 0;

    const now = Date.now();
    let oldest = now;

    for (const mutation of mutations) {
      if (mutation.sentAt < oldest) {
        oldest = mutation.sentAt;
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

  // NOTE: requestSnapshotRecovery and completeRecovery have been
  // extracted to RecoveryManager class (TASK-012)

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

  // NOTE: queueMessage, evictLowestPriority, and replayQueuedMessages have been
  // extracted to MessageQueue class (TASK-011)

  /**
   * Phase 12: Get queue size (for debugging/UI)
   */
  getQueueSize(): number {
    return this.messageQueue.size;
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
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   * Useful for components that need to react to multiplayer state updates.
   */
  subscribe(callback: StateChangedCallback): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
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

    // Phase 26: Start periodic mutation pruning for lost mutation detection
    this.startMutationPruning();
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

    // Periodic hash check + stale session detection
    this.stateHashInterval = setInterval(() => {
      // BUG-06: Check for stale session (no messages received for too long)
      if (this.lastMessageReceivedAt > 0) {
        const timeSinceLastMessage = Date.now() - this.lastMessageReceivedAt;
        if (timeSinceLastMessage > STALE_SESSION_THRESHOLD_MS) {
          logger.ws.warn(`[STALE SESSION] No messages received for ${Math.round(timeSinceLastMessage / 1000)}s, triggering reconnect`);
          this.scheduleReconnect();
          return; // Skip hash check since we're reconnecting
        }
      }

      this.sendStateHash();
    }, STATE_HASH_CHECK_INTERVAL_MS);

    logger.ws.log(`State hash checking enabled (every ${STATE_HASH_CHECK_INTERVAL_MS / 1000}s, stale threshold ${STALE_SESSION_THRESHOLD_MS / 1000}s)`);
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
   * Phase 26: Start periodic mutation pruning
   * Detects lost mutations even without snapshot receipt (timeout-based)
   */
  private startMutationPruning(): void {
    // Clear any existing interval
    if (this.mutationPruneInterval) {
      clearInterval(this.mutationPruneInterval);
    }

    this.mutationPruneInterval = setInterval(() => {
      this.pruneOldMutations();
    }, MUTATION_PRUNE_INTERVAL_MS);

    logger.ws.log(`Mutation pruning enabled (every ${MUTATION_PRUNE_INTERVAL_MS / 1000}s, timeout ${MUTATION_TIMEOUT_MS / 1000}s)`);
  }

  /**
   * Phase 26: Stop periodic mutation pruning
   */
  private stopMutationPruning(): void {
    if (this.mutationPruneInterval) {
      clearInterval(this.mutationPruneInterval);
      this.mutationPruneInterval = null;
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
    this.stopMutationPruning();

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

    // BUG-06: Track last message for stale session detection
    this.lastMessageReceivedAt = Date.now();

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
      if (recoveryDecision.needed && !this.recoveryManager.isInProgress) {
        // Check what kind of recovery is needed
        if (recoveryDecision.reason?.includes('out-of-order')) {
          // Too many out-of-order messages - trigger reconnect
          logger.ws.warn(`Triggering reconnect: ${recoveryDecision.reason}`);
          this.scheduleReconnect();
        } else if (recoveryDecision.reason?.includes('gap')) {
          // Large gap - request snapshot
          this.recoveryManager.request(recoveryDecision.reason, () => {
            this.send({ type: 'request_snapshot' });
          });
        }
      }
    }

    // Phase 26: Hook Point 2 - Confirm delivery via clientSeq echo
    // Option C: Pass serverSeq for selective mutation clearing
    if (msg.clientSeq !== undefined) {
      this.confirmMutation(msg.clientSeq, msg.seq);
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
        // Phase 26: Track supersession if from another player
        if (msg.playerId !== this.state.playerId) {
          this.recordSupersession(msg.track.id);
        }
        break;
      case 'track_deleted':
        this.handleTrackDeleted(msg);
        // Phase 26: Track confirmed state from server broadcast
        this.updateConfirmedState('track_deleted', msg.trackId);
        // Phase 26: Track supersession if from another player
        if (msg.playerId !== this.state.playerId) {
          this.recordSupersession(msg.trackId);
        }
        break;
      case 'track_cleared':
        this.handleTrackCleared(msg);
        // Phase 26: Clear confirmed steps for this track (track still exists, but no active steps)
        if (this.confirmedSteps.has(msg.trackId)) {
          this.confirmedSteps.get(msg.trackId)!.clear();
        }
        // Phase 26: Track supersession if from another player
        if (msg.playerId !== this.state.playerId) {
          this.recordSupersession(msg.trackId);
        }
        break;
      case 'sequence_copied':
        this.handleSequenceCopied(msg);
        // Phase 26: Update confirmed steps for the target track
        if (this.confirmedSteps.has(msg.toTrackId)) {
          this.confirmedSteps.get(msg.toTrackId)!.clear();
        }
        // Phase 26: Track supersession if from another player
        if (msg.playerId !== this.state.playerId) {
          this.recordSupersession(msg.toTrackId);
        }
        break;
      case 'sequence_moved':
        this.handleSequenceMoved(msg);
        // Phase 26: Update confirmed steps for both source and target tracks
        if (this.confirmedSteps.has(msg.fromTrackId)) {
          this.confirmedSteps.get(msg.fromTrackId)!.clear();
        }
        if (this.confirmedSteps.has(msg.toTrackId)) {
          this.confirmedSteps.get(msg.toTrackId)!.clear();
        }
        // Phase 26: Track supersession if from another player
        if (msg.playerId !== this.state.playerId) {
          this.recordSupersession(msg.fromTrackId);
          this.recordSupersession(msg.toTrackId);
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
      case 'track_swing_set':
        this.handleTrackSwingSet(msg);
        break;
      case 'effects_changed':
        this.handleEffectsChanged(msg);
        break;
      case 'scale_changed':
        this.handleScaleChanged(msg);
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
      case 'session_name_changed':
        this.handleSessionNameChanged(msg);
        break;
      // Phase 31F: Batch operation broadcasts
      case 'steps_cleared':
        this.handleStepsCleared(msg);
        // Phase 26: Update confirmed steps (remove cleared steps)
        if (this.confirmedSteps.has(msg.trackId)) {
          const confirmed = this.confirmedSteps.get(msg.trackId)!;
          for (const step of msg.steps) {
            confirmed.delete(step);
          }
        }
        break;
      case 'parameter_locks_batch_set':
        this.handleParameterLocksBatchSet(msg);
        break;
      // Phase 31G: Loop selection broadcast
      case 'loop_region_changed':
        this.handleLoopRegionChanged(msg);
        break;
      // Phase 31G: Track reorder broadcast
      case 'tracks_reordered':
        this.handleTracksReordered(msg);
        break;
      // Phase 32: Pattern operation broadcasts (sync fix)
      case 'pattern_rotated':
        this.handlePatternRotated(msg);
        break;
      case 'pattern_inverted':
        this.handlePatternInverted(msg);
        break;
      case 'pattern_reversed':
        this.handlePatternReversed(msg);
        break;
      case 'pattern_mirrored':
        this.handlePatternMirrored(msg);
        break;
      case 'euclidean_filled':
        this.handleEuclideanFilled(msg);
        break;
      case 'track_name_set':
        this.handleTrackNameSet(msg);
        break;
      case 'error':
        logger.ws.error('Server error:', msg.message);
        this.updateState({ error: msg.message });
        break;
      default:
        // Exhaustive check - if TypeScript complains here, a message type is missing
        assertNever(msg, `[WS] Unhandled server message type: ${(msg as { type: string }).type}`);
    }
  }

  // ============================================================================
  // Message Handlers
  // ============================================================================

  private handleSnapshot(msg: { state: SessionState; players: PlayerInfo[]; playerId: string; immutable?: boolean; snapshotTimestamp?: number; serverSeq?: number; playingPlayerIds?: string[] }): void {
    // Debug assertion: check if snapshot is expected
    const wasConnected = this.state.status === 'connected';
    debugAssert.snapshotExpected(wasConnected, this.lastToggle);

    // REFACTOR-04: Recovery in progress flag stays set until recoveryManager.complete() is called

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
        tracks: sessionTracksToTracks(msg.state.tracks),
        tempo: msg.state.tempo,
        swing: msg.state.swing,
        // Phase 22: Include effects from snapshot for session persistence
        effects: msg.state.effects,
        // Phase 29E: Include scale from snapshot for Key Assistant
        scale: msg.state.scale,
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

    // Phase 26: Check pending mutations for invariant violations BEFORE pruning
    // This detects lost mutations that indicate sync bugs
    this.checkMutationInvariant(msg.state);

    // Phase 26: Prune old mutations on snapshot receipt
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.messageQueue.replay((data) => this.ws?.send(data));
    }

    // Phase 26 (REFACTOR-03): Clear pending mutations on snapshot
    // Option C: Pass serverSeq for selective clearing (only clear pre-snapshot mutations)
    this.clearPendingMutationsOnSnapshot(msg.serverSeq);

    // REFACTOR-04: Complete recovery after snapshot is fully applied
    if (this.recoveryManager.isInProgress) {
      this.recoveryManager.complete();
    }
  }

  /**
   * Phase 26 (Option C): Selective mutation clearing on snapshot
   *
   * Only clears mutations that were confirmed BEFORE the snapshot was generated.
   * This fixes the race condition where rapid edits during snapshot load are lost.
   *
   * Logic:
   * - confirmedAtServerSeq <= snapshotServerSeq: CLEAR (included in snapshot)
   * - confirmedAtServerSeq > snapshotServerSeq: KEEP (post-snapshot, not included)
   * - state === 'pending': KEEP (still awaiting confirmation)
   * - Fallback: Clear confirmed mutations older than 60s (safety net, backwards compat)
   */
  private clearPendingMutationsOnSnapshot(snapshotServerSeq?: number): void {
    // Delegate to MutationTracker (testable without mocks)
    this.mutationTracker.clearOnSnapshot(snapshotServerSeq);
  }

  private handleStepToggled(msg: { trackId: string; step: number; value: boolean; playerId: string }): void {
    const isOwnMessage = msg.playerId === this.state.playerId;
    debugAssert.stepToggledReceived(msg.trackId, msg.step, msg.value, msg.playerId, isOwnMessage);

    if (isOwnMessage) return; // Skip own messages

    // Phase 26: Track supersession - another player touched this step
    this.recordSupersession(msg.trackId, msg.step);

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

  private handleTrackAdded = createRemoteHandler<{ track: SessionTrack; playerId: string }>(
    (msg) => ({
      type: 'ADD_TRACK',
      sampleId: msg.track.sampleId,
      name: msg.track.name,
      track: sessionTrackToTrack(msg.track),
    })
  );

  private handleTrackDeleted = createRemoteHandler<{ trackId: string; playerId: string }>(
    (msg) => ({ type: 'DELETE_TRACK', trackId: msg.trackId })
  );

  private handleTrackCleared = createRemoteHandler<{ trackId: string; playerId: string }>(
    (msg) => ({ type: 'CLEAR_TRACK', trackId: msg.trackId })
  );

  // Phase 26: Handle sequence_copied broadcast
  private handleSequenceCopied = createRemoteHandler<{
    fromTrackId: string;
    toTrackId: string;
    steps: boolean[];
    parameterLocks: (ParameterLock | null)[];
    stepCount: number;
    playerId: string;
  }>((msg) => ({
    type: 'SET_TRACK_STEPS',
    trackId: msg.toTrackId,
    steps: msg.steps,
    parameterLocks: msg.parameterLocks,
    stepCount: msg.stepCount,
  }));

  // Phase 26: Handle sequence_moved broadcast
  // Move = copy to target + clear source
  private handleSequenceMoved = (msg: {
    fromTrackId: string;
    toTrackId: string;
    steps: boolean[];
    parameterLocks: (ParameterLock | null)[];
    stepCount: number;
    playerId: string;
  }): void => {
    if (!this.dispatch) return;

    // Apply to target track
    this.dispatch({
      type: 'SET_TRACK_STEPS',
      trackId: msg.toTrackId,
      steps: msg.steps,
      parameterLocks: msg.parameterLocks,
      stepCount: msg.stepCount,
      isRemote: true,
    });

    // Clear source track
    this.dispatch({
      type: 'CLEAR_TRACK',
      trackId: msg.fromTrackId,
      isRemote: true,
    });
  };

  // Phase 31F: Handle steps_cleared broadcast (from DELETE_SELECTED_STEPS)
  private handleStepsCleared = (msg: {
    trackId: string;
    steps: number[];
    playerId: string;
  }): void => {
    if (!this.dispatch) return;

    // Skip if this is our own message (already applied locally)
    if (msg.playerId === this.state.playerId) return;

    // Apply each step toggle to turn off the steps
    for (const step of msg.steps) {
      this.dispatch({
        type: 'REMOTE_STEP_SET',
        trackId: msg.trackId,
        step,
        value: false,
        isRemote: true,
      });
    }
  };

  // Phase 31F: Handle parameter_locks_batch_set broadcast (from APPLY_TO_SELECTION)
  private handleParameterLocksBatchSet = (msg: {
    trackId: string;
    locks: { step: number; lock: ParameterLock }[];
    playerId: string;
  }): void => {
    if (!this.dispatch) return;

    // Skip if this is our own message (already applied locally)
    if (msg.playerId === this.state.playerId) return;

    // Apply each p-lock
    for (const { step, lock } of msg.locks) {
      this.dispatch({
        type: 'SET_PARAMETER_LOCK',
        trackId: msg.trackId,
        step,
        lock,
        isRemote: true,
      });
    }
  };

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

  /** Phase 31D: Handle per-track swing change from another player */
  private handleTrackSwingSet = createRemoteHandler<{
    trackId: string;
    swing: number;
    playerId: string;
  }>((msg) => ({
    type: 'SET_TRACK_SWING',
    trackId: msg.trackId,
    swing: msg.swing,
  }));

  /** Phase 25: Handle effects state change from another player */
  private handleEffectsChanged = createRemoteHandler<{
    effects: EffectsState;
    playerId: string;
  }>((msg) => ({
    type: 'SET_EFFECTS',
    effects: msg.effects,
  }));

  /** Phase 29E: Handle scale state change from another player */
  private handleScaleChanged = createRemoteHandler<{
    scale: ScaleState;
    playerId: string;
  }>((msg) => ({
    type: 'SET_SCALE',
    scale: msg.scale,
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
    // Skip if player already exists (prevents duplicates on reconnection)
    if (this.state.players.some(p => p.id === msg.player.id)) {
      logger.ws.log('Player already in list, skipping duplicate join:', msg.player.name);
      return;
    }

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
    // Skip own cursor messages (prevents seeing own cursor with delay when server echoes)
    if (msg.playerId === this.state.playerId) return;

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

  /**
   * Handle session name change broadcast from server.
   * Updates local state so UI components can react to the new name.
   * Skips own messages to prevent unnecessary re-render (echo prevention).
   */
  private handleSessionNameChanged(msg: { name: string; playerId: string }): void {
    // Skip own messages (echo prevention)
    if (msg.playerId === this.state.playerId) return;

    logger.ws.log(`Session name changed to "${msg.name}" by player ${msg.playerId}`);
    this.updateState({ sessionName: msg.name || null });
  }

  /**
   * Phase 31G: Handle loop region change broadcast from server.
   * Updates local grid state so scheduler respects the loop boundaries.
   * Skips own messages to prevent unnecessary re-dispatch.
   */
  private handleLoopRegionChanged = (msg: { region: { start: number; end: number } | null; playerId: string }): void => {
    // Skip own messages (echo prevention)
    if (msg.playerId === this.state.playerId) return;

    logger.ws.log(`Loop region changed to ${msg.region ? `${msg.region.start}-${msg.region.end}` : 'null'} by player ${msg.playerId}`);
    // Dispatch to local grid state
    if (this.dispatch) {
      this.dispatch({ type: 'SET_LOOP_REGION', region: msg.region, isRemote: true });
    }
  };

  /**
   * Phase 31G: Handle track reorder broadcast from server.
   * Updates local grid state to match the new track order.
   * Skips own messages to prevent unnecessary re-dispatch.
   */
  private handleTracksReordered = (msg: { fromIndex: number; toIndex: number; playerId: string }): void => {
    // Skip own messages (echo prevention)
    if (msg.playerId === this.state.playerId) return;

    // MEDIUM-3: Validate indices against current local track array
    if (this.getStateForHash) {
      const currentState = this.getStateForHash() as { tracks: unknown[] };
      const trackCount = currentState.tracks?.length ?? 0;
      if (msg.fromIndex < 0 || msg.fromIndex >= trackCount ||
          msg.toIndex < 0 || msg.toIndex >= trackCount) {
        logger.ws.warn(`Invalid track reorder indices: ${msg.fromIndex} -> ${msg.toIndex}, trackCount: ${trackCount}`);
        return;
      }
    }

    logger.ws.log(`Tracks reordered: ${msg.fromIndex} -> ${msg.toIndex} by player ${msg.playerId}`);
    // Dispatch to local grid state
    if (this.dispatch) {
      this.dispatch({ type: 'REORDER_TRACKS', fromIndex: msg.fromIndex, toIndex: msg.toIndex, isRemote: true });
    }
  };

  // ============================================================================
  // Phase 32: Pattern Operation Handlers (sync fix)
  // Refactored to use handler factory (TASK-002 from DUPLICATION-REMEDIATION-PLAN.md)
  // ============================================================================

  /**
   * Factory function that creates pattern operation handlers.
   * All pattern handlers share the same structure:
   * 1. Skip own messages (echo prevention)
   * 2. Log the operation
   * 3. Dispatch SET_TRACK_STEPS with the new pattern data
   */
  private createPatternHandler = <T extends PatternMessage>(
    operationName: string,
    getLogDetail?: (msg: T) => string
  ) => (msg: T): void => {
    if (msg.playerId === this.state.playerId) return;
    const detail = getLogDetail ? ` ${getLogDetail(msg)}` : '';
    logger.ws.log(`${operationName}: track=${msg.trackId}${detail} by ${msg.playerId}`);
    if (this.dispatch) {
      this.dispatch({
        type: 'SET_TRACK_STEPS',
        trackId: msg.trackId,
        steps: msg.steps,
        parameterLocks: msg.parameterLocks,
        stepCount: msg.stepCount,
        isRemote: true,
      });
    }
  };

  // Pattern handlers using factory
  private handlePatternRotated = this.createPatternHandler<PatternRotatedMessage>(
    'Pattern rotated',
    (msg) => `direction=${msg.direction}`
  );

  private handlePatternInverted = this.createPatternHandler<PatternMessage>('Pattern inverted');

  private handlePatternReversed = this.createPatternHandler<PatternMessage>('Pattern reversed');

  private handlePatternMirrored = this.createPatternHandler<PatternMirroredMessage>(
    'Pattern mirrored',
    (msg) => `direction=${msg.direction}`
  );

  private handleEuclideanFilled = this.createPatternHandler<PatternEuclideanMessage>(
    'Euclidean filled',
    (msg) => `hits=${msg.hits}`
  );

  private handleTrackNameSet = (msg: { trackId: string; name: string; playerId: string }): void => {
    if (msg.playerId === this.state.playerId) return;
    logger.ws.log(`Track name set: track=${msg.trackId} name="${msg.name}" by ${msg.playerId}`);
    if (this.dispatch) {
      this.dispatch({ type: 'SET_TRACK_NAME', trackId: msg.trackId, name: msg.name, isRemote: true });
    }
  };

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

    // BUG FIX: Log detailed state info for debugging mismatches
    // This helps identify which field(s) are causing the divergence
    if (this.getStateForHash) {
      const state = this.getStateForHash() as StateForHash;
      const canonicalState = canonicalizeForHash(state);
      const localHash = hashState(canonicalState);
      logger.ws.warn('[MISMATCH DETAIL]', {
        localHash,
        serverHash,
        trackCount: state.tracks.length,
        tempo: state.tempo,
        swing: state.swing,
        trackSummary: state.tracks.map(t => ({
          id: t.id.slice(0, 8),
          stepCount: t.stepCount ?? DEFAULT_STEP_COUNT,
          volume: t.volume,
          transpose: t.transpose,
          swing: (t as { swing?: number }).swing ?? 0,
          activeSteps: t.steps.filter(Boolean).length,
        })),
      });
    }

    // Check if we should request a full snapshot
    const recovery = this.syncHealth.needsRecovery();
    if (recovery.needed && recovery.reason?.includes('mismatch')) {
      this.recoveryManager.request(recovery.reason, () => {
        this.send({ type: 'request_snapshot' });
      });
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
      queueSize: this.messageQueue.size,
    });

    // BUG FIX: Clear any existing reconnect timeout to prevent accumulation
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
    }
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
    this.stopMutationPruning();
    this.reconnectAttempts = 0;

    // Phase 13B: Reset sequence tracking on disconnect
    this.clientSeq = 0;

    // REFACTOR-05: Reset sync health on disconnect
    this.syncHealth.reset();

    // Phase 21.5: Reset snapshot timestamp on disconnect
    this.lastAppliedSnapshotTimestamp = 0;

    // Phase 26: Reset mutation tracking on disconnect
    this.mutationTracker.clear();
    this.supersededKeys.clear();

    // Phase 26: Reset confirmed state tracking on disconnect
    this.resetConfirmedState();

    // REFACTOR-04: Reset recovery state on disconnect
    this.recoveryManager.reset();

    // BUG-06: Reset stale session tracking
    this.lastMessageReceivedAt = 0;

    // Reset connection storm detection on intentional disconnect
    this.connectionStormDetector.reset();
  }

  private updateState(update: Partial<MultiplayerState>): void {
    this.state = { ...this.state, ...update };
    if (this.stateCallback) {
      this.stateCallback(this.state);
    }
    // Notify all subscribers
    for (const subscriber of this.subscribers) {
      subscriber(this.state);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const multiplayer = new MultiplayerConnection();

// HMR cleanup - disconnects WebSocket and clears intervals during development
registerHmrDispose('Multiplayer', () => multiplayer.disconnect());

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
    case 'SET_TRACK_SWING':
      return {
        type: 'set_track_swing',
        trackId: action.trackId,
        swing: action.swing,
      };
    case 'SET_EFFECTS':
      return {
        type: 'set_effects',
        effects: action.effects,
      };
    case 'SET_SCALE':
      return {
        type: 'set_scale',
        scale: action.scale,
      };
    case 'SET_FM_PARAMS':
      return {
        type: 'set_fm_params',
        trackId: action.trackId,
        fmParams: action.fmParams,
      };
    case 'COPY_SEQUENCE':
      return {
        type: 'copy_sequence',
        fromTrackId: action.fromTrackId,
        toTrackId: action.toTrackId,
      };
    case 'MOVE_SEQUENCE':
      return {
        type: 'move_sequence',
        fromTrackId: action.fromTrackId,
        toTrackId: action.toTrackId,
      };
    case 'SET_SESSION_NAME':
      return {
        type: 'set_session_name',
        name: action.name,
      };
    // Phase 31G: Loop selection
    case 'SET_LOOP_REGION':
      return {
        type: 'set_loop_region',
        region: action.region,
      };
    case 'SET_PLAYING':
      return action.isPlaying ? { type: 'play' } : { type: 'stop' };
    // Phase 32: Pattern operations (sync fix)
    case 'ROTATE_PATTERN':
      return {
        type: 'rotate_pattern',
        trackId: action.trackId,
        direction: action.direction,
      };
    case 'INVERT_PATTERN':
      return {
        type: 'invert_pattern',
        trackId: action.trackId,
      };
    case 'REVERSE_PATTERN':
      return {
        type: 'reverse_pattern',
        trackId: action.trackId,
      };
    case 'MIRROR_PATTERN':
      // Mirror needs the direction - action should have it from gridReducer
      return {
        type: 'mirror_pattern',
        trackId: action.trackId,
        // Direction is computed client-side based on step density
        direction: action.direction ?? 'left-to-right',
      };
    case 'EUCLIDEAN_FILL':
      return {
        type: 'euclidean_fill',
        trackId: action.trackId,
        hits: action.hits,
      };
    case 'SET_TRACK_NAME':
      return {
        type: 'set_track_name',
        trackId: action.trackId,
        name: action.name,
      };

    // =========================================================================
    // LOCAL_ONLY actions - return null (each player controls their own mix)
    // =========================================================================
    case 'EXCLUSIVE_SOLO':
    case 'CLEAR_ALL_SOLOS':
    case 'UNMUTE_ALL':
    case 'SET_CURRENT_STEP':
    case 'SELECT_STEP':
    case 'CLEAR_SELECTION':
      return null;

    // =========================================================================
    // INTERNAL actions - return null (server-driven or internal state)
    // =========================================================================
    case 'LOAD_STATE':
    case 'RESET_STATE':
    case 'REMOTE_STEP_SET':
    case 'REMOTE_MUTE_SET':
    case 'REMOTE_SOLO_SET':
    case 'SET_TRACK_STEPS':
      return null;

    // =========================================================================
    // NON_STANDARD_SYNC actions - return null (use dedicated send* functions)
    // =========================================================================
    case 'REORDER_TRACKS':
      // Uses handleTrackReorder directly
      return null;
    case 'DELETE_SELECTED_STEPS':
    case 'APPLY_TO_SELECTION':
      // Batch operations use selection state not in the action
      return null;

    default:
      // EXHAUSTIVE CHECK: If TypeScript complains here, add the new action above
      assertNever(action, `[actionToMessage] Unhandled action type: ${(action as { type: string }).type}`);
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
 * Send session name change to other players
 * Called when user renames the session
 */
export function sendSessionName(name: string): void {
  multiplayer.send({ type: 'set_session_name', name });
}

/**
 * Phase 31F: Send batch clear steps to other players
 * Called when DELETE_SELECTED_STEPS clears multiple steps at once
 */
export function sendBatchClearSteps(trackId: string, steps: number[]): void {
  if (steps.length === 0) return;
  multiplayer.send({ type: 'batch_clear_steps', trackId, steps });
}

/**
 * Phase 31F: Send batch set parameter locks to other players
 * Called when APPLY_TO_SELECTION sets p-locks on multiple steps at once
 */
export function sendBatchSetParameterLocks(
  trackId: string,
  locks: { step: number; lock: ParameterLock }[]
): void {
  if (locks.length === 0) return;
  multiplayer.send({ type: 'batch_set_parameter_locks', trackId, locks });
}

/**
 * Phase 31G: Send track reorder to other players
 * Called when user drags a track to a new position
 */
export function sendReorderTracks(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;
  multiplayer.send({ type: 'reorder_tracks', fromIndex, toIndex });
}

/**
 * Phase 11: Get current remote cursors
 */
export function getRemoteCursors(): Map<string, RemoteCursor> {
  return multiplayer.getState().cursors;
}
