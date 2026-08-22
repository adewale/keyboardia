import { describe, expect, it, vi } from 'vitest';
import { SynthEngine, SYNTH_PRESETS, type SynthParams } from './synth';
import { NATIVE_ADVANCED_SYNTH_PRESETS, type AdvancedSynthPreset } from './advancedSynth';
import {
  ENVELOPE_PCM_FIXED_CANARIES,
  ENVELOPE_PCM_SAMPLE_RATE,
  ENVELOPE_PCM_TOLERANCES,
} from '../test/envelope-pcm-manifest';
import { comparePcmMetrics, measurePcm } from '../test/pcm-metrics';

const webAudio = await import('node-web-audio-api').catch(() => null);
const SAMPLE_RATE = ENVELOPE_PCM_SAMPLE_RATE;

function rms(data: Float32Array, startSeconds: number, endSeconds: number): number {
  const start = Math.floor(startSeconds * SAMPLE_RATE);
  const end = Math.min(data.length, Math.floor(endSeconds * SAMPLE_RATE));
  let sumSquares = 0;
  for (let i = start; i < end; i++) sumSquares += data[i] * data[i];
  return Math.sqrt(sumSquares / Math.max(1, end - start));
}

function candidateAsNativeParams(preset: AdvancedSynthPreset): SynthParams {
  const osc2Total = preset.oscillator1.level + preset.oscillator2.level;
  const osc2Mix = osc2Total > 0 ? preset.oscillator2.level / osc2Total : 0;
  return {
    waveform: preset.oscillator1.waveform,
    filterCutoff: preset.filter.frequency,
    filterResonance: preset.filter.resonance,
    ...preset.amplitudeEnvelope,
    ...(preset.oscillator2.level > 0 ? {
      osc2: {
        waveform: preset.oscillator2.waveform,
        detune: preset.oscillator2.detune,
        coarse: preset.oscillator2.coarseDetune,
        mix: osc2Mix,
      },
    } : {}),
    ...(preset.filter.envelopeAmount !== 0 ? {
      filterEnv: {
        amount: preset.filter.envelopeAmount,
        attack: preset.filterEnvelope.attack,
        decay: preset.filterEnvelope.decay,
        sustain: preset.filterEnvelope.sustain,
      },
    } : {}),
    ...(preset.lfo.amount !== 0 ? {
      lfo: {
        waveform: preset.lfo.waveform,
        rate: preset.lfo.frequency,
        depth: preset.lfo.amount,
        destination: preset.lfo.destination,
      },
    } : {}),
  };
}

async function renderPreset(params: SynthParams): Promise<Float32Array> {
  const { OfflineAudioContext } = webAudio!;
  const context = new OfflineAudioContext(1, SAMPLE_RATE * 2, SAMPLE_RATE);
  const output = context.createGain();
  output.connect(context.destination);
  const engine = new SynthEngine();
  engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);
  engine.playNote('pcm-canary', 261.625565, params, 0.05, 0.1125, 0.7);
  return (await context.startRendering()).getChannelData(0);
}

describe.skipIf(!webAudio)('native synth envelope — offline PCM regression', () => {
  it.each(ENVELOPE_PCM_FIXED_CANARIES)(
    'compares the %s native baseline with its translated candidate configuration',
    async presetId => {
      const baseline = await renderPreset(SYNTH_PRESETS[presetId]);
      const candidatePreset = NATIVE_ADVANCED_SYNTH_PRESETS[`native:${presetId}`];
      expect(candidatePreset).toBeDefined();
      const candidate = await renderPreset(candidateAsNativeParams(candidatePreset));
      const delta = comparePcmMetrics(
        measurePcm(baseline, SAMPLE_RATE, 0.2),
        measurePcm(candidate, SAMPLE_RATE, 0.2),
      );
      expect(delta.peakDeltaDb).toBeLessThanOrEqual(ENVELOPE_PCM_TOLERANCES.peakDeltaDb);
      expect(delta.rmsDeltaDb).toBeLessThanOrEqual(ENVELOPE_PCM_TOLERANCES.rmsDeltaDb);
      expect(delta.tailDeltaDb).toBeLessThanOrEqual(ENVELOPE_PCM_TOLERANCES.releaseTailDeltaDb);
      expect(delta.spectralCentroidRatio).toBeLessThanOrEqual(
        ENVELOPE_PCM_TOLERANCES.medianSpectralCentroidRatio,
      );
      expect(delta.newClippingSamples).toBe(0);
    },
  );

  it('keeps audible energy after note-off and decays through the configured release', async () => {
    const { OfflineAudioContext } = webAudio!;
    const context = new OfflineAudioContext(1, SAMPLE_RATE * 2, SAMPLE_RATE);
    const output = context.createGain();
    output.connect(context.destination);

    const engine = new SynthEngine();
    engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);

    const start = 0.05;
    const duration = 0.1125;
    engine.playNote(
      'release-regression',
      261.625565,
      SYNTH_PRESETS.pad,
      start,
      duration,
      1,
    );

    const rendered = await context.startRendering();
    const channel = rendered.getChannelData(0);
    const earlyTail = rms(channel, 0.20, 0.35);
    const lateTail = rms(channel, 0.75, 0.90);

    // Before the fix, future stop() cancelled the decay ramp and anchored the
    // release from AudioParam.value (near zero), making earlyTail ~0.00005.
    expect(earlyTail).toBeGreaterThan(0.03);
    expect(lateTail).toBeGreaterThan(0.001);
    expect(lateTail).toBeLessThan(earlyTail);
  });

  it('renders authored v2 ADSR with the exact release endpoint and guard', async () => {
    const { OfflineAudioContext } = webAudio!;
    const context = new OfflineAudioContext(1, SAMPLE_RATE / 2, SAMPLE_RATE);
    const output = context.createGain();
    output.connect(context.destination);
    const engine = new SynthEngine();
    engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);

    engine.playNote(
      'canonical-authored',
      261.625565,
      SYNTH_PRESETS.pad,
      0.05,
      0.125,
      1,
      undefined,
      {
        model: 'adsr',
        attackSeconds: 0,
        decaySeconds: 0,
        sustain: 1,
        releaseSeconds: 0.1,
      },
    );

    const rendered = await context.startRendering();
    const channel = rendered.getChannelData(0);
    expect(rms(channel, 0.051, 0.06)).toBeGreaterThan(0.05);
    // note-off .175 + R .1 + guard .01 = hard stop .285
    expect(rms(channel, 0.20, 0.25)).toBeGreaterThan(0.001);
    expect(rms(channel, 0.30, 0.35)).toBeLessThan(1e-7);
  });

  it('releases from the current attack level for exactly 300ms without a wall timer', async () => {
    const { OfflineAudioContext } = webAudio!;
    const context = new OfflineAudioContext(1, SAMPLE_RATE * 0.8, SAMPLE_RATE);
    const output = context.createGain();
    output.connect(context.destination);
    const engine = new SynthEngine();
    engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);
    const timer = vi.spyOn(globalThis, 'setTimeout');

    engine.playNote(
      'canonical-early-release',
      261.625565,
      SYNTH_PRESETS.pad,
      0.05,
      0.1,
      1,
      undefined,
      {
        model: 'adsr',
        attackSeconds: 0.4,
        decaySeconds: 0.2,
        sustain: 0.5,
        releaseSeconds: 0.3,
      },
    );

    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();
    const rendered = await context.startRendering();
    const channel = rendered.getChannelData(0);

    // note-off .15 occurs one quarter through attack. The release must retain
    // that current energy, reach epsilon at .45, and hard-stop at .46.
    expect(rms(channel, 0.16, 0.24)).toBeGreaterThan(0.005);
    expect(rms(channel, 0.34, 0.42)).toBeGreaterThan(0.00005);
    expect(rms(channel, 0.48, 0.60)).toBeLessThan(1e-7);
  });
});
