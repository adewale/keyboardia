/**
 * Change Instrument — the shared domain operation
 *
 * One validated, transport-neutral implementation of "replace this track's
 * sound source". The browser reducer, the Durable Object's WebSocket handler,
 * and the stateless MCP `edit_session` endpoint all call this function; none of
 * them re-derives the catalog, the validation, or the engine-state policy.
 *
 * See specs/CHANGE-INSTRUMENT.md.
 *
 * Design decisions:
 * - Pure. State in, state out. No throwing: callers get a discriminated result
 *   so an HTTP surface can shape an error and a WebSocket surface can drop the
 *   message, without either duplicating the checks.
 * - A rejected edit returns the ORIGINAL state reference. A caller that assigns
 *   the result unconditionally therefore cannot half-apply or clobber
 *   concurrent edits.
 * - An unchanged instrument returns `changed: false` with the original state
 *   reference, which is what makes the operation retry-safe for agents and
 *   silent for the broadcast path.
 * - The result is a function of `(track, sampleId)` alone. That is what lets the
 *   granular broadcast carry only `{ trackId, sampleId }` and still converge:
 *   every peer recomputes the same track.
 */

import { VALID_SAMPLE_IDS } from './instrument-catalog';
import type { SessionState, SessionTrack } from './state';

/** Why a change-instrument request was refused. */
export type SetTrackInstrumentErrorCode = 'INVALID_SAMPLE_ID' | 'TRACK_NOT_FOUND';

export interface SetTrackInstrumentError {
  code: SetTrackInstrumentErrorCode;
  message: string;
}

export type SetTrackInstrumentResult =
  | {
      ok: true;
      /** False when the track already plays this instrument. */
      changed: boolean;
      /** The original reference when `changed` is false. */
      state: SessionState;
      /** The resulting track (unchanged when `changed` is false). */
      track: SessionTrack;
    }
  | {
      ok: false;
      error: SetTrackInstrumentError;
      /** Always the caller's own state reference — nothing was applied. */
      state: SessionState;
    };

export interface SetTrackInstrumentRequest {
  trackId: string;
  sampleId: string;
}

/**
 * Engine-specific state compatibility policy.
 *
 * `fmParams` is the only engine-scoped field on a track. It is meaningful only
 * for `tone:fm-*` presets and its useful range differs per preset, so a value
 * tuned for `tone:fm-bass` is wrong for `tone:fm-bell` and meaningless for a
 * drum sample. Replacing the instrument therefore drops it, and the new
 * instrument falls back to its own preset defaults.
 *
 * Keeping it dormant instead would resurrect settings the user has not seen in
 * the UI as soon as they picked an FM preset again, and would make the resulting
 * track depend on history rather than on `(track, sampleId)`. `fmParams` is
 * excluded from the sync state hash, so such a divergence would never be
 * detected — one policy, one implementation, is the only defense.
 *
 * Exported so the policy has a single test target.
 */
export function carryOverEngineState(
  track: SessionTrack,
  nextSampleId: string
): Pick<SessionTrack, 'fmParams'> {
  if (track.sampleId === nextSampleId) {
    // Not a change: the caller's tweaked parameters still belong to this preset.
    return { fmParams: track.fmParams };
  }
  return { fmParams: undefined };
}

function invalidSampleId(sampleId: string, state: SessionState): SetTrackInstrumentResult {
  return {
    ok: false,
    state,
    error: {
      code: 'INVALID_SAMPLE_ID',
      message: `Unknown sample_id: ${sampleId}`,
    },
  };
}

function trackNotFound(trackId: string, state: SessionState): SetTrackInstrumentResult {
  return {
    ok: false,
    state,
    error: {
      code: 'TRACK_NOT_FOUND',
      message: `Track not found: ${trackId}`,
    },
  };
}

/**
 * Replace a track's sound source, preserving everything else about the track.
 *
 * Preserved: id, list position, name, steps, parameterLocks, volume, muted,
 * soloed, transpose, stepCount, swing.
 * Replaced: sampleId.
 * Dropped: fmParams (see carryOverEngineState).
 *
 * Renaming is deliberately NOT part of this operation — it stays
 * `set_track_name`, so replacing a sound can never erase a collaborator's
 * custom label.
 */
export function setTrackInstrument(
  state: SessionState,
  request: SetTrackInstrumentRequest
): SetTrackInstrumentResult {
  const { trackId, sampleId } = request;

  // Validate the instrument before looking at the session, so an invalid ID is
  // rejected identically whether or not the track happens to exist.
  if (typeof sampleId !== 'string' || !VALID_SAMPLE_IDS.has(sampleId)) {
    return invalidSampleId(String(sampleId), state);
  }

  const index = state.tracks.findIndex((track) => track.id === trackId);
  if (index === -1) {
    return trackNotFound(trackId, state);
  }

  const current = state.tracks[index]!;
  if (current.sampleId === sampleId) {
    return { ok: true, changed: false, state, track: current };
  }

  // Build the replacement locally, then never touch it again. Dropped engine
  // state is deleted rather than set to `undefined` so the resulting track has
  // the same shape as a track that never had FM parameters at all.
  const track: SessionTrack = { ...current, sampleId };
  const carried = carryOverEngineState(current, sampleId);
  if (carried.fmParams === undefined) {
    delete track.fmParams;
  } else {
    track.fmParams = carried.fmParams;
  }

  // Replace in place. Filtering and appending would move the track to the end
  // of the list, which is a visible reordering nobody asked for.
  const tracks = [...state.tracks];
  tracks[index] = track;

  return { ok: true, changed: true, state: { ...state, tracks }, track };
}
