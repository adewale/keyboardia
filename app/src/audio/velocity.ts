/**
 * Volume-multiplier → MIDI-velocity bridge.
 *
 * The sequencer's dynamics live in the volume p-lock (0–1 multiplier,
 * surfaced in the UI as the Velocity Lane). Sampled instruments select
 * velocity layers by MIDI velocity (0–127). Schedulers use the richer
 * resolveNoteDynamics contract; this compatibility helper remains the pure
 * explicit-lock conversion used by tests and non-scheduler callers.
 *
 * Correctness by construction: the function is total (any double in,
 * valid velocity out) and clamping, so downstream layer selection never
 * sees an out-of-range or non-integer velocity.
 */

import { DEFAULT_MIDI_VELOCITY, MIDI_VELOCITY_MAX } from '../shared/constants';
export { DEFAULT_MIDI_VELOCITY } from '../shared/constants';

/**
 * Convert a 0–1 volume multiplier to an integer MIDI velocity in [0, 127].
 * Out-of-range input is clamped; non-finite input falls back to the default.
 */
export function velocityFromMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier)) return DEFAULT_MIDI_VELOCITY;
  const clamped = Math.min(1, Math.max(0, multiplier));
  return Math.round(clamped * MIDI_VELOCITY_MAX);
}
