/**
 * REFACTOR-02: Single MUTATING_MESSAGE_TYPES Integration Tests
 *
 * Verifies that MUTATING_MESSAGE_TYPES is defined in exactly one location
 * and both client and server use the same definitions.
 */
import { describe, it, expect } from 'vitest';
import {
  MUTATING_MESSAGE_TYPES,
  READONLY_MESSAGE_TYPES,
  STATE_MUTATING_BROADCASTS,
  isStateMutatingMessage,
  isStateMutatingBroadcast,
} from '../../src/shared/messages';

describe('REFACTOR-02: Single MUTATING_MESSAGE_TYPES', () => {

  describe('Canonical Definition', () => {
    it('MUTATING_MESSAGE_TYPES is defined in shared/messages.ts', () => {
      expect(MUTATING_MESSAGE_TYPES).toBeDefined();
      expect(MUTATING_MESSAGE_TYPES.size).toBeGreaterThan(0);
    });

    it('all expected mutation types are present', () => {
      // NOTE: mute_track and solo_track are intentionally in READONLY_MESSAGE_TYPES
      // because they're local-only per "My Ears, My Control" philosophy.
      // Each user controls their own mix - these are never synced to shared state.
      const expectedTypes = [
        'toggle_step',
        'set_tempo',
        'set_swing',
        // mute_track - LOCAL ONLY
        // solo_track - LOCAL ONLY
        'set_parameter_lock',
        'add_track',
        'delete_track',
        'clear_track',
        'set_track_sample',
        'set_track_volume',
        'set_track_transpose',
        'set_track_step_count',
        'set_track_swing',   // Phase 31D: Per-track swing
        'set_effects',
        'set_scale',         // Phase 29E: Key Assistant scale sync
        'set_fm_params',
        'copy_sequence',    // Phase 26
        'move_sequence',    // Phase 26
        'set_session_name', // Session metadata sync
        // Phase 31F: Batch operations for multi-select
        'batch_clear_steps',
        'batch_set_parameter_locks',
        // Phase 31G: Loop selection and track reorder
        'set_loop_region',
        'reorder_tracks',
        // Pattern operations
        'rotate_pattern',
        'invert_pattern',
        'reverse_pattern',
        'mirror_pattern',
        'euclidean_fill',
        // Track naming
        'set_track_name',
      ];

      expectedTypes.forEach(type => {
        expect(MUTATING_MESSAGE_TYPES.has(type)).toBe(true);
      });

      // Verify count matches expected (28 total)
      expect(MUTATING_MESSAGE_TYPES.size).toBe(expectedTypes.length);
    });

    it('READONLY_MESSAGE_TYPES is separate from MUTATING_MESSAGE_TYPES', () => {
      const readonlyTypes = Array.from(READONLY_MESSAGE_TYPES);
      const mutatingTypes = Array.from(MUTATING_MESSAGE_TYPES);

      // No overlap
      readonlyTypes.forEach(type => {
        expect(mutatingTypes.includes(type)).toBe(false);
      });
    });
  });

  describe('Re-exports from worker/types.ts', () => {
    it('worker/types.ts re-exports MUTATING_MESSAGE_TYPES from shared', async () => {
      const workerTypes = await import('../../src/worker/types');

      expect(workerTypes.MUTATING_MESSAGE_TYPES).toBe(MUTATING_MESSAGE_TYPES);
    });

    it('worker/types.ts re-exports isStateMutatingMessage from shared', async () => {
      const workerTypes = await import('../../src/worker/types');

      expect(workerTypes.isStateMutatingMessage).toBe(isStateMutatingMessage);
    });

    it('worker/types.ts re-exports isStateMutatingBroadcast from shared', async () => {
      const workerTypes = await import('../../src/worker/types');

      expect(workerTypes.isStateMutatingBroadcast).toBe(isStateMutatingBroadcast);
    });
  });

  describe('Helper Functions', () => {
    it('isStateMutatingMessage returns true for all mutation types', () => {
      for (const type of MUTATING_MESSAGE_TYPES) {
        expect(isStateMutatingMessage(type)).toBe(true);
      }
    });

    it('isStateMutatingMessage returns false for read-only types', () => {
      for (const type of READONLY_MESSAGE_TYPES) {
        expect(isStateMutatingMessage(type)).toBe(false);
      }
    });

    it('isStateMutatingBroadcast returns true for state-mutating broadcasts', () => {
      for (const type of STATE_MUTATING_BROADCASTS) {
        expect(isStateMutatingBroadcast(type)).toBe(true);
      }
    });

    it('isStateMutatingBroadcast returns false for non-mutating broadcasts', () => {
      const nonMutatingBroadcasts = [
        'snapshot',
        'player_joined',
        'player_left',
        'cursor_moved',
        'playback_started',
        'playback_stopped',
        'state_mismatch',
        'state_hash_match',
        'clock_sync_response',
        'error',
      ];

      nonMutatingBroadcasts.forEach(type => {
        expect(isStateMutatingBroadcast(type)).toBe(false);
      });
    });
  });

  describe('Broadcast-to-Message Parity', () => {
    it('each mutation type has a corresponding broadcast type', () => {
      // Mapping from client message types to server broadcast types
      // NOTE: mute_track/solo_track are excluded - they're local-only (READONLY)
      const messageToToBroadcast: Record<string, string> = {
        'toggle_step': 'step_toggled',
        'set_tempo': 'tempo_changed',
        'set_swing': 'swing_changed',
        // mute_track -> track_muted - LOCAL ONLY (not in MUTATING)
        // solo_track -> track_soloed - LOCAL ONLY (not in MUTATING)
        'set_parameter_lock': 'parameter_lock_set',
        'add_track': 'track_added',
        'delete_track': 'track_deleted',
        'clear_track': 'track_cleared',
        'set_track_sample': 'track_sample_set',
        'set_track_volume': 'track_volume_set',
        'set_track_transpose': 'track_transpose_set',
        'set_track_step_count': 'track_step_count_set',
        'set_track_swing': 'track_swing_set',  // Phase 31D: Per-track swing
        'set_effects': 'effects_changed',
        'set_scale': 'scale_changed',  // Phase 29E: Key Assistant scale sync
        'set_fm_params': 'fm_params_changed',
        'copy_sequence': 'sequence_copied',    // Phase 26
        'move_sequence': 'sequence_moved',     // Phase 26
        'set_session_name': 'session_name_changed',  // Session metadata
        // Phase 31F: Batch operations for multi-select
        'batch_clear_steps': 'steps_cleared',
        'batch_set_parameter_locks': 'parameter_locks_batch_set',
        // Phase 31G: Loop selection and track reorder
        'set_loop_region': 'loop_region_changed',
        'reorder_tracks': 'tracks_reordered',
        // Pattern operations
        'rotate_pattern': 'pattern_rotated',
        'invert_pattern': 'pattern_inverted',
        'reverse_pattern': 'pattern_reversed',
        'mirror_pattern': 'pattern_mirrored',
        'euclidean_fill': 'euclidean_filled',
        // Track naming
        'set_track_name': 'track_name_set',
      };

      // Verify every mutation type has a broadcast
      for (const [message, broadcast] of Object.entries(messageToToBroadcast)) {
        expect(MUTATING_MESSAGE_TYPES.has(message)).toBe(true);
        expect(STATE_MUTATING_BROADCASTS.has(broadcast)).toBe(true);
      }

      // Verify counts match (28 mutations, 28 broadcasts)
      expect(MUTATING_MESSAGE_TYPES.size).toBe(Object.keys(messageToToBroadcast).length);
      expect(STATE_MUTATING_BROADCASTS.size).toBe(Object.values(messageToToBroadcast).length);
    });
  });
});
