import { beforeAll, describe, expect, it } from 'vitest';
import type { Sample } from '../types';
import { bandRmsDb, spectralCentroidHz } from '../test/audio-measures';
import { mulberry32 } from '../test/seeded-random';
import { FakeAudioContext } from './__fakes__/FakeWebAudio';
import { createSynthesizedSamples } from './samples';

const SAMPLE_RATE = 44_100;

function smoothedZeroCrossingFrequency(
  source: Float32Array,
  startSeconds: number,
  endSeconds: number,
): number {
  const width = 48;
  const smoothed = new Float32Array(source.length);
  let sum = 0;
  for (let index = 0; index < source.length; index++) {
    sum += source[index];
    if (index >= width) sum -= source[index - width];
    smoothed[index] = sum / Math.min(index + 1, width);
  }
  const start = Math.round(startSeconds * SAMPLE_RATE);
  const end = Math.round(endSeconds * SAMPLE_RATE);
  let crossings = 0;
  for (let index = start + 1; index < end; index++) {
    if ((smoothed[index - 1] <= 0 && smoothed[index] > 0)
      || (smoothed[index - 1] >= 0 && smoothed[index] < 0)) crossings++;
  }
  return crossings / 2 / (endSeconds - startSeconds);
}

function designedKickAverageFrequency(startSeconds: number, endSeconds: number): number {
  const width = endSeconds - startSeconds;
  const sweepAverage = 110
    * (Math.exp(-10 * startSeconds) - Math.exp(-10 * endSeconds))
    / (10 * width);
  return 40 + sweepAverage;
}

function energyAbove5kFraction(samples: Float32Array): number {
  const lowDb = bandRmsDb(samples, SAMPLE_RATE, 0, 5_000);
  const highDb = bandRmsDb(samples, SAMPLE_RATE, 5_000, SAMPLE_RATE / 2);
  // bandRmsDb is mean energy per FFT bin; multiply by bandwidth to compare
  // total energy because FFT bins are uniformly spaced.
  const low = 10 ** (lowDb / 10) * 5_000;
  const high = 10 ** (highDb / 10) * (SAMPLE_RATE / 2 - 5_000);
  return high / (low + high);
}

describe('Phase 43.6 procedural timbre', () => {
  let samples: Map<string, Sample>;

  beforeAll(async () => {
    samples = await createSynthesizedSamples(
      new FakeAudioContext().asAudioContext(),
      mulberry32(0x43_0006),
    );
  });

  it('renders the kick as a true downward instantaneous-frequency sweep', () => {
    const kick = samples.get('kick')!.buffer!.getChannelData(0);
    const early = smoothedZeroCrossingFrequency(kick, 0.01, 0.06);
    const late = smoothedZeroCrossingFrequency(kick, 0.2, 0.45);
    expect(Math.abs(early - designedKickAverageFrequency(0.01, 0.06))).toBeLessThanOrEqual(5);
    expect(Math.abs(late - designedKickAverageFrequency(0.2, 0.45))).toBeLessThanOrEqual(2);
    expect(early).toBeGreaterThan(100);
    expect(late).toBeGreaterThanOrEqual(35);
    expect(late).toBeLessThanOrEqual(60);
    expect(early).toBeGreaterThan(late * 2);
  });

  it('puts at least 80% of closed-hat energy above 5 kHz', () => {
    const hihat = samples.get('hihat')!.buffer!.getChannelData(0);
    expect(energyAbove5kFraction(hihat)).toBeGreaterThanOrEqual(0.8);
    expect(spectralCentroidHz(hihat, SAMPLE_RATE)).toBeGreaterThan(7_000);
  });

  it('adds an audible 330 Hz snare body and a short 2-4 kHz kick click', () => {
    const snare = samples.get('snare')!.buffer!.getChannelData(0);
    expect(bandRmsDb(snare, SAMPLE_RATE, 280, 380)).toBeGreaterThan(-100);

    const kick = samples.get('kick')!.buffer!.getChannelData(0);
    const attack = kick.slice(0, Math.round(SAMPLE_RATE * 0.012));
    const tail = kick.slice(Math.round(SAMPLE_RATE * 0.08), Math.round(SAMPLE_RATE * 0.092));
    expect(bandRmsDb(attack, SAMPLE_RATE, 2_000, 4_000))
      .toBeGreaterThan(bandRmsDb(tail, SAMPLE_RATE, 2_000, 4_000) + 12);
  });
});
