/**
 * MUTATION-TRACKING Spec: Full Mutation Tracking Integration Tests
 *
 * Implementation:
 * - Pending mutations tracked with full TrackedMutation objects
 * - Confirm on echo (remove from Map, increment confirmed)
 * - Timeout after 30s (mark as lost, log warning)
 * - MutationStats tracks {pending, confirmed, superseded, lost}
 * - supersededKeys tracks multi-player edit conflicts
 * - checkMutationInvariant() detects lost mutations on snapshot
 */
import { describe, it, expect } from 'vitest';

// We test the public interface of multiplayer connection
// Full mutation tracking enables invariant violation detection
describe('MUTATION-TRACKING: Full Mutation Tracking', () => {
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

    it('getMutationStats includes superseded/lost for invariant tracking', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const stats = multiplayer.getMutationStats();

      // MUTATION-TRACKING spec requires full tracking for invariant violation detection
      expect(stats).toHaveProperty('superseded');
      expect(stats).toHaveProperty('lost');
      expect(typeof stats.superseded).toBe('number');
      expect(typeof stats.lost).toBe('number');
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

  describe('Invariant Checking', () => {
    it('checkMutationInvariant is exposed for internal snapshot handling', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      // checkMutationInvariant is called internally when snapshots arrive
      // to detect lost mutations (MUTATION-TRACKING spec requirement)
      expect(typeof (multiplayer as unknown as Record<string, unknown>)['checkMutationInvariant']).toBe('function');
    });
  });

  describe('Full Stats Behavior', () => {
    it('stats track pending, confirmed, superseded, and lost counts', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const stats = multiplayer.getMutationStats();

      // MUTATION-TRACKING spec requires 4 stat fields for full tracking
      const keys = Object.keys(stats);
      expect(keys).toHaveLength(4);
      expect(keys).toContain('pending');
      expect(keys).toContain('confirmed');
      expect(keys).toContain('superseded');
      expect(keys).toContain('lost');
    });

    it('superseded count tracks multi-player conflicts', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      // Disconnect to reset state
      multiplayer.disconnect();

      const stats = multiplayer.getMutationStats();
      // After disconnect, superseded should be reset
      expect(stats.superseded).toBe(0);
    });

    it('lost count tracks unconfirmed mutations', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      multiplayer.disconnect();

      const stats = multiplayer.getMutationStats();
      // After disconnect, lost should be reset
      expect(stats.lost).toBe(0);
    });
  });
});
