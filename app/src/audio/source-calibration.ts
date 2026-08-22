import { parseInstrumentId } from './instrument-types';

/**
 * Source-side trims are part of each instrument definition. They deliberately
 * do not depend on the bar position, the other sounding tracks, or random
 * humanisation: a source has the same calibrated level every time it plays.
 */
export const PROCEDURAL_SOURCE_GAIN_DB = Object.freeze({
  kick: 0, snare: 1, hihat: -4, clap: -4, tom: -2, rim: -5,
  cowbell: -6, openhat: -4, shaker: -6, conga: -3, tambourine: -6,
  clave: -5, cabasa: -6, woodblock: -4, bass: -1, subbass: -1,
  lead: -10, pluck: 0, chord: -6, pad: -5.5, zap: -5, noise: -8,
} satisfies Record<string, number>);

export const SYNTH_SOURCE_GAIN_DB = Object.freeze({
  bass: -3.5, lead: -7, pad: -4, pluck: -2, acid: -5,
  funkbass: -6, clavinet: -8, rhodes: -5, organ: -10, wurlitzer: -5,
  discobass: -5, strings: -8, brass: -8, stab: -8, sub: -3,
  shimmer: -8, jangle: -7, dreampop: -8, bell: -10, supersaw: -12,
  hypersaw: -12, wobble: -8, growl: -13.5, evolving: -8, sweep: -8,
  warmpad: -7, glass: -8, epiano: -6, vibes: -7, organphase: -9,
  reese: -9, hoover: -10,
} satisfies Record<string, number>);

export const TONE_SOURCE_GAIN_DB = Object.freeze({
  'fm-epiano': -6, 'fm-bass': -4, 'fm-bell': -8, 'am-bell': -8,
  'am-tremolo': -7, 'membrane-kick': -3, 'membrane-tom': -5,
  'metal-cymbal': -11, 'metal-hihat': -10, 'pluck-string': -6,
  'duo-lead': -9,
} satisfies Record<string, number>);

export const ADVANCED_SOURCE_GAIN_DB = Object.freeze({
  supersaw: -10, 'sub-bass': -7, 'wobble-bass': -9, 'warm-pad': -10,
  'vibrato-lead': -10, 'tremolo-strings': -10, 'acid-bass': -8,
  'thick-lead': -10,
} satisfies Record<string, number>);

export type SourceCalibration =
  | { kind: 'manifest' }
  | { kind: 'fixed'; gainDb: number };

/** Resolve the one source-calibration contract used by every catalogue path. */
export function getSourceCalibration(sampleId: string): SourceCalibration | null {
  const instrument = parseInstrumentId(sampleId);
  if (instrument.type === 'sampled') return { kind: 'manifest' };
  const tables: Partial<Record<typeof instrument.type, Readonly<Record<string, number>>>> = {
    sample: PROCEDURAL_SOURCE_GAIN_DB,
    synth: SYNTH_SOURCE_GAIN_DB,
    tone: TONE_SOURCE_GAIN_DB,
    advanced: ADVANCED_SOURCE_GAIN_DB,
  };
  const gainDb = tables[instrument.type]?.[instrument.presetId];
  return gainDb === undefined ? null : { kind: 'fixed', gainDb };
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
