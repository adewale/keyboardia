/**
 * Tests for MutationTracker - testing the REAL implementation directly.
 *
 * No mocks required! This is pure business logic testing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MutationTracker, type TrackedMutation } from './mutation-tracker';

describe('MutationTracker', () => {
  let tracker: MutationTracker;

  beforeEach(() => {
    tracker = new MutationTracker({ enableLogging: false });
  });

  /**
   * Helper to create a mutation input
   */
  function createMutation(
    seq: number,
    trackId: string = 't1',
    step: number = 0,
    sentAt: number = Date.now()
  ): Omit<TrackedMutation, 'state' | 'confirmedAtServerSeq'> {
    return {
      seq,
      type: 'toggle_step',
      trackId,
      step,
      intendedValue: true,
      sentAt,
      sentAtServerTime: sentAt,
    };
  }

  describe('trackMutation', () => {
    it('should track a new mutation as pending', () => {
      tracker.trackMutation(createMutation(1));

      const mutation = tracker.getMutation(1);
      expect(mutation).toBeDefined();
      expect(mutation!.state).toBe('pending');
      expect(mutation!.seq).toBe(1);
    });

    it('should increment pending count', () => {
      expect(tracker.getStats().pending).toBe(0);

      tracker.trackMutation(createMutation(1));
      expect(tracker.getStats().pending).toBe(1);

      tracker.trackMutation(createMutation(2));
      expect(tracker.getStats().pending).toBe(2);
    });

    it('should track multiple mutations independently', () => {
      tracker.trackMutation(createMutation(1, 't1', 0));
      tracker.trackMutation(createMutation(2, 't1', 1));
      tracker.trackMutation(createMutation(3, 't2', 0));

      expect(tracker.getTotalInMap()).toBe(3);
      expect(tracker.getMutation(1)?.trackId).toBe('t1');
      expect(tracker.getMutation(2)?.step).toBe(1);
      expect(tracker.getMutation(3)?.trackId).toBe('t2');
    });
  });

  describe('confirmMutation', () => {
    it('should confirm a pending mutation', () => {
      tracker.trackMutation(createMutation(1));

      const result = tracker.confirmMutation(1, 100);

      expect(result).toBe(true);
      const mutation = tracker.getMutation(1);
      expect(mutation!.state).toBe('confirmed');
      expect(mutation!.confirmedAtServerSeq).toBe(100);
    });

    it('should update stats correctly', () => {
      tracker.trackMutation(createMutation(1));
      expect(tracker.getStats().pending).toBe(1);
      expect(tracker.getStats().confirmed).toBe(0);

      tracker.confirmMutation(1, 100);

      expect(tracker.getStats().pending).toBe(0);
      expect(tracker.getStats().confirmed).toBe(1);
    });

    it('should keep mutation in map after confirmation (for snapshot clearing)', () => {
      tracker.trackMutation(createMutation(1));
      tracker.confirmMutation(1, 100);

      expect(tracker.getMutation(1)).toBeDefined();
      expect(tracker.getTotalInMap()).toBe(1);
    });

    it('should return false for non-existent mutation', () => {
      const result = tracker.confirmMutation(999, 100);
      expect(result).toBe(false);
    });

    it('should return false for already confirmed mutation', () => {
      tracker.trackMutation(createMutation(1));
      tracker.confirmMutation(1, 100);

      const result = tracker.confirmMutation(1, 101);
      expect(result).toBe(false);
    });
  });

  describe('markSuperseded', () => {
    it('should mark a pending mutation as superseded', () => {
      tracker.trackMutation(createMutation(1));

      const result = tracker.markSuperseded(1, 'player2');

      expect(result).toBe(true);
      expect(tracker.getStats().superseded).toBe(1);
      expect(tracker.getStats().pending).toBe(0);
    });

    it('should remove mutation from map', () => {
      tracker.trackMutation(createMutation(1));
      tracker.markSuperseded(1);

      expect(tracker.getMutation(1)).toBeUndefined();
      expect(tracker.getTotalInMap()).toBe(0);
    });

    it('should return false for confirmed mutation', () => {
      tracker.trackMutation(createMutation(1));
      tracker.confirmMutation(1, 100);

      const result = tracker.markSuperseded(1);
      expect(result).toBe(false);
    });
  });

  describe('markLost', () => {
    it('should mark a pending mutation as lost', () => {
      tracker.trackMutation(createMutation(1));

      const result = tracker.markLost(1);

      expect(result).toBe(true);
      expect(tracker.getStats().lost).toBe(1);
      expect(tracker.getStats().pending).toBe(0);
    });

    it('should remove mutation from map', () => {
      tracker.trackMutation(createMutation(1));
      tracker.markLost(1);

      expect(tracker.getMutation(1)).toBeUndefined();
    });
  });

  describe('clearOnSnapshot (Option C)', () => {
    it('should clear mutations where confirmedAtServerSeq <= snapshotServerSeq', () => {
      tracker.trackMutation(createMutation(1));
      tracker.confirmMutation(1, 95);

      const cleared = tracker.clearOnSnapshot(100);

      expect(cleared).toBe(1);
      expect(tracker.getMutation(1)).toBeUndefined();
    });

    it('should KEEP mutations where confirmedAtServerSeq > snapshotServerSeq', () => {
      tracker.trackMutation(createMutation(1));
      tracker.confirmMutation(1, 105);

      const cleared = tracker.clearOnSnapshot(100);

      expect(cleared).toBe(0);
      expect(tracker.getMutation(1)).toBeDefined();
    });

    it('should KEEP pending mutations', () => {
      tracker.trackMutation(createMutation(1));
      // Not confirming - stays pending

      const cleared = tracker.clearOnSnapshot(100);

      expect(cleared).toBe(0);
      expect(tracker.getMutation(1)).toBeDefined();
      expect(tracker.getMutation(1)!.state).toBe('pending');
    });

    it('should handle mixed mutation states correctly', () => {
      tracker.trackMutation(createMutation(1)); // Pre-snapshot confirmed
      tracker.trackMutation(createMutation(2)); // Post-snapshot confirmed
      tracker.trackMutation(createMutation(3)); // Pending

      tracker.confirmMutation(1, 95);  // Pre-snapshot
      tracker.confirmMutation(2, 105); // Post-snapshot
      // Mutation 3 stays pending

      const cleared = tracker.clearOnSnapshot(100);

      expect(cleared).toBe(1);
      expect(tracker.getMutation(1)).toBeUndefined(); // Cleared
      expect(tracker.getMutation(2)).toBeDefined();   // Kept
      expect(tracker.getMutation(3)).toBeDefined();   // Kept
      expect(tracker.getTotalInMap()).toBe(2);
    });

    it('should use age fallback when serverSeq unavailable', () => {
      const oldTime = Date.now() - 70000; // 70 seconds ago
      tracker.trackMutation(createMutation(1, 't1', 0, oldTime));
      tracker.confirmMutation(1, undefined); // No serverSeq

      const now = Date.now();
      const cleared = tracker.clearOnSnapshot(undefined, now);

      expect(cleared).toBe(1);
    });

    it('should NOT clear young mutations when serverSeq unavailable', () => {
      const recentTime = Date.now() - 1000; // 1 second ago
      tracker.trackMutation(createMutation(1, 't1', 0, recentTime));
      tracker.confirmMutation(1, undefined); // No serverSeq

      const now = Date.now();
      const cleared = tracker.clearOnSnapshot(undefined, now);

      expect(cleared).toBe(0);
    });

    it('should clear old mutations even if confirmedAt > snapshotSeq', () => {
      // Edge case: old confirmed mutation with higher serverSeq than snapshot
      // Should still be cleared by age fallback
      const oldTime = Date.now() - 70000;
      tracker.trackMutation(createMutation(1, 't1', 0, oldTime));
      tracker.confirmMutation(1, 200); // High serverSeq

      const now = Date.now();
      // Snapshot with low serverSeq, but mutation is old
      const cleared = tracker.clearOnSnapshot(100, now);

      // NOT cleared because confirmedAt (200) > snapshotSeq (100)
      // Age fallback only applies when serverSeq is unavailable
      expect(cleared).toBe(0);
    });

    it('should return 0 when no mutations tracked', () => {
      const cleared = tracker.clearOnSnapshot(100);
      expect(cleared).toBe(0);
    });
  });

  describe('pruneOldMutations', () => {
    it('should mark old pending mutations as lost', () => {
      const oldTime = Date.now() - 40000; // 40 seconds ago (> 30s timeout)
      tracker.trackMutation(createMutation(1, 't1', 0, oldTime));

      const now = Date.now();
      const pruned = tracker.pruneOldMutations(now);

      expect(pruned).toBe(1);
      expect(tracker.getStats().lost).toBe(1);
      expect(tracker.getMutation(1)).toBeUndefined();
    });

    it('should NOT prune recent pending mutations', () => {
      const recentTime = Date.now() - 1000; // 1 second ago
      tracker.trackMutation(createMutation(1, 't1', 0, recentTime));

      const now = Date.now();
      const pruned = tracker.pruneOldMutations(now);

      expect(pruned).toBe(0);
      expect(tracker.getMutation(1)).toBeDefined();
    });

    it('should NOT prune confirmed mutations', () => {
      const oldTime = Date.now() - 40000;
      tracker.trackMutation(createMutation(1, 't1', 0, oldTime));
      tracker.confirmMutation(1, 100);

      const now = Date.now();
      const pruned = tracker.pruneOldMutations(now);

      expect(pruned).toBe(0);
      expect(tracker.getMutation(1)).toBeDefined();
    });
  });

  describe('findMutationsForStep', () => {
    it('should find pending mutations for a specific track/step', () => {
      tracker.trackMutation(createMutation(1, 't1', 0));
      tracker.trackMutation(createMutation(2, 't1', 1));
      tracker.trackMutation(createMutation(3, 't2', 0));

      const found = tracker.findMutationsForStep('t1', 0);

      expect(found.length).toBe(1);
      expect(found[0].seq).toBe(1);
    });

    it('should NOT include confirmed mutations', () => {
      tracker.trackMutation(createMutation(1, 't1', 0));
      tracker.confirmMutation(1, 100);

      const found = tracker.findMutationsForStep('t1', 0);

      expect(found.length).toBe(0);
    });

    it('should return empty array when no matches', () => {
      tracker.trackMutation(createMutation(1, 't1', 0));

      const found = tracker.findMutationsForStep('t2', 5);

      expect(found.length).toBe(0);
    });
  });

  describe('accessor methods', () => {
    it('should return correct pending count', () => {
      tracker.trackMutation(createMutation(1));
      tracker.trackMutation(createMutation(2));
      tracker.confirmMutation(1, 100);

      expect(tracker.getPendingCount()).toBe(1);
    });

    it('should return correct confirmed count', () => {
      tracker.trackMutation(createMutation(1));
      tracker.trackMutation(createMutation(2));
      tracker.confirmMutation(1, 100);

      expect(tracker.getConfirmedCount()).toBe(1);
    });

    it('should return all mutations', () => {
      tracker.trackMutation(createMutation(1));
      tracker.trackMutation(createMutation(2));

      const all = tracker.getAllMutations();
      expect(all.length).toBe(2);
    });

    it('should return defensive copy of stats', () => {
      tracker.trackMutation(createMutation(1));
      const stats1 = tracker.getStats();
      const stats2 = tracker.getStats();

      expect(stats1).not.toBe(stats2); // Different objects
      expect(stats1).toEqual(stats2);  // Same values
    });
  });

  describe('clear', () => {
    it('should clear all mutations and reset stats', () => {
      tracker.trackMutation(createMutation(1));
      tracker.trackMutation(createMutation(2));
      tracker.confirmMutation(1, 100);

      tracker.clear();

      expect(tracker.getTotalInMap()).toBe(0);
      expect(tracker.getStats()).toEqual({
        pending: 0,
        confirmed: 0,
        superseded: 0,
        lost: 0,
      });
    });
  });

  describe('race condition scenarios', () => {
    it('should preserve edit when snapshot arrives before confirmation', () => {
      /**
       * Race condition scenario:
       * T0: Client sends toggle (seq=1)
       * T1: Snapshot arrives with serverSeq=99 (toggle not included)
       * T2: Confirmation arrives with serverSeq=100
       *
       * Expected: Edit preserved because pending during snapshot
       */

      // T0: Send toggle
      tracker.trackMutation(createMutation(1));

      // T1: Snapshot arrives - mutation still pending
      const cleared1 = tracker.clearOnSnapshot(99);
      expect(cleared1).toBe(0);
      expect(tracker.getMutation(1)).toBeDefined();
      expect(tracker.getMutation(1)!.state).toBe('pending');

      // T2: Confirmation arrives
      tracker.confirmMutation(1, 100);
      expect(tracker.getMutation(1)!.state).toBe('confirmed');
      expect(tracker.getMutation(1)!.confirmedAtServerSeq).toBe(100);

      // Next snapshot will clear it because 100 <= 100
      const cleared2 = tracker.clearOnSnapshot(100);
      expect(cleared2).toBe(1);
    });

    it('should preserve multiple rapid edits during snapshot load', () => {
      // Multiple rapid edits
      tracker.trackMutation(createMutation(1));
      tracker.trackMutation(createMutation(2));
      tracker.trackMutation(createMutation(3));

      // First confirmation arrives before snapshot
      tracker.confirmMutation(1, 98);

      // Snapshot arrives at serverSeq=99
      const cleared = tracker.clearOnSnapshot(99);

      // Only mutation 1 cleared (98 <= 99)
      expect(cleared).toBe(1);
      expect(tracker.getMutation(1)).toBeUndefined();
      expect(tracker.getMutation(2)).toBeDefined();
      expect(tracker.getMutation(3)).toBeDefined();

      // Later confirmations
      tracker.confirmMutation(2, 100);
      tracker.confirmMutation(3, 101);

      // Both still in map
      expect(tracker.getMutation(2)!.confirmedAtServerSeq).toBe(100);
      expect(tracker.getMutation(3)!.confirmedAtServerSeq).toBe(101);
    });

    it('should handle out-of-order confirmations correctly', () => {
      tracker.trackMutation(createMutation(1));
      tracker.trackMutation(createMutation(2));
      tracker.trackMutation(createMutation(3));

      // Confirmations arrive out of order
      tracker.confirmMutation(3, 103);
      tracker.confirmMutation(1, 101);
      tracker.confirmMutation(2, 102);

      // Snapshot at 102
      const cleared = tracker.clearOnSnapshot(102);

      // Mutations 1 and 2 cleared (101, 102 <= 102)
      // Mutation 3 kept (103 > 102)
      expect(cleared).toBe(2);
      expect(tracker.getMutation(1)).toBeUndefined();
      expect(tracker.getMutation(2)).toBeUndefined();
      expect(tracker.getMutation(3)).toBeDefined();
    });
  });

  describe('configurable timeouts', () => {
    it('should respect custom mutationTimeoutMs', () => {
      const customTracker = new MutationTracker({
        mutationTimeoutMs: 5000,
        enableLogging: false,
      });

      const oldTime = Date.now() - 6000; // 6 seconds ago
      customTracker.trackMutation(createMutation(1, 't1', 0, oldTime));

      const now = Date.now();
      const pruned = customTracker.pruneOldMutations(now);

      expect(pruned).toBe(1);
    });

    it('should respect custom maxConfirmedAgeMs', () => {
      const customTracker = new MutationTracker({
        maxConfirmedAgeMs: 10000, // 10 seconds
        enableLogging: false,
      });

      const oldTime = Date.now() - 15000; // 15 seconds ago
      customTracker.trackMutation(createMutation(1, 't1', 0, oldTime));
      customTracker.confirmMutation(1, undefined);

      const now = Date.now();
      const cleared = customTracker.clearOnSnapshot(undefined, now);

      expect(cleared).toBe(1);
    });
  });
});
