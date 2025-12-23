/**
 * MutationTracker: Standalone mutation tracking for Option C
 *
 * Extracted from Multiplayer class to enable direct testing without mocks.
 * Handles:
 * - Tracking pending mutations
 * - Confirming mutations with serverSeq
 * - Selective clearing on snapshot (Option C algorithm)
 * - Stats accounting
 */

import { logger } from '../utils/logger';

/**
 * State of a tracked mutation
 */
export type MutationState = 'pending' | 'confirmed' | 'superseded' | 'lost';

/**
 * A mutation being tracked for delivery confirmation
 */
export interface TrackedMutation {
  seq: number;                    // Client sequence number
  type: string;                   // Message type ('toggle_step', etc.)
  trackId: string;                // Which track
  step?: number;                  // Which step (for toggle_step)
  intendedValue?: boolean;        // What we wanted (for toggle_step)
  sentAt: number;                 // Local timestamp
  sentAtServerTime: number;       // Estimated server time
  state: MutationState;
  confirmedAtServerSeq?: number;  // Server seq when confirmation received (Option C)
}

/**
 * Stats for mutation tracking
 */
export interface MutationStats {
  pending: number;
  confirmed: number;
  superseded: number;
  lost: number;
}

/**
 * Options for creating a MutationTracker
 */
export interface MutationTrackerOptions {
  /** Timeout for marking mutations as lost (default: 30000ms) */
  mutationTimeoutMs?: number;
  /** Max age for confirmed mutations before fallback clearing (default: 60000ms) */
  maxConfirmedAgeMs?: number;
  /** Enable logging (default: true) */
  enableLogging?: boolean;
}

/**
 * Standalone mutation tracker for Option C server-side sequencing.
 *
 * This class can be tested directly without any mocks because it:
 * - Has no external dependencies (WebSocket, timers, etc.)
 * - Uses pure functions that operate on internal state
 * - Provides complete visibility into its state for assertions
 */
export class MutationTracker {
  private pendingMutations = new Map<number, TrackedMutation>();
  private stats: MutationStats = {
    pending: 0,
    confirmed: 0,
    superseded: 0,
    lost: 0,
  };

  private readonly mutationTimeoutMs: number;
  private readonly maxConfirmedAgeMs: number;
  private readonly enableLogging: boolean;

  constructor(options: MutationTrackerOptions = {}) {
    this.mutationTimeoutMs = options.mutationTimeoutMs ?? 30000;
    this.maxConfirmedAgeMs = options.maxConfirmedAgeMs ?? 60000;
    this.enableLogging = options.enableLogging ?? true;
  }

  /**
   * Track a new mutation
   */
  trackMutation(mutation: Omit<TrackedMutation, 'state' | 'confirmedAtServerSeq'>): void {
    const tracked: TrackedMutation = {
      ...mutation,
      state: 'pending',
    };

    this.pendingMutations.set(mutation.seq, tracked);
    this.stats.pending++;

    if (this.enableLogging) {
      logger.ws.log(
        `[MUTATION-TRACK] Tracking ${mutation.type} seq=${mutation.seq} ` +
        `trackId=${mutation.trackId} step=${mutation.step}`
      );
    }
  }

  /**
   * Confirm a mutation was delivered via clientSeq echo.
   * Stores confirmedAtServerSeq for Option C selective clearing.
   * Mutation stays in map until snapshot clears it.
   */
  confirmMutation(clientSeq: number, serverSeq?: number): boolean {
    const mutation = this.pendingMutations.get(clientSeq);
    if (!mutation || mutation.state !== 'pending') {
      return false;
    }

    mutation.state = 'confirmed';
    mutation.confirmedAtServerSeq = serverSeq;
    this.stats.pending--;
    this.stats.confirmed++;

    if (this.enableLogging) {
      logger.ws.log(
        `[MUTATION-TRACK] Confirmed seq=${clientSeq} at serverSeq=${serverSeq} ` +
        `type=${mutation.type} trackId=${mutation.trackId}`
      );
    }

    return true;
  }

  /**
   * Mark a mutation as superseded (another player touched the same key).
   * This is not a bug - it's expected in multiplayer when edits overlap.
   */
  markSuperseded(clientSeq: number, byPlayerId?: string): boolean {
    const mutation = this.pendingMutations.get(clientSeq);
    if (!mutation || mutation.state !== 'pending') {
      return false;
    }

    mutation.state = 'superseded';
    this.pendingMutations.delete(clientSeq);
    this.stats.pending--;
    this.stats.superseded++;

    if (this.enableLogging) {
      logger.ws.log(`[MUTATION-TRACK] Superseded seq=${clientSeq} by player=${byPlayerId}`);
    }

    return true;
  }

  /**
   * Mark a mutation as lost (timed out without confirmation).
   */
  markLost(clientSeq: number): boolean {
    const mutation = this.pendingMutations.get(clientSeq);
    if (!mutation || mutation.state !== 'pending') {
      return false;
    }

    mutation.state = 'lost';
    this.pendingMutations.delete(clientSeq);
    this.stats.pending--;
    this.stats.lost++;

    if (this.enableLogging) {
      logger.ws.warn(
        `[INVARIANT VIOLATION] Mutation lost: seq=${clientSeq} ` +
        `type=${mutation.type} trackId=${mutation.trackId} step=${mutation.step}`
      );
    }

    return true;
  }

  /**
   * Option C: Selective mutation clearing on snapshot.
   *
   * Only clears mutations that were confirmed BEFORE the snapshot was generated.
   * This fixes the race condition where rapid edits during snapshot load are lost.
   *
   * Logic:
   * - confirmedAtServerSeq <= snapshotServerSeq: CLEAR (included in snapshot)
   * - confirmedAtServerSeq > snapshotServerSeq: KEEP (post-snapshot, not included)
   * - state === 'pending': KEEP (still awaiting confirmation)
   * - Fallback: Clear confirmed mutations older than maxConfirmedAgeMs
   *
   * @returns Number of mutations cleared
   */
  clearOnSnapshot(snapshotServerSeq?: number, now: number = Date.now()): number {
    if (this.pendingMutations.size === 0) return 0;

    const toDelete: number[] = [];

    for (const [clientSeq, mutation] of this.pendingMutations) {
      // Only process confirmed mutations - pending ones must wait for confirmation
      if (mutation.state !== 'confirmed') {
        continue;
      }

      const confirmedAt = mutation.confirmedAtServerSeq;

      if (confirmedAt !== undefined && snapshotServerSeq !== undefined) {
        // Both serverSeqs available - use precise comparison
        if (confirmedAt <= snapshotServerSeq) {
          toDelete.push(clientSeq);
        }
        // Otherwise: confirmed AFTER snapshot - KEEP (not in this snapshot)
      } else if (now - mutation.sentAt > this.maxConfirmedAgeMs) {
        // Fallback for backwards compatibility or missing serverSeq
        toDelete.push(clientSeq);
        if (this.enableLogging) {
          logger.ws.log(
            `[MUTATION-TRACK] Clearing stale confirmed mutation seq=${clientSeq} ` +
            `(age=${Math.round((now - mutation.sentAt) / 1000)}s)`
          );
        }
      }
    }

    // Delete identified mutations (all are confirmed, no stats adjustment needed)
    for (const clientSeq of toDelete) {
      this.pendingMutations.delete(clientSeq);
    }

    if (this.enableLogging && toDelete.length > 0) {
      logger.ws.log(
        `[MUTATION-TRACK] Cleared ${toDelete.length} confirmed mutations ` +
        `(snapshot serverSeq=${snapshotServerSeq})`
      );
    }

    const remaining = this.pendingMutations.size;
    if (this.enableLogging && remaining > 0) {
      logger.ws.log(
        `[MUTATION-TRACK] ${remaining} mutations retained (post-snapshot or pending)`
      );
    }

    return toDelete.length;
  }

  /**
   * Prune old pending mutations (mark as lost after timeout).
   * Called periodically to detect lost mutations.
   *
   * @returns Number of mutations marked as lost
   */
  pruneOldMutations(now: number = Date.now()): number {
    const seqsToMarkLost: number[] = [];

    for (const [seq, mutation] of this.pendingMutations) {
      if (mutation.state === 'pending' && now - mutation.sentAt > this.mutationTimeoutMs) {
        seqsToMarkLost.push(seq);
      }
    }

    for (const seq of seqsToMarkLost) {
      this.markLost(seq);
    }

    return seqsToMarkLost.length;
  }

  /**
   * Find mutations for a specific track/step combination.
   * Used for supersession detection.
   */
  findMutationsForStep(trackId: string, step: number): TrackedMutation[] {
    const result: TrackedMutation[] = [];
    for (const mutation of this.pendingMutations.values()) {
      if (mutation.trackId === trackId && mutation.step === step && mutation.state === 'pending') {
        result.push(mutation);
      }
    }
    return result;
  }

  // ============================================================================
  // Accessors for testing and debugging
  // ============================================================================

  getMutation(clientSeq: number): TrackedMutation | undefined {
    return this.pendingMutations.get(clientSeq);
  }

  getStats(): MutationStats {
    return { ...this.stats };
  }

  getPendingCount(): number {
    let count = 0;
    for (const m of this.pendingMutations.values()) {
      if (m.state === 'pending') count++;
    }
    return count;
  }

  getConfirmedCount(): number {
    let count = 0;
    for (const m of this.pendingMutations.values()) {
      if (m.state === 'confirmed') count++;
    }
    return count;
  }

  getTotalInMap(): number {
    return this.pendingMutations.size;
  }

  getAllMutations(): TrackedMutation[] {
    return Array.from(this.pendingMutations.values());
  }

  /**
   * Clear all tracked mutations (for testing or reset)
   */
  clear(): void {
    this.pendingMutations.clear();
    this.stats = { pending: 0, confirmed: 0, superseded: 0, lost: 0 };
  }
}
