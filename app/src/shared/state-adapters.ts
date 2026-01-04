/**
 * State Adapters
 *
 * Converts between GridState (client) and SessionState (server/shared).
 * Used for refactoring gridReducer to delegate SYNCED actions to applyMutation.
 *
 * Phase 3 of SHARED-MUTATION-REFACTORING-PLAN.md
 *
 * ARCHITECTURE:
 * - GridState has LOCAL-ONLY fields: isPlaying, currentStep, selection
 * - Track has LOCAL-ONLY fields: muted, soloed (My Ears, My Control philosophy)
 * - SessionState has SERVER-ONLY field: version
 *
 * The adapters preserve local-only state during mutation application.
 *
 * DELEGATION PATTERN:
 * For SYNCED actions with direct message mappings, gridReducer can delegate
 * to applyMutation using:
 *   1. gridStateToSessionState() - convert client state to session state
 *   2. applyMutation() - apply the mutation
 *   3. applySessionToGridState() - merge result back, preserving local-only state
 *
 * Some SYNCED actions cannot be delegated because:
 *   - actionToMessage returns null (ADD_TRACK creates track ID client-side)
 *   - They need selection context (DELETE_SELECTED_STEPS, APPLY_TO_SELECTION)
 *   - They have client-side extras (XSS sanitization in SET_TRACK_NAME)
 * These are marked clearly in gridReducer with comments.
 */

import type { GridState, Track, SelectionState, LoopRegion } from '../types';
import type { SessionState, SessionTrack } from './state';
import type { ClientMessageBase } from './message-types';
import { DEFAULT_STEP_COUNT } from './constants';
import { applyMutation } from './state-mutations';

/**
 * Convert GridState to SessionState for mutation application.
 * Strips local-only fields (isPlaying, currentStep, selection).
 */
export function gridStateToSessionState(gridState: GridState): SessionState {
  return {
    tracks: gridState.tracks.map(trackToSessionTrack),
    tempo: gridState.tempo,
    swing: gridState.swing,
    effects: gridState.effects,
    scale: gridState.scale,
    loopRegion: gridState.loopRegion ?? undefined,
    version: 1, // Version is server-managed, use placeholder
  };
}

/**
 * Convert Track to SessionTrack.
 * All fields are compatible; SessionTrack has optional fields that Track requires.
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
    fmParams: track.fmParams,
    swing: track.swing,
  };
}

/**
 * Apply SessionState changes back to GridState, preserving local-only fields.
 *
 * @param originalState - The original GridState before mutation
 * @param mutatedSession - The SessionState after applyMutation
 * @returns New GridState with session changes applied and local-only fields preserved
 */
export function applySessionToGridState(
  originalState: GridState,
  mutatedSession: SessionState
): GridState {
  // Build map of original tracks for preserving local-only fields
  const originalTrackMap = new Map(originalState.tracks.map(t => [t.id, t]));

  // Convert mutated session tracks back to Grid tracks
  const tracks: Track[] = mutatedSession.tracks.map(sessionTrack => {
    const originalTrack = originalTrackMap.get(sessionTrack.id);

    return {
      id: sessionTrack.id,
      name: sessionTrack.name,
      sampleId: sessionTrack.sampleId,
      steps: sessionTrack.steps,
      parameterLocks: sessionTrack.parameterLocks,
      volume: sessionTrack.volume,
      // LOCAL-ONLY: Preserve muted/soloed from original (My Ears, My Control)
      // For new tracks, use session value or default to false
      muted: originalTrack ? originalTrack.muted : (sessionTrack.muted ?? false),
      soloed: originalTrack ? originalTrack.soloed : (sessionTrack.soloed ?? false),
      transpose: sessionTrack.transpose,
      stepCount: sessionTrack.stepCount ?? DEFAULT_STEP_COUNT,
      fmParams: sessionTrack.fmParams,
      swing: sessionTrack.swing,
    };
  });

  return {
    tracks,
    tempo: mutatedSession.tempo,
    swing: mutatedSession.swing,
    effects: mutatedSession.effects ?? originalState.effects,
    scale: mutatedSession.scale ?? originalState.scale,
    // Preserve undefined vs null distinction for loopRegion
    loopRegion: mutatedSession.loopRegion === undefined
      ? originalState.loopRegion
      : (mutatedSession.loopRegion ?? null),
    // LOCAL-ONLY: Preserve playback state
    isPlaying: originalState.isPlaying,
    currentStep: originalState.currentStep,
    // LOCAL-ONLY: Preserve selection
    selection: originalState.selection,
  };
}

/**
 * Check if selection should be cleared after a pattern operation.
 * Pattern operations (rotate, invert, reverse, mirror, euclidean) change
 * what indices point to, so selection becomes invalid.
 *
 * @param selection - Current selection state
 * @param affectedTrackId - Track ID that was modified
 * @returns null if selection should be cleared, original selection otherwise
 */
export function maybeInvalidateSelection(
  selection: SelectionState | null | undefined,
  affectedTrackId: string
): SelectionState | null {
  if (!selection) return null;
  if (selection.trackId === affectedTrackId) return null;
  return selection;
}

/**
 * Apply a mutation to GridState by delegating to applyMutation.
 *
 * This is the core delegation helper that:
 * 1. Converts GridState to SessionState
 * 2. Applies the mutation via applyMutation
 * 3. Converts back to GridState, preserving local-only fields
 *
 * @param state - Current GridState
 * @param message - The mutation message to apply
 * @returns New GridState with mutation applied
 */
export function delegateToApplyMutation(
  state: GridState,
  message: ClientMessageBase
): GridState {
  const sessionState = gridStateToSessionState(state);
  const mutatedSession = applyMutation(sessionState, message);
  return applySessionToGridState(state, mutatedSession);
}
