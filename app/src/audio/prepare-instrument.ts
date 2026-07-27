/**
 * Make an instrument ready to play.
 *
 * Adding a track and changing a track's instrument both have to do the same
 * three things before the first note: start Tone.js if the instrument needs it,
 * load the sampled buffers if the instrument has any, and build the per-track
 * synth instance if the instrument is per-track.
 *
 * This existed inline in SamplePicker for the add path only. Extracting it is
 * what lets the change-instrument path reuse it instead of growing a second,
 * drifting copy.
 *
 * Fire-and-forget by design: the scheduler's hot path falls back to
 * `getOrCreate` for anything not yet warm, so a slow or failed preload costs
 * latency, never correctness. See docs/DEBUGGING-LESSONS-LEARNED.md #008.
 */

import { audioEngine } from './engine';

/** Instruments whose engine has to be started before anything can be warmed. */
function requiresTone(sampleId: string): boolean {
  return sampleId.startsWith('tone:') || sampleId.startsWith('advanced:');
}

/**
 * Preload whatever the given instrument needs.
 *
 * @param sampleId Canonical catalog instrument ID.
 * @param trackId  Present for a real track, so per-track `tone:`/`advanced:`
 *                 synths are warmed too. Omit for preview-style calls, which
 *                 use the engine's shared preview synths instead.
 */
export function prepareInstrument(sampleId: string, trackId?: string): void {
  if (requiresTone(sampleId) && !audioEngine.isToneInitialized()) {
    audioEngine.initializeTone().catch(() => {
      // Ignore - the scheduler warns on the next play.
    });
  }

  // preloadInstrumentsForTracks handles both sampled buffer loading and
  // per-track synth warming, and is a no-op for plain procedural samples.
  audioEngine.preloadInstrumentsForTracks(
    trackId === undefined ? [{ sampleId }] : [{ id: trackId, sampleId }]
  ).catch(() => {
    // Ignore - preloadInstrumentsForTracks already logs its own failures.
  });
}
