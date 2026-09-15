/**
 * Committed, role-aware expectations for every selectable instrument.
 *
 * These profiles deliberately live outside the production catalogue. An
 * instrument cannot change its own quality thresholds by changing DSP or
 * catalogue metadata in the same candidate branch. The coverage assertion is
 * called by the audit and by tests so new/removed catalogue IDs fail closed.
 */

export type InstrumentRole = 'drums' | 'bass' | 'keys' | 'leads' | 'pads' | 'fx';
export type PitchMode = 'tonal' | 'unpitched' | 'noise';
/** What a confident monophonic estimate is allowed to establish for this voice. */
export type PitchReference =
  | 'not-applicable'
  | 'absolute-fundamental'
  | 'fundamental-one-octave-below'
  | 'harmonic-pitch-class';
export type EnvelopeClass = 'one-shot' | 'plucked' | 'sustained' | 'pad' | 'texture';
export type LoudnessClass = 'transient' | 'bass' | 'tonal' | 'texture';
/** Descriptive level/spectrum deltas only; no unmeasured layer claim. */
export type VelocityPolicy = 'measure-only';
/** Exact seed-A replay is required; selected procedural voices also promise a seed-A/B difference. */
export type VariationPolicy = 'replay-only' | 'alternate-seed-must-differ';
/** The evaluator checks mono fold-down, not whether a particular width is artistically correct. */
export type StereoPolicy = 'mono-fold-only';
export type RangeStress = 'low-interior' | 'high-interior';
export type ReleasePolicy = 'lifecycle' | 'natural-decay';

export interface InstrumentQualityProfile {
  id: string;
  role: InstrumentRole;
  pitchMode: PitchMode;
  pitchReference: PitchReference;
  envelopeClass: EnvelopeClass;
  loudnessClass: LoudnessClass;
  velocityPolicy: VelocityPolicy;
  /** Whether silence after note-off is required or the natural tail is only measured. */
  releasePolicy: ReleasePolicy;
  variationPolicy: VariationPolicy;
  stereoPolicy: StereoPolicy;
  rangeStress: RangeStress;
  render: {
    canonicalMidi: number;
    gateSeconds: number;
    /** Always at least 2.1 s so the two-second release hard gate is observable. */
    tailSeconds: number;
    repeatIntervalSeconds: number;
    polyphonyMidi: readonly number[];
  };
}

interface ProfileDefaults extends Omit<InstrumentQualityProfile, 'id' | 'pitchReference' | 'variationPolicy' | 'velocityPolicy' | 'stereoPolicy'> {
  variationPolicy?: VariationPolicy;
  velocityPolicy?: VelocityPolicy;
  stereoPolicy?: StereoPolicy;
}

const ALTERNATE_SEED_VARIATION_IDS = new Set([
  'kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat',
  'shaker', 'conga', 'tambourine', 'clave', 'cabasa', 'woodblock',
]);

const LIFECYCLE_RELEASE_IDS = new Set([
  'sampled:hammond-organ', 'synth:rhodes', 'synth:wurlitzer',
  'synth:epiano', 'synth:vibes', 'tone:fm-epiano', 'synth:organ',
  'synth:organphase', 'synth:clavinet', 'synth:bell', 'synth:stab',
  'synth:brass', 'synth:wobble', 'synth:growl', 'tone:fm-bell',
  'tone:am-bell', 'tone:am-tremolo',
]);

const TONAL_FX_IDS = new Set([
  'synth:bell', 'synth:stab', 'synth:brass', 'synth:wobble',
  'synth:growl', 'tone:fm-bell', 'tone:am-bell', 'tone:am-tremolo',
]);

const HARMONIC_PITCH_CLASS_IDS = new Set([
  // Plucked bass waveforms regularly make autocorrelation prefer a subharmonic;
  // a confident estimate can establish pitch class, not sounding octave.
  'sampled:finger-bass', 'sampled:slap-bass',
]);

function profiles(ids: readonly string[], defaults: ProfileDefaults): InstrumentQualityProfile[] {
  return ids.map(id => {
    const pitchMode = TONAL_FX_IDS.has(id) ? 'tonal' : defaults.pitchMode;
    const pitchReference: PitchReference = pitchMode !== 'tonal'
      ? 'not-applicable'
      : id === 'sampled:hammond-organ'
        ? 'fundamental-one-octave-below'
        : HARMONIC_PITCH_CLASS_IDS.has(id)
          ? 'harmonic-pitch-class'
          : 'absolute-fundamental';
    return {
      id,
      ...defaults,
      pitchMode,
      pitchReference,
      releasePolicy: LIFECYCLE_RELEASE_IDS.has(id) ? 'lifecycle' : defaults.releasePolicy,
      velocityPolicy: defaults.velocityPolicy ?? 'measure-only',
      variationPolicy: ALTERNATE_SEED_VARIATION_IDS.has(id)
        ? 'alternate-seed-must-differ'
        : defaults.variationPolicy ?? 'replay-only',
      stereoPolicy: defaults.stereoPolicy ?? 'mono-fold-only',
    };
  });
}

const DRUM_IDS = [
  'sampled:808-kick', 'sampled:808-snare', 'sampled:808-hihat-closed',
  'sampled:808-hihat-open', 'sampled:808-clap', 'sampled:acoustic-kick',
  'sampled:acoustic-snare', 'sampled:acoustic-hihat-closed',
  'sampled:acoustic-hihat-open', 'sampled:acoustic-ride',
  'sampled:acoustic-crash', 'sampled:brushes-snare', 'kick', 'snare',
  'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat', 'shaker', 'conga',
  'tambourine', 'clave', 'cabasa', 'woodblock', 'tone:membrane-kick',
  'tone:membrane-tom', 'tone:metal-cymbal', 'tone:metal-hihat',
] as const;

const BASS_IDS = [
  'sampled:finger-bass', 'sampled:slap-bass', 'bass', 'subbass',
  'synth:bass', 'synth:acid', 'synth:sub', 'synth:funkbass',
  'synth:discobass', 'synth:reese', 'synth:hoover', 'tone:fm-bass',
  'advanced:sub-bass', 'advanced:wobble-bass', 'advanced:acid-bass',
] as const;

const KEY_IDS = [
  'sampled:piano', 'sampled:vibraphone', 'sampled:marimba',
  'sampled:kalimba', 'sampled:steel-drums', 'sampled:hammond-organ',
  'synth:rhodes', 'synth:wurlitzer', 'synth:epiano', 'synth:vibes',
  'tone:fm-epiano', 'synth:organ', 'synth:organphase', 'synth:clavinet',
] as const;

const LEAD_IDS = [
  'sampled:alto-sax', 'sampled:clean-guitar', 'sampled:acoustic-guitar',
  'lead', 'pluck', 'synth:lead', 'synth:pluck', 'synth:supersaw',
  'synth:hypersaw', 'tone:pluck-string', 'tone:duo-lead',
  'advanced:supersaw', 'advanced:thick-lead', 'advanced:vibrato-lead',
] as const;

const PAD_IDS = [
  'sampled:string-section', 'sampled:french-horn', 'pad', 'chord',
  'synth:pad', 'synth:warmpad', 'synth:strings', 'synth:shimmer',
  'synth:dreampop', 'synth:glass', 'synth:jangle', 'synth:evolving',
  'synth:sweep', 'advanced:warm-pad', 'advanced:tremolo-strings',
] as const;

const FX_IDS = [
  'sampled:vinyl-crackle', 'zap', 'noise', 'synth:bell', 'synth:stab',
  'synth:brass', 'synth:wobble', 'synth:growl', 'tone:fm-bell',
  'tone:am-bell', 'tone:am-tremolo',
] as const;

const ALL_PROFILES = [
  ...profiles(DRUM_IDS, {
    role: 'drums',
    pitchMode: 'unpitched',
    envelopeClass: 'one-shot',
    releasePolicy: 'natural-decay',
    loudnessClass: 'transient',
    rangeStress: 'high-interior',
    render: {
      canonicalMidi: 60,
      gateSeconds: 0.12,
      tailSeconds: 2.2,
      repeatIntervalSeconds: 0.18,
      polyphonyMidi: [60, 60, 60, 60, 60, 60, 60, 60],
    },
  }),
  ...profiles(BASS_IDS, {
    role: 'bass',
    pitchMode: 'tonal',
    envelopeClass: 'sustained',
    releasePolicy: 'lifecycle',
    loudnessClass: 'bass',
    rangeStress: 'low-interior',
    render: {
      canonicalMidi: 48,
      gateSeconds: 0.6,
      tailSeconds: 2.5,
      repeatIntervalSeconds: 0.35,
      polyphonyMidi: [36, 43, 48],
    },
  }),
  ...profiles(KEY_IDS, {
    role: 'keys',
    pitchMode: 'tonal',
    envelopeClass: 'plucked',
    releasePolicy: 'natural-decay',
    loudnessClass: 'tonal',
    rangeStress: 'high-interior',
    render: {
      canonicalMidi: 60,
      gateSeconds: 0.7,
      tailSeconds: 2.5,
      repeatIntervalSeconds: 0.4,
      polyphonyMidi: [60, 64, 67, 72],
    },
  }),
  ...profiles(LEAD_IDS, {
    role: 'leads',
    pitchMode: 'tonal',
    envelopeClass: 'sustained',
    releasePolicy: 'lifecycle',
    loudnessClass: 'tonal',
    rangeStress: 'high-interior',
    render: {
      canonicalMidi: 60,
      gateSeconds: 0.65,
      tailSeconds: 2.5,
      repeatIntervalSeconds: 0.4,
      polyphonyMidi: [60, 64, 67],
    },
  }),
  ...profiles(PAD_IDS, {
    role: 'pads',
    pitchMode: 'tonal',
    envelopeClass: 'pad',
    releasePolicy: 'lifecycle',
    loudnessClass: 'tonal',
    rangeStress: 'low-interior',
    render: {
      canonicalMidi: 60,
      gateSeconds: 1.5,
      tailSeconds: 3,
      repeatIntervalSeconds: 0.55,
      polyphonyMidi: [60, 64, 67, 72],
    },
  }),
  ...profiles(FX_IDS, {
    role: 'fx',
    pitchMode: 'noise',
    envelopeClass: 'texture',
    releasePolicy: 'natural-decay',
    loudnessClass: 'texture',
    rangeStress: 'high-interior',
    render: {
      canonicalMidi: 60,
      gateSeconds: 1,
      tailSeconds: 3,
      repeatIntervalSeconds: 0.5,
      polyphonyMidi: [60],
    },
  }),
] as const;

const duplicateIds = ALL_PROFILES
  .map(profile => profile.id)
  .filter((id, index, ids) => ids.indexOf(id) !== index);
if (duplicateIds.length > 0) {
  throw new Error(`Duplicate instrument quality profiles: ${[...new Set(duplicateIds)].join(', ')}`);
}

export const INSTRUMENT_QUALITY_PROFILES: readonly InstrumentQualityProfile[] = Object.freeze(
  ALL_PROFILES.map(profile => Object.freeze({
    ...profile,
    render: Object.freeze({ ...profile.render, polyphonyMidi: Object.freeze([...profile.render.polyphonyMidi]) }),
  })),
);

export const INSTRUMENT_QUALITY_PROFILE_BY_ID: ReadonlyMap<string, InstrumentQualityProfile> = new Map(
  INSTRUMENT_QUALITY_PROFILES.map(profile => [profile.id, profile]),
);

export function assertInstrumentQualityProfileCoverage(catalogueIds: readonly string[]): void {
  const expected = new Set(catalogueIds);
  const actual = new Set(INSTRUMENT_QUALITY_PROFILES.map(profile => profile.id));
  const missing = [...expected].filter(id => !actual.has(id)).sort();
  const unexpected = [...actual].filter(id => !expected.has(id)).sort();
  if (missing.length > 0 || unexpected.length > 0 || actual.size !== catalogueIds.length) {
    throw new Error(
      `Instrument quality profile coverage mismatch: missing=[${missing.join(', ')}], `
      + `unexpected=[${unexpected.join(', ')}], catalogue=${catalogueIds.length}, profiles=${actual.size}`,
    );
  }
}
