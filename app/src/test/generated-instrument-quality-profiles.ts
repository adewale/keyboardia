import {
  INSTRUMENT_CATEGORY_ORDER,
  INSTRUMENT_GROUPS,
  type InstrumentCategory,
} from '../shared/instrument-catalog';
import type { InstrumentType } from '../audio/instrument-types';

export type GeneratedInstrumentRole =
  | 'drum-low'
  | 'drum-mid'
  | 'drum-high'
  | 'bass'
  | 'keys'
  | 'lead'
  | 'pad'
  | 'fx';

export type TimbralMotionContract = 'darken' | 'brighten' | 'vary' | 'stable';

export interface GeneratedInstrumentQualityProfile {
  id: string;
  presetId: string;
  engine: Exclude<InstrumentType, 'sampled'>;
  role: GeneratedInstrumentRole;
  pitched: boolean;
  expectedFundamentalHz?: number;
  transient: boolean;
  noteOffsets: readonly number[];
  durationsSeconds: readonly number[];
  velocities: readonly number[];
  motion: TimbralMotionContract;
  minimumLoudnessLkfs: number;
}

const LOW_DRUMS = new Set([
  'kick',
  'tom',
  'conga',
  'tone:membrane-kick',
  'tone:membrane-tom',
]);

const HIGH_DRUMS = new Set([
  'hihat',
  'openhat',
  'shaker',
  'tambourine',
  'cabasa',
  'tone:metal-cymbal',
  'tone:metal-hihat',
]);

const UNPITCHED = new Set([
  ...LOW_DRUMS,
  ...HIGH_DRUMS,
  'snare',
  'clap',
  'rim',
  'cowbell',
  'clave',
  'woodblock',
  'zap',
  'noise',
]);

const TRANSIENT = new Set([
  ...UNPITCHED,
  'pluck',
  'synth:pluck',
  'synth:stab',
  'synth:bell',
  'synth:vibes',
  'tone:fm-bell',
  'tone:am-bell',
  'tone:pluck-string',
]);

const PROCEDURAL_FUNDAMENTALS_HZ: Readonly<Record<string, number>> = {
  bass: 55,
  subbass: 40,
  lead: 440,
  pluck: 330,
  chord: 220,
  pad: 220,
};

const DARKENING = new Set([
  'pluck',
  'synth:bass',
  'synth:lead',
  'synth:pluck',
  'synth:acid',
  'tone:fm-epiano',
  'advanced:acid-bass',
]);

const BRIGHTENING = new Set([
  'synth:pad',
  'synth:evolving',
  'synth:hoover',
]);

const VARYING = new Set([
  'synth:warmpad',
  'synth:organphase',
  'synth:reese',
  'synth:wobble',
  'synth:growl',
  'tone:am-tremolo',
  'tone:duo-lead',
  'advanced:supersaw',
  'advanced:wobble-bass',
  'advanced:warm-pad',
  'advanced:vibrato-lead',
  'advanced:tremolo-strings',
  'advanced:thick-lead',
]);

const MINIMUM_LOUDNESS_BY_ROLE: Readonly<Record<GeneratedInstrumentRole, number>> = {
  'drum-low': -23,
  'drum-mid': -33,
  'drum-high': -34,
  bass: -27,
  keys: -27,
  lead: -28,
  pad: -24,
  fx: -31,
};

function engineAndPreset(id: string, type: string): {
  engine: GeneratedInstrumentQualityProfile['engine'];
  presetId: string;
} {
  if (type === 'sample') return { engine: 'sample', presetId: id };
  const separator = id.indexOf(':');
  return {
    engine: type as GeneratedInstrumentQualityProfile['engine'],
    presetId: separator >= 0 ? id.slice(separator + 1) : id,
  };
}

function roleFor(category: InstrumentCategory, id: string): GeneratedInstrumentRole {
  if (category === 'drums') {
    if (LOW_DRUMS.has(id)) return 'drum-low';
    if (HIGH_DRUMS.has(id)) return 'drum-high';
    return 'drum-mid';
  }
  if (category === 'leads') return 'lead';
  if (category === 'pads') return 'pad';
  return category;
}

function motionFor(id: string): TimbralMotionContract {
  if (DARKENING.has(id)) return 'darken';
  if (BRIGHTENING.has(id)) return 'brighten';
  if (VARYING.has(id)) return 'vary';
  return 'stable';
}

/**
 * Exhaustive test contracts for every generated picker voice.
 * The array is derived from the picker vocabulary, so catalogue additions are
 * visible to the audit instead of silently escaping a hand-maintained test list.
 */
export const GENERATED_INSTRUMENT_QUALITY_PROFILES: readonly GeneratedInstrumentQualityProfile[] =
  INSTRUMENT_CATEGORY_ORDER.flatMap(category =>
    INSTRUMENT_GROUPS[category].instruments.flatMap(instrument => {
      if (instrument.type === 'sampled') return [];
      const { engine, presetId } = engineAndPreset(instrument.id, instrument.type);
      const role = roleFor(category, instrument.id);
      const pitched = !UNPITCHED.has(instrument.id);
      const transient = TRANSIENT.has(instrument.id);
      return [{
        id: instrument.id,
        presetId,
        engine,
        role,
        pitched,
        expectedFundamentalHz: pitched
          ? (engine === 'sample' ? PROCEDURAL_FUNDAMENTALS_HZ[instrument.id] : 261.625565)
          : undefined,
        transient,
        noteOffsets: pitched ? [-12, 0, 12] : [0],
        durationsSeconds: transient ? [0.12, 0.35] : [0.18, 0.8],
        velocities: [40, 90, 127],
        motion: motionFor(instrument.id),
        minimumLoudnessLkfs: MINIMUM_LOUDNESS_BY_ROLE[role],
      } satisfies GeneratedInstrumentQualityProfile];
    }),
  );
