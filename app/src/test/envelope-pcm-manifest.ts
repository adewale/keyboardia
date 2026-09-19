import { PUBLISHED_NATIVE_SYNTH_PRESETS } from '../audio/synth-renderer-migration';

export const ENVELOPE_PCM_SAMPLE_RATE = 48_000;

export const ENVELOPE_PCM_FIXTURE_AXES = Object.freeze({
  midiNotes: [36, 60, 84] as const,
  velocities: [0.25, 0.7, 1] as const,
  gates: [25, 90, 100] as const,
  phrases: ['one-step', 'four-step-tie', 'early-release', 'eight-voice', 'effects-on'] as const,
});

export const ENVELOPE_PCM_TOLERANCES = Object.freeze({
  minimumLandmarkSeconds: 0.005,
  landmarkStageRatio: 0.02,
  peakDeltaDb: 0.5,
  rmsDeltaDb: 1,
  releaseTailDeltaDb: 1,
  medianSpectralCentroidRatio: 0.05,
  maximumAbsoluteSample: 1,
});

export interface EnvelopePcmPresetFixture {
  presetId: string;
  baselineRenderer: 'native';
  candidateRenderer: 'advanced';
  deterministicSeed: number;
}

export const ENVELOPE_PCM_PRESET_FIXTURES: readonly EnvelopePcmPresetFixture[] =
  Object.freeze(PUBLISHED_NATIVE_SYNTH_PRESETS.map((presetId, index) => ({
    presetId,
    baselineRenderer: 'native' as const,
    candidateRenderer: 'advanced' as const,
    deterministicSeed: 0x4b455900 + index,
  })));

/** Cheap PR canaries; the complete fixture list is the nightly/release gate. */
export const ENVELOPE_PCM_FIXED_CANARIES = Object.freeze(['pad', 'acid'] as const);
