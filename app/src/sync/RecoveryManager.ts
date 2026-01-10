/**
 * RecoveryManager - Manages snapshot recovery state and requests
 *
 * Handles state recovery when sync issues are detected:
 * - Debounced snapshot requests to prevent flooding
 * - Timeout handling for failed recovery attempts
 * - Clean state transitions
 *
 * Extracted from multiplayer.ts to reduce complexity (TASK-012)
 */

import { logger } from '../utils/logger';

export interface RecoveryManagerOptions {
  /** Time to wait between recovery requests (ms) */
  debounceMs?: number;
  /** Time to wait for snapshot before resetting (ms) */
  timeoutMs?: number;
}

/**
 * Manages snapshot recovery state with debouncing and timeout handling.
 *
 * @example
 * ```ts
 * const recovery = new RecoveryManager({
 *   debounceMs: 2000,
 *   timeoutMs: 30000
 * });
 *
 * // Request recovery when sync issues detected
 * const sent = recovery.request('hash mismatch', () => {
 *   connection.send({ type: 'request_snapshot' });
 * });
 *
 * // Mark complete when snapshot received
 * recovery.complete();
 *
 * // Reset on disconnect
 * recovery.reset();
 * ```
 */
export class RecoveryManager {
  private inProgress = false;
  private lastRequestTime = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  private readonly debounceMs: number;
  private readonly timeoutMs: number;

  constructor(options: RecoveryManagerOptions = {}) {
    this.debounceMs = options.debounceMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  /**
   * Check if recovery is currently in progress.
   */
  get isInProgress(): boolean {
    return this.inProgress;
  }

  /**
   * Request a snapshot recovery.
   *
   * Handles debouncing to prevent rapid repeated requests.
   * Sets a timeout to auto-reset if snapshot never arrives.
   *
   * @param reason - Description of why recovery is needed (for logging)
   * @param sendRequest - Callback to actually send the snapshot request
   * @returns true if request was sent, false if debounced
   */
  request(reason: string, sendRequest: () => void): boolean {
    const now = Date.now();

    // Check debounce window
    if (this.inProgress || now - this.lastRequestTime < this.debounceMs) {
      logger.ws.log(`[RECOVERY] Skipping snapshot request (${reason}) - debounced`);
      return false;
    }

    this.inProgress = true;
    this.lastRequestTime = now;
    logger.ws.log(`[RECOVERY] Requesting snapshot: ${reason}`);

    // Set timeout to reset recovery state if snapshot never arrives
    this.clearTimeout();
    this.timeout = setTimeout(() => {
      if (this.inProgress) {
        logger.ws.warn('[RECOVERY] Timeout waiting for snapshot, resetting recovery state');
        this.inProgress = false;
        this.timeout = null;
      }
    }, this.timeoutMs);

    // Execute the actual request
    sendRequest();
    return true;
  }

  /**
   * Mark recovery as complete.
   * Called when snapshot is successfully received and applied.
   */
  complete(): void {
    this.inProgress = false;
    this.clearTimeout();
    logger.ws.log('[RECOVERY] Recovery complete');
  }

  /**
   * Reset recovery state.
   * Called on disconnect or when recovery needs to be cancelled.
   */
  reset(): void {
    this.inProgress = false;
    this.lastRequestTime = 0;
    this.clearTimeout();
  }

  /**
   * Clear the recovery timeout.
   */
  private clearTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
