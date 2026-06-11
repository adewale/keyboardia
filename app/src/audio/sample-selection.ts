/**
 * Pure sample-selection logic for SampledInstrument.
 *
 * Extracted so the selection invariants can be property-tested directly
 * (see sample-selection.property.test.ts) and so playNote stays a thin
 * orchestration layer over total, individually-verified functions.
 */

/**
 * Find the sampled note nearest to the requested MIDI note.
 *
 * Ties prefer the HIGHER sample: shifting a sample down (slowing it)
 * degrades less audibly than shifting up, which sharpens transients and
 * shortens the decay.
 *
 * Returns undefined only for an empty list (total otherwise).
 */
export function nearestSampleNote(
  notes: readonly number[],
  midiNote: number
): number | undefined {
  let best: number | undefined;
  for (const note of notes) {
    if (best === undefined) {
      best = note;
      continue;
    }
    const distance = Math.abs(midiNote - note);
    const bestDistance = Math.abs(midiNote - best);
    if (distance < bestDistance || (distance === bestDistance && note > best)) {
      best = note;
    }
  }
  return best;
}

export interface VelocityRange {
  velocityMin: number;
  velocityMax: number;
}

/**
 * Select the velocity layer for a MIDI velocity.
 *
 * Prefers a layer whose [velocityMin, velocityMax] range contains the
 * velocity; if none does (gappy manifest), falls back to the layer with
 * the nearest range midpoint. Total for any non-empty input.
 */
export function selectVelocityLayer<T extends VelocityRange>(
  layers: readonly T[],
  velocity: number
): T | undefined {
  if (layers.length === 0) return undefined;
  if (layers.length === 1) return layers[0];

  const match = layers.find(
    l => velocity >= l.velocityMin && velocity <= l.velocityMax
  );
  if (match) return match;

  return layers.reduce((closest, layer) => {
    const layerMid = (layer.velocityMin + layer.velocityMax) / 2;
    const closestMid = (closest.velocityMin + closest.velocityMax) / 2;
    return Math.abs(velocity - layerMid) < Math.abs(velocity - closestMid)
      ? layer
      : closest;
  });
}

export interface LoopSpec {
  /** Loop start in seconds (≥ 0). */
  start: number;
  /** Loop end in seconds (> start). Undefined = loop to buffer end. */
  end?: number;
}

/**
 * Validate a manifest loop declaration into a well-formed LoopSpec, or
 * null if looping is not requested or the region is malformed. Malformed
 * regions are rejected wholesale rather than "repaired" — a wrong loop
 * is far more audible than no loop.
 */
export function validatedLoop(mapping: {
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
}): LoopSpec | null {
  if (mapping.loop !== true) return null;

  const start = mapping.loopStart ?? 0;
  if (!Number.isFinite(start) || start < 0) return null;

  if (mapping.loopEnd === undefined) return { start };

  const end = mapping.loopEnd;
  if (!Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/**
 * Decibels → linear gain (20·log10 convention). Total: non-finite input
 * is treated as 0 dB so a malformed manifest can never silence or blast
 * an instrument.
 */
export function dbToGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}
