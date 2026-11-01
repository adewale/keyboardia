/**
 * useTrackInstrumentReconcile — keep the audio engine matching the session.
 *
 * A `tone:`/`advanced:` track owns a synth instance cached by `trackId`. When
 * the track's instrument changes, that instance is still the old sound, so it
 * has to be disposed and rebuilt or the track keeps playing what it used to be.
 *
 * This reconciles from STATE rather than from an event, which is what makes it
 * cover every origin of a change with one mechanism:
 *
 *   - the local person picking a new instrument,
 *   - a collaborator's instrument broadcast (new or rollout-compatible),
 *   - an MCP agent's `edit_session`,
 *   - a snapshot after reconnect,
 *   - `LOAD_STATE` when a session opens.
 *
 * An event-based hook on the click handler would have covered only the first,
 * leaving every collaborator hearing the previous instrument.
 *
 * Track deletion is not handled here: `handleDeleteTrack` already calls
 * `removeTrackGain`, which disposes both registries along with the bus.
 */

import { useEffect, useRef } from 'react';
import type { GridState } from '../types';
import { audioEngine } from './engine';
import { prepareInstrument } from './prepare-instrument';

export function useTrackInstrumentReconcile(state: GridState): void {
  // Undefined until the first render observes the session, so opening an
  // existing session records its tracks instead of tearing down synths that
  // were just built for them.
  const lastInstrumentsRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const previous = lastInstrumentsRef.current;
    const current = new Map(state.tracks.map((track) => [track.id, track.sampleId]));
    lastInstrumentsRef.current = current;

    if (previous === null) return;

    for (const [trackId, sampleId] of current) {
      const before = previous.get(trackId);
      // A track we have not seen before is not a change: the add-track path
      // already preloaded it.
      if (before === undefined || before === sampleId) continue;

      audioEngine.clearTrackSynths(trackId);
      void prepareInstrument(sampleId, trackId);
    }
  }, [state.tracks]);
}
