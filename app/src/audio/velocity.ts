/**
 * Volume-multiplier → MIDI-velocity bridge.
 *
 * The sequencer's dynamics live in the volume p-lock (0–1 multiplier,
 * surfaced in the UI as the Velocity Lane). Sampled instruments select
 * velocity layers by MIDI velocity (0–127). This module is the single
 * conversion point between the two domains — every scheduler
 * implementation must derive velocity through here so the main-thread
 * and worklet paths stay in parity.
 *
 * Correctness by construction: the function is total (any double in,
 * valid velocity out) and clamping, so downstream layer selection never
 * sees an out-of-range or non-integer velocity.
 */

export const MIDI_VELOCITY_MAX = 127;

/** Velocity used when no dynamics information exists (un-locked step = full hit). */
export const DEFAULT_MIDI_VELOCITY = MIDI_VELOCITY_MAX;

/**
 * Convert a 0–1 volume multiplier to an integer MIDI velocity in [0, 127].
 * Out-of-range input is clamped; non-finite input falls back to the default.
 */
export function velocityFromMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier)) return DEFAULT_MIDI_VELOCITY;
  const clamped = Math.min(1, Math.max(0, multiplier));
  return Math.round(clamped * MIDI_VELOCITY_MAX);
}
