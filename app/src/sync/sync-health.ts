/**
 * REFACTOR-05: Unified Sync Health Module
 *
 * Consolidates all sync health tracking that was previously scattered across:
 * - ClockSync class (hash check tracking)
 * - MultiplayerConnection (sequence gap detection)
 *
 * Provides a single point for:
 * - Recording hash check results
 * - Recording server sequence numbers
 * - Determining if recovery is needed
 * - Providing metrics for debug overlay
 */

import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface SyncHealthConfig {
  /** Number of consecutive hash mismatches before requesting snapshot (default: 2) */
  mismatchThreshold: number;
  /** Message gap size before requesting snapshot (default: 3) */
  gapThreshold: number;
  /** Number of out-of-order messages before requesting reconnect (default: 10) */
  outOfOrderThreshold: number;
}

export interface SyncHealthMetrics {
  /** Total hash checks performed */
  hashCheckCount: number;
  /** Total mismatches detected */
  mismatchCount: number;
  /** Current streak of consecutive mismatches */
  consecutiveMismatches: number;
  /** Last received server sequence number */
  lastServerSeq: number;
  /** Total out-of-order messages received */
  outOfOrderCount: number;
  /** Total missed messages (from gaps) */
  totalMissedMessages: number;
}

export interface RecoveryDecision {
  /** Whether recovery is needed */
  needed: boolean;
  /** Reason for recovery (null if not needed) */
  reason: string | null;
}

export interface SequenceResult {
  /** Number of messages missed (gap) */
  missed: number;
  /** Whether this message was out of order */
  outOfOrder: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: SyncHealthConfig = {
  mismatchThreshold: 2,
  gapThreshold: 3,
  outOfOrderThreshold: 10,
};

// ============================================================================
// SyncHealth Class
// ============================================================================

/**
 * Tracks sync health metrics and determines when recovery is needed.
 *
 * Usage:
 * ```typescript
 * const syncHealth = new SyncHealth();
 *
 * // Record hash check results
 * syncHealth.recordHashCheck(matched);
 *
 * // Record server sequence numbers
 * const result = syncHealth.recordServerSeq(seq);
 *
 * // Check if recovery is needed
 * if (syncHealth.needsRecovery().needed) {
 *   requestSnapshot();
 *   syncHealth.resetRecoveryFlags();
 * }
 * ```
 */
export class SyncHealth {
  private config: SyncHealthConfig;

  // Hash check tracking
  private hashCheckCount = 0;
  private mismatchCount = 0;
  private consecutiveMismatches = 0;

  // Sequence tracking
  private lastServerSeq = -1; // -1 indicates no messages received yet
  private outOfOrderCount = 0;
  private totalMissedMessages = 0;

  // Recovery trigger flags
  private hasLargeGap = false;
  private gapSize = 0;

  constructor(config?: Partial<SyncHealthConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // Hash Check Methods
  // ============================================================================

  /**
   * Record the result of a hash check.
   * Tracks consecutive mismatches for recovery decision.
   */
  recordHashCheck(matched: boolean): void {
    this.hashCheckCount++;

    if (!matched) {
      this.mismatchCount++;
      this.consecutiveMismatches++;
      logger.ws.log(`[SYNC-HEALTH] Hash mismatch #${this.consecutiveMismatches}`);
    } else {
      this.consecutiveMismatches = 0;
      logger.ws.log('[SYNC-HEALTH] Hash match');
    }
  }

  // ============================================================================
  // Sequence Tracking Methods
  // ============================================================================

  /**
   * Record a server sequence number.
   * Detects gaps and out-of-order messages.
   *
   * @returns Information about missed/out-of-order messages
   */
  recordServerSeq(seq: number): SequenceResult {
    // First message
    if (this.lastServerSeq === -1) {
      this.lastServerSeq = seq;
      return { missed: 0, outOfOrder: false };
    }

    const expectedSeq = this.lastServerSeq + 1;
    let missed = 0;
    let outOfOrder = false;

    if (seq > expectedSeq) {
      // Gap detected
      missed = seq - expectedSeq;
      this.totalMissedMessages += missed;

      // Check if gap is large enough to trigger recovery
      if (missed >= this.config.gapThreshold) {
        this.hasLargeGap = true;
        this.gapSize = missed;
        logger.ws.warn(`[SYNC-HEALTH] Large gap detected: missed ${missed} messages`);
      } else {
        logger.ws.log(`[SYNC-HEALTH] Small gap: missed ${missed} messages`);
      }

      this.lastServerSeq = seq;
    } else if (seq < expectedSeq) {
      // Out of order
      outOfOrder = true;
      this.outOfOrderCount++;
      logger.ws.log(`[SYNC-HEALTH] Out-of-order: expected ${expectedSeq}, got ${seq}`);
      // Don't update lastServerSeq for out-of-order messages
    } else {
      // Normal sequential message
      this.lastServerSeq = seq;
    }

    return { missed, outOfOrder };
  }

  // ============================================================================
  // Recovery Decision Methods
  // ============================================================================

  /**
   * Check if recovery is needed based on current health metrics.
   * Returns the most urgent reason if multiple issues exist.
   *
   * Priority (most urgent first):
   * 1. Large message gap (missing many messages)
   * 2. Excessive out-of-order messages
   * 3. Consecutive hash mismatches
   */
  needsRecovery(): RecoveryDecision {
    // Priority 1: Large gap (most urgent - missing state changes)
    if (this.hasLargeGap) {
      return {
        needed: true,
        reason: `gap of ${this.gapSize} messages`,
      };
    }

    // Priority 2: Too many out-of-order messages (network instability)
    if (this.outOfOrderCount > this.config.outOfOrderThreshold) {
      return {
        needed: true,
        reason: `${this.outOfOrderCount} out-of-order messages`,
      };
    }

    // Priority 3: Consecutive hash mismatches (state divergence)
    if (this.consecutiveMismatches >= this.config.mismatchThreshold) {
      return {
        needed: true,
        reason: `${this.consecutiveMismatches} consecutive hash mismatches`,
      };
    }

    return { needed: false, reason: null };
  }

  /**
   * Reset recovery trigger flags after a snapshot is received.
   * Keeps cumulative metrics for debugging.
   */
  resetRecoveryFlags(): void {
    this.consecutiveMismatches = 0;
    this.hasLargeGap = false;
    this.gapSize = 0;
    this.outOfOrderCount = 0;
    logger.ws.log('[SYNC-HEALTH] Recovery flags reset');
  }

  /**
   * Full reset - clears all state.
   * Call on disconnect.
   */
  reset(): void {
    this.hashCheckCount = 0;
    this.mismatchCount = 0;
    this.consecutiveMismatches = 0;
    this.lastServerSeq = -1;
    this.outOfOrderCount = 0;
    this.totalMissedMessages = 0;
    this.hasLargeGap = false;
    this.gapSize = 0;
    logger.ws.log('[SYNC-HEALTH] Full reset');
  }

  // ============================================================================
  // Metrics Methods
  // ============================================================================

  /**
   * Get comprehensive metrics for debugging/observability.
   */
  getMetrics(): SyncHealthMetrics {
    return {
      hashCheckCount: this.hashCheckCount,
      mismatchCount: this.mismatchCount,
      consecutiveMismatches: this.consecutiveMismatches,
      lastServerSeq: this.lastServerSeq === -1 ? 0 : this.lastServerSeq,
      outOfOrderCount: this.outOfOrderCount,
      totalMissedMessages: this.totalMissedMessages,
    };
  }

  /**
   * Get last server sequence number.
   * Returns 0 if no messages received yet.
   */
  getLastServerSeq(): number {
    return this.lastServerSeq === -1 ? 0 : this.lastServerSeq;
  }

  /**
   * Get out-of-order message count.
   */
  getOutOfOrderCount(): number {
    return this.outOfOrderCount;
  }
}
