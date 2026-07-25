/**
 * REFACTOR-05: Unified Sync Health Module Integration Tests
 *
 * Verifies that the SyncHealth class correctly consolidates:
 * - Hash check tracking (moved from ClockSync)
 * - Sequence gap detection (moved from MultiplayerConnection)
 * - Unified recovery decision making
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SyncHealth } from '../../src/sync/sync-health';

describe('REFACTOR-05: Unified Sync Health Module', () => {
  let syncHealth: SyncHealth;

  beforeEach(() => {
    syncHealth = new SyncHealth();
  });

  describe('Hash Check Tracking', () => {
    it('tracks consecutive mismatches', () => {
      syncHealth.recordHashCheck(false);
      syncHealth.recordHashCheck(false);

      const result = syncHealth.needsRecovery();
      expect(result.needed).toBe(true);
      expect(result.reason).toContain('mismatch');
    });

    it('resets mismatch count on match', () => {
      syncHealth.recordHashCheck(false);
      syncHealth.recordHashCheck(true);

      const result = syncHealth.needsRecovery();
      expect(result.needed).toBe(false);
    });

    it('requires 2 consecutive mismatches for recovery', () => {
      syncHealth.recordHashCheck(false);

      let result = syncHealth.needsRecovery();
      expect(result.needed).toBe(false);

      syncHealth.recordHashCheck(false);

      result = syncHealth.needsRecovery();
      expect(result.needed).toBe(true);
    });

    it('counts total hash checks', () => {
      syncHealth.recordHashCheck(true);
      syncHealth.recordHashCheck(false);
      syncHealth.recordHashCheck(true);

      const metrics = syncHealth.getMetrics();
      expect(metrics.hashCheckCount).toBe(3);
      expect(metrics.mismatchCount).toBe(1);
    });
  });

  describe('Sequence Gap Detection', () => {
    it('detects missed messages', () => {
      syncHealth.recordServerSeq(1);
      const result = syncHealth.recordServerSeq(5); // Missed 2,3,4

      expect(result.missed).toBe(3);
    });

    it('returns zero missed for sequential messages', () => {
      syncHealth.recordServerSeq(1);
      const result = syncHealth.recordServerSeq(2);

      expect(result.missed).toBe(0);
      expect(result.outOfOrder).toBe(false);
    });

    it('triggers recovery on large gaps', () => {
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(10); // Gap of 8

      const result = syncHealth.needsRecovery();
      expect(result.needed).toBe(true);
      expect(result.reason).toContain('gap');
    });

    it('does not trigger recovery on small gaps', () => {
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(3); // Gap of 1 (missed message 2)

      const result = syncHealth.needsRecovery();
      expect(result.needed).toBe(false);
    });

    it('detects out-of-order messages', () => {
      syncHealth.recordServerSeq(5);
      const result = syncHealth.recordServerSeq(3); // Out of order

      expect(result.outOfOrder).toBe(true);
    });

    it('triggers recovery on excessive out-of-order', () => {
      // Send 11 out-of-order messages
      for (let i = 0; i < 11; i++) {
        syncHealth.recordServerSeq(100);
        syncHealth.recordServerSeq(50);
      }

      const result = syncHealth.needsRecovery();
      expect(result.needed).toBe(true);
      expect(result.reason).toContain('out-of-order');
    });

    it('tracks last server sequence', () => {
      syncHealth.recordServerSeq(5);
      syncHealth.recordServerSeq(10);

      const metrics = syncHealth.getMetrics();
      expect(metrics.lastServerSeq).toBe(10);
    });
  });

  describe('Combined Health Assessment', () => {
    it('returns most urgent reason (gap over hash)', () => {
      syncHealth.recordHashCheck(false);
      syncHealth.recordHashCheck(false);
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(100); // Large gap

      const result = syncHealth.needsRecovery();
      expect(result.needed).toBe(true);
      // Gap is more urgent than hash mismatch
      expect(result.reason).toContain('gap');
    });

    it('returns hash reason when no gap issues', () => {
      syncHealth.recordHashCheck(false);
      syncHealth.recordHashCheck(false);
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(2);

      const result = syncHealth.needsRecovery();
      expect(result.needed).toBe(true);
      expect(result.reason).toContain('mismatch');
    });

    it('reset clears all tracking', () => {
      syncHealth.recordHashCheck(false);
      syncHealth.recordHashCheck(false);
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(100);

      syncHealth.reset();

      const result = syncHealth.needsRecovery();
      expect(result.needed).toBe(false);
    });

    it('resetRecoveryFlags clears only recovery triggers', () => {
      syncHealth.recordHashCheck(false);
      syncHealth.recordHashCheck(false);
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(100);

      // Should trigger recovery
      expect(syncHealth.needsRecovery().needed).toBe(true);

      // Reset recovery flags (call after snapshot)
      syncHealth.resetRecoveryFlags();

      // Should no longer need recovery
      expect(syncHealth.needsRecovery().needed).toBe(false);

      // But metrics should still be tracked
      const metrics = syncHealth.getMetrics();
      expect(metrics.hashCheckCount).toBe(2);
    });
  });

  describe('Metrics', () => {
    it('provides comprehensive metrics', () => {
      syncHealth.recordHashCheck(true);
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(2);

      const metrics = syncHealth.getMetrics();

      expect(metrics).toHaveProperty('hashCheckCount');
      expect(metrics).toHaveProperty('mismatchCount');
      expect(metrics).toHaveProperty('consecutiveMismatches');
      expect(metrics).toHaveProperty('lastServerSeq');
      expect(metrics).toHaveProperty('outOfOrderCount');
      expect(metrics).toHaveProperty('totalMissedMessages');
    });

    it('accurately counts missed messages', () => {
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(5);  // Missed 2,3,4 = 3
      syncHealth.recordServerSeq(10); // Missed 6,7,8,9 = 4

      const metrics = syncHealth.getMetrics();
      expect(metrics.totalMissedMessages).toBe(7);
    });

    it('accurately counts out-of-order messages', () => {
      syncHealth.recordServerSeq(5);
      syncHealth.recordServerSeq(3); // Out of order
      syncHealth.recordServerSeq(7);
      syncHealth.recordServerSeq(6); // Out of order

      const metrics = syncHealth.getMetrics();
      expect(metrics.outOfOrderCount).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('handles first message (no previous seq)', () => {
      const result = syncHealth.recordServerSeq(1);

      expect(result.missed).toBe(0);
      expect(result.outOfOrder).toBe(false);
    });

    it('handles seq 0 as valid first message', () => {
      const result = syncHealth.recordServerSeq(0);

      expect(result.missed).toBe(0);
      expect(result.outOfOrder).toBe(false);

      const metrics = syncHealth.getMetrics();
      expect(metrics.lastServerSeq).toBe(0);
    });

    it('handles duplicate seq numbers gracefully', () => {
      syncHealth.recordServerSeq(5);
      const result = syncHealth.recordServerSeq(5); // Duplicate

      // Duplicate is treated as out-of-order (lower than expected)
      expect(result.outOfOrder).toBe(true);
    });
  });

  describe('Recovery Threshold Configuration', () => {
    it('uses default gap threshold of 3', () => {
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(4); // Gap of 2 (missed 2,3)

      let result = syncHealth.needsRecovery();
      expect(result.needed).toBe(false);

      syncHealth.recordServerSeq(8); // Gap of 3 (missed 5,6,7)

      result = syncHealth.needsRecovery();
      expect(result.needed).toBe(true);
    });

    it('uses configurable mismatch threshold', () => {
      // Default is 2 consecutive mismatches
      const customHealth = new SyncHealth({ mismatchThreshold: 3 });

      customHealth.recordHashCheck(false);
      customHealth.recordHashCheck(false);

      let result = customHealth.needsRecovery();
      expect(result.needed).toBe(false);

      customHealth.recordHashCheck(false);

      result = customHealth.needsRecovery();
      expect(result.needed).toBe(true);
    });

    it('uses configurable gap threshold', () => {
      const customHealth = new SyncHealth({ gapThreshold: 5 });

      customHealth.recordServerSeq(1);
      customHealth.recordServerSeq(5); // Gap of 3 (below custom threshold of 5)

      let result = customHealth.needsRecovery();
      expect(result.needed).toBe(false);

      customHealth.recordServerSeq(11); // Gap of 5 (at custom threshold)

      result = customHealth.needsRecovery();
      expect(result.needed).toBe(true);
    });
  });

  describe('Integration with Debug Overlay', () => {
    it('getMetrics provides all data needed by debug overlay', () => {
      // Simulate a session with some activity
      syncHealth.recordServerSeq(1);
      syncHealth.recordServerSeq(2);
      syncHealth.recordServerSeq(5);
      syncHealth.recordHashCheck(true);
      syncHealth.recordHashCheck(false);

      const metrics = syncHealth.getMetrics();

      // All values should be renderable as strings for display
      expect(String(metrics.hashCheckCount)).toBeDefined();
      expect(String(metrics.mismatchCount)).toBeDefined();
      expect(String(metrics.consecutiveMismatches)).toBeDefined();
      expect(String(metrics.lastServerSeq)).toBeDefined();
      expect(String(metrics.outOfOrderCount)).toBeDefined();
      expect(String(metrics.totalMissedMessages)).toBeDefined();

      // Values should be numbers
      expect(typeof metrics.hashCheckCount).toBe('number');
      expect(typeof metrics.mismatchCount).toBe('number');
      expect(typeof metrics.consecutiveMismatches).toBe('number');
      expect(typeof metrics.lastServerSeq).toBe('number');
      expect(typeof metrics.outOfOrderCount).toBe('number');
      expect(typeof metrics.totalMissedMessages).toBe('number');
    });
  });
});
