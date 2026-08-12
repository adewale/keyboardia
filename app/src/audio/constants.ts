/**
 * Audio Constants
 *
 * Centralized audio-related constants used across the synthesis engine.
 *
 * SINGLE SOURCE OF TRUTH: Constants defined here are the canonical values.
 * Validators and other tools should import from here rather than hardcoding.
 *
 * The playableRange bug (commit b28d05c) occurred because the assumption
 * "scheduler plays at MIDI 60" was encoded in multiple places independently.
 * This file prevents that class of bugs.
 */

/**
 * Frequency of C4 (middle C) in Hz
 * Used as the reference for semitone calculations
 */
export const C4_FREQUENCY = 261.625565;

// NOTE: NOTE_NAMES was removed in audit cleanup.
// Use NOTE_NAMES from '../music/music-theory' instead (canonical source with NoteName type)

/**
 * Common note duration values in seconds at 120 BPM
 */
export const NOTE_DURATIONS_120BPM: Record<string, number> = {
  '32n': 0.0625,
  '16n': 0.125,
  '16t': 0.0833,
  '8n': 0.25,
  '8t': 0.167,
  '4n': 0.5,
  '4t': 0.333,
  '2n': 1,
  '2t': 0.667,
  '1n': 2,
  '1m': 4,
  '2m': 8,
  '4m': 16,
};

/**
 * Convert semitone offset from C4 to frequency
 *
 * This is the CANONICAL implementation used throughout the codebase.
 * Semitone 0 = C4 (261.63 Hz), semitone 12 = C5, semitone -12 = C3
 *
 * @param semitone - Semitone offset from C4 (positive = higher, negative = lower)
 * @returns Frequency in Hz
 */
export function semitoneToFrequency(semitone: number): number {
  return C4_FREQUENCY * Math.pow(2, semitone / 12);
}

// NOTE: VALID_DELAY_TIMES was removed in Phase 22.
// - For UI delay options: use delay-constants.ts (subset for dropdowns)
// - For validation: use worker/invariants.ts (full Set for server validation)
// The constants.ts version was only used in tests and duplicated invariants.ts.
//
// NOTE: semitoneToNoteName was also removed in Phase 22.
// Use ToneSynthManager.semitoneToNoteName() instead.

// ============================================================================
// Scheduler Constants - SINGLE SOURCE OF TRUTH
// ============================================================================

/**
 * MIDI note number for C4 (middle C)
 */
export const C4_MIDI_NOTE = 60;

/**
 * The base MIDI note used by the scheduler when pitchSemitones = 0.
 *
 * When a track plays with default transpose (0) and no pitch lock,
 * the scheduler calculates: midiNote = SCHEDULER_BASE_MIDI_NOTE + pitchSemitones
 *
 * CRITICAL: Sampled instruments MUST have playableRange that includes this note,
 * otherwise they will be SILENT at default settings.
 *
 * This constant is the SINGLE SOURCE OF TRUTH. The scheduler and all validators
 * must use this constant - never hardcode the value 60.
 */
export const SCHEDULER_BASE_MIDI_NOTE = C4_MIDI_NOTE;

// ============================================================================
// Master bus - SOUND-QUALITY-PARITY-PLAN Phase 43.1
// ============================================================================

/**
 * The source-calibration contract now supplies normal operating headroom.
 * Unity here means the master dynamics stage is a safety net, not a mixer.
 */
export const MASTER_INPUT_TRIM = 1;

/** Compressor settings are deliberately identical in both master paths. */
export const MASTER_COMPRESSOR_SETTINGS = Object.freeze({
  threshold: -1,
  knee: 0,
  ratio: 8,
  attack: 0.003,
  release: 0.08,
});

/** Re-measured by the browser capture receipt when the safety curve changes. */
export const MASTER_COMPRESSOR_AUTO_MAKEUP_DB = 0.5248653331;

/** Keep normal programme at unity; the output ceiling supplies final margin. */
export const MASTER_MAKEUP_GAIN = 10 ** (-MASTER_COMPRESSOR_AUTO_MAKEUP_DB / 20);

/** Tone's fast compressor-style limiter threshold. */
export const MASTER_LIMITER_THRESHOLD_DB = -2;

/**
 * Post-limiter safety margin. Tone.Limiter can overshoot its nominal threshold
 * on the user-reachable mixed-engine capacity fixture; a final linear trim
 * preserves the compressor response while keeping rendered samples below full
 * scale. This is gain staging, not a claim of true-peak limiting.
 */
export const MASTER_OUTPUT_TRIM_DB = -1.75;
export const MASTER_OUTPUT_TRIM = 10 ** (MASTER_OUTPUT_TRIM_DB / 20);

/** Remove low-frequency energy before it is sent into the parallel reverb. */
export const REVERB_SEND_HIGHPASS_HZ = 275;

/** Short pre-delay keeps the dry transient distinct from the room response. */
export const REVERB_PREDELAY_SECONDS = 0.015;

/** Uniform smoothing at the engine boundary for user-dragged controls. */
export const CONTINUOUS_PARAMETER_SLEW_SECONDS = 0.04;

/** Short note-edge fade used by the live engine to prevent clicks. */
export const NOTE_FADE_SECONDS = 0.003;

/** Minimal shape shared by Web Audio AudioParam and Tone.Param. */
export interface SlewableAudioParam {
  cancelScheduledValues(startTime: number): unknown;
  setTargetAtTime(value: number, startTime: number, timeConstant: number): unknown;
}

/** Apply a click-resistant target ramp without duplicating automation policy. */
export function slewAudioParam(
  param: SlewableAudioParam,
  value: number,
  startTime: number,
): void {
  param.cancelScheduledValues(startTime);
  param.setTargetAtTime(value, startTime, CONTINUOUS_PARAMETER_SLEW_SECONDS);
}

// ============================================================================
// Sample Processing Constants - SINGLE SOURCE OF TRUTH
// ============================================================================

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert MIDI note number to note name (e.g., 60 -> "C4")
 */
export function midiToNoteName(midi: number): string {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}
