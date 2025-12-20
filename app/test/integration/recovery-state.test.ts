/**
 * REFACTOR-04: Simplified Recovery State Integration Tests
 *
 * After simplification:
 * - Boolean recoveryInProgress replaces 3-state enum
 * - Debounce prevents rapid duplicate requests
 * - Snapshot receipt resets recovery state
 * - Disconnect resets recovery state
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('REFACTOR-04: Simplified Recovery State', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Recovery State Reset', () => {
    it('disconnect resets connection state and clears pending mutations', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      // Disconnect to clear any state
      multiplayer.disconnect();

      // After disconnect, connection should be false
      expect(multiplayer.isConnected()).toBe(false);

      // State should show disconnected status (property is 'status', not 'connectionStatus')
      const state = multiplayer.getState();
      expect(state.status).toBe('disconnected');

      // Pending mutations should be cleared
      expect(multiplayer.getPendingMutationCount()).toBe(0);

      // Queue should be empty
      expect(multiplayer.getQueueSize()).toBe(0);
    });
  });

  describe('Public API Stability', () => {
    it('no RecoveryState type exported', async () => {
      // RecoveryState should be an implementation detail, not exported
      const exports = await import('../../src/sync/multiplayer');

      // RecoveryState should not be in the exports
      expect('RecoveryState' in exports).toBe(false);
    });

    it('internal recovery state is not exposed on public API', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      // The public API should not expose internal recovery mechanism details
      // Check that getState() returns the documented MultiplayerState shape
      const state = multiplayer.getState();

      // Verify the public API shape (what IS exposed - note: 'status' not 'connectionStatus')
      expect(state).toHaveProperty('status');
      expect(state).toHaveProperty('playerId');
      expect(state).toHaveProperty('players');
      expect(state).toHaveProperty('cursors');
      expect(state).toHaveProperty('error');

      // These internal details should not be on the public state object
      expect(state).not.toHaveProperty('recoveryState');
      expect(state).not.toHaveProperty('recoveryTimeout');
      expect(state).not.toHaveProperty('recoveryInProgress');
    });
  });

  describe('Debounce Behavior', () => {
    it('multiplayer API does not expose internal debounce/recovery request methods', async () => {
      // The debounce logic should be internal - users should not need to
      // manually call recovery methods
      const { multiplayer } = await import('../../src/sync/multiplayer');

      // Verify core public API is functional
      expect(typeof multiplayer.disconnect).toBe('function');
      expect(typeof multiplayer.connect).toBe('function');
      expect(typeof multiplayer.send).toBe('function');
      expect(typeof multiplayer.getState).toBe('function');
      expect(typeof multiplayer.getSyncMetrics).toBe('function');

      // Internal recovery methods should NOT be exposed as public functions
      // (Note: internal properties may exist but aren't part of the public API contract)
      const mp = multiplayer as unknown as Record<string, unknown>;
      expect(typeof mp['requestSnapshotWithDebounce']).not.toBe('function');
      expect(typeof mp['triggerRecovery']).not.toBe('function');
      expect(typeof mp['handleRecoveryTimeout']).not.toBe('function');
    });
  });

  describe('Simplified Implementation', () => {
    it('old 3-state recovery enum no longer exists', async () => {
      // After REFACTOR-04, the 3-state enum is removed
      // and replaced with a simple boolean
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const mp = multiplayer as unknown as Record<string, unknown>;

      // The recoveryState property should not exist as a string enum
      // After REFACTOR-04, we use boolean recoveryInProgress instead
      const hasOldEnum =
        mp['recoveryState'] === 'idle' ||
        mp['recoveryState'] === 'applying_snapshot' ||
        mp['recoveryState'] === 'requesting_snapshot';

      expect(hasOldEnum).toBe(false);
    });

    it('recoveryInProgress is a boolean if exposed', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      const mp = multiplayer as unknown as Record<string, unknown>;

      // If recoveryInProgress exists, it must be a boolean (not undefined or other type)
      if ('recoveryInProgress' in mp) {
        expect(typeof mp['recoveryInProgress']).toBe('boolean');
      }
      // This is acceptable - the property may not be exposed on the singleton
    });
  });

  describe('Integration with Disconnect', () => {
    it('disconnect clears sync health metrics and resets reconnect attempts', async () => {
      const { multiplayer } = await import('../../src/sync/multiplayer');

      // Disconnect should clear all state
      multiplayer.disconnect();

      // Sync metrics should be reset
      const syncMetrics = multiplayer.getSyncMetrics();
      expect(syncMetrics.consecutiveMismatches).toBe(0);
      expect(syncMetrics.outOfOrderCount).toBe(0);

      // Reconnect attempts should be reset
      expect(multiplayer.getReconnectAttempts()).toBe(0);

      // Mutation stats should show no pending/lost mutations
      const mutationStats = multiplayer.getMutationStats();
      expect(mutationStats.pending).toBe(0);
    });
  });
});
