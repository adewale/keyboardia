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
} from '../../src/sync/sync-classification';
import { actionToMessage } from '../../src/sync/multiplayer';
import { MUTATING_MESSAGE_TYPES, READONLY_MESSAGE_TYPES } from '../../src/shared/messages';
import type { GridAction, Track, ParameterLock, EffectsState, FMParams } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

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
    case 'SET_TRACK_INSTRUMENT':
      return { type: 'SET_TRACK_INSTRUMENT', trackId: 'test-track-1', sampleId: 'snare', name: 'Test Track' };
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
    case 'REORDER_TRACK_BY_ID':
      return { type: 'REORDER_TRACK_BY_ID', trackId: 'test-track-1', toIndex: 0 };
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
    // Phase 36: Focus state actions (local only - for keyboard navigation)
    case 'FOCUS_TRACK':
      return { type: 'FOCUS_TRACK', trackId: 'test-track-1' };
    case 'FOCUS_STEP':
      return { type: 'FOCUS_STEP', trackId: 'test-track-1', stepIndex: 0 };
    case 'BLUR_FOCUS':
      return { type: 'BLUR_FOCUS' };
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Sync Classification Verification', () => {

  describe('Classification Completeness', () => {
    it('does not assign an action to conflicting policies', () => {
      const syncedAndLocal = [...SYNCED_ACTIONS].filter(a => LOCAL_ONLY_ACTIONS.has(a as never));
      const syncedAndInternal = [...SYNCED_ACTIONS].filter(a => INTERNAL_ACTIONS.has(a as never));
      const localAndInternal = [...LOCAL_ONLY_ACTIONS].filter(a => INTERNAL_ACTIONS.has(a as never));

      expect(syncedAndLocal, 'Some actions are in both SYNCED and LOCAL_ONLY').toEqual([]);
      expect(syncedAndInternal, 'Some actions are in both SYNCED and INTERNAL').toEqual([]);
      expect(localAndInternal, 'Some actions are in both LOCAL_ONLY and INTERNAL').toEqual([]);
    });
  });

  describe('SYNCED_ACTIONS Verification', () => {
    /**
     * Most SYNCED_ACTIONS should produce messages from actionToMessage.
     * Exception: ADD_TRACK uses sendAddTrack separately (returns null from actionToMessage)
     */
    it('SYNCED_ACTIONS produce messages (except special cases)', () => {
      // These actions use dedicated send functions because their wire payload
      // needs reducer state that is not present on the GridAction itself.
      const specialCases = new Set([
        'ADD_TRACK',         // Uses sendAddTrack separately
        'REORDER_TRACKS',    // Phase 31G: Uses handleTrackReorder separately
        'DELETE_SELECTED_STEPS', // Uses handleBatchClearSteps separately
        'APPLY_TO_SELECTION',    // Uses handleBatchSetParameterLocks separately
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
        'REORDER_TRACKS',    // Phase 31G: Uses handleTrackReorder separately
        'DELETE_SELECTED_STEPS', // Uses handleBatchClearSteps separately
        'APPLY_TO_SELECTION',    // Uses handleBatchSetParameterLocks separately
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
      expect(SYNCED_ACTIONS.has('TOGGLE_MUTE' as never)).toBe(false);
    });

    it('solo actions are classified as LOCAL_ONLY', () => {
      expect(LOCAL_ONLY_ACTIONS.has('TOGGLE_SOLO')).toBe(true);
      expect(LOCAL_ONLY_ACTIONS.has('EXCLUSIVE_SOLO')).toBe(true);
      expect(LOCAL_ONLY_ACTIONS.has('CLEAR_ALL_SOLOS')).toBe(true);

      expect(SYNCED_ACTIONS.has('TOGGLE_SOLO' as never)).toBe(false);
      expect(SYNCED_ACTIONS.has('EXCLUSIVE_SOLO' as never)).toBe(false);
      expect(SYNCED_ACTIONS.has('CLEAR_ALL_SOLOS' as never)).toBe(false);
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

});
