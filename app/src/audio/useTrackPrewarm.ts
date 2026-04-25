/**
 * useTrackPrewarm — keep tone/advanced track synth instances warm
 * during playback so the first scheduled note is never dropped.
 *
 * `preloadInstrumentsForTracks` runs at play-start, but a user can
 * add or change a track to `tone:*` / `advanced:*` mid-playback. The
 * scheduler's hot path uses `getIfReady`, which returns null for any
 * track the registry hasn't built yet — and the note is skipped.
 *
 * This hook re-runs preload whenever the tone/advanced track membership
 * changes. The registry's `getOrCreate` is idempotent so already-warmed
 * tracks pay only a Map lookup.
 */

import { useEffect, useRef } from 'react';
import type { GridState } from '../types';
import { audioEngine } from './engine';

function toneOrAdvancedSignature(state: GridState): string {
  // Stable signature of "which tracks need warming". Deliberately
  // includes only tone:/advanced: tracks so unrelated state changes
  // (volume, swing, p-locks) don't trigger prewarm.
  return state.tracks
    .filter((t) => t.sampleId.startsWith('tone:') || t.sampleId.startsWith('advanced:'))
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

    const signature = toneOrAdvancedSignature(state);
    if (signature === lastSignatureRef.current) return;
    if (signature === '') {
      // No tone/advanced tracks; nothing to warm.
      lastSignatureRef.current = signature;
      return;
    }

    lastSignatureRef.current = signature;
    audioEngine.preloadInstrumentsForTracks(state.tracks).catch((err) => {
      // Swallow — the next scheduled note will retry via getOrCreate.
      // Errors here would already be logged by preloadInstrumentsForTracks.
      void err;
    });
  }, [state, isPlaying]);
}
