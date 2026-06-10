/**
 * Pitch-shift worklet parameter range and clamping helper.
 *
 * The pitch-shift worklet declares its `pitchRatio` AudioParam with
 * `minValue: 0.25, maxValue: 4.0` (corresponding to ±24 semitones). Per
 * the Web Audio spec, AudioParam silently clamps out-of-range values —
 * which means setting a ratio of 0.125 (-36 st) makes the worklet
 * actually run at 0.25 (-24 st) with no warning. The user hears wrong
 * pitch.
 *
 * This helper makes the clamping explicit so the engine can decide what
 * to do (warn, fall back to native playbackRate, etc).
 *
 * KEEP IN SYNC with pitch-shift.worklet.ts parameterDescriptors.
 */

export const PITCH_WORKLET_MAX_SEMITONES = 24;
export const PITCH_WORKLET_MIN_RATIO = 0.25;
export const PITCH_WORKLET_MAX_RATIO = 4.0;

export interface PitchRatioResult {
  /** Clamped ratio safe to assign to the worklet's pitchRatio AudioParam. */
  ratio: number;
  /** True when the requested semitones exceeded the worklet's range. */
  clamped: boolean;
}

export function pitchSemitonesToWorkletRatio(semitones: number): PitchRatioResult {
  const clampedSemitones = Math.max(
    -PITCH_WORKLET_MAX_SEMITONES,
    Math.min(PITCH_WORKLET_MAX_SEMITONES, semitones),
  );
  return {
    ratio: Math.pow(2, clampedSemitones / 12),
    clamped: clampedSemitones !== semitones,
  };
}
