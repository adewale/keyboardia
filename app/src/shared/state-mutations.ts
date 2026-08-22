/**
 * Pure State Mutation Functions
 *
 * This module provides pure functions for applying mutations to SessionState.
 * Used by the client adapter, MCP editing, and sync-invariant tests.
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
import { isValidPan } from './validation';
import { setTrackInstrument } from './track-instrument';
import { clampTrackEnvelope, TRACK_GATE_RANGE } from './envelope';
import {
  convertTrackEnvelopeUnitsWithReportV2,
  repairTrackEnvelopeV2,
} from './envelope-contract-v2';
import { applyEnvelopeLockDurationV2 } from './envelope-lock-v2';
// Import runtime-neutral pattern operations (Phase 32: Sync fix)
import {
  rotateLeft,
  rotateRight,
  invertPattern,
  reversePattern,
  mirrorPattern,
  applyEuclidean,
} from './pattern-operations';

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
    pan: 0,
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

    case 'set_track_instrument': {
      // Change instrument (issue #63). The shared operation validates the
      // instrument and owns the engine-state policy, so the browser reducer,
      // the Durable Object, and MCP cannot drift apart. A rejected request
      // returns the caller's own state, so this is a safe no-op.
      return setTrackInstrument(state, message).state;
    }

    case 'set_track_sample': {
      // Legacy wire alias. The caller-supplied name exists only so a new client
      // can talk safely to an older server; current code must never trust it or
      // bypass catalog validation / engine-state cleanup.
      return setTrackInstrument(state, message).state;
    }

    case 'set_track_volume': {
      return updateTrackField(state, message.trackId, 'volume', clamp(message.volume, MIN_VOLUME, MAX_VOLUME));
    }

    case 'set_track_pan': {
      // Public transports reject invalid pan. The pure mutation mirrors that
      // policy by refusing to coerce an out-of-range value into a hard side.
      return isValidPan(message.pan)
        ? updateTrackField(state, message.trackId, 'pan', message.pan)
        : state;
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

    case 'set_track_envelope': {
      return updateTrackById(state, message.trackId, track => {
        if (message.envelope === null) {
          const next = { ...track };
          delete next.envelope;
          return next;
        }
        return { ...track, envelope: clampTrackEnvelope(message.envelope) };
      });
    }

    case 'set_track_envelope_time_unit': {
      return updateTrackField(state, message.trackId, 'envelopeTimeUnit', message.unit);
    }

    case 'set_track_gate': {
      return updateTrackField(
        state,
        message.trackId,
        'gate',
        clamp(message.gate, TRACK_GATE_RANGE.min, TRACK_GATE_RANGE.max),
      );
    }

    case 'set_track_envelope_v2': {
      return updateTrackById(state, message.trackId, track => {
        if (message.envelope === null) {
          const next = { ...track };
          delete next.envelopeV2;
          return next;
        }
        const envelopeV2 = repairTrackEnvelopeV2(message.envelope);
        return envelopeV2 ? { ...track, envelopeV2 } : track;
      });
    }

    case 'convert_track_envelope_units_v2': {
      return updateTrackById(state, message.trackId, track => track.envelopeV2
        ? {
            ...track,
            envelopeV2: convertTrackEnvelopeUnitsWithReportV2(
              track.envelopeV2,
              message.targetUnit,
              state.tempo,
            ).envelope,
          }
        : track);
    }

    case 'set_track_sample_playback_mode_v2': {
      return updateTrackById(state, message.trackId, track => {
        if (message.mode === null) {
          const next = { ...track };
          delete next.samplePlaybackMode;
          return next;
        }
        return { ...track, samplePlaybackMode: message.mode };
      });
    }

    case 'set_track_gate_v2': {
      return updateTrackField(
        state,
        message.trackId,
        'gate',
        clamp(message.gate, TRACK_GATE_RANGE.min, TRACK_GATE_RANGE.max),
      );
    }

    case 'set_envelope_lock_v2': {
      return updateTrackById(state, message.trackId, track => {
        if (message.step < 0 || message.step >= track.parameterLocks.length) return track;
        const parameterLocks = [...track.parameterLocks];
        parameterLocks[message.step] = applyEnvelopeLockDurationV2(
          parameterLocks[message.step],
          message.stage,
          message.duration,
        );
        return { ...track, parameterLocks };
      });
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
      const { trackId, toIndex } = message;
      // Find the track by ID
      const fromIndex = state.tracks.findIndex(t => t.id === trackId);
      // Validate: track must exist and toIndex must be valid
      if (
        fromIndex === -1 ||
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
