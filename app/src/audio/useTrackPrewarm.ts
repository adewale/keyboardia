/**
 * useTrackPrewarm — keep readiness-gated instruments warm during playback so
 * tracks introduced after Play do not remain silent.
 *
 * `preloadInstrumentsForTracks` runs at play-start, but UI, multiplayer, and
 * MCP edits can add or change sampled/tone/advanced tracks mid-playback. Their
 * scheduler hot paths refuse unready instruments and skip the note.
 *
 * This hook re-runs preload whenever readiness-gated track membership changes.
 * The registries are idempotent, so already-loaded instruments are cheap.
 */

import { useEffect, useRef } from 'react';
import type { GridState } from '../types';
import { audioEngine } from './engine';
import { getSampledInstrumentId } from './instrument-types';

function prewarmSignature(state: GridState): string {
  // Stable signature of "which tracks need warming". Deliberately excludes
  // immediately playable plain samples and unrelated state such as volume,
  // swing, steps, p-locks, mute, and solo.
  return state.tracks
    .filter((t) =>
      getSampledInstrumentId(t.sampleId) !== null
      || t.sampleId.startsWith('tone:')
      || t.sampleId.startsWith('advanced:'))
    .map((t) => `${t.id}:${t.sampleId}`)
    .sort()
    .join('|');
}

export function useTrackPrewarm(state: GridState, isPlaying: boolean): void {
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      lastSignatureRef.current = null;
      return;
    }

    const signature = prewarmSignature(state);
    if (signature === lastSignatureRef.current) return;
    if (signature === '') {
      // No readiness-gated tracks; nothing to warm.
      lastSignatureRef.current = signature;
      return;
    }

    lastSignatureRef.current = signature;
    audioEngine.preloadInstrumentsForTracks(state.tracks).catch((err) => {
      // Errors here are already logged by preloadInstrumentsForTracks. A later
      // relevant state transition or Play transition can retry the preload.
      void err;
    });
  }, [state, isPlaying]);
}
