/**
 * Lazy Audio Loader
 *
 * Defers loading of the audio engine (and Tone.js ~200KB) until the user
 * demonstrates intent to make music. This improves initial page load for
 * users who are just viewing/sharing sessions.
 *
 * ## Feature Flag
 * Controlled by `VITE_LAZY_AUDIO` environment variable:
 * - `true`: Audio engine loads on first music-intent gesture
 * - `false` (default): Audio engine loads eagerly on page load
 *
 * ## Trigger Classification
 *
 * ### Tier 1 - MUST trigger (direct audio intent)
 * - Play button pressed
 * - Sample/synth preview played
 * - Recording started
 * - Chromatic grid note pressed
 *
 * ### Tier 2 - SHOULD trigger (strong music-making intent)
 * - Step cell toggled (building a pattern)
 * - Sample picker opened (will preview sounds)
 * - Track transpose changed (triggers preview)
 * - Parameter lock changed (triggers preview)
 *
 * ### Tier 3 - SHOULD NOT trigger (no immediate audio need)
 * - Page load
 * - Session name change
 * - QR code / share dialog
 * - Viewing other players' cursors
 * - Mute/solo toggled (state only, no sound yet)
 * - Adding a track (no sound until steps added)
 * - Tempo/swing changed (pattern might be empty)
 *
 * ## Usage
 *
 * ```typescript
 * // Before (eager loading)
 * import { audioEngine } from './engine';
 * audioEngine.playSample(...);
 *
 * // After (lazy loading)
 * import { ensureAudioLoaded, getAudioEngine } from './lazyAudioLoader';
 *
 * // Option 1: Preload on user intent, use later
 * function handleStepToggle() {
 *   ensureAudioLoaded(); // Fire and forget - starts loading
 *   dispatch({ type: 'TOGGLE_STEP', ... });
 * }
 *
 * // Option 2: Await when audio is needed now
 * async function handlePlay() {
 *   const engine = await getAudioEngine();
 *   await engine.initialize();
 *   engine.startPlayback();
 * }
 * ```
 */

import { logger } from '../utils/logger';

// Feature flag - defaults to false (eager loading) for stability
const LAZY_AUDIO_ENABLED = import.meta.env.VITE_LAZY_AUDIO === 'true';

// Module-level state for the lazy loader
let audioEngineModule: typeof import('./engine') | null = null;
let loadPromise: Promise<typeof import('./engine')> | null = null;
let loadStartTime: number | null = null;

/**
 * Load the audio engine module dynamically.
 * Returns cached module if already loaded.
 */
async function loadAudioModule(): Promise<typeof import('./engine')> {
  // Return cached module if already loaded
  if (audioEngineModule) {
    return audioEngineModule;
  }

  // Return existing promise if load is in progress
  if (loadPromise) {
    return loadPromise;
  }

  // Start loading
  loadStartTime = performance.now();
  logger.audio.log('[LazyAudio] Starting audio engine load...');

  loadPromise = import('./engine')
    .then((module) => {
      audioEngineModule = module;
      const loadTime = performance.now() - (loadStartTime ?? 0);
      logger.audio.log(`[LazyAudio] Audio engine loaded in ${loadTime.toFixed(0)}ms`);
      return module;
    })
    .catch((error) => {
      // Clear promise to allow retry
      loadPromise = null;
      logger.audio.error('[LazyAudio] Failed to load audio engine:', error);
      throw error;
    });

  return loadPromise;
}

/**
 * Preload the audio engine without blocking.
 * Use this on Tier 2 events (step toggle, sample picker open).
 *
 * @returns void - Does not wait for load to complete
 */
export function ensureAudioLoaded(): void {
  if (!LAZY_AUDIO_ENABLED) {
    // Eager mode - module is already imported via engine.ts
    return;
  }

  if (audioEngineModule || loadPromise) {
    // Already loaded or loading
    return;
  }

  // Start loading in background
  loadAudioModule().catch(() => {
    // Error already logged in loadAudioModule
  });
}

/**
 * Get the audio engine, loading it if necessary.
 * Use this when audio is needed immediately (play, record, preview).
 *
 * @returns Promise<AudioEngine> - The audio engine singleton
 */
export async function getAudioEngine(): Promise<typeof import('./engine')['audioEngine']> {
  if (!LAZY_AUDIO_ENABLED) {
    // Eager mode - return the already-imported engine
    const { audioEngine } = await import('./engine');
    return audioEngine;
  }

  const module = await loadAudioModule();
  return module.audioEngine;
}

/**
 * Check if audio engine is loaded (without triggering load).
 * Useful for conditional UI rendering.
 */
export function isAudioLoaded(): boolean {
  if (!LAZY_AUDIO_ENABLED) {
    return true; // Eager mode - always "loaded"
  }
  return audioEngineModule !== null;
}

/**
 * Check if lazy audio loading is enabled.
 */
export function isLazyAudioEnabled(): boolean {
  return LAZY_AUDIO_ENABLED;
}

/**
 * For testing: reset the loader state
 */
export function _resetForTesting(): void {
  audioEngineModule = null;
  loadPromise = null;
  loadStartTime = null;
}
