/**
 * LRU Sample Cache with Reference Counting
 *
 * Manages AudioBuffer samples with memory-bounded caching and smart eviction.
 * See specs/LRU-SAMPLE-CACHE.md for detailed architecture documentation.
 *
 * Key features:
 * - O(1) lookup, insert, and eviction
 * - Reference counting prevents evicting in-use samples
 * - Size-based memory management
 * - Observable metrics for debugging
 */

import { logger } from '../utils/logger';

/**
 * A node in the doubly-linked list for LRU ordering
 */
interface ListNode<T> {
  key: string;
  value: T;
  prev: ListNode<T> | null;
  next: ListNode<T> | null;
}

/**
 * Cache entry containing the buffer and metadata
 */
interface CacheEntry {
  key: string;
  buffer: AudioBuffer;
  size: number;
  node: ListNode<CacheEntry>;
  createdAt: number;
  lastAccessedAt: number;
}

/**
 * Cache metrics for observability
 */
export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  currentSize: number;
  maxSize: number;
  entryCount: number;
  refCountedEntries: number;
}

/**
 * Memory pressure levels for proactive eviction
 */
export type MemoryPressureLevel = 'warning' | 'critical';

/**
 * Configuration options for the cache
 */
export interface LRUSampleCacheOptions {
  /** Maximum cache size in bytes (default: 64MB, or 32MB on iOS) */
  maxSize?: number;
  /**
   * Absolute hard limit that cannot be exceeded even with referenced entries.
   * On iOS, this prevents crashes when memory exceeds ~50-100MB.
   * If not set, defaults to 1.5x maxSize (allows some temporary overage).
   */
  hardLimit?: number;
  /** Called when an entry is evicted */
  onEvict?: (key: string, buffer: AudioBuffer) => void;
  /** Called when memory pressure is signaled */
  onMemoryPressure?: (level: MemoryPressureLevel) => void;
}

// Default max sizes
const DEFAULT_MAX_SIZE = 64 * 1024 * 1024;  // 64MB for desktop
const IOS_MAX_SIZE = 32 * 1024 * 1024;      // 32MB for iOS (safer limit)
const IOS_HARD_LIMIT = 48 * 1024 * 1024;    // 48MB absolute max on iOS

/**
 * Detect if running on iOS (iPhone, iPad, iPod)
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua);
}

/**
 * Get recommended max cache size based on platform.
 * iOS devices get a lower limit to avoid memory crashes.
 */
export function getRecommendedMaxSize(): number {
  return isIOS() ? IOS_MAX_SIZE : DEFAULT_MAX_SIZE;
}

/**
 * Get recommended hard limit based on platform.
 */
export function getRecommendedHardLimit(): number {
  return isIOS() ? IOS_HARD_LIMIT : DEFAULT_MAX_SIZE * 1.5;
}

/**
 * Calculate the memory size of an AudioBuffer in bytes
 */
export function getBufferSize(buffer: AudioBuffer): number {
  // Float32Array: 4 bytes per sample
  return buffer.numberOfChannels * buffer.length * 4;
}

/**
 * LRU Sample Cache with Reference Counting
 *
 * Usage:
 * ```typescript
 * const cache = new LRUSampleCache({ maxSize: 32 * 1024 * 1024 });
 *
 * // Set a sample
 * cache.set('piano:C4:v100', audioBuffer);
 *
 * // Get a sample (moves to front of LRU)
 * const buffer = cache.get('piano:C4:v100');
 *
 * // Acquire reference (prevents eviction)
 * cache.acquire('piano:C4:v100');
 *
 * // Release reference (allows eviction)
 * cache.release('piano:C4:v100');
 * ```
 */
export class LRUSampleCache {
  private cache: Map<string, CacheEntry> = new Map();
  private refCounts: Map<string, number> = new Map();
  private head: ListNode<CacheEntry> | null = null;
  private tail: ListNode<CacheEntry> | null = null;
  private currentSize = 0;
  private maxSize: number;
  private hardLimit: number;
  private onEvict?: (key: string, buffer: AudioBuffer) => void;
  private onMemoryPressure?: (level: MemoryPressureLevel) => void;

  // Metrics
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: LRUSampleCacheOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.hardLimit = options.hardLimit ?? this.maxSize * 1.5;
    this.onEvict = options.onEvict;
    this.onMemoryPressure = options.onMemoryPressure;
    logger.audio.log(`LRUSampleCache initialized with maxSize: ${(this.maxSize / 1024 / 1024).toFixed(1)}MB, hardLimit: ${(this.hardLimit / 1024 / 1024).toFixed(1)}MB`);
  }

  /**
   * Get a sample from the cache
   * Returns null if not found (caller should load it)
   */
  get(key: string): AudioBuffer | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    this.hits++;
    entry.lastAccessedAt = Date.now();
    this.moveToHead(entry.node);
    return entry.buffer;
  }

  /**
   * Check if a key exists in the cache (without updating LRU order)
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Add or update a sample in the cache
   */
  set(key: string, buffer: AudioBuffer): void {
    const size = getBufferSize(buffer);

    // Reject entries that individually exceed hardLimit
    if (size > this.hardLimit) {
      logger.audio.warn(
        `LRU cache: rejecting ${key} - size ${(size / 1024).toFixed(1)}KB exceeds hardLimit ${(this.hardLimit / 1024 / 1024).toFixed(1)}MB`
      );
      return;
    }

    // If key exists, update it
    const existing = this.cache.get(key);
    if (existing) {
      this.currentSize -= existing.size;
      existing.buffer = buffer;
      existing.size = size;
      existing.lastAccessedAt = Date.now();
      this.currentSize += size;
      this.moveToHead(existing.node);
      return;
    }

    // Evict if necessary to make room
    this.evictIfNeeded(size);

    // Create new entry
    const node: ListNode<CacheEntry> = {
      key,
      value: null as unknown as CacheEntry, // Will be set below
      prev: null,
      next: null,
    };

    const entry: CacheEntry = {
      key,
      buffer,
      size,
      node,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    node.value = entry;

    // Add to cache and LRU list
    this.cache.set(key, entry);
    this.addToHead(node);
    this.currentSize += size;
  }

  /**
   * Acquire a reference to a key (prevents eviction)
   * Safe to call multiple times - uses reference counting
   */
  acquire(key: string): void {
    const count = this.refCounts.get(key) ?? 0;
    this.refCounts.set(key, count + 1);
  }

  /**
   * Release a reference to a key (allows eviction when count reaches 0)
   * Safe to call even if not acquired - will be a no-op
   */
  release(key: string): void {
    const count = this.refCounts.get(key) ?? 0;
    if (count <= 1) {
      this.refCounts.delete(key);
    } else {
      this.refCounts.set(key, count - 1);
    }
  }

  /**
   * Get the reference count for a key
   */
  getRefCount(key: string): number {
    return this.refCounts.get(key) ?? 0;
  }

  /**
   * Delete a specific entry from the cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.removeNode(entry.node);
    this.cache.delete(key);
    this.currentSize -= entry.size;
    this.refCounts.delete(key);

    if (this.onEvict) {
      this.onEvict(key, entry.buffer);
    }

    return true;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    if (this.onEvict) {
      for (const entry of this.cache.values()) {
        this.onEvict(entry.key, entry.buffer);
      }
    }

    this.cache.clear();
    this.refCounts.clear();
    this.head = null;
    this.tail = null;
    this.currentSize = 0;
    this.evictions = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get current cache metrics
   */
  getMetrics(): CacheMetrics {
    let refCountedEntries = 0;
    for (const count of this.refCounts.values()) {
      if (count > 0) refCountedEntries++;
    }

    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      currentSize: this.currentSize,
      maxSize: this.maxSize,
      entryCount: this.cache.size,
      refCountedEntries,
    };
  }

  /**
   * Get all keys in the cache (for debugging)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size in bytes
   */
  get size(): number {
    return this.currentSize;
  }

  /**
   * Get number of entries
   */
  get count(): number {
    return this.cache.size;
  }

  /**
   * Get current memory usage in bytes (alias for size)
   */
  getCurrentMemoryUsage(): number {
    return this.currentSize;
  }

  /**
   * Dynamically adjust maxSize at runtime.
   * Will trigger eviction if current size exceeds new max.
   */
  setMaxSize(newSize: number): void {
    this.maxSize = newSize;
    // Trigger eviction if we're now over the limit
    this.evictIfNeeded(0);
    logger.audio.log(`LRU cache maxSize changed to ${(this.maxSize / 1024 / 1024).toFixed(1)}MB`);
  }

  /**
   * Handle memory pressure signal from the system.
   * Proactively evicts unreferenced entries to free memory.
   *
   * @param level - 'warning' evicts to ~75% capacity, 'critical' evicts to ~50%
   */
  handleMemoryPressure(level: MemoryPressureLevel): void {
    // Notify callback
    if (this.onMemoryPressure) {
      this.onMemoryPressure(level);
    }

    // Determine target reduction
    const targetPercentage = level === 'critical' ? 0.5 : 0.75;
    const targetSize = this.currentSize * targetPercentage;

    logger.audio.warn(
      `LRU cache: memory pressure (${level}) - reducing from ` +
      `${(this.currentSize / 1024).toFixed(1)}KB to ${(targetSize / 1024).toFixed(1)}KB`
    );

    // Evict unreferenced entries from tail until we hit target
    while (this.currentSize > targetSize && this.tail) {
      let node: ListNode<CacheEntry> | null = this.tail;
      let evicted = false;

      while (node && this.currentSize > targetSize) {
        const entry = node.value;
        const refCount = this.refCounts.get(entry.key) ?? 0;

        if (refCount === 0) {
          const prevNode: ListNode<CacheEntry> | null = node.prev;
          this.evictEntry(entry);
          evicted = true;
          node = prevNode;
        } else {
          node = node.prev;
        }
      }

      // If nothing was evicted, all remaining entries are referenced
      if (!evicted) break;
    }

    logger.audio.log(
      `LRU cache: after pressure handling - ${(this.currentSize / 1024).toFixed(1)}KB, ` +
      `${this.cache.size} entries`
    );
  }

  // === Private Methods ===

  /**
   * Evict entries from the tail (LRU) until there's room for newSize bytes.
   * First tries to evict unreferenced entries, then force-evicts referenced
   * entries if hardLimit would be exceeded.
   */
  private evictIfNeeded(newSize: number): void {
    const targetSize = this.maxSize - newSize;

    // Phase 1: Evict unreferenced entries (normal LRU behavior)
    while (this.currentSize > targetSize && this.tail) {
      let node: ListNode<CacheEntry> | null = this.tail;
      let evicted = false;

      while (node) {
        const entry = node.value;
        const refCount = this.refCounts.get(entry.key) ?? 0;

        if (refCount === 0) {
          const prevNode: ListNode<CacheEntry> | null = node.prev;
          this.evictEntry(entry);
          evicted = true;
          node = prevNode;

          if (this.currentSize <= targetSize) break;
        } else {
          node = node.prev;
        }
      }

      if (!evicted) break;
    }

    // Phase 2: If we'd exceed hardLimit, force-evict even referenced entries
    const wouldExceedHardLimit = this.currentSize + newSize > this.hardLimit;
    if (wouldExceedHardLimit && this.tail) {
      const hardTargetSize = this.hardLimit - newSize;

      logger.audio.warn(
        `LRU cache: force-evicting referenced entries to stay under hardLimit ` +
        `(current: ${(this.currentSize / 1024 / 1024).toFixed(1)}MB, ` +
        `hardLimit: ${(this.hardLimit / 1024 / 1024).toFixed(1)}MB)`
      );

      // Force evict from tail regardless of refCount
      while (this.currentSize > hardTargetSize && this.tail) {
        const entry = this.tail.value;
        this.evictEntry(entry);
        // Also clear the reference count since we're force-evicting
        this.refCounts.delete(entry.key);
      }
    }

    // Log warning if still over maxSize (but under hardLimit)
    if (this.currentSize + newSize > this.maxSize && this.currentSize + newSize <= this.hardLimit) {
      logger.audio.warn(
        `LRU cache over soft limit: ${(this.currentSize / 1024 / 1024).toFixed(1)}MB ` +
        `(max: ${(this.maxSize / 1024 / 1024).toFixed(1)}MB) - all unreferenced entries evicted`
      );
    }
  }

  /**
   * Evict a single entry from the cache
   */
  private evictEntry(entry: CacheEntry): void {
    this.removeNode(entry.node);
    this.cache.delete(entry.key);
    this.currentSize -= entry.size;
    this.evictions++;

    if (this.onEvict) {
      this.onEvict(entry.key, entry.buffer);
    }

    logger.audio.log(`LRU evicted: ${entry.key} (${(entry.size / 1024).toFixed(1)}KB)`);
  }

  /**
   * Add a node to the head of the LRU list (most recently used)
   */
  private addToHead(node: ListNode<CacheEntry>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * Remove a node from the LRU list
   */
  private removeNode(node: ListNode<CacheEntry>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * Move a node to the head (most recently used)
   */
  private moveToHead(node: ListNode<CacheEntry>): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToHead(node);
  }
}

// Export a singleton instance for global use
// Note: Create separate instances for isolated testing
export const sampleCache = new LRUSampleCache();
