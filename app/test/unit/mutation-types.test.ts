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
  'set_track_playback_mode',  // Phase 26: Playback mode sync
  'set_effects',  // Phase 25: Audio effects sync
  'set_scale',  // Phase 29E: Key Assistant scale sync
  'set_fm_params',  // Phase 23: FM synthesis params sync
  'set_session_name',  // Session metadata sync
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
      'set_track_playback_mode',  // Phase 26: Playback mode sync
      'set_effects',  // Phase 25: Audio effects sync
      'set_scale',  // Phase 29E: Key Assistant scale sync
      'set_fm_params',  // Phase 23: FM synthesis params sync
      'set_session_name',  // Session metadata sync
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
  it('has exactly 18 mutation types to block', () => {
    // 16 original + set_session_name + set_scale
    expect(MUTATING_MESSAGE_TYPES.size).toBe(18);
  });

  it('has exactly 8 read-only types to allow', () => {
    // 6 original + mute_track + solo_track
    expect(READONLY_MESSAGE_TYPES.size).toBe(8);
  });

  it('covers all 26 message types handled by the DO', () => {
    const totalClassified = MUTATING_MESSAGE_TYPES.size + READONLY_MESSAGE_TYPES.size;
    expect(totalClassified).toBe(ALL_HANDLED_MESSAGE_TYPES.length);
    expect(totalClassified).toBe(26);
  });
});
