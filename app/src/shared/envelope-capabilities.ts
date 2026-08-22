import { VALID_SAMPLE_IDS } from './instrument-catalog';
import type {
  EnvelopeModel,
  EnvelopeStageName,
  SamplePlaybackMode,
  TrackEnvelopeV2,
} from './envelope-contract-v2';

export type EnvelopeSustainSource = 'oscillator' | 'finite-buffer' | 'sample-loop' | 'none';
export type EnvelopeReleaseSource = 'gain-only' | 'source-tail' | 'release-trigger' | 'none';

/**
 * Runtime capability row consumed by audio, UI, MCP and analysis.  This is
 * deliberately separate from an authored envelope: changing instruments must
 * never destroy an override merely because that override is currently inactive.
 */
export interface EnvelopeCapability {
  models: readonly EnvelopeModel[];
  samplePlaybackModes?: readonly SamplePlaybackMode[];
  sustainSource: EnvelopeSustainSource;
  releaseSource: EnvelopeReleaseSource;
  lockableStages: readonly EnvelopeStageName[];
  defaultModel: EnvelopeModel;
  defaultPlaybackMode?: SamplePlaybackMode;
  defaultEnvelope?: TrackEnvelopeV2;
}

const ALL_TIMED_STAGES = ['attack', 'hold', 'decay', 'release'] as const;
const ADSR_STAGES = ['attack', 'decay', 'release'] as const;

const OSCILLATOR_ADSR: EnvelopeCapability = {
  models: ['adsr'],
  sustainSource: 'oscillator',
  releaseSource: 'gain-only',
  lockableStages: ADSR_STAGES,
  defaultModel: 'adsr',
};

const FINITE_SAMPLE: EnvelopeCapability = {
  models: ['ahd', 'ar'],
  samplePlaybackModes: ['trigger', 'gate'],
  sustainSource: 'finite-buffer',
  releaseSource: 'source-tail',
  lockableStages: ALL_TIMED_STAGES,
  defaultModel: 'ahd',
  defaultPlaybackMode: 'trigger',
};

const HAMMOND_LOOP: EnvelopeCapability = {
  models: ['ahd', 'ar', 'adsr'],
  samplePlaybackModes: ['trigger', 'gate', 'loop'],
  sustainSource: 'sample-loop',
  releaseSource: 'gain-only',
  lockableStages: ALL_TIMED_STAGES,
  defaultModel: 'adsr',
  defaultPlaybackMode: 'loop',
};

const TONE_TRANSIENT_IDS = new Set([
  'tone:membrane-kick',
  'tone:membrane-tom',
  'tone:metal-cymbal',
  'tone:metal-hihat',
]);

const TONE_AR_IDS = new Set(['tone:pluck-string']);

function capabilityForId(id: string): EnvelopeCapability {
  if (id === 'sampled:hammond-organ') return HAMMOND_LOOP;
  if (id.startsWith('sampled:') || !id.includes(':')) return FINITE_SAMPLE;
  if (TONE_TRANSIENT_IDS.has(id)) {
    return {
      models: ['ad', 'ahd'],
      sustainSource: 'none',
      releaseSource: 'gain-only',
      lockableStages: ['attack', 'hold', 'decay'],
      defaultModel: 'ad',
    };
  }
  if (TONE_AR_IDS.has(id)) {
    return {
      models: ['ar'],
      sustainSource: 'oscillator',
      releaseSource: 'gain-only',
      lockableStages: ['attack', 'release'],
      defaultModel: 'ar',
    };
  }
  return OSCILLATOR_ADSR;
}

export const ENVELOPE_CAPABILITY_REGISTRY: Readonly<Record<string, EnvelopeCapability>> =
  Object.freeze(Object.fromEntries(
    [...VALID_SAMPLE_IDS].sort().map(id => [id, Object.freeze(capabilityForId(id))]),
  ));

export const NO_ENVELOPE_CAPABILITY: EnvelopeCapability = Object.freeze({
  models: [],
  sustainSource: 'none',
  releaseSource: 'none',
  lockableStages: [],
  defaultModel: 'ad',
});

export function getEnvelopeCapability(sampleId: string): EnvelopeCapability {
  return ENVELOPE_CAPABILITY_REGISTRY[sampleId] ?? NO_ENVELOPE_CAPABILITY;
}

export interface EnvelopeCompatibility {
  active: boolean;
  ignoredStages: readonly EnvelopeStageName[];
  reason?: string;
}

/**
 * Sample playback owns note-off semantics, so only these model/mode pairs are
 * truthful. Keep this rule beside the capability registry so UI, resolver and
 * renderer cannot independently invent different coercions.
 */
export function isEnvelopeModelCompatibleWithPlayback(
  model: EnvelopeModel,
  playbackMode: SamplePlaybackMode,
): boolean {
  if (playbackMode === 'trigger') return model === 'ad' || model === 'ahd';
  if (playbackMode === 'gate') return model === 'ar';
  return model === 'adsr';
}

export function describeEnvelopeCompatibility(
  sampleId: string,
  envelope: TrackEnvelopeV2,
  playbackMode?: SamplePlaybackMode,
): EnvelopeCompatibility {
  const capability = getEnvelopeCapability(sampleId);
  const activeStages = envelope.model === 'ad'
    ? ['attack', 'decay'] as const
    : envelope.model === 'ahd'
      ? ['attack', 'hold', 'decay'] as const
      : envelope.model === 'ar'
        ? ['attack', 'release'] as const
        : ADSR_STAGES;
  const ignoredStages = activeStages.filter(stage => !capability.lockableStages.includes(stage));
  if (!capability.models.includes(envelope.model)) {
    return {
      active: false,
      ignoredStages: activeStages,
      reason: `${sampleId} does not support the ${envelope.model.toUpperCase()} model`,
    };
  }
  if (playbackMode && !capability.samplePlaybackModes?.includes(playbackMode)) {
    return {
      active: false,
      ignoredStages,
      reason: `${sampleId} does not support ${playbackMode} playback`,
    };
  }
  if (playbackMode === 'loop' && capability.sustainSource !== 'sample-loop') {
    return {
      active: false,
      ignoredStages,
      reason: `${sampleId} has no validated sustain loop`,
    };
  }
  if (playbackMode
      && capability.samplePlaybackModes
      && !isEnvelopeModelCompatibleWithPlayback(envelope.model, playbackMode)) {
    return {
      active: false,
      ignoredStages: activeStages,
      reason: `${envelope.model.toUpperCase()} is not compatible with ${playbackMode} playback`,
    };
  }
  return { active: true, ignoredStages };
}
