/**
 * Audio Constants
 *
 * Centralized audio-related constants used across the synthesis engine.
 */

/**
 * Frequency of C4 (middle C) in Hz
 * Used as the reference for semitone calculations
 */
export const C4_FREQUENCY = 261.625565;

/**
 * Note names for chromatic scale
 */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Valid delay time notations (Tone.js format)
 */
export const VALID_DELAY_TIMES = [
  '32n', '16n', '16t', '8n', '8t', '4n', '4t', '2n', '2t', '1n', '1m', '2m', '4m',
] as const;

export type DelayTimeNotation = typeof VALID_DELAY_TIMES[number];

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
 */
export function semitoneToFrequency(semitone: number): number {
  return C4_FREQUENCY * Math.pow(2, semitone / 12);
}

/**
 * Convert semitone offset from C4 to note name
 * @param semitone Semitone offset (0 = C4, 12 = C5, -12 = C3)
 * @returns Note name like "C4", "F#5", etc.
 */
export function semitoneToNoteName(semitone: number): string {
  const baseOctave = 4;
  const absoluteSemitone = semitone + (baseOctave * 12);
  const octave = Math.floor(absoluteSemitone / 12);
  const noteIndex = ((absoluteSemitone % 12) + 12) % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}
