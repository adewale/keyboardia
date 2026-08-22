/**
 * The only conversion boundary between authored TrackEnvelope values and the
 * scheduling dialects used by Keyboardia's engines.
 */
import type { TrackEnvelope } from '../shared/sync-types';
import type { ResolvedEnvelopeV2 } from '../shared/envelope-contract-v2';
import { clampTrackEnvelope } from '../shared/envelope';

export type EnvelopeTimeUnit = 'seconds' | 'steps';
export type EnvelopeNoteLock = Partial<Pick<TrackEnvelope, 'attack' | 'decay' | 'release'>>;

/** Lossless for ADSR renderers; deterministic best-effort projection otherwise. */
export function resolvedEnvelopeV2ToLegacy(
  envelope: ResolvedEnvelopeV2,
): TrackEnvelope {
  return {
    attack: envelope.attackSeconds,
    decay: envelope.decaySeconds ?? 0,
    sustain: envelope.sustain ?? (envelope.model === 'ar' ? 1 : 0),
    release: envelope.releaseSeconds ?? 0,
  };
}

export interface ToneEnvelopeSchedule {
  duration: number | string;
  envelope: TrackEnvelope;
}

/**
 * Tone's ADSR-shaped synth API has no hold stage. For finite AD/AHD voices,
 * hold the peak through attack + hold and use the native release segment as
 * the finite decay. Crucially, the sequencer gate is ignored for these models.
 */
export function resolvedEnvelopeV2ToToneSchedule(
  envelope: ResolvedEnvelopeV2,
  gatedDuration: number | string,
): ToneEnvelopeSchedule {
  if (envelope.model === 'ad' || envelope.model === 'ahd') {
    return {
      duration: envelope.attackSeconds
        + (envelope.model === 'ahd' ? envelope.holdSeconds ?? 0 : 0),
      envelope: {
        attack: envelope.attackSeconds,
        decay: 0,
        sustain: 1,
        release: envelope.decaySeconds ?? 0,
      },
    };
  }
  return { duration: gatedDuration, envelope: resolvedEnvelopeV2ToLegacy(envelope) };
}

export function envelopeTimeScale(bpm: number, unit: EnvelopeTimeUnit = 'seconds'): number {
  if (unit === 'seconds') return 1;
  // Keyboardia's grid is sixteenth-note based: four steps per quarter note.
  return 60 / Math.max(1, bpm) / 4;
}

export function translateTrackEnvelope(
  envelope: TrackEnvelope,
  bpm: number,
  unit: EnvelopeTimeUnit = 'seconds',
): TrackEnvelope {
  const canonical = clampTrackEnvelope(envelope);
  const scale = envelopeTimeScale(bpm, unit);
  return {
    attack: canonical.attack * scale,
    decay: canonical.decay * scale,
    sustain: canonical.sustain,
    release: canonical.release * scale,
  };
}

export function effectiveAudioEnvelope(
  baseAudioEnvelope: TrackEnvelope,
  bpm: number,
  unit: EnvelopeTimeUnit,
  noteOverride?: EnvelopeNoteLock,
): TrackEnvelope {
  if (!noteOverride) return baseAudioEnvelope;
  const scale = envelopeTimeScale(bpm, unit);
  return {
    ...baseAudioEnvelope,
    attack: noteOverride.attack === undefined
      ? baseAudioEnvelope.attack
      : noteOverride.attack * scale,
    decay: noteOverride.decay === undefined
      ? baseAudioEnvelope.decay
      : noteOverride.decay * scale,
    release: noteOverride.release === undefined
      ? baseAudioEnvelope.release
      : noteOverride.release * scale,
  };
}
