/**
 * Reducer-Mutation Equivalence Tests
 *
 * WHAT THESE ACTUALLY COVER, which is not what the file was built for.
 *
 * The original premise: gridReducer (client) and applyMutation (shared) hold
 * duplicate logic, and this suite is the net that catches them diverging. That
 * premise expired. Phase 3 routed every SYNCED case in gridReducer through
 * `delegateToApplyMutation`, so 27 of the 28 SYNCED actions have no separate
 * client implementation left — `SET_SESSION_NAME` is the sole exception and it
 * has no test here. Both sides of every comparison below now run the same
 * function.
 *
 * The July 2026 audit caught this by sabotage: neutering `applyMutation` to
 * `return state` broke both sides identically, and all 29 tests passed. A
 * suite whose stated job is detecting divergence detected a function that had
 * stopped working at all.
 *
 * What survives is still worth running, because two things in the path are
 * genuinely independent of applyMutation:
 *   - actionToMessage, which translates a GridAction into a wire message
 *   - the GridState <-> SessionState adapters
 * A break in either shows up here as an inequality. `expectEquivalentAndChanged`
 * supplies the missing half: the mutation must also move the state, so a no-op
 * implementation can no longer satisfy the comparison. Under the same sabotage
 * 28 of the 29 tests now fail.
 *
 * If a SYNCED action ever regains an independent client implementation, this
 * file becomes a true equivalence suite again for that action, at no cost.
 *
 * ARCHITECTURE:
 * - gridReducer works on GridState (client-side state)
 * - applyMutation works on SessionState (server-side/shared state)
 * - We convert between them to compare results
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { gridReducer } from '../../src/state/grid';
import { applyMutation } from '../../src/shared/state-mutations';
import { gridStateToSessionState } from '../../src/shared/state-adapters';
import { actionToMessage } from '../../src/sync/multiplayer';
import { SYNCED_ACTIONS } from '../../src/sync/sync-classification';
import type { GridState, GridAction } from '../../src/types';
import type { ClientMessageBase } from '../../src/shared/message-types';
import { MAX_STEPS } from '../../src/types';
import { DEFAULT_EFFECTS_STATE } from '../../src/audio/toneEffects';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a test GridState with some data.
 */
function createTestGridState(): GridState {
  return {
    tracks: [
      {
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false, ...Array(120).fill(false)],
        parameterLocks: [{ volume: 0.8 }, null, null, null, { pitch: 2 }, ...Array(123).fill(null)],
        volume: 0.9,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'track-2',
        name: 'Snare',
        sampleId: 'snare',
        steps: [false, false, false, false, true, false, false, false, ...Array(120).fill(false)],
        parameterLocks: Array(MAX_STEPS).fill(null),
        volume: 0.7,
        muted: false,
        soloed: false,
        transpose: 3,
        stepCount: 16,
      },
    ],
    tempo: 120,
    swing: 0,
    effects: DEFAULT_EFFECTS_STATE,
    scale: { root: 'C', scaleId: 'minor-pentatonic', locked: false },
    isPlaying: false,
    currentStep: -1,
  };
}

// ============================================================================
// Actions that use NON-STANDARD sync (documented exceptions)
// These are valid SYNCED_ACTIONS but don't go through actionToMessage()
// ============================================================================

const NON_STANDARD_SYNC_ACTIONS = new Set([
  'ADD_TRACK',             // Uses sendAddTrack() with full track data
  'DELETE_SELECTED_STEPS', // Uses selection state not in action
  'APPLY_TO_SELECTION',    // Uses selection state not in action
  'REORDER_TRACKS',        // Uses handleTrackReorder directly
  'SET_LOOP_REGION',       // Has actionToMessage but complex validation differs
  'SET_SESSION_NAME',      // Updates session metadata, which GridState does not contain
]);

// ============================================================================
/**
 * Assert the two paths agree AND that the mutation actually moved the state.
 *
 * The witness is what makes these tests capable of failing. Phase 3 made every
 * SYNCED action in gridReducer delegate to applyMutation via
 * delegateToApplyMutation, so both sides of the comparison now run the same
 * function: 27 of the 28 SYNCED actions have no independent client
 * implementation left (SET_SESSION_NAME is the only exception, and it has no
 * test here). Neutering applyMutation to `return state` broke both sides
 * identically and all 29 tests in this file still passed.
 *
 * Equality alone therefore proves nothing. Requiring the result to differ from
 * the input makes a no-op implementation fail, and keeps the real remaining
 * coverage — actionToMessage and the GridState/SessionState adapters, which
 * are genuinely independent of applyMutation.
 */
function expectEquivalentAndChanged(
  reducerAsSession: unknown,
  mutationResult: unknown,
  before: unknown,
): void {
  expect(reducerAsSession).toEqual(mutationResult);
  expect(
    mutationResult,
    'the mutation left the state untouched, so the equivalence above is f(x) === f(x)',
  ).not.toEqual(before);
}

// Equivalence Tests
// ============================================================================

describe('Reducer-Mutation Equivalence', () => {
  describe('SYNCED actions produce equivalent state changes', () => {
    /**
     * Test that gridReducer and applyMutation produce the same result
     * for each SYNCED action type.
     */

    it('TOGGLE_STEP: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'TOGGLE_STEP', trackId: 'track-1', step: 2 };

      // Apply via gridReducer
      const reducerResult = gridReducer(gridState, action);

      // Apply via applyMutation
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      // Compare results
      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('SET_TEMPO: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'SET_TEMPO', tempo: 140 };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('SET_SWING: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'SET_SWING', swing: 50 };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('SET_TRACK_VOLUME: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'SET_TRACK_VOLUME', trackId: 'track-1', volume: 0.5 };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('SET_TRACK_TRANSPOSE: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'SET_TRACK_TRANSPOSE', trackId: 'track-1', transpose: 5 };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('CLEAR_TRACK: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'CLEAR_TRACK', trackId: 'track-1' };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('DELETE_TRACK: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'DELETE_TRACK', trackId: 'track-1' };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('SET_PARAMETER_LOCK: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = {
        type: 'SET_PARAMETER_LOCK',
        trackId: 'track-1',
        step: 3,
        lock: { volume: 0.3, pitch: -2 },
      };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    // Pattern operations
    it('ROTATE_PATTERN: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'ROTATE_PATTERN', trackId: 'track-1', direction: 'left' };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('INVERT_PATTERN: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'INVERT_PATTERN', trackId: 'track-1' };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('REVERSE_PATTERN: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'REVERSE_PATTERN', trackId: 'track-1' };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('MIRROR_PATTERN: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      // Pre-compute direction so both use the same value
      const action: GridAction = { type: 'MIRROR_PATTERN', trackId: 'track-1', direction: 'left-to-right' };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('EUCLIDEAN_FILL: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'EUCLIDEAN_FILL', trackId: 'track-1', hits: 5 };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('SET_TRACK_NAME: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'SET_TRACK_NAME', trackId: 'track-1', name: 'Bass Drum' };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('COPY_SEQUENCE: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'COPY_SEQUENCE', fromTrackId: 'track-1', toTrackId: 'track-2' };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it('MOVE_SEQUENCE: gridReducer and applyMutation are equivalent', () => {
      const gridState = createTestGridState();
      const action: GridAction = { type: 'MOVE_SEQUENCE', fromTrackId: 'track-1', toTrackId: 'track-2' };

      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

      const reducerAsSession = gridStateToSessionState(reducerResult);
      expectEquivalentAndChanged(reducerAsSession, mutationResult, sessionState);
    });

    it.each([
      { type: 'SET_TRACK_SAMPLE', trackId: 'track-1', sampleId: 'lead', name: 'Lead' },
      { type: 'SET_TRACK_STEP_COUNT', trackId: 'track-1', stepCount: 32 },
      { type: 'SET_TRACK_SWING', trackId: 'track-1', swing: 37 },
      {
        type: 'SET_EFFECTS',
        effects: { ...DEFAULT_EFFECTS_STATE, bypass: true },
      },
      {
        type: 'SET_SCALE',
        scale: { root: 'D', scaleId: 'major', locked: true },
      },
      {
        type: 'SET_FM_PARAMS',
        trackId: 'track-1',
        fmParams: { harmonicity: 2, modulationIndex: 5 },
      },
    ] satisfies GridAction[])('$type: gridReducer and applyMutation are equivalent', action => {
      const gridState = createTestGridState();
      const reducerResult = gridReducer(gridState, action);
      const message = actionToMessage(action);
      expect(message).not.toBeNull();

      const sessionState = gridStateToSessionState(gridState);
      const mutationResult = applyMutation(sessionState, message as ClientMessageBase);
      expectEquivalentAndChanged(gridStateToSessionState(reducerResult), mutationResult, sessionState);
    });
  });

  describe('Property-based equivalence tests', () => {
    // Arbitrary for tempo (30-300 BPM)
    const arbTempo = fc.integer({ min: 30, max: 300 });

    // Arbitrary for swing (0-100)
    const arbSwing = fc.integer({ min: 0, max: 100 });

    // Arbitrary for volume (0-1)
    const arbVolume = fc.double({ min: 0, max: 1, noNaN: true });

    // Arbitrary for transpose (-24 to 24 semitones)
    const arbTranspose = fc.integer({ min: -24, max: 24 });

    // Arbitrary for step index (0-15 for default 16 steps)
    const arbStep = fc.integer({ min: 0, max: 15 });

    it('PBT-EQ-001: SET_TEMPO equivalence holds for all valid tempos', () => {
      fc.assert(
        fc.property(arbTempo, (tempo) => {
          const gridState = createTestGridState();
          const action: GridAction = { type: 'SET_TEMPO', tempo };

          const reducerResult = gridReducer(gridState, action);
          const message = actionToMessage(action);
          expect(message).not.toBeNull();

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          expectEquivalentAndChanged(gridStateToSessionState(reducerResult), mutationResult, sessionState);
        }),
        { numRuns: 100 }
      );
    });

    it('PBT-EQ-002: SET_SWING equivalence holds for all valid swing values', () => {
      fc.assert(
        fc.property(arbSwing, (swing) => {
          const gridState = createTestGridState();
          // The fixture starts at swing 0, so that one draw is a no-op and the
          // change witness cannot hold for it. Skipping the identity keeps the
          // boundary in the arbitrary while leaving every executed run able to
          // detect a mutation that does nothing.
          fc.pre(swing !== gridState.swing);
          const action: GridAction = { type: 'SET_SWING', swing };

          const reducerResult = gridReducer(gridState, action);
          const message = actionToMessage(action);
          expect(message).not.toBeNull();

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          expectEquivalentAndChanged(gridStateToSessionState(reducerResult), mutationResult, sessionState);
        }),
        { numRuns: 100 }
      );
    });

    it('PBT-EQ-003: TOGGLE_STEP equivalence holds for all steps', () => {
      fc.assert(
        fc.property(arbStep, (step) => {
          const gridState = createTestGridState();
          const action: GridAction = { type: 'TOGGLE_STEP', trackId: 'track-1', step };

          const reducerResult = gridReducer(gridState, action);
          const message = actionToMessage(action);
          expect(message).not.toBeNull();

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          expectEquivalentAndChanged(gridStateToSessionState(reducerResult), mutationResult, sessionState);
        }),
        { numRuns: 100 }
      );
    });

    it('PBT-EQ-004: SET_TRACK_VOLUME equivalence holds for all volumes', () => {
      fc.assert(
        fc.property(arbVolume, (volume) => {
          const gridState = createTestGridState();
          const action: GridAction = { type: 'SET_TRACK_VOLUME', trackId: 'track-1', volume };

          const reducerResult = gridReducer(gridState, action);
          const message = actionToMessage(action);
          expect(message).not.toBeNull();

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          expectEquivalentAndChanged(gridStateToSessionState(reducerResult), mutationResult, sessionState);
        }),
        { numRuns: 100 }
      );
    });

    it('PBT-EQ-005: SET_TRACK_TRANSPOSE equivalence holds for all transpose values', () => {
      fc.assert(
        fc.property(arbTranspose, (transpose) => {
          const gridState = createTestGridState();
          // track-1 starts at transpose 0 — same identity-draw reasoning as
          // PBT-EQ-002 above.
          fc.pre(transpose !== gridState.tracks[0].transpose);
          const action: GridAction = { type: 'SET_TRACK_TRANSPOSE', trackId: 'track-1', transpose };

          const reducerResult = gridReducer(gridState, action);
          const message = actionToMessage(action);
          expect(message).not.toBeNull();

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          expectEquivalentAndChanged(gridStateToSessionState(reducerResult), mutationResult, sessionState);
        }),
        { numRuns: 100 }
      );
    });

    it('PBT-EQ-006: EUCLIDEAN_FILL equivalence holds for all hit counts', () => {
      const arbHits = fc.integer({ min: 0, max: 16 });

      fc.assert(
        fc.property(arbHits, (hits) => {
          const gridState = createTestGridState();
          const action: GridAction = { type: 'EUCLIDEAN_FILL', trackId: 'track-1', hits };

          const reducerResult = gridReducer(gridState, action);
          const message = actionToMessage(action);
          expect(message).not.toBeNull();

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          expectEquivalentAndChanged(gridStateToSessionState(reducerResult), mutationResult, sessionState);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Coverage check', () => {
    it('reports which SYNCED_ACTIONS have equivalence tests', () => {
      const testedActions = new Set([
        'TOGGLE_STEP',
        'SET_TEMPO',
        'SET_SWING',
        'SET_TRACK_VOLUME',
        'SET_TRACK_TRANSPOSE',
        'SET_TRACK_SAMPLE',
        'SET_TRACK_STEP_COUNT',
        'SET_TRACK_SWING',
        'SET_EFFECTS',
        'SET_SCALE',
        'SET_FM_PARAMS',
        'CLEAR_TRACK',
        'DELETE_TRACK',
        'SET_PARAMETER_LOCK',
        'ROTATE_PATTERN',
        'INVERT_PATTERN',
        'REVERSE_PATTERN',
        'MIRROR_PATTERN',
        'EUCLIDEAN_FILL',
        'SET_TRACK_NAME',
        'COPY_SEQUENCE',
        'MOVE_SEQUENCE',
      ]);

      const untestedActions = [...SYNCED_ACTIONS].filter(
        a => !testedActions.has(a) && !NON_STANDARD_SYNC_ACTIONS.has(a)
      );

      expect(untestedActions).toEqual([]);
    });
  });
});
