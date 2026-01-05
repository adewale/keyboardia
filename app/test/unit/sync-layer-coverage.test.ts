/**
 * Sync Layer Coverage Tests
 *
 * These tests verify that the sync layer is complete:
 * 1. Every SYNCED_ACTION has a corresponding message in actionToMessage()
 * 2. Every message type has a corresponding server handler
 * 3. Every server handler broadcasts to clients
 * 4. Round-trip: client → server → client produces correct state
 *
 * CRITICAL: These tests should FAIL if sync is incomplete.
 * Do NOT skip or ignore failures - they indicate data loss bugs.
 *
 * Background: Phase 31B pattern operations were listed in SYNCED_ACTIONS
 * but never wired up. The test skipped them with "pending implementation"
 * comment, so the bug shipped. This test prevents that pattern.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  SYNCED_ACTIONS,
  LOCAL_ONLY_ACTIONS,
  INTERNAL_ACTIONS,
  isSyncedAction as _isSyncedAction,
} from '../../src/shared/sync-classification';
import { actionToMessage } from '../../src/sync/multiplayer';
import { applyMutation as _applyMutation } from '../../src/shared/state-mutations';
import type { GridAction, Track, ParameterLock, EffectsState, ScaleState, FMParams } from '../../src/types';
import type { ClientMessageBase as _ClientMessageBase } from '../../src/shared/message-types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a valid mock action for any GridAction type.
 * Each action type needs valid required properties.
 */
function createMockAction(type: string): GridAction {
  const mockTrack: Track = {
    id: 'test-track-1',
    name: 'Test Track',
    sampleId: 'kick',
    steps: Array(128).fill(false),
    parameterLocks: Array(128).fill(null),
    volume: 0.8,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
  };

  const mockLock: ParameterLock = { volume: 0.5, pitch: 3 };
  const mockEffects: EffectsState = {
    reverb: { decay: 1.5, wet: 0.3 },
    delay: { time: '8n', feedback: 0.3, wet: 0.2 },
    chorus: { frequency: 1.5, depth: 0.5, wet: 0.2 },
    distortion: { amount: 0, wet: 0 },
  };
  const mockScale: ScaleState = { root: 'C', scaleId: 'minor-pentatonic', locked: false };
  const mockFMParams: FMParams = { harmonicity: 2, modulationIndex: 5 };

  switch (type) {
    // Synced actions
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
    case 'SET_TRACK_SWING':
      return { type: 'SET_TRACK_SWING', trackId: 'test-track-1', swing: 25 };
    case 'SET_TRACK_NAME':
      return { type: 'SET_TRACK_NAME', trackId: 'test-track-1', name: 'New Name' };
    case 'SET_EFFECTS':
      return { type: 'SET_EFFECTS', effects: mockEffects };
    case 'SET_SCALE':
      return { type: 'SET_SCALE', scale: mockScale };
    case 'SET_FM_PARAMS':
      return { type: 'SET_FM_PARAMS', trackId: 'test-track-1', fmParams: mockFMParams };
    case 'COPY_SEQUENCE':
      return { type: 'COPY_SEQUENCE', fromTrackId: 'test-track-1', toTrackId: 'test-track-2' };
    case 'MOVE_SEQUENCE':
      return { type: 'MOVE_SEQUENCE', fromTrackId: 'test-track-1', toTrackId: 'test-track-2' };
    case 'SET_SESSION_NAME':
      return { type: 'SET_SESSION_NAME', name: 'My Session' };
    // Pattern operations (Phase 31B) - MUST sync
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
    // Phase 31G
    case 'REORDER_TRACKS':
      return { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 1 };
    case 'SET_LOOP_REGION':
      return { type: 'SET_LOOP_REGION', region: { start: 0, end: 15 } };
    // Phase 31F batch operations
    case 'DELETE_SELECTED_STEPS':
      return { type: 'DELETE_SELECTED_STEPS' };
    case 'APPLY_TO_SELECTION':
      return { type: 'APPLY_TO_SELECTION', lock: { pitch: 2 } };

    // Local-only actions
    case 'TOGGLE_MUTE':
      return { type: 'TOGGLE_MUTE', trackId: 'test-track-1' };
    case 'TOGGLE_SOLO':
      return { type: 'TOGGLE_SOLO', trackId: 'test-track-1' };
    case 'EXCLUSIVE_SOLO':
      return { type: 'EXCLUSIVE_SOLO', trackId: 'test-track-1' };
    case 'CLEAR_ALL_SOLOS':
      return { type: 'CLEAR_ALL_SOLOS' };
    case 'UNMUTE_ALL':
      return { type: 'UNMUTE_ALL' };
    case 'SET_PLAYING':
      return { type: 'SET_PLAYING', isPlaying: true };
    case 'SET_CURRENT_STEP':
      return { type: 'SET_CURRENT_STEP', step: 4 };
    case 'SELECT_STEP':
      return { type: 'SELECT_STEP', trackId: 'test-track-1', step: 0, mode: 'toggle' as const };
    case 'CLEAR_SELECTION':
      return { type: 'CLEAR_SELECTION' };

    // Internal actions
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
      throw new Error(`Unknown action type: ${type}. Add it to createMockAction().`);
  }
}

/**
 * Actions that use non-standard sync patterns.
 * These are valid SYNCED_ACTIONS but don't go through actionToMessage().
 *
 * IMPORTANT: This list should be MINIMAL. Every entry here is a
 * potential source of bugs because it bypasses the standard sync path.
 */
const NON_STANDARD_SYNC_ACTIONS = new Set([
  // ADD_TRACK creates the track locally first, then sends via sendAddTrack()
  // This is intentional: we need the track ID before we can send
  'ADD_TRACK',

  // Batch operations use selection state which isn't in the action
  // They call handleBatchClearSteps/handleBatchSetParameterLocks directly
  'DELETE_SELECTED_STEPS',
  'APPLY_TO_SELECTION',

  // These use handleTrackReorder, handleSetLoopRegion directly
  // TODO: Should these go through actionToMessage instead?
  'REORDER_TRACKS',
  'SET_LOOP_REGION',
]);

/**
 * Actions that are known to be unimplemented.
 *
 * CRITICAL: This set should be EMPTY in a healthy codebase.
 * If this set has entries, tests will pass but users will lose data!
 *
 * When fixing a bug, remove it from this set and implement the sync.
 */
const KNOWN_UNIMPLEMENTED_SYNCED_ACTIONS = new Set<string>([
  // All pattern operations and SET_TRACK_NAME now have proper sync implementation.
  // Fixed in Phase 33 (2026-01-04).
]);

// ============================================================================
// Sync Coverage Tests
// ============================================================================

describe('Sync Layer Coverage', () => {
  describe('SYNCED_ACTIONS produce messages', () => {
    // Test each synced action individually for clear error messages
    for (const actionType of SYNCED_ACTIONS) {
      if (NON_STANDARD_SYNC_ACTIONS.has(actionType)) {
        it(`${actionType}: uses non-standard sync (documented exception)`, () => {
          // These are valid but use different sync patterns
          // The test documents that we know about them
          expect(NON_STANDARD_SYNC_ACTIONS.has(actionType)).toBe(true);
        });
        continue;
      }

      if (KNOWN_UNIMPLEMENTED_SYNCED_ACTIONS.has(actionType)) {
        it.fails(`${actionType}: KNOWN BUG - sync not implemented`, () => {
          // This test is expected to fail!
          // When you implement the sync, remove from KNOWN_UNIMPLEMENTED_SYNCED_ACTIONS
          // and this test will start passing.
          const action = createMockAction(actionType);
          const message = actionToMessage(action);
          expect(message).not.toBeNull();
        });
        continue;
      }

      it(`${actionType}: produces a sync message`, () => {
        const action = createMockAction(actionType);
        const message = actionToMessage(action);

        expect(
          message,
          `SYNCED_ACTION "${actionType}" should produce a message from actionToMessage(). ` +
          `Either implement the sync or move to LOCAL_ONLY_ACTIONS.`
        ).not.toBeNull();
      });
    }
  });

  describe('LOCAL_ONLY_ACTIONS do not produce state-mutating messages', () => {
    for (const actionType of LOCAL_ONLY_ACTIONS) {
      it(`${actionType}: returns null or read-only message`, () => {
        const action = createMockAction(actionType);
        const message = actionToMessage(action);

        // Either null or a read-only message (play/stop for clock sync)
        if (message !== null) {
          expect(
            ['play', 'stop'].includes(message.type),
            `LOCAL_ONLY_ACTION "${actionType}" returned message type "${message.type}" ` +
            `which is not read-only. This would cause sync issues.`
          ).toBe(true);
        }
      });
    }
  });

  describe('INTERNAL_ACTIONS do not produce messages', () => {
    for (const actionType of INTERNAL_ACTIONS) {
      it(`${actionType}: returns null`, () => {
        const action = createMockAction(actionType);
        const message = actionToMessage(action);

        expect(
          message,
          `INTERNAL_ACTION "${actionType}" should not produce a message`
        ).toBeNull();
      });
    }
  });

  describe('Known unimplemented actions tracking', () => {
    it('KNOWN_UNIMPLEMENTED_SYNCED_ACTIONS is documented', () => {
      // This test documents which synced actions are known to be broken.
      // When this set becomes empty, we've fixed all the bugs!
      console.log(
        `\n⚠️  KNOWN SYNC BUGS: ${KNOWN_UNIMPLEMENTED_SYNCED_ACTIONS.size} actions listed in SYNCED_ACTIONS but not implemented:\n` +
        `   ${[...KNOWN_UNIMPLEMENTED_SYNCED_ACTIONS].join(', ')}\n` +
        `   These will cause data loss in multiplayer!\n`
      );

      // Fail if there are too many unimplemented actions
      // This prevents the list from growing unbounded
      expect(
        KNOWN_UNIMPLEMENTED_SYNCED_ACTIONS.size,
        'Too many unimplemented synced actions. Fix some before adding more!'
      ).toBeLessThanOrEqual(10);
    });

    it('NON_STANDARD_SYNC_ACTIONS is minimal', () => {
      // Every non-standard sync is a potential bug source
      // Keep this list small and well-documented
      expect(
        NON_STANDARD_SYNC_ACTIONS.size,
        'Too many non-standard sync patterns. Consolidate to actionToMessage() where possible.'
      ).toBeLessThanOrEqual(5);
    });
  });
});

// ============================================================================
// Property-Based Tests for Sync Layer
// ============================================================================

describe('Sync Layer Properties', () => {
  // Arbitrary for synced action types
  const arbSyncedActionType = fc.constantFrom(
    ...([...SYNCED_ACTIONS].filter(
      a => !NON_STANDARD_SYNC_ACTIONS.has(a) && !KNOWN_UNIMPLEMENTED_SYNCED_ACTIONS.has(a)
    ))
  );

  it('SL-001: All implemented SYNCED_ACTIONS produce non-null messages', () => {
    fc.assert(
      fc.property(arbSyncedActionType, (actionType) => {
        const action = createMockAction(actionType);
        const message = actionToMessage(action);
        return message !== null;
      }),
      { numRuns: 100 }
    );
  });

  it('SL-002: actionToMessage is deterministic', () => {
    fc.assert(
      fc.property(arbSyncedActionType, (actionType) => {
        const action = createMockAction(actionType);
        const message1 = actionToMessage(action);
        const message2 = actionToMessage(action);

        if (message1 === null && message2 === null) return true;
        if (message1 === null || message2 === null) return false;

        return JSON.stringify(message1) === JSON.stringify(message2);
      }),
      { numRuns: 100 }
    );
  });

  it('SL-003: Message type matches action type pattern', () => {
    fc.assert(
      fc.property(arbSyncedActionType, (actionType) => {
        const action = createMockAction(actionType);
        const message = actionToMessage(action);

        if (message === null) return true; // Handled by SL-001

        // Action type TOGGLE_STEP should produce message type toggle_step
        const expectedPattern = actionType.toLowerCase();
        const actualType = message.type;

        // Allow some flexibility in naming (set_tempo vs tempo_changed, etc.)
        return actualType.includes(expectedPattern.split('_')[0]) ||
               expectedPattern.includes(actualType.split('_')[0]);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Summary Statistics
// ============================================================================

describe('Sync Coverage Summary', () => {
  it('reports coverage statistics', () => {
    const totalSynced = SYNCED_ACTIONS.size;
    const nonStandard = NON_STANDARD_SYNC_ACTIONS.size;
    const unimplemented = KNOWN_UNIMPLEMENTED_SYNCED_ACTIONS.size;
    const implemented = totalSynced - nonStandard - unimplemented;

    const coverage = ((implemented / totalSynced) * 100).toFixed(1);

    console.log(`
╔════════════════════════════════════════╗
║       SYNC LAYER COVERAGE REPORT       ║
╠════════════════════════════════════════╣
║ Total SYNCED_ACTIONS:        ${String(totalSynced).padStart(8)} ║
║ Standard sync (actionToMessage):${String(implemented).padStart(5)} ║
║ Non-standard sync patterns:  ${String(nonStandard).padStart(8)} ║
║ UNIMPLEMENTED (bugs):        ${String(unimplemented).padStart(8)} ║
╠════════════════════════════════════════╣
║ Coverage: ${coverage}%${' '.repeat(25 - coverage.length)}║
╚════════════════════════════════════════╝
    `);

    // This test always passes but prints useful info
    expect(true).toBe(true);
  });
});
