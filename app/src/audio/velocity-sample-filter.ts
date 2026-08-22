/**
 * Velocity → cutoff curve for sampled instruments (Phase 44 Change 2).
 *
 * The SF2 default modulator makes soft notes darker as well as quieter; the
 * sampled path here historically scaled gain only, so 12 of 26 instruments
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
 * The anchor is per playable note (`velocity-filter-anchors.json`), tuned by
 * `scripts/simulate-velocity-filter.ts --solve` so the centroid drop at a
 * soft strike lands in the 26–35% band that the genuinely multi-sampled
 * instruments already occupy. Layered instruments declare no anchors and are
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
export const VELOCITY_FILTER_MAX_ANCHOR_HZ = 42_000;

/** Default reference for callers that intentionally pitch-track one anchor. */
export const VELOCITY_FILTER_REFERENCE_MIDI_NOTE = 60;

/** Cutoff reached immediately below bypass, effectively transparent at 44.1/48 kHz. */
export const VELOCITY_FILTER_TRANSPARENT_HZ = 24_000;

/** Keep the measured v40 operating point stable; fade smoothly to bypass above it. */
export const VELOCITY_FILTER_PROBE_VELOCITY = 40;

function cutoffForValidatedAnchor(
  effectiveAnchorHz: number,
  midiVelocity: number,
  octaves: number,
): number | null {
  if (!Number.isFinite(midiVelocity) || midiVelocity >= VELOCITY_FILTER_BYPASS_VELOCITY) {
    return null;
  }
  const velocity = Math.max(0, midiVelocity);
  if (velocity <= VELOCITY_FILTER_PROBE_VELOCITY) {
    const normalized = velocity / VELOCITY_FILTER_BYPASS_VELOCITY;
    return effectiveAnchorHz * 2 ** (-octaves * (1 - normalized));
  }

  // The old curve was still near the anchor at v89, then removed the node at
  // v90. Exponentially open from the calibrated v40 point to a transparent
  // corner so the byte-identical bypass no longer creates a brightness cliff.
  const probeCutoff = effectiveAnchorHz * 2 ** (
    -octaves * (1 - VELOCITY_FILTER_PROBE_VELOCITY / VELOCITY_FILTER_BYPASS_VELOCITY)
  );
  const progress = (velocity - VELOCITY_FILTER_PROBE_VELOCITY)
    / (VELOCITY_FILTER_BYPASS_VELOCITY - VELOCITY_FILTER_PROBE_VELOCITY);
  return probeCutoff * (VELOCITY_FILTER_TRANSPARENT_HZ / probeCutoff) ** progress;
}

/**
 * Null means "bypass": create no filter node at all. The generalized form can
 * pitch-track an anchor between notes; production supplies an anchor calibrated
 * for the exact requested note, so its note and anchor-note are identical.
 */
export function velocitySampleCutoffForNoteAt(
  anchorHz: number | undefined,
  midiVelocity: number,
  midiNote: number = VELOCITY_FILTER_REFERENCE_MIDI_NOTE,
  anchorMidiNote: number = VELOCITY_FILTER_REFERENCE_MIDI_NOTE,
  octaves: number = VELOCITY_FILTER_OCTAVES,
): number | null {
  if (
    anchorHz === undefined
    || !Number.isFinite(anchorHz)
    || anchorHz < VELOCITY_FILTER_MIN_ANCHOR_HZ
    || anchorHz > VELOCITY_FILTER_MAX_ANCHOR_HZ
    || !Number.isFinite(midiNote)
    || !Number.isFinite(anchorMidiNote)
  ) return null;
  const pitchTrackedAnchor = Math.min(
    VELOCITY_FILTER_TRANSPARENT_HZ,
    anchorHz * 2 ** ((midiNote - anchorMidiNote) / 12),
  );
  return cutoffForValidatedAnchor(pitchTrackedAnchor, midiVelocity, octaves);
}

export function velocitySampleCutoff(
  anchorHz: number | undefined,
  midiVelocity: number,
  midiNote: number = VELOCITY_FILTER_REFERENCE_MIDI_NOTE,
  anchorMidiNote: number = VELOCITY_FILTER_REFERENCE_MIDI_NOTE,
): number | null {
  return velocitySampleCutoffForNoteAt(anchorHz, midiVelocity, midiNote, anchorMidiNote);
}
