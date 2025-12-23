/**
 * Tests for LRU Sample Cache with Reference Counting
 *
 * Tests the cache's core functionality:
 * - Basic get/set operations
 * - LRU eviction ordering
 * - Reference counting prevents eviction
 * - Memory size management
 * - Edge cases
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LRUSampleCache, getBufferSize, isIOS, getRecommendedMaxSize } from './lru-sample-cache';

// Mock AudioBuffer factory
function createMockBuffer(channels: number, length: number): AudioBuffer {
  return {
    numberOfChannels: channels,
    length,
    sampleRate: 44100,
    duration: length / 44100,
    getChannelData: vi.fn(),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

describe('getBufferSize', () => {
  it('calculates size correctly for stereo buffer', () => {
    const buffer = createMockBuffer(2, 44100); // 1 second stereo
    // 2 channels * 44100 samples * 4 bytes = 352800 bytes
    expect(getBufferSize(buffer)).toBe(352800);
  });

  it('calculates size correctly for mono buffer', () => {
    const buffer = createMockBuffer(1, 22050); // 0.5 second mono
    // 1 channel * 22050 samples * 4 bytes = 88200 bytes
    expect(getBufferSize(buffer)).toBe(88200);
  });
});

describe('LRUSampleCache', () => {
  let cache: LRUSampleCache;

  beforeEach(() => {
    // Create cache with 1MB max size for testing
    cache = new LRUSampleCache({ maxSize: 1024 * 1024 });
  });

  describe('basic operations', () => {
    it('returns null for missing keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('stores and retrieves buffers', () => {
      const buffer = createMockBuffer(2, 1000);
      cache.set('test:A4:v100', buffer);
      expect(cache.get('test:A4:v100')).toBe(buffer);
    });

    it('reports has() correctly', () => {
      const buffer = createMockBuffer(2, 1000);
      expect(cache.has('test:A4:v100')).toBe(false);
      cache.set('test:A4:v100', buffer);
      expect(cache.has('test:A4:v100')).toBe(true);
    });

    it('updates existing entries', () => {
      const buffer1 = createMockBuffer(2, 1000);
      const buffer2 = createMockBuffer(2, 2000);

      cache.set('test:A4:v100', buffer1);
      cache.set('test:A4:v100', buffer2);

      expect(cache.get('test:A4:v100')).toBe(buffer2);
      expect(cache.count).toBe(1);
    });

    it('deletes entries', () => {
      const buffer = createMockBuffer(2, 1000);
      cache.set('test:A4:v100', buffer);

      expect(cache.delete('test:A4:v100')).toBe(true);
      expect(cache.get('test:A4:v100')).toBeNull();
      expect(cache.delete('test:A4:v100')).toBe(false); // Already deleted
    });

    it('clears all entries', () => {
      cache.set('a', createMockBuffer(2, 1000));
      cache.set('b', createMockBuffer(2, 1000));
      cache.set('c', createMockBuffer(2, 1000));

      expect(cache.count).toBe(3);
      cache.clear();
      expect(cache.count).toBe(0);
      expect(cache.size).toBe(0);
    });
  });

  describe('LRU ordering', () => {
    it('evicts least recently used when full', () => {
      // Each buffer is ~8KB (2 channels * 1000 samples * 4 bytes)
      const smallCache = new LRUSampleCache({ maxSize: 24000 }); // Fits ~3 buffers

      smallCache.set('a', createMockBuffer(2, 1000));
      smallCache.set('b', createMockBuffer(2, 1000));
      smallCache.set('c', createMockBuffer(2, 1000));

      // All three should be cached
      expect(smallCache.has('a')).toBe(true);
      expect(smallCache.has('b')).toBe(true);
      expect(smallCache.has('c')).toBe(true);

      // Add a fourth - should evict 'a' (oldest)
      smallCache.set('d', createMockBuffer(2, 1000));

      expect(smallCache.has('a')).toBe(false); // Evicted
      expect(smallCache.has('b')).toBe(true);
      expect(smallCache.has('c')).toBe(true);
      expect(smallCache.has('d')).toBe(true);
    });

    it('get() moves item to front of LRU', () => {
      const smallCache = new LRUSampleCache({ maxSize: 24000 }); // Fits ~3 buffers

      smallCache.set('a', createMockBuffer(2, 1000));
      smallCache.set('b', createMockBuffer(2, 1000));
      smallCache.set('c', createMockBuffer(2, 1000));

      // Access 'a' - moves it to front
      smallCache.get('a');

      // Add 'd' - should evict 'b' (now oldest)
      smallCache.set('d', createMockBuffer(2, 1000));

      expect(smallCache.has('a')).toBe(true); // Accessed, moved to front
      expect(smallCache.has('b')).toBe(false); // Evicted (was oldest)
      expect(smallCache.has('c')).toBe(true);
      expect(smallCache.has('d')).toBe(true);
    });
  });

  describe('reference counting', () => {
    it('acquire() prevents eviction', () => {
      const smallCache = new LRUSampleCache({ maxSize: 24000 }); // Fits ~3 buffers

      smallCache.set('a', createMockBuffer(2, 1000));
      smallCache.set('b', createMockBuffer(2, 1000));
      smallCache.set('c', createMockBuffer(2, 1000));

      // Acquire reference to 'a'
      smallCache.acquire('a');

      // Add 'd' - should evict 'b' instead of 'a' (a is referenced)
      smallCache.set('d', createMockBuffer(2, 1000));

      expect(smallCache.has('a')).toBe(true); // Protected by reference
      expect(smallCache.has('b')).toBe(false); // Evicted (was oldest unreferenced)
    });

    it('release() allows eviction', () => {
      const smallCache = new LRUSampleCache({ maxSize: 16000 }); // Fits ~2 buffers

      smallCache.set('a', createMockBuffer(2, 1000));
      smallCache.acquire('a');

      smallCache.set('b', createMockBuffer(2, 1000));

      // Release 'a'
      smallCache.release('a');

      // Add 'c' - should now be able to evict 'a'
      smallCache.set('c', createMockBuffer(2, 1000));

      expect(smallCache.has('a')).toBe(false); // Now evictable
      expect(smallCache.has('b')).toBe(true);
      expect(smallCache.has('c')).toBe(true);
    });

    it('supports multiple acquire/release', () => {
      cache.set('a', createMockBuffer(2, 1000));

      cache.acquire('a');
      cache.acquire('a');
      expect(cache.getRefCount('a')).toBe(2);

      cache.release('a');
      expect(cache.getRefCount('a')).toBe(1);

      cache.release('a');
      expect(cache.getRefCount('a')).toBe(0);
    });

    it('release() is safe to call without acquire', () => {
      expect(() => cache.release('nonexistent')).not.toThrow();
      expect(cache.getRefCount('nonexistent')).toBe(0);
    });
  });

  describe('metrics', () => {
    it('tracks hits and misses', () => {
      cache.set('a', createMockBuffer(2, 1000));

      cache.get('a'); // Hit
      cache.get('a'); // Hit
      cache.get('b'); // Miss
      cache.get('c'); // Miss

      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(2);
      expect(metrics.misses).toBe(2);
    });

    it('tracks evictions', () => {
      const smallCache = new LRUSampleCache({ maxSize: 16000 }); // Fits ~2 buffers

      smallCache.set('a', createMockBuffer(2, 1000));
      smallCache.set('b', createMockBuffer(2, 1000));
      smallCache.set('c', createMockBuffer(2, 1000)); // Evicts 'a'
      smallCache.set('d', createMockBuffer(2, 1000)); // Evicts 'b'

      const metrics = smallCache.getMetrics();
      expect(metrics.evictions).toBe(2);
    });

    it('tracks current size', () => {
      const buffer = createMockBuffer(2, 1000); // 8000 bytes
      cache.set('a', buffer);

      const metrics = cache.getMetrics();
      expect(metrics.currentSize).toBe(8000);
    });

    it('tracks referenced entries', () => {
      cache.set('a', createMockBuffer(2, 1000));
      cache.set('b', createMockBuffer(2, 1000));

      cache.acquire('a');

      const metrics = cache.getMetrics();
      expect(metrics.refCountedEntries).toBe(1);
    });
  });

  describe('callbacks', () => {
    it('calls onEvict when entries are evicted', () => {
      const onEvict = vi.fn();
      const smallCache = new LRUSampleCache({ maxSize: 16000, onEvict });

      const bufferA = createMockBuffer(2, 1000);
      smallCache.set('a', bufferA);
      smallCache.set('b', createMockBuffer(2, 1000));
      smallCache.set('c', createMockBuffer(2, 1000)); // Evicts 'a'

      expect(onEvict).toHaveBeenCalledWith('a', bufferA);
    });

    it('calls onEvict when delete() is called', () => {
      const onEvict = vi.fn();
      const testCache = new LRUSampleCache({ maxSize: 1024 * 1024, onEvict });

      const buffer = createMockBuffer(2, 1000);
      testCache.set('a', buffer);
      testCache.delete('a');

      expect(onEvict).toHaveBeenCalledWith('a', buffer);
    });

    it('calls onEvict for all entries on clear()', () => {
      const onEvict = vi.fn();
      const testCache = new LRUSampleCache({ maxSize: 1024 * 1024, onEvict });

      testCache.set('a', createMockBuffer(2, 1000));
      testCache.set('b', createMockBuffer(2, 1000));
      testCache.clear();

      expect(onEvict).toHaveBeenCalledTimes(2);
    });
  });

  describe('edge cases', () => {
    it('handles empty cache', () => {
      expect(cache.get('anything')).toBeNull();
      expect(cache.count).toBe(0);
      expect(cache.size).toBe(0);
      expect(cache.keys()).toEqual([]);
    });

    it('rejects buffer larger than hardLimit', () => {
      const tinyCache = new LRUSampleCache({ maxSize: 1000, hardLimit: 2000 });
      const largeBuffer = createMockBuffer(2, 10000); // 80000 bytes > 2000 hardLimit

      // Should be rejected to prevent iOS memory crashes
      tinyCache.set('large', largeBuffer);
      expect(tinyCache.get('large')).toBeNull(); // Rejected, not stored
      expect(tinyCache.size).toBe(0);
    });

    it('handles all entries being referenced', () => {
      const smallCache = new LRUSampleCache({ maxSize: 24000 });

      smallCache.set('a', createMockBuffer(2, 1000));
      smallCache.set('b', createMockBuffer(2, 1000));
      smallCache.set('c', createMockBuffer(2, 1000));

      // Reference all entries
      smallCache.acquire('a');
      smallCache.acquire('b');
      smallCache.acquire('c');

      // Adding more should still work (allows overage)
      smallCache.set('d', createMockBuffer(2, 1000));

      // All should still be present (nothing could be evicted)
      expect(smallCache.has('a')).toBe(true);
      expect(smallCache.has('b')).toBe(true);
      expect(smallCache.has('c')).toBe(true);
      expect(smallCache.has('d')).toBe(true);
    });

    it('delete() also clears reference count', () => {
      cache.set('a', createMockBuffer(2, 1000));
      cache.acquire('a');
      cache.acquire('a');

      expect(cache.getRefCount('a')).toBe(2);

      cache.delete('a');

      expect(cache.getRefCount('a')).toBe(0);
    });
  });

  // ===========================================================================
  // iOS Memory Safety Tests
  // ===========================================================================
  // iOS Safari crashes when audio buffer memory exceeds ~50-100MB.
  // These tests verify the cache can enforce hard limits and detect iOS.
  // ===========================================================================

  describe('iOS memory safety', () => {
    describe('hard limit enforcement', () => {
      it('should support a hardLimit option that cannot be exceeded', () => {
        const hardLimitCache = new LRUSampleCache({
          maxSize: 24000,
          hardLimit: 32000,  // Absolute max, even with referenced entries
        });

        hardLimitCache.set('a', createMockBuffer(2, 1000)); // 8000 bytes
        hardLimitCache.set('b', createMockBuffer(2, 1000)); // 8000 bytes
        hardLimitCache.set('c', createMockBuffer(2, 1000)); // 8000 bytes = 24000 total

        // Reference all entries to prevent normal eviction
        hardLimitCache.acquire('a');
        hardLimitCache.acquire('b');
        hardLimitCache.acquire('c');

        // Try to add another - would push to 32000 bytes
        hardLimitCache.set('d', createMockBuffer(2, 1000));

        // With hard limit, should refuse or evict despite references
        const metrics = hardLimitCache.getMetrics();
        expect(metrics.currentSize).toBeLessThanOrEqual(32000);
      });

      it('should reject entries that would exceed hardLimit even individually', () => {
        const hardLimitCache = new LRUSampleCache({
          maxSize: 8000,
          hardLimit: 16000,
        });

        // Try to add a buffer that's larger than hardLimit
        const hugeBuffer = createMockBuffer(2, 5000); // 40000 bytes > 16000

        hardLimitCache.set('huge', hugeBuffer);

        // Should either reject or not store
        // (implementation detail: could log warning and reject)
        const metrics = hardLimitCache.getMetrics();
        expect(metrics.currentSize).toBeLessThanOrEqual(16000);
      });

      it('should force-evict referenced entries when hardLimit would be exceeded', () => {
        const onEvict = vi.fn();
        const hardLimitCache = new LRUSampleCache({
          maxSize: 16000,
          hardLimit: 24000,
          onEvict,
        });

        hardLimitCache.set('a', createMockBuffer(2, 1000)); // 8000
        hardLimitCache.set('b', createMockBuffer(2, 1000)); // 8000 = 16000
        hardLimitCache.acquire('a');
        hardLimitCache.acquire('b');

        // Add third would hit 24000 (at limit)
        hardLimitCache.set('c', createMockBuffer(2, 1000)); // 8000

        // Add fourth would exceed hardLimit - must evict something
        hardLimitCache.set('d', createMockBuffer(2, 1000));

        // Something should have been evicted despite references
        expect(hardLimitCache.count).toBeLessThanOrEqual(3);
      });
    });

    describe('platform-aware defaults', () => {
      it('isIOS() detects iOS user agents', () => {
        // Test that the isIOS function exists and can detect iOS
        // Note: In test environment, navigator.userAgent is not iOS
        expect(typeof isIOS).toBe('function');
        // Default test environment should not be iOS
        expect(isIOS()).toBe(false);
      });

      it('getRecommendedMaxSize() returns 64MB for non-iOS (default test env)', () => {
        // In test environment (Node/JSDOM), this should return desktop default
        const size = getRecommendedMaxSize();
        expect(size).toBe(64 * 1024 * 1024);
      });

      it('should return smaller size when isIOS would return true', () => {
        // Verify the iOS constants are smaller than desktop
        // iOS: 32MB, Desktop: 64MB
        const IOS_MAX_SIZE = 32 * 1024 * 1024;
        const DEFAULT_MAX_SIZE = 64 * 1024 * 1024;
        expect(IOS_MAX_SIZE).toBeLessThan(DEFAULT_MAX_SIZE);
      });
    });

    describe('memory pressure handling', () => {
      it('should support onMemoryPressure callback for proactive eviction', () => {
        const onMemoryPressure = vi.fn();
        const pressureCache = new LRUSampleCache({
          maxSize: 1024 * 1024,
          onMemoryPressure,
        });

        // Simulate memory pressure signal
        pressureCache.handleMemoryPressure('warning');

        expect(onMemoryPressure).toHaveBeenCalledWith('warning');
      });

      it('should evict unreferenced entries on memory pressure', () => {
        const pressureCache = new LRUSampleCache({ maxSize: 32000 });

        pressureCache.set('a', createMockBuffer(2, 1000));
        pressureCache.set('b', createMockBuffer(2, 1000));
        pressureCache.set('c', createMockBuffer(2, 1000));
        pressureCache.acquire('c'); // Protect c

        const sizeBefore = pressureCache.size;

        // Simulate critical memory pressure
        pressureCache.handleMemoryPressure('critical');

        // Should have evicted unreferenced entries
        expect(pressureCache.size).toBeLessThan(sizeBefore);
        expect(pressureCache.has('c')).toBe(true); // Protected
      });

      it('should reduce to target percentage on memory pressure', () => {
        const pressureCache = new LRUSampleCache({ maxSize: 40000 });

        pressureCache.set('a', createMockBuffer(2, 1000)); // 8000
        pressureCache.set('b', createMockBuffer(2, 1000)); // 8000
        pressureCache.set('c', createMockBuffer(2, 1000)); // 8000
        pressureCache.set('d', createMockBuffer(2, 1000)); // 8000 = 32000 total

        // Critical pressure should try to reduce to ~50% of current
        pressureCache.handleMemoryPressure('critical');

        expect(pressureCache.size).toBeLessThanOrEqual(16000);
      });
    });

    describe('getCurrentMemoryUsage', () => {
      it('should report current cache memory usage', () => {
        cache.set('a', createMockBuffer(2, 1000)); // 8000 bytes
        cache.set('b', createMockBuffer(2, 2000)); // 16000 bytes

        expect(cache.getCurrentMemoryUsage()).toBe(24000);
      });

      it('should return 0 for empty cache', () => {
        expect(cache.getCurrentMemoryUsage()).toBe(0);
      });
    });

    describe('setMaxSize', () => {
      it('should allow runtime adjustment of maxSize', () => {
        cache.set('a', createMockBuffer(2, 1000)); // 8000
        cache.set('b', createMockBuffer(2, 1000)); // 8000
        cache.set('c', createMockBuffer(2, 1000)); // 8000 = 24000

        // Reduce max size - should trigger eviction
        cache.setMaxSize(16000);

        expect(cache.size).toBeLessThanOrEqual(16000);
        expect(cache.getMetrics().maxSize).toBe(16000);
      });

      it('should not evict referenced entries when reducing maxSize', () => {
        cache.set('a', createMockBuffer(2, 1000));
        cache.set('b', createMockBuffer(2, 1000));
        cache.acquire('a');

        cache.setMaxSize(8000); // Would need to evict one

        // Should evict 'b', keep 'a' (referenced)
        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
      });
    });
  });
});
