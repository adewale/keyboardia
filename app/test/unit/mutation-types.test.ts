/**
 * Unit tests for mutation type definitions
 *
 * These tests ensure the centralized MUTATING_MESSAGE_TYPES set stays in sync
 * with the actual message handlers in the Durable Object.
 *
 * ARCHITECTURAL PRINCIPLE: If this test fails, you either:
 * 1. Added a new handler without adding it to MUTATING_MESSAGE_TYPES/READONLY_MESSAGE_TYPES
 * 2. Removed a handler without removing it from the type sets
 * 3. Misclassified a mutation as read-only or vice versa
 */

import { describe, it, expect } from 'vitest';
import {
  MUTATING_MESSAGE_TYPES,
  READONLY_MESSAGE_TYPES,
  isStateMutatingMessage,
} from '../../src/worker/types';

/**
 * These are the message types handled in the DO's switch statement.
 * This list must be kept manually in sync with live-session.ts.
 *
 * When you add a new handler:
 * 1. Add the message type here
 * 2. Add it to MUTATING_MESSAGE_TYPES or READONLY_MESSAGE_TYPES in types.ts
 * 3. This test will verify correctness
 */
const ALL_HANDLED_MESSAGE_TYPES = [
  // Mutation types - these modify session state
  'toggle_step',
  'set_tempo',
  'set_swing',
  'mute_track',
  'solo_track',
  'set_parameter_lock',
  'add_track',
  'delete_track',
  'clear_track',
  'copy_sequence',  // Phase 26: Copy steps between tracks
  'move_sequence',  // Phase 26: Move steps between tracks
  'set_track_sample',
  'set_track_volume',
  'set_track_transpose',
  'set_track_step_count',
  'set_track_swing',  // Phase 31D: Per-track swing
  'set_effects',  // Phase 25: Audio effects sync
  'set_scale',  // Phase 29E: Key Assistant scale sync
  'set_fm_params',  // Phase 23: FM synthesis params sync
  'set_session_name',  // Session metadata sync
  // Phase 31F: Batch operations for multi-select
  'batch_clear_steps',  // Batch delete selected steps
  'batch_set_parameter_locks',  // Batch set p-locks on selected steps
  // Phase 31G: Loop selection
  'set_loop_region',  // Set loop playback region
  // Phase 31G: Track reorder
  'reorder_tracks',   // Drag and drop track reorganization
  // Pattern operations
  'rotate_pattern',   // Rotate pattern left/right
  'invert_pattern',   // Invert pattern (toggle all steps)
  'reverse_pattern',  // Reverse pattern order
  'mirror_pattern',   // Mirror pattern left-to-right or right-to-left
  'euclidean_fill',   // Fill with euclidean rhythm
  // Track naming
  'set_track_name',   // Set track display name
  // Read-only types - these don't modify session state
  'play',
  'stop',
  'state_hash',
  'request_snapshot',
  'clock_sync_request',
  'cursor_move',
];

describe('Mutation Type Definitions', () => {
  it('MUTATING_MESSAGE_TYPES contains all expected mutation types', () => {
    // NOTE: mute_track and solo_track are intentionally EXCLUDED
    // They are local-only per "My Ears, My Control" philosophy
    // Each user controls their own mix - these don't mutate shared state
    const expectedMutations = [
      'toggle_step',
      'set_tempo',
      'set_swing',
      // mute_track - LOCAL ONLY (in READONLY, not MUTATING)
      // solo_track - LOCAL ONLY (in READONLY, not MUTATING)
      'set_parameter_lock',
      'add_track',
      'delete_track',
      'clear_track',
      'copy_sequence',  // Phase 26: Copy steps between tracks
      'move_sequence',  // Phase 26: Move steps between tracks
      'set_track_sample',
      'set_track_volume',
      'set_track_transpose',
      'set_track_step_count',
      'set_track_swing',  // Phase 31D: Per-track swing
      'set_effects',  // Phase 25: Audio effects sync
      'set_scale',  // Phase 29E: Key Assistant scale sync
      'set_fm_params',  // Phase 23: FM synthesis params sync
      'set_session_name',  // Session metadata sync
      // Phase 31F: Batch operations for multi-select
      'batch_clear_steps',
      'batch_set_parameter_locks',
      // Phase 31G: Loop selection
      'set_loop_region',
      // Phase 31G: Track reorder
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

    expect(MUTATING_MESSAGE_TYPES.size).toBe(expectedMutations.length);
    for (const type of expectedMutations) {
      expect(MUTATING_MESSAGE_TYPES.has(type as never)).toBe(true);
    }
  });

  it('READONLY_MESSAGE_TYPES contains all expected read-only types', () => {
    // NOTE: mute_track and solo_track are in READONLY, not MUTATING
    // They only affect the sender's local mix, not shared state
    const expectedReadOnly = [
      'play',
      'stop',
      'state_hash',
      'request_snapshot',
      'clock_sync_request',
      'cursor_move',
      'mute_track',   // Local only - "My Ears, My Control"
      'solo_track',   // Local only - "My Ears, My Control"
    ];

    expect(READONLY_MESSAGE_TYPES.size).toBe(expectedReadOnly.length);
    for (const type of expectedReadOnly) {
      expect(READONLY_MESSAGE_TYPES.has(type as never)).toBe(true);
    }
  });

  it('mutation and read-only sets are mutually exclusive', () => {
    for (const type of MUTATING_MESSAGE_TYPES) {
      expect(READONLY_MESSAGE_TYPES.has(type as never)).toBe(false);
    }
    for (const type of READONLY_MESSAGE_TYPES) {
      expect(MUTATING_MESSAGE_TYPES.has(type as never)).toBe(false);
    }
  });

  it('all handled message types are classified', () => {
    // Every message type in the handler switch statement must be in one of the sets
    for (const type of ALL_HANDLED_MESSAGE_TYPES) {
      const isMutation = MUTATING_MESSAGE_TYPES.has(type as never);
      const isReadOnly = READONLY_MESSAGE_TYPES.has(type as never);

      expect(
        isMutation || isReadOnly,
        `Message type "${type}" is not classified as mutation or read-only`
      ).toBe(true);
    }
  });

  it('no orphan types in sets (all classified types are handled)', () => {
    const allHandled = new Set(ALL_HANDLED_MESSAGE_TYPES);

    for (const type of MUTATING_MESSAGE_TYPES) {
      expect(
        allHandled.has(type),
        `MUTATING_MESSAGE_TYPES contains "${type}" but it's not in the handler switch`
      ).toBe(true);
    }

    for (const type of READONLY_MESSAGE_TYPES) {
      expect(
        allHandled.has(type),
        `READONLY_MESSAGE_TYPES contains "${type}" but it's not in the handler switch`
      ).toBe(true);
    }
  });

  describe('isStateMutatingMessage helper', () => {
    it('returns true for all mutation types', () => {
      for (const type of MUTATING_MESSAGE_TYPES) {
        expect(isStateMutatingMessage(type)).toBe(true);
      }
    });

    it('returns false for all read-only types', () => {
      for (const type of READONLY_MESSAGE_TYPES) {
        expect(isStateMutatingMessage(type)).toBe(false);
      }
    });

    it('returns false for unknown types', () => {
      expect(isStateMutatingMessage('unknown_type')).toBe(false);
      expect(isStateMutatingMessage('')).toBe(false);
      expect(isStateMutatingMessage('TOGGLE_STEP')).toBe(false); // case sensitive
    });
  });
});

/**
 * Phase 24: Published session mutation blocking
 *
 * These tests verify the architectural guarantee:
 * - All 18 mutation types are blocked on published sessions
 * - All 8 read-only types are allowed on published sessions
 *
 * NOTE: mute_track and solo_track moved from MUTATING to READONLY
 * per "My Ears, My Control" philosophy - each user controls their own mix.
 */
describe('Published Session Protection', () => {
  it('has exactly 28 mutation types to block', () => {
    // 15 original + set_session_name + set_scale + set_track_swing (removed set_track_playback_mode)
    // Phase 31F: Added batch_clear_steps and batch_set_parameter_locks
    // Phase 31G: Added set_loop_region and reorder_tracks
    // Pattern ops: rotate_pattern, invert_pattern, reverse_pattern, mirror_pattern, euclidean_fill
    // Track naming: set_track_name
    expect(MUTATING_MESSAGE_TYPES.size).toBe(28);
  });

  it('has exactly 8 read-only types to allow', () => {
    // 6 original + mute_track + solo_track
    expect(READONLY_MESSAGE_TYPES.size).toBe(8);
  });

  it('covers all 36 message types handled by the DO', () => {
    const totalClassified = MUTATING_MESSAGE_TYPES.size + READONLY_MESSAGE_TYPES.size;
    expect(totalClassified).toBe(ALL_HANDLED_MESSAGE_TYPES.length);
    // Phase 31F: Added 2 batch message types
    // Phase 31G: Added set_loop_region and reorder_tracks
    // Pattern ops: 5 new types, Track naming: 1 new type
    expect(totalClassified).toBe(36);
  });
});

/**
 * Bidirectional Mapping Test
 *
 * Verifies the complete message flow:
 * GridAction (SYNCED_ACTIONS) → ClientMessage → Handler (live-session.ts)
 *
 * This ensures that:
 * 1. Every synced GridAction has a corresponding ClientMessage type
 * 2. Every ClientMessage type has a handler in the DO
 * 3. The naming conventions are consistent (SCREAMING_CASE → snake_case → snake_case)
 */
import { SYNCED_ACTIONS } from '../../src/shared/sync-classification';
import { STATE_MUTATING_BROADCASTS } from '../../src/shared/messages';

describe('Bidirectional Message Mapping', () => {
  /**
   * Maps GridAction types to their expected ClientMessage types.
   * This documents the naming convention: SCREAMING_CASE → snake_case
   */
  const ACTION_TO_MESSAGE_MAP: Record<string, string> = {
    // Standard mutations
    'TOGGLE_STEP': 'toggle_step',
    'SET_TEMPO': 'set_tempo',
    'SET_SWING': 'set_swing',
    'SET_PARAMETER_LOCK': 'set_parameter_lock',
    'ADD_TRACK': 'add_track',
    'DELETE_TRACK': 'delete_track',
    'CLEAR_TRACK': 'clear_track',
    'SET_TRACK_SAMPLE': 'set_track_sample',
    'SET_TRACK_VOLUME': 'set_track_volume',
    'SET_TRACK_TRANSPOSE': 'set_track_transpose',
    'SET_TRACK_STEP_COUNT': 'set_track_step_count',
    'SET_TRACK_SWING': 'set_track_swing',
    'SET_TRACK_NAME': 'set_track_name',
    'SET_EFFECTS': 'set_effects',
    'SET_SCALE': 'set_scale',
    'SET_FM_PARAMS': 'set_fm_params',
    'COPY_SEQUENCE': 'copy_sequence',
    'MOVE_SEQUENCE': 'move_sequence',
    'SET_SESSION_NAME': 'set_session_name',
    // Pattern operations
    'ROTATE_PATTERN': 'rotate_pattern',
    'INVERT_PATTERN': 'invert_pattern',
    'REVERSE_PATTERN': 'reverse_pattern',
    'MIRROR_PATTERN': 'mirror_pattern',
    'EUCLIDEAN_FILL': 'euclidean_fill',
    // Workflow features
    'REORDER_TRACKS': 'reorder_tracks',
    'SET_LOOP_REGION': 'set_loop_region',
    // Batch operations (use dedicated send* functions, not actionToMessage)
    'DELETE_SELECTED_STEPS': 'batch_clear_steps',
    'APPLY_TO_SELECTION': 'batch_set_parameter_locks',
  };

  /**
   * Maps ClientMessage types to their expected ServerMessage broadcast types.
   * This documents the convention: verb_noun → noun_verbed (past tense)
   */
  const MESSAGE_TO_BROADCAST_MAP: Record<string, string> = {
    'toggle_step': 'step_toggled',
    'set_tempo': 'tempo_changed',
    'set_swing': 'swing_changed',
    'set_parameter_lock': 'parameter_lock_set',
    'add_track': 'track_added',
    'delete_track': 'track_deleted',
    'clear_track': 'track_cleared',
    'set_track_sample': 'track_sample_set',
    'set_track_volume': 'track_volume_set',
    'set_track_transpose': 'track_transpose_set',
    'set_track_step_count': 'track_step_count_set',
    'set_track_swing': 'track_swing_set',
    'set_track_name': 'track_name_set',
    'set_effects': 'effects_changed',
    'set_scale': 'scale_changed',
    'set_fm_params': 'fm_params_changed',
    'copy_sequence': 'sequence_copied',
    'move_sequence': 'sequence_moved',
    'set_session_name': 'session_name_changed',
    // Pattern operations
    'rotate_pattern': 'pattern_rotated',
    'invert_pattern': 'pattern_inverted',
    'reverse_pattern': 'pattern_reversed',
    'mirror_pattern': 'pattern_mirrored',
    'euclidean_fill': 'euclidean_filled',
    // Workflow features
    'reorder_tracks': 'tracks_reordered',
    'set_loop_region': 'loop_region_changed',
    // Batch operations
    'batch_clear_steps': 'steps_cleared',
    'batch_set_parameter_locks': 'parameter_locks_batch_set',
  };

  it('every SYNCED_ACTION has a corresponding ClientMessage type', () => {
    for (const action of SYNCED_ACTIONS) {
      expect(
        ACTION_TO_MESSAGE_MAP[action],
        `SYNCED_ACTION "${action}" is missing from ACTION_TO_MESSAGE_MAP`
      ).toBeDefined();
    }
  });

  it('ACTION_TO_MESSAGE_MAP covers exactly SYNCED_ACTIONS', () => {
    const mappedActions = new Set(Object.keys(ACTION_TO_MESSAGE_MAP));
    const syncedActions = new Set(SYNCED_ACTIONS);

    // Every mapped action should be in SYNCED_ACTIONS
    for (const action of mappedActions) {
      expect(
        syncedActions.has(action as never),
        `ACTION_TO_MESSAGE_MAP contains "${action}" but it's not in SYNCED_ACTIONS`
      ).toBe(true);
    }

    // Sizes should match
    expect(mappedActions.size).toBe(syncedActions.size);
  });

  it('every ClientMessage type has a corresponding broadcast type', () => {
    const messageTypes = Object.values(ACTION_TO_MESSAGE_MAP);

    for (const msgType of messageTypes) {
      expect(
        MESSAGE_TO_BROADCAST_MAP[msgType],
        `ClientMessage "${msgType}" is missing from MESSAGE_TO_BROADCAST_MAP`
      ).toBeDefined();
    }
  });

  it('every broadcast type is in STATE_MUTATING_BROADCASTS', () => {
    const broadcastTypes = Object.values(MESSAGE_TO_BROADCAST_MAP);

    for (const broadcast of broadcastTypes) {
      expect(
        STATE_MUTATING_BROADCASTS.has(broadcast as never),
        `Broadcast "${broadcast}" is not in STATE_MUTATING_BROADCASTS`
      ).toBe(true);
    }
  });

  it('MESSAGE_TO_BROADCAST_MAP covers all state-mutating broadcasts', () => {
    const mappedBroadcasts = new Set(Object.values(MESSAGE_TO_BROADCAST_MAP));

    // Every STATE_MUTATING_BROADCAST should be in our map
    for (const broadcast of STATE_MUTATING_BROADCASTS) {
      expect(
        mappedBroadcasts.has(broadcast),
        `STATE_MUTATING_BROADCASTS contains "${broadcast}" but it's not in MESSAGE_TO_BROADCAST_MAP`
      ).toBe(true);
    }

    // Sizes should match
    expect(mappedBroadcasts.size).toBe(STATE_MUTATING_BROADCASTS.size);
  });

  it('complete flow: SYNCED_ACTION → ClientMessage → Broadcast', () => {
    // This test verifies the complete bidirectional chain
    for (const action of SYNCED_ACTIONS) {
      const msgType = ACTION_TO_MESSAGE_MAP[action];
      expect(msgType, `Missing message for action ${action}`).toBeDefined();

      const broadcast = MESSAGE_TO_BROADCAST_MAP[msgType];
      expect(broadcast, `Missing broadcast for message ${msgType}`).toBeDefined();

      expect(
        STATE_MUTATING_BROADCASTS.has(broadcast as never),
        `Broadcast ${broadcast} not in STATE_MUTATING_BROADCASTS`
      ).toBe(true);
    }
  });
});
