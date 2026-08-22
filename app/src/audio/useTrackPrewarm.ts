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

// A readiness-blocking manifest or priority-sample failure should recover
// without requiring the user to stop playback. Keep the policy bounded so a
// permanently unavailable asset cannot create an endless request loop.
const PREWARM_RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;

function prewarmSignature(state: GridState): string {
  // Stable signature of "which tracks need warming". Deliberately excludes
  // immediately playable plain samples and unrelated state such as volume,
  // swing, steps, p-locks, mute, and solo.
  const members = state.tracks
    .filter((t) =>
      getSampledInstrumentId(t.sampleId) !== null
      || t.sampleId.startsWith('synth:')
      || t.sampleId.startsWith('tone:')
      || t.sampleId.startsWith('advanced:'))
    .map((t) => [t.id, t.sampleId] as const)
    .sort(([leftId, leftSampleId], [rightId, rightSampleId]) =>
      leftId.localeCompare(rightId) || leftSampleId.localeCompare(rightSampleId));
  return members.length === 0 ? '' : JSON.stringify(members);
}

export function useTrackPrewarm(state: GridState, isPlaying: boolean): void {
  const lastSignatureRef = useRef<string | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const cancelPendingRetry = () => {
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };

    if (!isPlaying) {
      generationRef.current += 1;
      cancelPendingRetry();
      lastSignatureRef.current = null;
      return;
    }

    const signature = prewarmSignature(state);
    if (signature === lastSignatureRef.current) return;
    if (signature === '') {
      // No readiness-gated tracks; nothing to warm.
      generationRef.current += 1;
      cancelPendingRetry();
      lastSignatureRef.current = signature;
      return;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    cancelPendingRetry();
    lastSignatureRef.current = signature;
    const tracks = state.tracks;
    const sampledInstrumentIds = new Set<string>();
    for (const track of tracks) {
      const instrumentId = getSampledInstrumentId(track.sampleId);
      if (instrumentId !== null) sampledInstrumentIds.add(instrumentId);
    }

    const attemptPrewarm = (retryIndex: number): void => {
      if (generation !== generationRef.current) return;
      retryTimeoutRef.current = null;

      const scheduleRetry = () => {
        if (generation !== generationRef.current) return;
        const delay = PREWARM_RETRY_DELAYS_MS[retryIndex];
        if (delay === undefined) return;
        retryTimeoutRef.current = setTimeout(
          () => attemptPrewarm(retryIndex + 1),
          delay,
        );
      };

      audioEngine.preloadInstrumentsForTracks(tracks).then(() => {
        if (generation !== generationRef.current) return;
        const sampledReady = Array.from(sampledInstrumentIds).every(
          instrumentId => audioEngine.isSampledInstrumentReady(instrumentId),
        );
        if (!sampledReady) scheduleRetry();
      }).catch(() => {
        // The preloader logs the underlying error. This hook owns retry timing
        // because scheduler hot paths must remain free of loading side effects.
        scheduleRetry();
      });
    };

    attemptPrewarm(0);
  }, [state, isPlaying]);

  useEffect(() => () => {
    generationRef.current += 1;
    // Effect replay must not retain the signature owned by the generation it
    // just cancelled. React StrictMode performs this setup/cleanup/setup cycle
    // in development, and a real unmount has no reason to preserve the value.
    lastSignatureRef.current = null;
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);
}
