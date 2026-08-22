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
 * Callers may fire-and-forget, but the work inside is deliberately sequenced:
 * base audio, then Tone.js when required, then the track-specific preload.
 * Warming before Tone.js is ready is a no-op and can otherwise lose a note.
 */

import { audioEngine } from './engine';

/** Instruments whose engine has to be started before anything can be warmed. */
function requiresTone(sampleId: string): boolean {
  return sampleId.startsWith('synth:') || sampleId.startsWith('tone:') || sampleId.startsWith('advanced:');
}

/**
 * Preload whatever the given instrument needs.
 *
 * @param sampleId Canonical catalog instrument ID.
 * @param trackId  Present for a real track, so per-track `tone:`/`advanced:`
 *                 synths are warmed too. Omit for preview-style calls, which
 *                 use the engine's shared preview synths instead.
 */
export async function prepareInstrument(sampleId: string, trackId?: string): Promise<void> {
  try {
    // Remote state changes must not create an AudioContext outside a user
    // gesture. A picker click starts initialization first via signalMusicIntent;
    // if that work is still in flight, join its promise before preloading.
    if (!audioEngine.isInitialized()) {
      if (!audioEngine.isInitializing()) return;
      await audioEngine.initialize();
    }

    if (requiresTone(sampleId) && !audioEngine.isToneInitialized()) {
      await audioEngine.initializeTone();
    }

    // Handles sampled buffers and per-track synth warming; plain procedural
    // samples make this a cheap no-op.
    await audioEngine.preloadInstrumentsForTracks(
      trackId === undefined ? [{ sampleId }] : [{ id: trackId, sampleId }]
    );
  } catch {
    // Non-blocking preparation: playback owns user-visible readiness errors.
  }
}
