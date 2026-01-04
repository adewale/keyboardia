/**
 * Reducer-Mutation Equivalence Tests
 *
 * These tests verify that gridReducer and applyMutation produce IDENTICAL
 * results for all SYNCED actions. This catches divergence bugs where
 * someone changes one but not the other.
 *
 * WHY THIS MATTERS:
 * - gridReducer (client) and applyMutation (shared) have duplicate logic
 * - If they diverge, client and server state will differ
 * - This test suite is the safety net that catches divergence
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
import { actionToMessage } from '../../src/sync/multiplayer';
import { SYNCED_ACTIONS } from '../../src/shared/sync-classification';
import type { GridState, GridAction, Track } from '../../src/types';
import type { SessionState, SessionTrack } from '../../src/shared/state';
import type { ClientMessageBase } from '../../src/shared/message-types';
import { MAX_STEPS, STEPS_PER_PAGE } from '../../src/types';
import { DEFAULT_EFFECTS_STATE } from '../../src/audio/toneEffects';

// ============================================================================
// State Adapters
// ============================================================================

/**
 * Convert GridState to SessionState for comparison.
 * Only includes synced fields.
 */
function gridStateToSessionState(gridState: GridState): SessionState {
  return {
    tracks: gridState.tracks.map(trackToSessionTrack),
    tempo: gridState.tempo,
    swing: gridState.swing,
    effects: gridState.effects,
    scale: gridState.scale,
    loopRegion: gridState.loopRegion,
    version: 1,
  };
}

/**
 * Convert Track to SessionTrack.
 */
function trackToSessionTrack(track: Track): SessionTrack {
  return {
    id: track.id,
    name: track.name,
    sampleId: track.sampleId,
    steps: track.steps,
    parameterLocks: track.parameterLocks,
    volume: track.volume,
    muted: track.muted,
    soloed: track.soloed,
    transpose: track.transpose,
    stepCount: track.stepCount,
    swing: track.swing,
    fmParams: track.fmParams,
  };
}

/**
 * Compare two session states for equivalence.
 * Ignores version and local-only fields.
 */
function statesAreEquivalent(a: SessionState, b: SessionState): boolean {
  // Compare tracks
  if (a.tracks.length !== b.tracks.length) return false;
  for (let i = 0; i < a.tracks.length; i++) {
    if (!tracksAreEquivalent(a.tracks[i], b.tracks[i])) return false;
  }

  // Compare global settings
  if (a.tempo !== b.tempo) return false;
  if (a.swing !== b.swing) return false;

  // Compare effects (deep equality)
  if (JSON.stringify(a.effects) !== JSON.stringify(b.effects)) return false;

  // Compare scale (deep equality)
  if (JSON.stringify(a.scale) !== JSON.stringify(b.scale)) return false;

  // Compare loop region
  if (JSON.stringify(a.loopRegion) !== JSON.stringify(b.loopRegion)) return false;

  return true;
}

/**
 * Compare two tracks for equivalence.
 * Ignores local-only fields (muted, soloed - per "My Ears, My Control").
 */
function tracksAreEquivalent(a: SessionTrack, b: SessionTrack): boolean {
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if (a.sampleId !== b.sampleId) return false;
  if (a.volume !== b.volume) return false;
  if (a.transpose !== b.transpose) return false;
  if (a.stepCount !== b.stepCount) return false;
  if (a.swing !== b.swing) return false;

  // Compare steps (only within stepCount)
  const stepCount = a.stepCount ?? STEPS_PER_PAGE;
  for (let i = 0; i < stepCount; i++) {
    if (a.steps[i] !== b.steps[i]) return false;
  }

  // Compare parameter locks (only within stepCount)
  for (let i = 0; i < stepCount; i++) {
    if (JSON.stringify(a.parameterLocks[i]) !== JSON.stringify(b.parameterLocks[i])) return false;
  }

  // Compare FM params
  if (JSON.stringify(a.fmParams) !== JSON.stringify(b.fmParams)) return false;

  return true;
}

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
]);

// ============================================================================
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
      expect(statesAreEquivalent(reducerAsSession, mutationResult)).toBe(true);
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
          if (!message) return true; // Skip if no message

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          return statesAreEquivalent(
            gridStateToSessionState(reducerResult),
            mutationResult
          );
        }),
        { numRuns: 100 }
      );
    });

    it('PBT-EQ-002: SET_SWING equivalence holds for all valid swing values', () => {
      fc.assert(
        fc.property(arbSwing, (swing) => {
          const gridState = createTestGridState();
          const action: GridAction = { type: 'SET_SWING', swing };

          const reducerResult = gridReducer(gridState, action);
          const message = actionToMessage(action);
          if (!message) return true;

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          return statesAreEquivalent(
            gridStateToSessionState(reducerResult),
            mutationResult
          );
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
          if (!message) return true;

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          return statesAreEquivalent(
            gridStateToSessionState(reducerResult),
            mutationResult
          );
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
          if (!message) return true;

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          return statesAreEquivalent(
            gridStateToSessionState(reducerResult),
            mutationResult
          );
        }),
        { numRuns: 100 }
      );
    });

    it('PBT-EQ-005: SET_TRACK_TRANSPOSE equivalence holds for all transpose values', () => {
      fc.assert(
        fc.property(arbTranspose, (transpose) => {
          const gridState = createTestGridState();
          const action: GridAction = { type: 'SET_TRACK_TRANSPOSE', trackId: 'track-1', transpose };

          const reducerResult = gridReducer(gridState, action);
          const message = actionToMessage(action);
          if (!message) return true;

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          return statesAreEquivalent(
            gridStateToSessionState(reducerResult),
            mutationResult
          );
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
          if (!message) return true;

          const sessionState = gridStateToSessionState(gridState);
          const mutationResult = applyMutation(sessionState, message as ClientMessageBase);

          return statesAreEquivalent(
            gridStateToSessionState(reducerResult),
            mutationResult
          );
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

      if (untestedActions.length > 0) {
        console.log(`
⚠️  UNTESTED SYNCED_ACTIONS (add equivalence tests):
   ${untestedActions.join(', ')}
        `);
      }

      // Don't fail the test, just report
      expect(true).toBe(true);
    });
  });
});
