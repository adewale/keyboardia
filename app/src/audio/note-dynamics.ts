import {
  isBassInstrument,
  isDrumInstrument,
  isKickInstrument,
} from '../shared/instrument-classification';
import {
  DEFAULT_STEP_MIDI_VELOCITY,
} from '../shared/constants';
import { velocityFromMultiplier } from './velocity';

export interface NoteDynamics {
  /** Stable timbre/layer input; humanization never changes it. */
  midiVelocity: number;
  /** Linear per-note amplitude applied exactly once by the renderer. */
  noteGain: number;
  /** True only when this step carries an explicit volume lock. */
  hasExplicitLock: boolean;
}

export type InstrumentHumanizationClass = 'tonal' | 'percussion' | 'low-end';

const HUMANIZATION_RANGE_DB: Readonly<Record<InstrumentHumanizationClass, number>> = {
  tonal: 2.5,
  percussion: 1.25,
  'low-end': 0.75,
};

/**
 * Resolve the sequencer's optional volume lock into independent timbre and
 * amplitude controls. Unlocked steps retain full note gain but use the
 * calibrated MIDI-90 layer; locked gain follows a 40 dB perceptual taper.
 */
export function resolveNoteDynamics(volumeLock: number | null | undefined): NoteDynamics {
  if (volumeLock === null || volumeLock === undefined) {
    return {
      midiVelocity: DEFAULT_STEP_MIDI_VELOCITY,
      noteGain: 1,
      hasExplicitLock: false,
    };
  }

  const finite = Number.isFinite(volumeLock) ? volumeLock : 1;
  const value = Math.min(1, Math.max(0, finite));
  return {
    midiVelocity: velocityFromMultiplier(value),
    noteGain: value === 0 ? 0 : 10 ** ((-40 * (1 - value)) / 20),
    hasExplicitLock: true,
  };
}

/** Stable FNV-1a seed for deterministic scheduler renders. */
export function noteHumanizationSeed(trackId: string, step: number, loopIteration: number): number {
  const value = `${trackId}\u0000${step}\u0000${loopIteration}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** One deterministic random sample in [0, 1) from a 32-bit seed. */
export function randomFromSeed(seed: number): number {
  let value = seed >>> 0;
  value += 0x6d2b79f5;
  let mixed = value;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

/** Classification uses musical role, not rendering-engine prefix. */
export function classifyInstrumentForHumanization(sampleId: string): InstrumentHumanizationClass {
  if (isKickInstrument(sampleId) || isBassInstrument(sampleId)) {
    return 'low-end';
  }
  return isDrumInstrument(sampleId) ? 'percussion' : 'tonal';
}

/**
 * Apply a bounded gain-only dB offset. Explicit volume locks are returned
 * bit-for-bit and zero remains zero. The RNG is injected to keep this pure.
 */
export function humanizeNoteGainDb(
  noteGain: number,
  hasExplicitLock: boolean,
  instrumentClass: InstrumentHumanizationClass,
  rng: () => number,
): number {
  if (hasExplicitLock || noteGain === 0) return noteGain;
  const random = Math.min(1, Math.max(0, rng()));
  const offsetDb = (random * 2 - 1) * HUMANIZATION_RANGE_DB[instrumentClass];
  return noteGain * 10 ** (offsetDb / 20);
}

/** Scheduler convenience preserving a stable layer while varying gain. */
export function resolveHumanizedNoteDynamics(
  volumeLock: number | null | undefined,
  sampleId: string,
  trackId: string,
  step: number,
  loopIteration: number,
): NoteDynamics {
  const resolved = resolveNoteDynamics(volumeLock);
  return {
    ...resolved,
    noteGain: humanizeNoteGainDb(
      resolved.noteGain,
      resolved.hasExplicitLock,
      classifyInstrumentForHumanization(sampleId),
      () => randomFromSeed(noteHumanizationSeed(trackId, step, loopIteration)),
    ),
  };
}
