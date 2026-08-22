/**
 * Velocity → cutoff curve for sampled instruments (Phase 44 Change 2).
 *
 * The SF2 default modulator makes soft notes darker as well as quieter; the
 * sampled path here historically scaled gain only, so 20 of 26 instruments
 * had a measured 0% timbral spread across velocity
 * (specs/PHASE-44-SOUND-CHANGES.md §1.1). This module supplies the missing
 * brightness dimension as a per-voice lowpass.
 *
 * The curve is BYPASSED at and above DEFAULT_STEP_MIDI_VELOCITY: unlocked
 * steps use exactly that velocity, so every session without explicit volume
 * locks renders through a byte-identical graph. That zero-regression bypass
 * is the point of the design — and also its stated limit: the filter only
 * narrows the per-note gap where the velocity lane is used
 * (specs/PHASE-44-SOUND-CHANGES.md §3, "Reconsidered limits").
 *
 * The anchor is per-instrument (manifest `velocityFilterAnchorHz`), tuned by
 * `scripts/simulate-velocity-filter.ts --solve` so the centroid drop at a
 * soft strike lands in the 26–35% band that the genuinely multi-sampled
 * instruments already occupy. Layered instruments declare no anchor and are
 * untouched.
 */

import { DEFAULT_STEP_MIDI_VELOCITY } from '../shared/constants';

/** Bypass threshold: at and above this velocity no filter node is created. */
export const VELOCITY_FILTER_BYPASS_VELOCITY = DEFAULT_STEP_MIDI_VELOCITY;

/** Sweep depth reaching v=0; chosen from the measured simulation in §3. */
export const VELOCITY_FILTER_OCTAVES = 1.5;

/** Butterworth: no resonant peak on top of real recordings. */
export const VELOCITY_FILTER_Q = Math.SQRT1_2;

/** Manifest anchors outside this range are treated as absent, not clamped. */
export const VELOCITY_FILTER_MIN_ANCHOR_HZ = 100;
export const VELOCITY_FILTER_MAX_ANCHOR_HZ = 20_000;

/**
 * Generalized curve used by the design-simulation script to explore sweep
 * depths. Production always uses VELOCITY_FILTER_OCTAVES.
 */
export function velocitySampleCutoffAt(
  anchorHz: number,
  midiVelocity: number,
  octaves: number,
): number | null {
  if (
    !Number.isFinite(anchorHz)
    || anchorHz < VELOCITY_FILTER_MIN_ANCHOR_HZ
    || anchorHz > VELOCITY_FILTER_MAX_ANCHOR_HZ
  ) {
    return null;
  }
  if (!Number.isFinite(midiVelocity) || midiVelocity >= VELOCITY_FILTER_BYPASS_VELOCITY) {
    return null;
  }
  const normalized = Math.max(0, midiVelocity) / VELOCITY_FILTER_BYPASS_VELOCITY;
  return anchorHz * 2 ** (-octaves * (1 - normalized));
}

/** Null means "bypass": create no filter node at all. */
export function velocitySampleCutoff(
  anchorHz: number | undefined,
  midiVelocity: number,
): number | null {
  if (anchorHz === undefined) return null;
  return velocitySampleCutoffAt(anchorHz, midiVelocity, VELOCITY_FILTER_OCTAVES);
}
