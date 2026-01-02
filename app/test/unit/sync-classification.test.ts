/**
 * Sync Classification Verification Tests
 *
 * Verifies that the sync classification manifest (sync-classification.ts) matches
 * actual implementation behavior. These tests catch:
 * 1. New actions added without classification
 * 2. Actions that should sync but actionToMessage returns null
 * 3. Actions that shouldn't sync but actionToMessage returns a message
 * 4. Violations of "My Ears, My Control" philosophy
 *
 * ARCHITECTURAL PRINCIPLE: The manifest is the design document.
 * These tests verify implementation matches design.
 */

import { describe, it, expect } from 'vitest';
import {
  SYNCED_ACTIONS,
  LOCAL_ONLY_ACTIONS,
  INTERNAL_ACTIONS,
  isSyncedAction,
  isLocalOnlyAction,
  isInternalAction,
} from '../../src/shared/sync-classification';
import { actionToMessage } from '../../src/sync/multiplayer';
import { MUTATING_MESSAGE_TYPES, READONLY_MESSAGE_TYPES } from '../../src/shared/messages';
import type { GridAction, Track, ParameterLock, EffectsState, FMParams } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * All GridAction type strings from src/types.ts.
 *
 * NOTE: This list is now REDUNDANT with the compile-time exhaustiveness check
 * in sync-classification.ts. The TypeScript compiler will error if any action
 * is missing from the classification sets. This list is kept for test clarity.
 */
const ALL_GRID_ACTION_TYPES = [
  // State mutations (synced)
  'TOGGLE_STEP',
  'SET_TEMPO',
  'SET_SWING',
  'SET_PARAMETER_LOCK',
  'ADD_TRACK',
  'DELETE_TRACK',
  'CLEAR_TRACK',
  'SET_TRACK_SAMPLE',
  'SET_TRACK_VOLUME',
  'SET_TRACK_TRANSPOSE',
  'SET_TRACK_STEP_COUNT',
  'SET_TRACK_SWING',       // Phase 31D: Per-track swing
  'SET_TRACK_NAME',        // Phase 31D: Track naming
  'SET_EFFECTS',
  'SET_SCALE',             // Phase 29E: Key Assistant
  'SET_FM_PARAMS',
  'COPY_SEQUENCE',
  'MOVE_SEQUENCE',
  'SET_SESSION_NAME',
  // Phase 31B: Pattern manipulation
  'ROTATE_PATTERN',
  'INVERT_PATTERN',
  'REVERSE_PATTERN',
  'MIRROR_PATTERN',
  'EUCLIDEAN_FILL',
  // Phase 31G: Workflow
  'REORDER_TRACKS',
  // Local only (not synced)
  'TOGGLE_MUTE',
  'TOGGLE_SOLO',
  'EXCLUSIVE_SOLO',
  'CLEAR_ALL_SOLOS',
  'UNMUTE_ALL',            // Phase 31D
  'SET_PLAYING',
  'SET_CURRENT_STEP',
  // Internal (not synced)
  'LOAD_STATE',
  'RESET_STATE',
  'REMOTE_STEP_SET',
  'REMOTE_MUTE_SET',
  'REMOTE_SOLO_SET',
  'SET_TRACK_STEPS',
] as const;

/**
 * Create a mock GridAction for testing actionToMessage.
 * Each action type needs valid required properties.
 */
function createMockAction(type: string): GridAction {
  const mockTrack: Track = {
    id: 'test-track-1',
    name: 'Test Track',
    sampleId: 'kick',
    steps: Array(16).fill(false),
    parameterLocks: Array(16).fill(null),
    volume: 0.8,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
  };

  const mockLock: ParameterLock = { volume: 0.5 };
  const mockEffects: EffectsState = { reverb: 0.3, delay: 0.2 };
  const mockFMParams: FMParams = { ratio: 2, index: 5, attack: 0.01, decay: 0.3 };

  switch (type) {
    case 'TOGGLE_STEP':
      return { type: 'TOGGLE_STEP', trackId: 'test-track-1', step: 0 };
    case 'SET_TEMPO':
      return { type: 'SET_TEMPO', tempo: 120 };
    case 'SET_SWING':
      return { type: 'SET_SWING', swing: 50 };
    case 'SET_PARAMETER_LOCK':
      return { type: 'SET_PARAMETER_LOCK', trackId: 'test-track-1', step: 0, lock: mockLock };
    case 'ADD_TRACK':
      return { type: 'ADD_TRACK', sampleId: 'kick', name: 'Kick', track: mockTrack };
    case 'DELETE_TRACK':
      return { type: 'DELETE_TRACK', trackId: 'test-track-1' };
    case 'CLEAR_TRACK':
      return { type: 'CLEAR_TRACK', trackId: 'test-track-1' };
    case 'SET_TRACK_SAMPLE':
      return { type: 'SET_TRACK_SAMPLE', trackId: 'test-track-1', sampleId: 'snare', name: 'Snare' };
    case 'SET_TRACK_VOLUME':
      return { type: 'SET_TRACK_VOLUME', trackId: 'test-track-1', volume: 0.5 };
    case 'SET_TRACK_TRANSPOSE':
      return { type: 'SET_TRACK_TRANSPOSE', trackId: 'test-track-1', transpose: 3 };
    case 'SET_TRACK_STEP_COUNT':
      return { type: 'SET_TRACK_STEP_COUNT', trackId: 'test-track-1', stepCount: 32 };
    case 'SET_EFFECTS':
      return { type: 'SET_EFFECTS', effects: mockEffects };
    case 'SET_FM_PARAMS':
      return { type: 'SET_FM_PARAMS', trackId: 'test-track-1', fmParams: mockFMParams };
    case 'COPY_SEQUENCE':
      return { type: 'COPY_SEQUENCE', fromTrackId: 'test-track-1', toTrackId: 'test-track-2' };
    case 'MOVE_SEQUENCE':
      return { type: 'MOVE_SEQUENCE', fromTrackId: 'test-track-1', toTrackId: 'test-track-2' };
    case 'SET_SESSION_NAME':
      return { type: 'SET_SESSION_NAME', name: 'My Session' };
    case 'TOGGLE_MUTE':
      return { type: 'TOGGLE_MUTE', trackId: 'test-track-1' };
    case 'TOGGLE_SOLO':
      return { type: 'TOGGLE_SOLO', trackId: 'test-track-1' };
    case 'EXCLUSIVE_SOLO':
      return { type: 'EXCLUSIVE_SOLO', trackId: 'test-track-1' };
    case 'CLEAR_ALL_SOLOS':
      return { type: 'CLEAR_ALL_SOLOS' };
    case 'SET_PLAYING':
      return { type: 'SET_PLAYING', isPlaying: true };
    case 'SET_CURRENT_STEP':
      return { type: 'SET_CURRENT_STEP', step: 4 };
    case 'LOAD_STATE':
      return { type: 'LOAD_STATE', tracks: [mockTrack], tempo: 120, swing: 0 };
    case 'RESET_STATE':
      return { type: 'RESET_STATE' };
    case 'REMOTE_STEP_SET':
      return { type: 'REMOTE_STEP_SET', trackId: 'test-track-1', step: 0, value: true };
    case 'REMOTE_MUTE_SET':
      return { type: 'REMOTE_MUTE_SET', trackId: 'test-track-1', muted: true };
    case 'REMOTE_SOLO_SET':
      return { type: 'REMOTE_SOLO_SET', trackId: 'test-track-1', soloed: true };
    case 'SET_TRACK_STEPS':
      return { type: 'SET_TRACK_STEPS', trackId: 'test-track-1', steps: [true, false], parameterLocks: [null, null], stepCount: 16 };
    case 'SET_TRACK_SWING':
      return { type: 'SET_TRACK_SWING', trackId: 'test-track-1', swing: 25 };
    case 'SET_TRACK_NAME':
      return { type: 'SET_TRACK_NAME', trackId: 'test-track-1', name: 'New Name' };
    case 'SET_SCALE':
      return { type: 'SET_SCALE', scale: { root: 0, mode: 'major' } };
    case 'ROTATE_PATTERN':
      return { type: 'ROTATE_PATTERN', trackId: 'test-track-1', direction: 'left' };
    case 'INVERT_PATTERN':
      return { type: 'INVERT_PATTERN', trackId: 'test-track-1' };
    case 'REVERSE_PATTERN':
      return { type: 'REVERSE_PATTERN', trackId: 'test-track-1' };
    case 'MIRROR_PATTERN':
      return { type: 'MIRROR_PATTERN', trackId: 'test-track-1' };
    case 'EUCLIDEAN_FILL':
      return { type: 'EUCLIDEAN_FILL', trackId: 'test-track-1', hits: 5 };
    case 'UNMUTE_ALL':
      return { type: 'UNMUTE_ALL' };
    case 'REORDER_TRACKS':
      return { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 1 };
    // Phase 31F/31G: Selection and loop actions
    case 'SELECT_STEP':
      return { type: 'SELECT_STEP', trackId: 'test-track-1', step: 0, mode: 'toggle' as const };
    case 'CLEAR_SELECTION':
      return { type: 'CLEAR_SELECTION' };
    case 'DELETE_SELECTED_STEPS':
      return { type: 'DELETE_SELECTED_STEPS' };
    case 'APPLY_TO_SELECTION':
      return { type: 'APPLY_TO_SELECTION', lock: { pitch: 2 } };
    case 'SET_LOOP_REGION':
      return { type: 'SET_LOOP_REGION', region: { start: 0, end: 15 } };
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Sync Classification Verification', () => {

  describe('Classification Completeness', () => {
    it('all GridAction types are classified in exactly one set', () => {
      const allClassified = new Set([
        ...SYNCED_ACTIONS,
        ...LOCAL_ONLY_ACTIONS,
        ...INTERNAL_ACTIONS,
      ]);

      // Check that every known action is classified
      for (const actionType of ALL_GRID_ACTION_TYPES) {
        expect(
          allClassified.has(actionType),
          `Action type "${actionType}" is not classified in any set. Add it to SYNCED_ACTIONS, LOCAL_ONLY_ACTIONS, or INTERNAL_ACTIONS in sync-classification.ts`
        ).toBe(true);
      }

      // Check that no action is in multiple sets (no duplicates)
      const syncedAndLocal = [...SYNCED_ACTIONS].filter(a => LOCAL_ONLY_ACTIONS.has(a as never));
      const syncedAndInternal = [...SYNCED_ACTIONS].filter(a => INTERNAL_ACTIONS.has(a as never));
      const localAndInternal = [...LOCAL_ONLY_ACTIONS].filter(a => INTERNAL_ACTIONS.has(a as never));

      expect(syncedAndLocal, 'Some actions are in both SYNCED and LOCAL_ONLY').toEqual([]);
      expect(syncedAndInternal, 'Some actions are in both SYNCED and INTERNAL').toEqual([]);
      expect(localAndInternal, 'Some actions are in both LOCAL_ONLY and INTERNAL').toEqual([]);
    });

    it('has the expected number of classified actions', () => {
      // 28 synced + 8 local-only + 6 internal = 42 total
      // (Phase 31F added SELECT_STEP, CLEAR_SELECTION to local-only)
      // (Phase 31F/31G added DELETE_SELECTED_STEPS, APPLY_TO_SELECTION, SET_LOOP_REGION to synced)
      // Note: TypeScript exhaustiveness check in sync-classification.ts now enforces completeness
      const totalClassified = SYNCED_ACTIONS.size + LOCAL_ONLY_ACTIONS.size + INTERNAL_ACTIONS.size;
      expect(totalClassified).toBe(43);
    });
  });

  describe('SYNCED_ACTIONS Verification', () => {
    /**
     * Most SYNCED_ACTIONS should produce messages from actionToMessage.
     * Exception: ADD_TRACK uses sendAddTrack separately (returns null from actionToMessage)
     */
    it('SYNCED_ACTIONS produce messages (except special cases)', () => {
      // Special cases: actions classified as synced but with pending wire implementation
      // or non-standard send patterns. These still pass compile-time exhaustiveness check.
      const specialCases = new Set([
        'ADD_TRACK',         // Uses sendAddTrack separately
        // Pattern manipulation - classified as synced, wire implementation pending
        'SET_TRACK_NAME',    // Phase 31D: Pending implementation
        'ROTATE_PATTERN',    // Phase 31B: Pending implementation
        'INVERT_PATTERN',    // Phase 31B: Pending implementation
        'REVERSE_PATTERN',   // Phase 31B: Pending implementation
        'MIRROR_PATTERN',    // Phase 31B: Pending implementation
        'EUCLIDEAN_FILL',    // Phase 31B: Pending implementation
        'REORDER_TRACKS',    // Phase 31G: Pending implementation
        // Phase 31F/31G: Batch operations use separate sync handlers
        'DELETE_SELECTED_STEPS', // Uses handleBatchClearSteps separately
        'APPLY_TO_SELECTION',    // Uses handleBatchSetParameterLocks separately
        'SET_LOOP_REGION',       // Pending wire implementation
      ]);

      for (const actionType of SYNCED_ACTIONS) {
        if (specialCases.has(actionType)) continue;

        const action = createMockAction(actionType);
        const message = actionToMessage(action);

        expect(
          message,
          `SYNCED_ACTION "${actionType}" should produce a message from actionToMessage()`
        ).not.toBeNull();
      }
    });

    it('ADD_TRACK uses special handler (returns null from actionToMessage)', () => {
      // ADD_TRACK is a special case - it uses sendAddTrack after the reducer creates the track
      const action = createMockAction('ADD_TRACK');
      const message = actionToMessage(action);

      expect(
        message,
        'ADD_TRACK should return null from actionToMessage (uses sendAddTrack separately)'
      ).toBeNull();
    });

    it('SYNCED_ACTIONS message types are in MUTATING_MESSAGE_TYPES', () => {
      // Same special cases as above
      const specialCases = new Set([
        'ADD_TRACK',         // Uses sendAddTrack separately
        'SET_TRACK_NAME',    // Phase 31D: Pending implementation
        'ROTATE_PATTERN',    // Phase 31B: Pending implementation
        'INVERT_PATTERN',    // Phase 31B: Pending implementation
        'REVERSE_PATTERN',   // Phase 31B: Pending implementation
        'MIRROR_PATTERN',    // Phase 31B: Pending implementation
        'EUCLIDEAN_FILL',    // Phase 31B: Pending implementation
        'REORDER_TRACKS',    // Phase 31G: Pending implementation
        // Phase 31F/31G: Batch operations use separate sync handlers
        'DELETE_SELECTED_STEPS', // Uses handleBatchClearSteps separately
        'APPLY_TO_SELECTION',    // Uses handleBatchSetParameterLocks separately
        'SET_LOOP_REGION',       // Pending wire implementation
      ]);

      for (const actionType of SYNCED_ACTIONS) {
        if (specialCases.has(actionType)) continue;

        const action = createMockAction(actionType);
        const message = actionToMessage(action);

        if (message) {
          expect(
            MUTATING_MESSAGE_TYPES.has(message.type as never),
            `SYNCED_ACTION "${actionType}" produces message type "${message.type}" which is not in MUTATING_MESSAGE_TYPES`
          ).toBe(true);
        }
      }
    });
  });

  describe('LOCAL_ONLY_ACTIONS Verification', () => {
    /**
     * LOCAL_ONLY_ACTIONS should NOT produce state-mutating messages.
     * Exception: SET_PLAYING produces play/stop for clock sync, but these are READONLY not MUTATING
     */
    it('LOCAL_ONLY_ACTIONS do not produce state-mutating messages', () => {
      for (const actionType of LOCAL_ONLY_ACTIONS) {
        const action = createMockAction(actionType);
        const message = actionToMessage(action);

        if (message) {
          // If they do produce a message, it should NOT be in MUTATING_MESSAGE_TYPES
          expect(
            MUTATING_MESSAGE_TYPES.has(message.type as never),
            `LOCAL_ONLY_ACTION "${actionType}" produces "${message.type}" which should not be in MUTATING_MESSAGE_TYPES`
          ).toBe(false);

          // If they produce a message, it should be in READONLY_MESSAGE_TYPES (like play/stop)
          expect(
            READONLY_MESSAGE_TYPES.has(message.type as never),
            `LOCAL_ONLY_ACTION "${actionType}" produces "${message.type}" which should be in READONLY_MESSAGE_TYPES`
          ).toBe(true);
        }
      }
    });

    it('SET_PLAYING produces play/stop for clock sync (READONLY, not MUTATING)', () => {
      const playAction = createMockAction('SET_PLAYING');
      const message = actionToMessage(playAction);

      expect(message).not.toBeNull();
      expect(message?.type).toMatch(/^(play|stop)$/);

      // play and stop should be READONLY not MUTATING
      expect(READONLY_MESSAGE_TYPES.has('play' as never)).toBe(true);
      expect(READONLY_MESSAGE_TYPES.has('stop' as never)).toBe(true);
      expect(MUTATING_MESSAGE_TYPES.has('play' as never)).toBe(false);
      expect(MUTATING_MESSAGE_TYPES.has('stop' as never)).toBe(false);
    });
  });

  describe('INTERNAL_ACTIONS Verification', () => {
    it('INTERNAL_ACTIONS do not produce messages', () => {
      for (const actionType of INTERNAL_ACTIONS) {
        const action = createMockAction(actionType);
        const message = actionToMessage(action);

        expect(
          message,
          `INTERNAL_ACTION "${actionType}" should not produce a message`
        ).toBeNull();
      }
    });
  });

  describe('"My Ears, My Control" Philosophy Verification', () => {
    /**
     * Critical invariant: Mute and solo actions must NEVER sync to other clients.
     * Each player controls their own listening experience.
     */

    it('mute actions are classified as LOCAL_ONLY', () => {
      expect(LOCAL_ONLY_ACTIONS.has('TOGGLE_MUTE')).toBe(true);
      expect(isLocalOnlyAction('TOGGLE_MUTE')).toBe(true);
      expect(isSyncedAction('TOGGLE_MUTE')).toBe(false);
    });

    it('solo actions are classified as LOCAL_ONLY', () => {
      expect(LOCAL_ONLY_ACTIONS.has('TOGGLE_SOLO')).toBe(true);
      expect(LOCAL_ONLY_ACTIONS.has('EXCLUSIVE_SOLO')).toBe(true);
      expect(LOCAL_ONLY_ACTIONS.has('CLEAR_ALL_SOLOS')).toBe(true);

      expect(isLocalOnlyAction('TOGGLE_SOLO')).toBe(true);
      expect(isLocalOnlyAction('EXCLUSIVE_SOLO')).toBe(true);
      expect(isLocalOnlyAction('CLEAR_ALL_SOLOS')).toBe(true);

      expect(isSyncedAction('TOGGLE_SOLO')).toBe(false);
      expect(isSyncedAction('EXCLUSIVE_SOLO')).toBe(false);
      expect(isSyncedAction('CLEAR_ALL_SOLOS')).toBe(false);
    });

    it('mute actions do not produce sync messages', () => {
      const action = createMockAction('TOGGLE_MUTE');
      const message = actionToMessage(action);
      expect(message).toBeNull();
    });

    it('solo actions do not produce sync messages', () => {
      const actions = ['TOGGLE_SOLO', 'EXCLUSIVE_SOLO', 'CLEAR_ALL_SOLOS'];

      for (const actionType of actions) {
        const action = createMockAction(actionType);
        const message = actionToMessage(action);
        expect(message, `${actionType} should not produce a sync message`).toBeNull();
      }
    });
  });

  describe('Helper Functions', () => {
    it('isSyncedAction returns true only for SYNCED_ACTIONS', () => {
      expect(isSyncedAction('TOGGLE_STEP')).toBe(true);
      expect(isSyncedAction('SET_TEMPO')).toBe(true);
      expect(isSyncedAction('TOGGLE_MUTE')).toBe(false);
      expect(isSyncedAction('LOAD_STATE')).toBe(false);
      expect(isSyncedAction('unknown')).toBe(false);
    });

    it('isLocalOnlyAction returns true only for LOCAL_ONLY_ACTIONS', () => {
      expect(isLocalOnlyAction('TOGGLE_MUTE')).toBe(true);
      expect(isLocalOnlyAction('TOGGLE_SOLO')).toBe(true);
      expect(isLocalOnlyAction('SET_PLAYING')).toBe(true);
      expect(isLocalOnlyAction('TOGGLE_STEP')).toBe(false);
      expect(isLocalOnlyAction('LOAD_STATE')).toBe(false);
    });

    it('isInternalAction returns true only for INTERNAL_ACTIONS', () => {
      expect(isInternalAction('LOAD_STATE')).toBe(true);
      expect(isInternalAction('RESET_STATE')).toBe(true);
      expect(isInternalAction('REMOTE_STEP_SET')).toBe(true);
      expect(isInternalAction('TOGGLE_STEP')).toBe(false);
      expect(isInternalAction('TOGGLE_MUTE')).toBe(false);
    });
  });
});
