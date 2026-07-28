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
