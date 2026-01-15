/**
 * Pure State Mutation Functions
 *
 * This module provides pure functions for applying mutations to SessionState.
 * Used for property-based testing of sync invariants (Phase 32).
 *
 * IMPORTANT: These functions must be kept in sync with gridReducer (state/grid.tsx)
 * and the server handlers (worker/live-session.ts). Any divergence will cause
 * sync bugs that are hard to debug.
 *
 * Design decisions:
 * - Pure functions with no side effects
 * - SessionState in, SessionState out
 * - Bounds checking and clamping match production code
 * - Local-only fields (muted, soloed) are handled but excluded from sync comparison
 */

import type { SessionState, SessionTrack } from './state';
import type { ClientMessageBase } from './message-types';
import type { ParameterLock } from './sync-types';
import {
  MAX_TRACKS,
  MAX_STEPS,
  DEFAULT_STEP_COUNT,
  MIN_TEMPO,
  MAX_TEMPO,
  MIN_SWING,
  MAX_SWING,
  MIN_VOLUME,
  MAX_VOLUME,
  MIN_TRANSPOSE,
  MAX_TRANSPOSE,
  clamp,
} from './constants';
import { MAX_TRACK_NAME_LENGTH } from './validation';
// Import pattern operation utilities (Phase 32: Sync fix)
import {
  rotateLeft,
  rotateRight,
  invertPattern,
  reversePattern,
  mirrorPattern,
  applyEuclidean,
} from '../utils/patternOps';

/**
 * Create an empty initial state for testing.
 */
export function createInitialState(): SessionState {
  return {
    tracks: [],
    tempo: 120,
    swing: 0,
    version: 1,
  };
}

/**
 * Create a default track with the given ID and sample.
 */
export function createDefaultTrack(
  id: string,
  sampleId: string,
  name: string
): SessionTrack {
  return {
    id,
    name,
    sampleId,
    steps: Array(MAX_STEPS).fill(false),
    parameterLocks: Array(MAX_STEPS).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: DEFAULT_STEP_COUNT,
  };
}

// ============================================================================
// State Mutation Helpers (TASK-004 from DUPLICATION-REMEDIATION-PLAN.md)
// ============================================================================

/**
 * Update a track by ID with an updater function.
 * Returns a new state with the updated tracks array.
 *
 * @param state Current session state
 * @param trackId ID of track to update
 * @param updater Function that receives the track and returns updated track
 * @returns New state with updated track
 */
export function updateTrackById<S extends { tracks: SessionTrack[] }>(
  state: S,
  trackId: string,
  updater: (track: SessionTrack) => SessionTrack
): S {
  return {
    ...state,
    tracks: state.tracks.map(track =>
      track.id === trackId ? updater(track) : track
    ),
  };
}

/**
 * Update a single field on a track by ID.
 * Simpler helper for common single-field updates.
 *
 * @param state Current session state
 * @param trackId ID of track to update
 * @param field Field name to update
 * @param value New value for the field
 * @returns New state with updated track
 */
export function updateTrackField<
  S extends { tracks: SessionTrack[] },
  K extends keyof SessionTrack
>(
  state: S,
  trackId: string,
  field: K,
  value: SessionTrack[K]
): S {
  return updateTrackById(state, trackId, track => ({
    ...track,
    [field]: value,
  }));
}

// ============================================================================
// Main Mutation Function
// ============================================================================

/**
 * Apply a client message mutation to session state.
 * Returns a new state object (immutable).
 *
 * NOTE: This only handles state-mutating messages.
 * Non-mutating messages (play, stop, state_hash, etc.) are ignored.
 */
export function applyMutation(
  state: SessionState,
  message: ClientMessageBase
): SessionState {
  switch (message.type) {
    case 'toggle_step': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        const steps = [...track.steps];
        if (message.step >= 0 && message.step < steps.length) {
          steps[message.step] = !steps[message.step];
        }
        return { ...track, steps };
      });
      return { ...state, tracks };
    }

    case 'set_tempo': {
      return { ...state, tempo: clamp(message.tempo, MIN_TEMPO, MAX_TEMPO) };
    }

    case 'set_swing': {
      return { ...state, swing: clamp(message.swing, MIN_SWING, MAX_SWING) };
    }

    case 'mute_track': {
      // Local-only mutation (My Ears, My Control)
      return updateTrackField(state, message.trackId, 'muted', message.muted);
    }

    case 'solo_track': {
      // Local-only mutation (My Ears, My Control)
      return updateTrackField(state, message.trackId, 'soloed', message.soloed);
    }

    case 'set_parameter_lock': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        if (message.step < 0 || message.step >= track.parameterLocks.length) return track;
        const parameterLocks = [...track.parameterLocks];
        parameterLocks[message.step] = message.lock;
        return { ...track, parameterLocks };
      });
      return { ...state, tracks };
    }

    case 'add_track': {
      if (state.tracks.length >= MAX_TRACKS) return state;
      // Prevent duplicate tracks
      if (state.tracks.some((t) => t.id === message.track.id)) return state;
      // Normalize track to ensure required fields
      const newTrack: SessionTrack = {
        ...message.track,
        steps: message.track.steps.length >= MAX_STEPS
          ? message.track.steps
          : [...message.track.steps, ...Array(MAX_STEPS - message.track.steps.length).fill(false)],
        parameterLocks: message.track.parameterLocks.length >= MAX_STEPS
          ? message.track.parameterLocks
          : [...message.track.parameterLocks, ...Array(MAX_STEPS - message.track.parameterLocks.length).fill(null)],
        stepCount: message.track.stepCount ?? DEFAULT_STEP_COUNT,
        soloed: message.track.soloed ?? false,
      };
      return { ...state, tracks: [...state.tracks, newTrack] };
    }

    case 'delete_track': {
      const tracks = state.tracks.filter((track) => track.id !== message.trackId);
      return { ...state, tracks };
    }

    case 'clear_track': {
      return updateTrackById(state, message.trackId, track => ({
        ...track,
        steps: Array(MAX_STEPS).fill(false),
        parameterLocks: Array(MAX_STEPS).fill(null),
      }));
    }

    case 'set_track_sample': {
      return updateTrackById(state, message.trackId, track => ({
        ...track,
        sampleId: message.sampleId,
        name: message.name,
      }));
    }

    case 'set_track_volume': {
      return updateTrackField(state, message.trackId, 'volume', clamp(message.volume, MIN_VOLUME, MAX_VOLUME));
    }

    case 'set_track_transpose': {
      return updateTrackField(state, message.trackId, 'transpose', clamp(message.transpose, MIN_TRANSPOSE, MAX_TRANSPOSE));
    }

    case 'set_track_step_count': {
      return updateTrackField(state, message.trackId, 'stepCount', clamp(message.stepCount, 1, MAX_STEPS));
    }

    case 'set_track_swing': {
      return updateTrackField(state, message.trackId, 'swing', clamp(message.swing, MIN_SWING, MAX_SWING));
    }

    case 'set_effects': {
      return { ...state, effects: message.effects };
    }

    case 'set_scale': {
      return { ...state, scale: message.scale };
    }

    case 'set_fm_params': {
      return updateTrackById(state, message.trackId, track => ({
        ...track,
        fmParams: {
          harmonicity: clamp(message.fmParams.harmonicity, 0.5, 10),
          modulationIndex: clamp(message.fmParams.modulationIndex, 0, 20),
        },
      }));
    }

    case 'copy_sequence': {
      const fromTrack = state.tracks.find((t) => t.id === message.fromTrackId);
      if (!fromTrack) return state;
      return updateTrackById(state, message.toTrackId, track => ({
        ...track,
        steps: [...fromTrack.steps],
        parameterLocks: [...fromTrack.parameterLocks],
        stepCount: fromTrack.stepCount,
      }));
    }

    case 'move_sequence': {
      const fromTrack = state.tracks.find((t) => t.id === message.fromTrackId);
      if (!fromTrack) return state;
      const tracks = state.tracks.map((track) => {
        if (track.id === message.fromTrackId) {
          return {
            ...track,
            steps: Array(MAX_STEPS).fill(false),
            parameterLocks: Array(MAX_STEPS).fill(null),
          };
        }
        if (track.id === message.toTrackId) {
          return {
            ...track,
            steps: [...fromTrack.steps],
            parameterLocks: [...fromTrack.parameterLocks],
            stepCount: fromTrack.stepCount,
          };
        }
        return track;
      });
      return { ...state, tracks };
    }

    case 'set_loop_region': {
      const region = message.region;
      if (region === null) {
        return { ...state, loopRegion: null };
      }
      // Validate and normalize loop region
      const longestTrack = Math.max(
        ...state.tracks.map(t => t.stepCount ?? DEFAULT_STEP_COUNT),
        DEFAULT_STEP_COUNT
      );
      let { start, end } = region;
      // Swap if start > end
      if (start > end) {
        [start, end] = [end, start];
      }
      // Clamp to valid range
      start = Math.max(0, Math.min(start, longestTrack - 1));
      end = Math.max(0, Math.min(end, longestTrack - 1));
      return { ...state, loopRegion: { start, end } };
    }

    case 'reorder_tracks': {
      const { fromIndex, toIndex } = message;
      if (
        fromIndex < 0 ||
        fromIndex >= state.tracks.length ||
        toIndex < 0 ||
        toIndex >= state.tracks.length ||
        fromIndex === toIndex
      ) {
        return state;
      }
      const tracks = [...state.tracks];
      const [moved] = tracks.splice(fromIndex, 1);
      tracks.splice(toIndex, 0, moved);
      return { ...state, tracks };
    }

    case 'batch_clear_steps': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        const steps = [...track.steps];
        const parameterLocks = [...track.parameterLocks];
        for (const step of message.steps) {
          if (step >= 0 && step < steps.length) {
            steps[step] = false;
            parameterLocks[step] = null;
          }
        }
        return { ...track, steps, parameterLocks };
      });
      return { ...state, tracks };
    }

    case 'batch_set_parameter_locks': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        const parameterLocks = [...track.parameterLocks];
        for (const { step, lock } of message.locks) {
          if (step >= 0 && step < parameterLocks.length) {
            parameterLocks[step] = lock;
          }
        }
        return { ...track, parameterLocks };
      });
      return { ...state, tracks };
    }

    // Phase 32: Pattern operations (sync fix)
    case 'rotate_pattern': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
        const rotate = message.direction === 'left' ? rotateLeft : rotateRight;
        return {
          ...track,
          steps: rotate(track.steps, stepCount),
          parameterLocks: rotate(track.parameterLocks, stepCount),
        };
      });
      return { ...state, tracks };
    }

    case 'invert_pattern': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
        const newSteps = invertPattern(track.steps, stepCount);
        // Clear p-locks on steps that become inactive
        const newLocks = track.parameterLocks.map((lock, i) => {
          if (i < stepCount && track.steps[i] && !newSteps[i]) {
            return null;
          }
          return lock;
        });
        return { ...track, steps: newSteps, parameterLocks: newLocks };
      });
      return { ...state, tracks };
    }

    case 'reverse_pattern': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
        return {
          ...track,
          steps: reversePattern(track.steps, stepCount),
          parameterLocks: reversePattern(track.parameterLocks, stepCount),
        };
      });
      return { ...state, tracks };
    }

    case 'mirror_pattern': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
        // Use provided direction (smart detection happens client-side)
        const direction = message.direction;
        return {
          ...track,
          steps: mirrorPattern(track.steps, stepCount, direction),
          parameterLocks: mirrorPattern(track.parameterLocks, stepCount, direction),
        };
      });
      return { ...state, tracks };
    }

    case 'euclidean_fill': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
        const { steps, locks } = applyEuclidean(
          track.steps,
          track.parameterLocks,
          stepCount,
          message.hits
        );
        return { ...track, steps, parameterLocks: locks };
      });
      return { ...state, tracks };
    }

    case 'set_track_name': {
      const tracks = state.tracks.map((track) => {
        if (track.id !== message.trackId) return track;
        // Sanitize name: trim, limit length
        const sanitizedName = message.name.trim().slice(0, MAX_TRACK_NAME_LENGTH);
        if (!sanitizedName) return track; // Don't allow empty names
        return { ...track, name: sanitizedName };
      });
      return { ...state, tracks };
    }

    // Non-mutating messages - return state unchanged
    case 'play':
    case 'stop':
    case 'state_hash':
    case 'request_snapshot':
    case 'clock_sync_request':
    case 'cursor_move':
    case 'set_session_name': // Only affects metadata, not session state
      return state;

    default:
      // Unknown message type - return unchanged
      return state;
  }
}

/**
 * Compare two states for canonical equality.
 * Excludes local-only fields (muted, soloed) from comparison.
 */
export function canonicalEqual(a: SessionState, b: SessionState): boolean {
  // Compare global fields
  if (a.tempo !== b.tempo) return false;
  if (a.swing !== b.swing) return false;
  if (a.tracks.length !== b.tracks.length) return false;

  // Compare loop regions
  if (a.loopRegion?.start !== b.loopRegion?.start) return false;
  if (a.loopRegion?.end !== b.loopRegion?.end) return false;

  // Compare tracks (excluding local-only fields)
  for (let i = 0; i < a.tracks.length; i++) {
    const ta = a.tracks[i];
    const tb = b.tracks[i];

    if (ta.id !== tb.id) return false;
    if (ta.name !== tb.name) return false;
    if (ta.sampleId !== tb.sampleId) return false;
    if (ta.volume !== tb.volume) return false;
    if (ta.transpose !== tb.transpose) return false;
    if ((ta.stepCount ?? DEFAULT_STEP_COUNT) !== (tb.stepCount ?? DEFAULT_STEP_COUNT)) return false;
    if ((ta.swing ?? 0) !== (tb.swing ?? 0)) return false;

    // Compare steps
    const stepCount = ta.stepCount ?? DEFAULT_STEP_COUNT;
    for (let j = 0; j < stepCount; j++) {
      if (ta.steps[j] !== tb.steps[j]) return false;
    }

    // Compare parameter locks (shallow comparison for now)
    for (let j = 0; j < stepCount; j++) {
      const la = ta.parameterLocks[j];
      const lb = tb.parameterLocks[j];
      if (la === null && lb === null) continue;
      if (la === null || lb === null) return false;
      if ((la as ParameterLock).pitch !== (lb as ParameterLock).pitch) return false;
      if ((la as ParameterLock).volume !== (lb as ParameterLock).volume) return false;
      if ((la as ParameterLock).tie !== (lb as ParameterLock).tie) return false;
    }

    // Skip muted and soloed - they are local-only
  }

  return true;
}

/**
 * Check if two mutations are independent (can be reordered safely).
 * Returns true if the mutations operate on different tracks or different aspects.
 */
export function areMutationsIndependent(
  m1: ClientMessageBase,
  m2: ClientMessageBase
): boolean {
  const globalTypes = ['set_tempo', 'set_swing', 'set_effects', 'set_scale', 'set_loop_region'];
  const isGlobal1 = globalTypes.includes(m1.type);
  const isGlobal2 = globalTypes.includes(m2.type);

  // Both global: independent if different types
  if (isGlobal1 && isGlobal2) {
    return m1.type !== m2.type;
  }

  // One global, one track-specific: they're independent
  // (Global mutations don't affect track state and vice versa)
  if (isGlobal1 !== isGlobal2) {
    return true;
  }

  // Both are track-specific - check if on different tracks
  const getTrackIds = (m: ClientMessageBase): string[] => {
    if ('trackId' in m) return [m.trackId as string];
    if (m.type === 'add_track') return [m.track.id];
    if (m.type === 'copy_sequence' || m.type === 'move_sequence') {
      return [m.fromTrackId, m.toTrackId];
    }
    if (m.type === 'reorder_tracks') {
      return []; // Affects all tracks, can't be independent
    }
    return [];
  };

  const ids1 = getTrackIds(m1);
  const ids2 = getTrackIds(m2);

  // If either operates on "all tracks" (empty array for reorder), not independent
  if (ids1.length === 0 || ids2.length === 0) {
    return false;
  }

  // Independent if no overlap in track IDs
  return !ids1.some((id) => ids2.includes(id));
}
