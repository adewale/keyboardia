/**
 * Shared Synthesis Types
 *
 * Common type definitions used across synthesis engines:
 * - synth.ts (Web Audio API synth)
 * - advancedSynth.ts (Tone.js advanced synth)
 *
 * NEW-001 from complexity audit - eliminates duplicate type definitions.
 */

/**
 * Oscillator waveform types.
 * These four basic waveforms are the building blocks of subtractive synthesis.
 *
 * - sine: Pure tone, no harmonics (mellow, organ-like)
 * - triangle: Odd harmonics only, softer than sawtooth (woodwind-like)
 * - sawtooth: All harmonics, bright and buzzy (strings, brass, leads)
 * - square: Odd harmonics only, hollow sound (clarinet-like, retro game sounds)
 */
export type WaveformType = 'sine' | 'triangle' | 'sawtooth' | 'square';

/**
 * LFO (Low Frequency Oscillator) destination targets.
 * Determines what parameter the LFO modulates.
 */
export type LFODestination = 'filter' | 'pitch' | 'amplitude';

/**
 * Basic ADSR envelope shape.
 * The fundamental building block for amplitude and filter envelopes.
 *
 * @property attack - Time to reach peak (0.001 to 4s)
 * @property decay - Time to fall to sustain level (0.001 to 4s)
 * @property sustain - Level held while note is pressed (0 to 1)
 * @property release - Time to fall to zero after note release (0.001 to 8s)
 */
export interface ADSREnvelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/**
 * Base oscillator configuration shared between synth engines.
 *
 * @property waveform - The waveform shape
 * @property detune - Fine tuning in cents (-100 to +100)
 * @property coarseDetune - Coarse tuning in semitones (-24 to +24)
 */
export interface BaseOscillatorConfig {
  waveform: WaveformType;
  detune: number;
  coarseDetune: number;
}

/**
 * Filter types supported by the synthesis engines.
 */
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/**
 * Audio engineering constants shared across synth engines.
 */
export const SYNTH_CONSTANTS = {
  /** Minimum filter frequency in Hz */
  MIN_FILTER_FREQ: 20,
  /** Maximum filter frequency in Hz */
  MAX_FILTER_FREQ: 20000,
  /** Maximum filter resonance (Q) to prevent self-oscillation */
  MAX_FILTER_RESONANCE: 30,
  /** Minimum gain value for exponential ramps (can't target 0) */
  MIN_GAIN_VALUE: 0.0001,
  /** Peak amplitude for full, rich sound */
  ENVELOPE_PEAK: 0.85,
  /** Maximum simultaneous voices (prevents CPU overload) */
  MAX_VOICES: 16,
} as const;
