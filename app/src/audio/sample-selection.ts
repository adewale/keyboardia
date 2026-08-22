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

export interface RoundRobinVariant extends VelocityRange {
  roundRobinIndex?: number;
}

export interface VelocityGroupBlend<T> {
  layers: readonly T[];
  weight: number;
}

export interface VelocityBlend<T> {
  layer: T;
  weight: number;
}

function velocityGroups<T extends VelocityRange>(layers: readonly T[]): Array<{ min: number; max: number; layers: T[] }> {
  const groups = new Map<string, { min: number; max: number; layers: T[] }>();
  for (const layer of layers) {
    const key = `${layer.velocityMin}:${layer.velocityMax}`;
    const group = groups.get(key) ?? { min: layer.velocityMin, max: layer.velocityMax, layers: [] };
    group.layers.push(layer);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.min - b.min || a.max - b.max);
}

/**
 * Select one velocity group, or two normalized adjacent groups inside an
 * explicit crossfade. Round-robin variants remain grouped until after this
 * decision so variants never masquerade as velocity layers.
 */
export function selectVelocityGroupBlend<T extends VelocityRange>(
  layers: readonly T[],
  velocity: number,
  crossfadeWidth = 0
): Array<VelocityGroupBlend<T>> {
  const groups = velocityGroups(layers);
  if (groups.length === 0) return [];
  if (groups.length === 1) return [{ layers: groups[0].layers, weight: 1 }];

  if (crossfadeWidth > 0 && Number.isFinite(crossfadeWidth)) {
    for (let i = 0; i < groups.length - 1; i++) {
      const lower = groups[i];
      const upper = groups[i + 1];
      if (lower.max + 1 !== upper.min) continue;
      const center = (lower.max + upper.min) / 2;
      const start = center - crossfadeWidth / 2;
      const upperWeight = Math.min(1, Math.max(0, (velocity - start) / crossfadeWidth));
      if (upperWeight > 0 && upperWeight < 1) {
        return [
          { layers: lower.layers, weight: 1 - upperWeight },
          { layers: upper.layers, weight: upperWeight },
        ];
      }
    }
  }

  const containing = groups.find(group => velocity >= group.min && velocity <= group.max);
  if (containing) return [{ layers: containing.layers, weight: 1 }];
  const closest = groups.reduce((best, group) => {
    const midpoint = (group.min + group.max) / 2;
    const bestMidpoint = (best.min + best.max) / 2;
    return Math.abs(velocity - midpoint) < Math.abs(velocity - bestMidpoint) ? group : best;
  });
  return [{ layers: closest.layers, weight: 1 }];
}

/** Deterministically select a declared round-robin variant for a cursor. */
export function selectRoundRobinVariant<T extends RoundRobinVariant>(
  variants: readonly T[],
  cursor: number
): T | undefined {
  if (variants.length === 0) return undefined;
  const ordered = [...variants].sort((a, b) => (a.roundRobinIndex ?? 0) - (b.roundRobinIndex ?? 0));
  const safeCursor = Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : 0;
  return ordered[safeCursor % ordered.length];
}

export interface LoopSpec {
  /** Loop start in seconds (≥ 0). */
  start: number;
  /** Loop end in seconds (> start). Undefined = loop to buffer end. */
  end?: number;
  /** Requested equal-power crossfade width; current Web Audio loop playback supports zero only. */
  crossfadeFrames?: number;
  direction?: 'forward';
}

export interface SustainLoopFrames {
  startFrame: number;
  endFrame: number;
  crossfadeFrames: number;
  direction: 'forward';
}

export interface ZeroCrossfadeLoopApproval {
  status: string;
  crossfadeFrames: number;
  note: string;
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
  sustainLoop?: SustainLoopFrames;
}, decoded?: { length: number; sampleRate: number }, authoredSampleRate?: number,
approval?: ZeroCrossfadeLoopApproval): LoopSpec | null {
  if (mapping.loop !== true) return null;

  if (mapping.sustainLoop !== undefined) {
    const loop = mapping.sustainLoop;
    const frameRate = authoredSampleRate ?? decoded?.sampleRate;
    if (!decoded
      || !Number.isFinite(decoded.sampleRate)
      || decoded.sampleRate <= 0
      || !Number.isInteger(decoded.length)
      || decoded.length < 0
      || frameRate === undefined
      || !Number.isFinite(frameRate)
      || frameRate <= 0
      || !Number.isInteger(loop.startFrame)
      || !Number.isInteger(loop.endFrame)
      || !Number.isInteger(loop.crossfadeFrames)
      || loop.startFrame < 0
      || loop.endFrame <= loop.startFrame
      || loop.crossfadeFrames < 0
      || loop.crossfadeFrames * 2 >= loop.endFrame - loop.startFrame
      || loop.direction !== 'forward') return null;
    if (loop.crossfadeFrames === 0
        && (!approval
          || approval.crossfadeFrames !== 0
          || approval.status.trim().length === 0
          || approval.note.trim().length === 0)) return null;
    const startSeconds = loop.startFrame / frameRate;
    const endSeconds = loop.endFrame / frameRate;
    const decodedDurationSeconds = decoded.length / decoded.sampleRate;
    // AudioBuffer is resampled to the AudioContext rate by decodeAudioData.
    // Frame metadata stays in the manifest's authored rate, so compare in
    // seconds and scale any future runtime crossfade width to decoded frames.
    if (endSeconds > decodedDurationSeconds) return null;
    return {
      start: startSeconds,
      end: endSeconds,
      crossfadeFrames: Math.round(loop.crossfadeFrames * decoded.sampleRate / frameRate),
      direction: 'forward',
    };
  }

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
  const safeDb = Math.max(-24, Math.min(24, db));
  return Math.pow(10, safeDb / 20);
}
