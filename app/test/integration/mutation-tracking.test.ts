/**
 * REFACTOR-03: Simplified Mutation Tracking Integration Tests
 *
 * After simplification:
 * - Pending mutations tracked as Set<number> with timestamps
 * - Confirm on echo (remove from Set)
 * - Timeout after 30s (log warning, remove from Set)
 * - MutationStats simplified to {pending, confirmed}
 * - No superseded/lost states (diagnostic only, no behavioral difference)
 */
import { describe, it, expect } from 'vitest';

// We test the public interface of multiplayer connection
// The internal simplification doesn't change the external API
describe('REFACTOR-03: Simplified Mutation Tracking', () => {
  describe('Public API Stability', () => {
    it('getPendingMutationCount returns a number', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      // Ensure disconnected state for clean test
      multiplayer.disconnect();

      const count = multiplayer.getPendingMutationCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('getOldestPendingMutationAge returns 0 when no pending', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      multiplayer.disconnect();

      const age = multiplayer.getOldestPendingMutationAge();
      expect(age).toBe(0);
    });

    it('getMutationStats returns required fields', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const stats = multiplayer.getMutationStats();

      // Required fields after simplification
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('confirmed');
      expect(typeof stats.pending).toBe('number');
      expect(typeof stats.confirmed).toBe('number');
    });

    it('getMutationStats simplified - no superseded/lost tracking', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const stats = multiplayer.getMutationStats();

      // After REFACTOR-03, these should NOT exist
      // This test will FAIL before refactor, PASS after
      expect(stats).not.toHaveProperty('superseded');
      expect(stats).not.toHaveProperty('lost');
    });

    it('getMutationStats has no totalTracked (unnecessary)', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const stats = multiplayer.getMutationStats();

      // totalTracked is unnecessary - we only care about pending/confirmed
      // This test will FAIL before refactor, PASS after
      expect(stats).not.toHaveProperty('totalTracked');
    });
  });

  describe('Disconnection Behavior', () => {
    it('disconnect clears pending mutations', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      // Disconnect to clear any state
      multiplayer.disconnect();

      // After disconnect, should have no pending mutations
      expect(multiplayer.getPendingMutationCount()).toBe(0);
      expect(multiplayer.getOldestPendingMutationAge()).toBe(0);
    });

    it('mutation stats reset on disconnect', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      multiplayer.disconnect();

      const stats = multiplayer.getMutationStats();
      expect(stats.pending).toBe(0);
    });
  });

  describe('Debug Overlay Compatibility', () => {
    it('debug overlay can display mutation stats', async () => {
      // Simulate what debug overlay does
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const stats = multiplayer.getMutationStats();
      const pending = multiplayer.getPendingMutationCount();
      const oldestAge = multiplayer.getOldestPendingMutationAge();

      // All values should be renderable as strings
      expect(String(stats.pending)).toBeDefined();
      expect(String(pending)).toBeDefined();
      expect(String(oldestAge)).toBeDefined();
    });

    it('getMessageOrderingStats still works', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const stats = multiplayer.getMessageOrderingStats();

      // These are needed for debugging and should remain
      expect(stats).toHaveProperty('outOfOrderCount');
      expect(stats).toHaveProperty('lastServerSeq');
    });
  });

  describe('Invariant Checking Removed', () => {
    it('no checkMutationInvariant method exposed', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      // checkMutationInvariant should be removed (was private anyway)
      // We verify it's not accidentally exposed
      expect((multiplayer as unknown as Record<string, unknown>)['checkMutationInvariant']).toBeUndefined();
    });
  });

  describe('Simplified Stats Behavior', () => {
    it('stats only track pending and confirmed counts', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const stats = multiplayer.getMutationStats();

      // Should only have these two keys
      const keys = Object.keys(stats);
      expect(keys).toHaveLength(2);
      expect(keys).toContain('pending');
      expect(keys).toContain('confirmed');
    });
  });
});
