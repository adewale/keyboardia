/**
 * MessageQueue - Priority-based offline message queue
 *
 * Manages message buffering during WebSocket disconnections with:
 * - Priority-based message ordering (high > normal > low)
 * - Size-limited queue with priority-aware eviction
 * - Age-based message expiration
 * - Sorted replay on reconnection
 *
 * Extracted from multiplayer.ts to reduce complexity (TASK-011)
 */

import type { ClientMessage } from '../shared/sync-types';
import { MAX_MESSAGE_SIZE } from '../shared/constants';
import { logger } from '../utils/logger';

export type MessagePriority = 'high' | 'normal' | 'low';

export interface QueuedMessage {
  message: ClientMessage;
  timestamp: number;
  priority: MessagePriority;
}

/**
 * Get priority level for a message type.
 * High: Critical state changes (add_track, delete_track, request_snapshot)
 * Normal: User interactions (toggle_step, mute, solo, tempo, swing)
 * Low: Transient updates (cursor_move, play, stop)
 */
export function getMessagePriority(messageType: ClientMessage['type']): MessagePriority {
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

export interface MessageQueueOptions {
  maxSize?: number;
  maxAge?: number; // milliseconds
}

/**
 * Priority-based message queue for offline buffering.
 *
 * @example
 * ```ts
 * const queue = new MessageQueue({ maxSize: 100, maxAge: 30000 });
 *
 * // Queue messages during disconnect
 * queue.enqueue(message);
 *
 * // On reconnect, replay all queued messages
 * queue.replay(websocket);
 * ```
 */
export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private readonly maxSize: number;
  private readonly maxAge: number;

  constructor(options: MessageQueueOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.maxAge = options.maxAge ?? 30000; // 30 seconds default
  }

  /**
   * Queue a message for replay on reconnect.
   * Skips time-sensitive messages that shouldn't be replayed.
   */
  enqueue(message: ClientMessage): void {
    // Don't queue certain message types that are time-sensitive
    if (message.type === 'clock_sync_request' || message.type === 'state_hash') {
      return;
    }

    const priority = getMessagePriority(message.type);

    // Priority-based eviction when queue is full
    if (this.queue.length >= this.maxSize) {
      const evicted = this.evictLowestPriority();
      if (!evicted) {
        // Couldn't evict anything (all high priority), drop this message
        logger.ws.log(`Queue full, dropping ${priority} priority message: ${message.type}`);
        return;
      }
    }

    this.queue.push({
      message,
      timestamp: Date.now(),
      priority,
    });

    logger.ws.log(`Queued ${priority} priority message: ${message.type} (queue size: ${this.queue.length})`);
  }

  /**
   * Evict the lowest priority message from the queue.
   * Prefers evicting: low > normal > high (oldest first within same priority)
   * @returns true if a message was evicted, false if queue is empty or all high priority
   */
  private evictLowestPriority(): boolean {
    // Find index of lowest priority message (oldest first within same priority)
    let lowIndex = -1;
    let normalIndex = -1;

    for (let i = 0; i < this.queue.length; i++) {
      const p = this.queue[i].priority;
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
      const evicted = this.queue.splice(evictIndex, 1)[0];
      logger.ws.log(`Evicted ${evicted.priority} priority message: ${evicted.message.type}`);
      return true;
    }

    return false;
  }

  /**
   * Replay queued messages after reconnect.
   * Sends high priority messages first, drops stale messages.
   * Clears the queue after replay.
   *
   * @param send - Function to send a message (usually ws.send bound to websocket)
   */
  replay(send: (data: string) => void): void {
    const now = Date.now();
    let replayed = 0;
    let dropped = 0;

    // Sort by priority (high first), then by timestamp (oldest first)
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    const sortedQueue = [...this.queue].sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });

    for (const queued of sortedQueue) {
      // Drop messages that are too old
      if (now - queued.timestamp > this.maxAge) {
        dropped++;
        continue;
      }

      // Replay the message (with size validation as defense-in-depth)
      const serialized = JSON.stringify(queued.message);
      if (serialized.length > MAX_MESSAGE_SIZE) {
        logger.ws.warn(`Dropping oversized queued message: ${queued.message.type}`);
        dropped++;
        continue;
      }

      send(serialized);
      replayed++;
    }

    if (replayed > 0 || dropped > 0) {
      logger.ws.log(`Replayed ${replayed} queued messages (by priority), dropped ${dropped} stale messages`);
    }

    // Clear the queue
    this.queue = [];
  }

  /**
   * Get current queue size (for debugging/UI).
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Clear all queued messages.
   */
  clear(): void {
    this.queue = [];
  }
}
