import type { TrackEnvelope } from './sync-types';
import { clamp } from './constants';
import {
  legacyTrackEnvelopeToV2,
  type SamplePlaybackMode,
  type TrackEnvelopeV2,
} from './envelope-contract-v2';
import {
  describeEnvelopeCompatibility,
  getEnvelopeCapability,
  type EnvelopeCapability,
} from './envelope-capabilities';

/** Canonical authored ranges used by state validation, UI, MCP, and audio. */
export const ENVELOPE_RANGES = {
  attack: { min: 0, max: 4 },
  decay: { min: 0, max: 4 },
  sustain: { min: 0, max: 1 },
  release: { min: 0, max: 8 },
} as const;

export const TRACK_GATE_RANGE = { min: 0, max: 100 } as const;
/** Preserve Keyboardia's historical 90% step gate when a track omits `gate`. */
export const DEFAULT_TRACK_GATE = 90;

/** Safe fallback for instruments whose preset does not expose a full ADSR. */
export const DEFAULT_TRACK_ENVELOPE: TrackEnvelope = {
  attack: 0.003,
  decay: 0,
  sustain: 1,
  release: 0.1,
};

export function isTrackEnvelope(value: unknown): value is TrackEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return ['attack', 'decay', 'sustain', 'release'].every(
    key => typeof envelope[key] === 'number' && Number.isFinite(envelope[key]),
  );
}

/** Clamp untrusted or engine-authored values into the canonical state domain. */
export function clampTrackEnvelope(envelope: TrackEnvelope): TrackEnvelope {
  return {
    attack: clamp(envelope.attack, ENVELOPE_RANGES.attack.min, ENVELOPE_RANGES.attack.max),
    decay: clamp(envelope.decay, ENVELOPE_RANGES.decay.min, ENVELOPE_RANGES.decay.max),
    sustain: clamp(envelope.sustain, ENVELOPE_RANGES.sustain.min, ENVELOPE_RANGES.sustain.max),
    release: clamp(envelope.release, ENVELOPE_RANGES.release.min, ENVELOPE_RANGES.release.max),
  };
}

/**
 * Preset envelopes used for read surfaces (UI/MCP/analysis).
 *
 * Audio engines still own the complete preset definitions. A parity test keeps
 * this runtime-neutral index aligned with those definitions so Worker code can
 * report effective values without importing Tone.js or browser-only modules.
 */
const NATIVE_SYNTH_ENVELOPES: Record<string, TrackEnvelope> = {
  bass: { attack: .01, decay: .2, sustain: .5, release: .1 },
  lead: { attack: .01, decay: .1, sustain: .8, release: .3 },
  pad: { attack: .05, decay: .15, sustain: .85, release: 1 },
  pluck: { attack: .005, decay: .4, sustain: .15, release: .25 },
  acid: { attack: .01, decay: .15, sustain: .35, release: .1 },
  funkbass: { attack: .005, decay: .1, sustain: .4, release: .05 },
  clavinet: { attack: .001, decay: .15, sustain: .35, release: .1 },
  rhodes: { attack: .01, decay: .4, sustain: .65, release: .6 },
  organ: { attack: .01, decay: .1, sustain: .8, release: .15 },
  wurlitzer: { attack: .005, decay: .3, sustain: .55, release: .3 },
  discobass: { attack: .01, decay: .15, sustain: .5, release: .1 },
  strings: { attack: .05, decay: .15, sustain: .8, release: .8 },
  brass: { attack: .05, decay: .2, sustain: .6, release: .2 },
  stab: { attack: .001, decay: .2, sustain: .25, release: .15 },
  sub: { attack: .02, decay: .3, sustain: .6, release: .2 },
  shimmer: { attack: .05, decay: .15, sustain: .8, release: 2 },
  jangle: { attack: .001, decay: .4, sustain: .45, release: .5 },
  dreampop: { attack: .05, decay: .3, sustain: .6, release: 1.5 },
  bell: { attack: .001, decay: .5, sustain: .2, release: 1 },
  supersaw: { attack: .01, decay: .12, sustain: .8, release: .3 },
  hypersaw: { attack: .01, decay: .15, sustain: .75, release: .4 },
  wobble: { attack: .01, decay: .1, sustain: .7, release: .1 },
  growl: { attack: .01, decay: .1, sustain: .6, release: .1 },
  evolving: { attack: .05, decay: .3, sustain: .7, release: 1.5 },
  sweep: { attack: .05, decay: .12, sustain: .8, release: 1 },
  warmpad: { attack: .05, decay: .15, sustain: .85, release: 1.5 },
  glass: { attack: .001, decay: .6, sustain: .2, release: 1.2 },
  epiano: { attack: .005, decay: .5, sustain: .4, release: .5 },
  vibes: { attack: .001, decay: .8, sustain: .3, release: 1 },
  organphase: { attack: .01, decay: .1, sustain: .8, release: .15 },
  reese: { attack: .01, decay: .2, sustain: .6, release: .15 },
  hoover: { attack: .01, decay: .3, sustain: .4, release: .2 },
};

const ADVANCED_SYNTH_ENVELOPES: Record<string, TrackEnvelope> = {
  supersaw: { attack: .01, decay: .2, sustain: .7, release: .5 },
  'sub-bass': { attack: .01, decay: .1, sustain: .9, release: .3 },
  'wobble-bass': { attack: .01, decay: .1, sustain: .9, release: .2 },
  'warm-pad': { attack: .5, decay: .15, sustain: .8, release: 1.5 },
  'vibrato-lead': { attack: .05, decay: .2, sustain: .7, release: .4 },
  'tremolo-strings': { attack: .3, decay: .12, sustain: .8, release: .8 },
  'acid-bass': { attack: .01, decay: .3, sustain: .4, release: .2 },
  'thick-lead': { attack: .02, decay: .2, sustain: .6, release: .4 },
};

const TONE_SYNTH_ENVELOPES: Record<string, TrackEnvelope> = {
  'fm-epiano': { attack: .01, decay: .3, sustain: .2, release: .8 },
  'fm-bass': { attack: .01, decay: .2, sustain: .4, release: .3 },
  'fm-bell': { attack: .001, decay: 2, sustain: 0, release: 2 },
  'am-bell': { attack: .001, decay: 1.5, sustain: 0, release: 1.5 },
  'am-tremolo': { attack: .1, decay: .2, sustain: .8, release: .5 },
  'membrane-kick': { attack: .001, decay: .4, sustain: .01, release: 1.4 },
  'membrane-tom': { attack: .001, decay: .3, sustain: .02, release: .8 },
  'metal-cymbal': { attack: .001, decay: 1.2, sustain: 0, release: .8 },
  'metal-hihat': { attack: .001, decay: .1, sustain: 0, release: .1 },
  'duo-lead': { attack: .01, decay: .2, sustain: .5, release: .5 },
};

const SAMPLED_RELEASES: Record<string, number> = {
  '808-clap': .1, '808-hihat-closed': .05, '808-hihat-open': .2,
  '808-kick': .1, '808-snare': .1, 'acoustic-crash': 2,
  'acoustic-guitar': .4, 'acoustic-hihat-closed': .15,
  'acoustic-hihat-open': .3, 'acoustic-kick': .2, 'acoustic-ride': .5,
  'acoustic-snare': .25, 'alto-sax': .4, 'brushes-snare': .2,
  'clean-guitar': .3, 'finger-bass': .3, 'french-horn': .6,
  'hammond-organ': .3, kalimba: 1, marimba: .8, piano: .5,
  'slap-bass': .15, 'steel-drums': .8, 'string-section': .8,
  vibraphone: 1, 'vinyl-crackle': .1,
};

/** Return a defensive copy of the effective baked envelope, if expressible. */
export function getPresetTrackEnvelope(sampleId: string): TrackEnvelope | null {
  const separator = sampleId.indexOf(':');
  if (separator === -1) return null;
  const namespace = sampleId.slice(0, separator);
  const preset = sampleId.slice(separator + 1);
  let envelope: TrackEnvelope | undefined;
  if (namespace === 'synth') envelope = NATIVE_SYNTH_ENVELOPES[preset];
  if (namespace === 'advanced') envelope = ADVANCED_SYNTH_ENVELOPES[preset];
  if (namespace === 'tone') envelope = TONE_SYNTH_ENVELOPES[preset];
  if (namespace === 'sampled' && SAMPLED_RELEASES[preset] !== undefined) {
    envelope = { ...DEFAULT_TRACK_ENVELOPE, release: SAMPLED_RELEASES[preset] };
  }
  return envelope ? { ...envelope } : null;
}

export function getEffectiveTrackEnvelope(
  track: { sampleId: string; envelope?: TrackEnvelope },
): TrackEnvelope {
  return clampTrackEnvelope(
    track.envelope ?? getPresetTrackEnvelope(track.sampleId) ?? DEFAULT_TRACK_ENVELOPE,
  );
}

function seconds(value: number): { value: number; unit: 'seconds' } {
  return { value, unit: 'seconds' };
}

/** Truthful v2 preset model; engine-owned defaults remain absent from track state. */
export function getPresetTrackEnvelopeV2(sampleId: string): TrackEnvelopeV2 {
  const capability = getEnvelopeCapability(sampleId);
  const legacy = getPresetTrackEnvelope(sampleId);
  if (capability.defaultModel === 'adsr' && legacy) return legacyTrackEnvelopeToV2(legacy);
  if (capability.defaultModel === 'ar') {
    return {
      model: 'ar',
      attack: seconds(legacy?.attack ?? DEFAULT_TRACK_ENVELOPE.attack),
      release: seconds(legacy?.release ?? DEFAULT_TRACK_ENVELOPE.release),
    };
  }
  if (capability.defaultModel === 'ad') {
    return {
      model: 'ad',
      attack: seconds(legacy?.attack ?? DEFAULT_TRACK_ENVELOPE.attack),
      decay: seconds(legacy?.decay ?? legacy?.release ?? 0.4),
    };
  }
  // Finite trigger defaults leave the source's natural body intact. The
  // maximum AHD decay is an outer safety fade, not invented sustain.
  return {
    model: 'ahd',
    attack: seconds(legacy?.attack ?? DEFAULT_TRACK_ENVELOPE.attack),
    hold: seconds(0),
    decay: seconds(8),
  };
}

export interface EffectiveTrackEnvelopeV2Report {
  authored: TrackEnvelopeV2 | null;
  effective: TrackEnvelopeV2;
  playbackMode?: SamplePlaybackMode;
  capability: EnvelopeCapability;
  active: boolean;
  ignoredStages: readonly string[];
  inactiveReason?: string;
}

export function getEffectiveTrackEnvelopeV2(track: {
  sampleId: string;
  envelope?: TrackEnvelope;
  envelopeTimeUnit?: 'seconds' | 'steps';
  envelopeV2?: TrackEnvelopeV2;
  samplePlaybackMode?: SamplePlaybackMode;
}): EffectiveTrackEnvelopeV2Report {
  const capability = getEnvelopeCapability(track.sampleId);
  const preset = getPresetTrackEnvelopeV2(track.sampleId);
  const requestedPlaybackMode = track.samplePlaybackMode ?? capability.defaultPlaybackMode;
  const legacyEnvelope = track.envelope
    ? legacyTrackEnvelopeToV2(track.envelope, track.envelopeTimeUnit ?? 'seconds')
    : undefined;
  const requestedEnvelope = track.envelopeV2 ?? legacyEnvelope ?? preset;
  const compatibility = describeEnvelopeCompatibility(
    track.sampleId,
    requestedEnvelope,
    requestedPlaybackMode,
  );
  const playbackMode = compatibility.active
    ? requestedPlaybackMode
    : capability.defaultPlaybackMode;
  return {
    authored: track.envelopeV2 ?? legacyEnvelope ?? null,
    effective: compatibility.active
      ? requestedEnvelope
      : preset,
    ...(playbackMode ? { playbackMode } : {}),
    capability,
    active: compatibility.active,
    ignoredStages: compatibility.ignoredStages,
    ...(compatibility.reason ? { inactiveReason: compatibility.reason } : {}),
  };
}
