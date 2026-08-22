/**
 * Runtime-neutral v2 amplitude-envelope contract.
 *
 * This module has no browser or audio dependencies so the client, worker,
 * notation tooling and renderers can share validation without importing one
 * another.  Legacy v2.3 data is accepted at the boundary and immediately
 * converted into this discriminated form.
 */

export type EnvelopeDurationUnit = 'seconds' | 'steps';

export interface EnvelopeDuration {
  value: number;
  unit: EnvelopeDurationUnit;
}

export type EnvelopeModel = 'ad' | 'ahd' | 'ar' | 'adsr';
export type EnvelopeStageName = 'attack' | 'hold' | 'decay' | 'release';
export type SamplePlaybackMode = 'trigger' | 'gate' | 'loop';

export type TrackEnvelopeV2 =
  | {
      model: 'ad';
      attack: EnvelopeDuration;
      decay: EnvelopeDuration;
    }
  | {
      model: 'ahd';
      attack: EnvelopeDuration;
      hold: EnvelopeDuration;
      decay: EnvelopeDuration;
    }
  | {
      model: 'ar';
      attack: EnvelopeDuration;
      release: EnvelopeDuration;
    }
  | {
      model: 'adsr';
      attack: EnvelopeDuration;
      decay: EnvelopeDuration;
      sustain: number;
      release: EnvelopeDuration;
    };

export interface EnvelopeLockV2 {
  step: number;
  stage: EnvelopeStageName;
  duration: EnvelopeDuration;
}

export interface EnvelopeCapabilityV2 {
  models: readonly EnvelopeModel[];
  playbackModes?: readonly SamplePlaybackMode[];
  sustainSource: 'oscillator' | 'finite-buffer' | 'sample-loop' | 'none';
  releaseSource: 'gain-only' | 'source-tail' | 'release-trigger' | 'none';
  lockableStages: readonly EnvelopeStageName[];
}

/** The four-number shape written by Keyboardia v2.3 and track-envelope-v1. */
export interface LegacyTrackEnvelopeV23 {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export type EnvelopeWireValueV2 = TrackEnvelopeV2 | LegacyTrackEnvelopeV23;

export interface ConvertedEnvelopeUnitsV2 {
  envelope: TrackEnvelopeV2;
  /** Stages whose converted value had to be clamped to the authored range. */
  clampedStages: readonly EnvelopeStageName[];
}

export const ENVELOPE_DURATION_RANGES_V2: Record<
  EnvelopeStageName,
  Record<EnvelopeDurationUnit, { min: number; max: number }>
> = {
  attack: {
    seconds: { min: 0, max: 4 },
    steps: { min: 0, max: 48 },
  },
  hold: {
    seconds: { min: 0, max: 8 },
    steps: { min: 0, max: 96 },
  },
  decay: {
    seconds: { min: 0, max: 8 },
    steps: { min: 0, max: 96 },
  },
  release: {
    seconds: { min: 0, max: 8 },
    steps: { min: 0, max: 96 },
  },
};

export const TRACK_GATE_RANGE_V2 = { min: 0, max: 100 } as const;

export const DEFAULT_TRACK_ENVELOPE_V2: TrackEnvelopeV2 = {
  model: 'adsr',
  attack: { value: 0.003, unit: 'seconds' },
  decay: { value: 0, unit: 'seconds' },
  sustain: 1,
  release: { value: 0.1, unit: 'seconds' },
};

export interface ResolvedEnvelopeV2 {
  model: EnvelopeModel;
  attackSeconds: number;
  holdSeconds?: number;
  decaySeconds?: number;
  sustain?: number;
  releaseSeconds?: number;
}

export function isEnvelopeDuration(value: unknown): value is EnvelopeDuration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.value === 'number'
    && Number.isFinite(candidate.value)
    && (candidate.unit === 'seconds' || candidate.unit === 'steps');
}

export interface EnvelopeValidationResultV2 {
  valid: boolean;
  errors: readonly string[];
  envelope?: TrackEnvelopeV2;
}

function durationForStage(
  value: unknown,
  stage: EnvelopeStageName,
  errors: string[],
): EnvelopeDuration | undefined {
  if (!isEnvelopeDuration(value)) {
    errors.push(`${stage} must be a finite typed duration`);
    return undefined;
  }
  const range = ENVELOPE_DURATION_RANGES_V2[stage][value.unit];
  if (value.value < range.min || value.value > range.max) {
    errors.push(`${stage} must be between ${range.min} and ${range.max} ${value.unit}`);
    return undefined;
  }
  return { value: Object.is(value.value, -0) ? 0 : value.value, unit: value.unit };
}

/** Strict, runtime-neutral validation used at every v2 serialization boundary. */
export function validateTrackEnvelopeV2(value: unknown): EnvelopeValidationResultV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['envelope must be an object'] };
  }
  const input = value as Record<string, unknown>;
  const errors: string[] = [];
  if (input.model !== 'ad' && input.model !== 'ahd' && input.model !== 'ar' && input.model !== 'adsr') {
    return { valid: false, errors: ['envelope model must be ad, ahd, ar, or adsr'] };
  }
  const allowedKeysByModel: Record<EnvelopeModel, readonly string[]> = {
    ad: ['model', 'attack', 'decay'],
    ahd: ['model', 'attack', 'hold', 'decay'],
    ar: ['model', 'attack', 'release'],
    adsr: ['model', 'attack', 'decay', 'sustain', 'release'],
  };
  const unknownKeys = Object.keys(input).filter(key => !allowedKeysByModel[input.model as EnvelopeModel].includes(key));
  if (unknownKeys.length > 0) errors.push(`unknown or inactive fields: ${unknownKeys.sort().join(', ')}`);
  const attack = durationForStage(input.attack, 'attack', errors);
  if (input.model === 'ad') {
    const decay = durationForStage(input.decay, 'decay', errors);
    return attack && decay && errors.length === 0
      ? { valid: true, errors, envelope: { model: 'ad', attack, decay } }
      : { valid: false, errors };
  }
  if (input.model === 'ahd') {
    const hold = durationForStage(input.hold, 'hold', errors);
    const decay = durationForStage(input.decay, 'decay', errors);
    return attack && hold && decay && errors.length === 0
      ? { valid: true, errors, envelope: { model: 'ahd', attack, hold, decay } }
      : { valid: false, errors };
  }
  if (input.model === 'ar') {
    const release = durationForStage(input.release, 'release', errors);
    return attack && release && errors.length === 0
      ? { valid: true, errors, envelope: { model: 'ar', attack, release } }
      : { valid: false, errors };
  }
  const decay = durationForStage(input.decay, 'decay', errors);
  const release = durationForStage(input.release, 'release', errors);
  const sustain = input.sustain;
  if (typeof sustain !== 'number' || !Number.isFinite(sustain) || sustain < 0 || sustain > 1) {
    errors.push('sustain must be between 0 and 1');
  }
  return attack && decay && release && typeof sustain === 'number' && errors.length === 0
    ? { valid: true, errors, envelope: { model: 'adsr', attack, decay, sustain, release } }
    : { valid: false, errors };
}

function clampDurationForStage(value: unknown, stage: EnvelopeStageName): EnvelopeDuration | null {
  if (!isEnvelopeDuration(value)) return null;
  const range = ENVELOPE_DURATION_RANGES_V2[stage][value.unit];
  return {
    value: Math.max(range.min, Math.min(range.max, value.value)),
    unit: value.unit,
  };
}

/** Best-effort deterministic persisted-state repair; null means irreparable. */
export function repairTrackEnvelopeV2(value: unknown): TrackEnvelopeV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const attack = clampDurationForStage(input.attack, 'attack');
  if (!attack) return null;
  if (input.model === 'ad') {
    const decay = clampDurationForStage(input.decay, 'decay');
    return decay ? { model: 'ad', attack, decay } : null;
  }
  if (input.model === 'ahd') {
    const hold = clampDurationForStage(input.hold, 'hold');
    const decay = clampDurationForStage(input.decay, 'decay');
    return hold && decay ? { model: 'ahd', attack, hold, decay } : null;
  }
  if (input.model === 'ar') {
    const release = clampDurationForStage(input.release, 'release');
    return release ? { model: 'ar', attack, release } : null;
  }
  if (input.model === 'adsr') {
    const decay = clampDurationForStage(input.decay, 'decay');
    const release = clampDurationForStage(input.release, 'release');
    if (!decay || !release || typeof input.sustain !== 'number' || !Number.isFinite(input.sustain)) return null;
    return {
      model: 'adsr',
      attack,
      decay,
      sustain: Math.max(0, Math.min(1, input.sustain)),
      release,
    };
  }
  return null;
}

export function legacyTrackEnvelopeToV2(
  envelope: LegacyTrackEnvelopeV23,
  unit: EnvelopeDurationUnit = 'seconds',
): TrackEnvelopeV2 {
  return clampTrackEnvelopeV2({
    model: 'adsr',
    attack: { value: envelope.attack, unit },
    decay: { value: envelope.decay, unit },
    sustain: envelope.sustain,
    release: { value: envelope.release, unit },
  });
}

export function convertTrackEnvelopeUnitsV2(
  envelope: TrackEnvelopeV2,
  targetUnit: EnvelopeDurationUnit,
  bpm: number,
): TrackEnvelopeV2 {
  const convert = (duration: EnvelopeDuration): EnvelopeDuration => {
    if (duration.unit === targetUnit) return { ...duration };
    const seconds = durationToSeconds(duration, bpm);
    return targetUnit === 'seconds'
      ? { value: seconds, unit: 'seconds' }
      : { value: seconds / (60 / bpm / 4), unit: 'steps' };
  };
  switch (envelope.model) {
    case 'ad': return { ...envelope, attack: convert(envelope.attack), decay: convert(envelope.decay) };
    case 'ahd': return {
      ...envelope,
      attack: convert(envelope.attack),
      hold: convert(envelope.hold),
      decay: convert(envelope.decay),
    };
    case 'ar': return { ...envelope, attack: convert(envelope.attack), release: convert(envelope.release) };
    case 'adsr': return {
      ...envelope,
      attack: convert(envelope.attack),
      decay: convert(envelope.decay),
      release: convert(envelope.release),
    };
  }
}

export function isSamplePlaybackMode(value: unknown): value is SamplePlaybackMode {
  return value === 'trigger' || value === 'gate' || value === 'loop';
}

export function isLegacyTrackEnvelopeV23(value: unknown): value is LegacyTrackEnvelopeV23 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return ['attack', 'decay', 'sustain', 'release'].every(
    key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]),
  );
}

export function isTrackEnvelopeV2(value: unknown): value is TrackEnvelopeV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.model === 'ad') {
    return isEnvelopeDuration(candidate.attack) && isEnvelopeDuration(candidate.decay);
  }
  if (candidate.model === 'ahd') {
    return isEnvelopeDuration(candidate.attack)
      && isEnvelopeDuration(candidate.hold)
      && isEnvelopeDuration(candidate.decay);
  }
  if (candidate.model === 'ar') {
    return isEnvelopeDuration(candidate.attack) && isEnvelopeDuration(candidate.release);
  }
  if (candidate.model === 'adsr') {
    return isEnvelopeDuration(candidate.attack)
      && isEnvelopeDuration(candidate.decay)
      && typeof candidate.sustain === 'number'
      && Number.isFinite(candidate.sustain)
      && isEnvelopeDuration(candidate.release);
  }
  return false;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampEnvelopeDurationV2(
  stage: EnvelopeStageName,
  duration: EnvelopeDuration,
): EnvelopeDuration {
  const range = ENVELOPE_DURATION_RANGES_V2[stage][duration.unit];
  return {
    value: clamp(finiteOr(duration.value, range.min), range.min, range.max),
    unit: duration.unit,
  };
}

/** Clamp an already parsed envelope without changing its model or units. */
export function clampTrackEnvelopeV2(envelope: TrackEnvelopeV2): TrackEnvelopeV2 {
  switch (envelope.model) {
    case 'ad':
      return {
        model: 'ad',
        attack: clampEnvelopeDurationV2('attack', envelope.attack),
        decay: clampEnvelopeDurationV2('decay', envelope.decay),
      };
    case 'ahd':
      return {
        model: 'ahd',
        attack: clampEnvelopeDurationV2('attack', envelope.attack),
        hold: clampEnvelopeDurationV2('hold', envelope.hold),
        decay: clampEnvelopeDurationV2('decay', envelope.decay),
      };
    case 'ar':
      return {
        model: 'ar',
        attack: clampEnvelopeDurationV2('attack', envelope.attack),
        release: clampEnvelopeDurationV2('release', envelope.release),
      };
    case 'adsr':
      return {
        model: 'adsr',
        attack: clampEnvelopeDurationV2('attack', envelope.attack),
        decay: clampEnvelopeDurationV2('decay', envelope.decay),
        sustain: clamp(finiteOr(envelope.sustain, 1), 0, 1),
        release: clampEnvelopeDurationV2('release', envelope.release),
      };
  }
}

export function normalizeTrackEnvelopeV2(
  value: unknown,
  legacyUnit: EnvelopeDurationUnit = 'seconds',
): TrackEnvelopeV2 | null {
  if (isTrackEnvelopeV2(value)) return clampTrackEnvelopeV2(value);
  if (isLegacyTrackEnvelopeV23(value)) return legacyTrackEnvelopeToV2(value, legacyUnit);
  return null;
}

export function trackEnvelopeV2ToLegacySeconds(
  envelope: TrackEnvelopeV2,
  bpm: number,
): LegacyTrackEnvelopeV23 {
  const resolved = resolveEnvelopeV2(envelope, bpm);
  return {
    attack: resolved.attackSeconds,
    decay: resolved.decaySeconds ?? 0,
    sustain: resolved.sustain ?? (resolved.model === 'ar' ? 1 : 0),
    release: resolved.releaseSeconds ?? 0,
  };
}

export function durationToSeconds(duration: EnvelopeDuration, bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`Tempo must be a positive finite BPM; received ${bpm}`);
  }
  return duration.unit === 'seconds'
    ? duration.value
    : duration.value * (60 / bpm / 4);
}

export function convertTrackEnvelopeUnitsWithReportV2(
  envelope: TrackEnvelopeV2,
  targetUnit: EnvelopeDurationUnit,
  bpm: number,
): ConvertedEnvelopeUnitsV2 {
  const stepSeconds = durationToSeconds({ value: 1, unit: 'steps' }, bpm);
  const clampedStages: EnvelopeStageName[] = [];
  const convert = (stage: EnvelopeStageName, duration: EnvelopeDuration): EnvelopeDuration => {
    const seconds = durationToSeconds(duration, bpm);
    const raw = targetUnit === 'seconds' ? seconds : seconds / stepSeconds;
    const converted = clampEnvelopeDurationV2(stage, { value: raw, unit: targetUnit });
    if (converted.value !== raw) clampedStages.push(stage);
    return converted;
  };

  let converted: TrackEnvelopeV2;
  switch (envelope.model) {
    case 'ad':
      converted = {
        model: 'ad',
        attack: convert('attack', envelope.attack),
        decay: convert('decay', envelope.decay),
      };
      break;
    case 'ahd':
      converted = {
        model: 'ahd',
        attack: convert('attack', envelope.attack),
        hold: convert('hold', envelope.hold),
        decay: convert('decay', envelope.decay),
      };
      break;
    case 'ar':
      converted = {
        model: 'ar',
        attack: convert('attack', envelope.attack),
        release: convert('release', envelope.release),
      };
      break;
    case 'adsr':
      converted = {
        model: 'adsr',
        attack: convert('attack', envelope.attack),
        decay: convert('decay', envelope.decay),
        sustain: clamp(envelope.sustain, 0, 1),
        release: convert('release', envelope.release),
      };
      break;
  }
  return { envelope: converted, clampedStages };
}

export function activeEnvelopeStages(model: EnvelopeModel): readonly EnvelopeStageName[] {
  switch (model) {
    case 'ad': return ['attack', 'decay'];
    case 'ahd': return ['attack', 'hold', 'decay'];
    case 'ar': return ['attack', 'release'];
    case 'adsr': return ['attack', 'decay', 'release'];
  }
}

export function resolveEnvelopeV2(
  envelope: TrackEnvelopeV2,
  bpm: number,
): ResolvedEnvelopeV2 {
  switch (envelope.model) {
    case 'ad':
      return {
        model: envelope.model,
        attackSeconds: durationToSeconds(envelope.attack, bpm),
        decaySeconds: durationToSeconds(envelope.decay, bpm),
      };
    case 'ahd':
      return {
        model: envelope.model,
        attackSeconds: durationToSeconds(envelope.attack, bpm),
        holdSeconds: durationToSeconds(envelope.hold, bpm),
        decaySeconds: durationToSeconds(envelope.decay, bpm),
      };
    case 'ar':
      return {
        model: envelope.model,
        attackSeconds: durationToSeconds(envelope.attack, bpm),
        releaseSeconds: durationToSeconds(envelope.release, bpm),
      };
    case 'adsr':
      return {
        model: envelope.model,
        attackSeconds: durationToSeconds(envelope.attack, bpm),
        decaySeconds: durationToSeconds(envelope.decay, bpm),
        sustain: envelope.sustain,
        releaseSeconds: durationToSeconds(envelope.release, bpm),
      };
  }
}
