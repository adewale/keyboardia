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
 * This list must be kept in sync manually when new actions are added.
 * If you add a new action type, add it here AND in sync-classification.ts.
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
  'SET_EFFECTS',
  'SET_FM_PARAMS',
  'COPY_SEQUENCE',
  'MOVE_SEQUENCE',
  'SET_SESSION_NAME',      // Not yet implemented - will fail until Part 3
  // Local only (not synced)
  'TOGGLE_MUTE',
  'TOGGLE_SOLO',
  'EXCLUSIVE_SOLO',
  'CLEAR_ALL_SOLOS',
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
      // 16 synced + 6 local-only + 6 internal = 28 total
      const totalClassified = SYNCED_ACTIONS.size + LOCAL_ONLY_ACTIONS.size + INTERNAL_ACTIONS.size;
      expect(totalClassified).toBe(28);
    });
  });

  describe('SYNCED_ACTIONS Verification', () => {
    /**
     * Most SYNCED_ACTIONS should produce messages from actionToMessage.
     * Exception: ADD_TRACK uses sendAddTrack separately (returns null from actionToMessage)
     */
    it('SYNCED_ACTIONS produce messages (except special cases)', () => {
      const specialCases = new Set([
        'ADD_TRACK',         // Uses sendAddTrack separately
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
      const specialCases = new Set([
        'ADD_TRACK',         // Uses sendAddTrack separately
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
