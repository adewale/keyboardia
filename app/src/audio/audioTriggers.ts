/**
 * Centralized Audio Trigger System
 *
 * This module defines WHAT triggers audio loading and provides a single
 * source of truth for the decision logic. All components should use these
 * functions rather than calling lazyAudioLoader directly.
 *
 * ## Web Audio API User Gesture Requirements
 *
 * Per Chrome's autoplay policy, AudioContext can only be unlocked by
 * specific user gestures. This affects when we can initialize audio.
 *
 * @see https://developer.chrome.com/blog/autoplay/#webaudio
 */

import {
  ensureAudioLoaded,
  getAudioEngine,
  isAudioLoaded,
  isLazyAudioEnabled,
} from './lazyAudioLoader';
import { logger } from '../utils/logger';

// ============================================================================
// User Gesture Classification
// ============================================================================

/**
 * Events that ARE valid user gestures for AudioContext unlock.
 * These can trigger audio initialization.
 */
export const VALID_AUDIO_GESTURES = [
  'click',
  'contextmenu',
  'auxclick',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerup',
  'touchend',
  'keydown',
  'keyup',
] as const;

/**
 * Events that are NOT valid user gestures.
 * These cannot unlock AudioContext - audio will remain suspended.
 */
export const INVALID_AUDIO_GESTURES = [
  'mouseenter',
  'mouseover',
  'mousemove',
  'scroll',
  'wheel',
  'focus',
  'blur',
  'load',
  'resize',
] as const;

export type ValidGesture = (typeof VALID_AUDIO_GESTURES)[number];
export type InvalidGesture = (typeof INVALID_AUDIO_GESTURES)[number];

/**
 * Check if an event type is a valid user gesture for AudioContext unlock.
 */
export function isValidAudioGesture(eventType: string): boolean {
  return (VALID_AUDIO_GESTURES as readonly string[]).includes(eventType);
}

// ============================================================================
// Audio Trigger Types
// ============================================================================

/**
 * Actions that trigger audio loading.
 *
 * Tier 1 (REQUIRE): Need audio engine immediately
 * Tier 2 (PRELOAD): Start loading in background, don't block
 * Tier 3 (NONE): Should not trigger audio loading
 */
export type AudioTrigger =
  // Tier 1 - Require audio now
  | 'play'              // Play button pressed
  | 'record'            // Recording started
  | 'record_stop'       // Recording stopped (needs decode)
  | 'add_to_grid'       // Adding recorded sample to grid
  // Tier 2 - Preload in background
  | 'step_toggle'       // Step cell clicked
  | 'add_track'         // Track added via sample picker
  | 'chromatic_click'   // Note clicked in chromatic grid
  // Preview triggers (only play if already loaded)
  | 'preview_hover'     // Hover preview (NOT a valid gesture)
  | 'preview_transpose' // Transpose preview (click IS valid)
  | 'preview_pitch'     // Pitch lock preview (drag/click)
  | 'preview_slice'     // Waveform slice preview (click)
  ;

/**
 * Tier 1 triggers that require audio immediately.
 */
export const TIER_1_TRIGGERS: readonly AudioTrigger[] = [
  'play',
  'record',
  'record_stop',
  'add_to_grid',
];

/**
 * Tier 2 triggers that preload audio in background.
 */
export const TIER_2_TRIGGERS: readonly AudioTrigger[] = [
  'step_toggle',
  'add_track',
  'chromatic_click',
];

/**
 * Preview triggers - only play if audio is already initialized.
 * These don't trigger loading themselves.
 */
export const PREVIEW_TRIGGERS: readonly AudioTrigger[] = [
  'preview_hover',
  'preview_transpose',
  'preview_pitch',
  'preview_slice',
];

// ============================================================================
// Trigger Decision Functions
// ============================================================================

/**
 * Check if a trigger should require audio immediately.
 */
export function shouldRequireAudio(trigger: AudioTrigger): boolean {
  return (TIER_1_TRIGGERS as readonly string[]).includes(trigger);
}

/**
 * Check if a trigger should preload audio in background.
 */
export function shouldPreloadAudio(trigger: AudioTrigger): boolean {
  return (TIER_2_TRIGGERS as readonly string[]).includes(trigger);
}

/**
 * Check if a trigger is a preview that only plays if already loaded.
 */
export function isPreviewTrigger(trigger: AudioTrigger): boolean {
  return (PREVIEW_TRIGGERS as readonly string[]).includes(trigger);
}

/**
 * Check if a trigger should initiate any audio loading.
 */
export function shouldTriggerAudioLoad(trigger: AudioTrigger): boolean {
  return shouldRequireAudio(trigger) || shouldPreloadAudio(trigger);
}

// ============================================================================
// Audio Trigger Handlers
// ============================================================================

/**
 * Signal that a music-making action occurred.
 * Call this from Tier 2 trigger handlers (step toggle, add track).
 *
 * This preloads the audio engine in the background without blocking.
 * The gesture must be valid (click, touch, key) but we don't verify here
 * since that's the caller's responsibility.
 *
 * @example
 * ```typescript
 * const handleToggleStep = () => {
 *   signalMusicIntent('step_toggle');
 *   dispatch({ type: 'TOGGLE_STEP', ... });
 * };
 * ```
 */
export function signalMusicIntent(trigger: AudioTrigger): void {
  if (!shouldTriggerAudioLoad(trigger)) {
    logger.audio.warn(`[AudioTrigger] ${trigger} should not trigger audio load`);
    return;
  }

  logger.audio.log(`[AudioTrigger] Music intent: ${trigger}`);
  ensureAudioLoaded();

  // Since this is triggered by a click (valid gesture), start async initialization
  // This enables hover previews after the first instrument click
  initializeAudioAsync();
}

/**
 * Start audio initialization asynchronously without blocking.
 * Called from signalMusicIntent to enable previews after first click.
 */
async function initializeAudioAsync(): Promise<void> {
  try {
    const engine = await getAudioEngine();
    if (!engine.isInitialized()) {
      await engine.initialize();
    }
    notifyAudioUnlocked();
  } catch (e) {
    // Non-blocking - log and continue
    logger.audio.warn('[AudioTrigger] Async audio init failed:', e);
  }
}

/**
 * Get the audio engine, loading and initializing if necessary.
 * Call this from Tier 1 trigger handlers (play, record).
 *
 * This blocks until audio is ready - only use for actions that
 * require audio immediately.
 *
 * @example
 * ```typescript
 * const handlePlay = async () => {
 *   const engine = await requireAudioEngine('play');
 *   engine.startPlayback();
 * };
 * ```
 */
export async function requireAudioEngine(
  trigger: AudioTrigger
): Promise<ReturnType<typeof getAudioEngine> extends Promise<infer T> ? T : never> {
  if (!shouldRequireAudio(trigger)) {
    logger.audio.warn(`[AudioTrigger] ${trigger} is not a Tier 1 trigger`);
  }

  logger.audio.log(`[AudioTrigger] Requiring audio: ${trigger}`);

  const engine = await getAudioEngine();
  if (!engine.isInitialized()) {
    await engine.initialize();
  }

  // Notify that audio is now unlocked (user gesture triggered initialization)
  notifyAudioUnlocked();

  return engine;
}

/**
 * Try to get the audio engine for preview playback.
 * Returns null if audio is not ready - does NOT block or trigger loading.
 *
 * Use this for hover previews and slider changes where we don't want
 * to block the UI waiting for audio.
 *
 * @example
 * ```typescript
 * const handleHoverPreview = async () => {
 *   const engine = await tryGetEngineForPreview('preview_hover');
 *   if (!engine) return; // Audio not ready, skip preview
 *   engine.playNow(sampleId);
 * };
 * ```
 */
export async function tryGetEngineForPreview(
  trigger: AudioTrigger
): Promise<Awaited<ReturnType<typeof getAudioEngine>> | null> {
  if (!isPreviewTrigger(trigger) && !shouldPreloadAudio(trigger)) {
    logger.audio.warn(`[AudioTrigger] ${trigger} is not a preview trigger`);
  }

  // Early exit if not loaded (sync check)
  if (!isAudioLoaded()) {
    return null;
  }

  const engine = await getAudioEngine();

  // Only return if initialized (ready to play)
  if (!engine.isInitialized()) {
    return null;
  }

  // If we got here, audio is ready - ensure unlocked state is set
  // (This handles case where audio was initialized externally)
  notifyAudioUnlocked();

  return engine;
}

// ============================================================================
// Preview Instrument Helper
// ============================================================================

/**
 * Options for instrument preview playback.
 */
export interface PreviewOptions {
  /** The instrument sample ID (e.g., 'synth:lead', 'tone:fm-bass', 'advanced:supersaw') */
  sampleId: string;
  /** Unique ID for this preview instance (e.g., 'preview-track123') */
  previewId: string;
  /** Pitch offset in semitones (default: 0) */
  pitch?: number;
  /** Duration in seconds (default: varies by type - 0.2 for synth, undefined for samples) */
  duration?: number;
}

/**
 * Play a preview sound for any instrument type.
 *
 * This function consolidates the preview logic for all instrument types:
 * - synth: → playSynthNote
 * - tone: → playToneSynth (with Tone.js initialization)
 * - advanced: → playAdvancedSynth (with Tone.js initialization)
 * - sampled: → playSampledInstrument (with instrument loading)
 * - default → playSample
 *
 * Returns false if audio is not ready (does not block or trigger loading).
 *
 * @example
 * ```typescript
 * // Simple preview
 * await previewInstrument('preview_pitch', {
 *   sampleId: track.sampleId,
 *   previewId: `preview-${track.id}`,
 *   pitch: transpose,
 * });
 *
 * // Preview with custom duration
 * await previewInstrument('preview_hover', {
 *   sampleId: 'synth:lead',
 *   previewId: 'sample-picker-preview',
 *   duration: 0.3,
 * });
 * ```
 */
export async function previewInstrument(
  trigger: AudioTrigger,
  options: PreviewOptions
): Promise<boolean> {
  const { sampleId, previewId, pitch = 0, duration } = options;

  const engine = await tryGetEngineForPreview(trigger);
  if (!engine) return false;

  const time = engine.getCurrentTime();

  // Route to appropriate playback method based on instrument type
  if (sampleId.startsWith('synth:')) {
    const preset = sampleId.replace('synth:', '');
    engine.playSynthNote(previewId, preset, pitch, time, duration ?? 0.2);
    return true;
  }

  if (sampleId.startsWith('tone:')) {
    // Ensure Tone.js is ready
    if (!engine.isToneInitialized()) {
      await engine.initializeTone();
    }
    if (engine.isToneSynthReady('tone')) {
      const preset = sampleId.replace('tone:', '');
      engine.playToneSynth(preset, pitch, time, duration ?? 0.15);
      return true;
    }
    return false;
  }

  if (sampleId.startsWith('advanced:')) {
    // Ensure Tone.js is ready for advanced instruments
    if (!engine.isToneInitialized()) {
      await engine.initializeTone();
    }
    if (engine.isToneSynthReady('advanced')) {
      const preset = sampleId.replace('advanced:', '');
      engine.playAdvancedSynth(preset, pitch, time, duration ?? 0.15);
      return true;
    }
    return false;
  }

  if (sampleId.startsWith('sampled:')) {
    const instrument = sampleId.replace('sampled:', '');
    // Trigger loading if not ready
    if (!engine.isSampledInstrumentReady(instrument)) {
      engine.loadSampledInstrument(instrument);
      return false; // Will be ready on next preview
    }
    // Convert pitch offset to MIDI note (60 = middle C)
    const midiNote = 60 + pitch;
    engine.playSampledInstrument(instrument, previewId, midiNote, time, duration ?? 0.15);
    return true;
  }

  // Default: basic sample (kick, snare, etc.)
  engine.playSample(sampleId, previewId, time, duration, pitch);
  return true;
}

// ============================================================================
// Audio Unlocked State (for UI feedback)
// ============================================================================

/**
 * Tracks whether audio has been unlocked by a valid user gesture.
 * Components can subscribe to this to grey out previews until audio is ready.
 */
let audioUnlocked = false;
const audioUnlockListeners: Set<(unlocked: boolean) => void> = new Set();

/**
 * Check if audio has been unlocked by a user gesture.
 * This is a synchronous check - returns current state immediately.
 */
export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

/**
 * Mark audio as unlocked. Called internally when audio engine initializes.
 * Notifies all subscribers.
 */
export function notifyAudioUnlocked(): void {
  if (audioUnlocked) return; // Already unlocked
  audioUnlocked = true;
  logger.audio.log('[AudioTrigger] Audio unlocked - notifying listeners');
  audioUnlockListeners.forEach(listener => listener(true));
}

/**
 * Subscribe to audio unlock state changes.
 * Returns an unsubscribe function.
 */
export function subscribeToAudioUnlock(
  listener: (unlocked: boolean) => void
): () => void {
  audioUnlockListeners.add(listener);
  // Immediately notify with current state
  listener(audioUnlocked);
  return () => {
    audioUnlockListeners.delete(listener);
  };
}

// ============================================================================
// Observability
// ============================================================================

/**
 * Audio loading state for observability.
 */
export interface AudioLoadingState {
  lazyLoadingEnabled: boolean;
  moduleLoaded: boolean;
  engineInitialized: boolean | null; // null if module not loaded
  audioUnlocked: boolean;
  timestamp: number;
}

/**
 * Get current audio loading state for debugging/observability.
 */
export async function getAudioLoadingState(): Promise<AudioLoadingState> {
  const moduleLoaded = isAudioLoaded();

  let engineInitialized: boolean | null = null;
  if (moduleLoaded) {
    const engine = await getAudioEngine();
    engineInitialized = engine.isInitialized();
  }

  return {
    lazyLoadingEnabled: isLazyAudioEnabled(),
    moduleLoaded,
    engineInitialized,
    audioUnlocked,
    timestamp: Date.now(),
  };
}

/**
 * Log current audio loading state to console.
 * Useful for debugging.
 */
export async function logAudioLoadingState(): Promise<void> {
  const state = await getAudioLoadingState();
  console.log('[AudioTrigger] Loading state:', state);
}

// Expose to window in development for debugging
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__audioTriggers = {
    getState: getAudioLoadingState,
    logState: logAudioLoadingState,
    isValidGesture: isValidAudioGesture,
    triggers: {
      TIER_1: TIER_1_TRIGGERS,
      TIER_2: TIER_2_TRIGGERS,
      PREVIEW: PREVIEW_TRIGGERS,
    },
  };
}
