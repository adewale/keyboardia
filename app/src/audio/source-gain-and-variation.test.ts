import { beforeAll, describe, expect, it } from 'vitest';
import type { Sample } from '../types';
import {
  hitCorrelation,
  loudnessKMax,
  peakDbfs,
  spectralCentroidHz,
  bandRmsDb,
} from '../test/audio-measures';
import { mulberry32 } from '../test/seeded-random';
import { FakeAudioContext } from './__fakes__/FakeWebAudio';
import { createSynthesizedSamples, selectSampleBuffer } from './samples';
import {
  sampledInstrumentOutputGainDb,
  SAMPLED_INSTRUMENT_OUTPUT_GAIN_DB,
} from './sampled-instrument';

const SAMPLE_RATE = 44_100;

function delivered(sample: Sample, buffer = sample.buffer!): Float32Array {
  return Float32Array.from(
    buffer.getChannelData(0),
    value => value * (sample.playbackGain ?? 1),
  );
}

function energyAbove5kFraction(samples: Float32Array): number {
  const lowDb = bandRmsDb(samples, SAMPLE_RATE, 0, 5_000);
  const highDb = bandRmsDb(samples, SAMPLE_RATE, 5_000, SAMPLE_RATE / 2);
  const low = 10 ** (lowDb / 10) * 5_000;
  const high = 10 ** (highDb / 10) * (SAMPLE_RATE / 2 - 5_000);
  return high / (low + high);
}

describe('automatic source balance and timbral variation', () => {
  let samples: Map<string, Sample>;

  beforeAll(async () => {
    samples = await createSynthesizedSamples(
      new FakeAudioContext().asAudioContext(),
      mulberry32(0x43_0011),
    );
  });

  it('keeps sampled drum balance in engine data without mutating content evidence', () => {
    expect(sampledInstrumentOutputGainDb('808-kick')).toBe(0);
    expect(sampledInstrumentOutputGainDb('808-snare')).toBe(-3);
    expect(sampledInstrumentOutputGainDb('808-hihat-closed')).toBe(-9);
    expect(sampledInstrumentOutputGainDb('acoustic-hihat-open')).toBe(-8);
    expect(sampledInstrumentOutputGainDb('piano', -2.5)).toBe(-2.5);
    expect(Object.keys(SAMPLED_INSTRUMENT_OUTPUT_GAIN_DB)).toHaveLength(11);
  });

  it('keeps every calibrated procedural source at or below digital full scale', () => {
    for (const sample of samples.values()) {
      expect(peakDbfs(delivered(sample)), sample.id).toBeLessThanOrEqual(0.01);
    }
  });

  it('balances the pitched procedural starter voices within 2 dB', () => {
    const levels = ['kick', 'bass', 'lead', 'pluck', 'pad'].map(sampleId =>
      loudnessKMax(delivered(samples.get(sampleId)!), SAMPLE_RATE)
    );
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(2);
  });

  it('places hats below the kick while retaining a high-frequency identity', () => {
    const kickLevel = loudnessKMax(delivered(samples.get('kick')!), SAMPLE_RATE);
    for (const sampleId of ['hihat', 'openhat']) {
      const pcm = delivered(samples.get(sampleId)!);
      const level = loudnessKMax(pcm, SAMPLE_RATE);
      expect(kickLevel - level, sampleId).toBeGreaterThanOrEqual(6);
      expect(kickLevel - level, sampleId).toBeLessThanOrEqual(10);
      expect(energyAbove5kFraction(pcm), sampleId).toBeGreaterThanOrEqual(0.8);
      expect(spectralCentroidHz(pcm, SAMPLE_RATE), sampleId).toBeGreaterThan(7_000);
    }
    expect(samples.get('openhat')!.buffer!.duration)
      .toBeGreaterThanOrEqual(samples.get('hihat')!.buffer!.duration * 3.5);
  });

  it.each(['snare', 'hihat', 'openhat'])('%s has four bounded deterministic alternates', (sampleId) => {
    const sample = samples.get(sampleId)!;
    expect(sample.variations).toHaveLength(4);
    const variations = sample.variations!;
    const correlation = hitCorrelation(
      variations[0].getChannelData(0),
      variations[1].getChannelData(0),
    );
    expect(correlation).toBeLessThan(0.995);

    const levels = variations.map(buffer =>
      loudnessKMax(delivered(sample, buffer), SAMPLE_RATE)
    );
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1.5);

    const first = selectSampleBuffer(sample, 'track-a-step-0-loop-0');
    expect(selectSampleBuffer(sample, 'track-a-step-0-loop-0')).toBe(first);
    const selected = new Set(Array.from(
      { length: 16 },
      (_, loop) => selectSampleBuffer(sample, `track-a-step-0-loop-${loop}`),
    ));
    expect(selected.size).toBeGreaterThan(1);
  });
});
