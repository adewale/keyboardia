import { describe, expect, it } from 'vitest';
import {
  bandRmsDb,
  dcOffset,
  estimateLatencyFrames,
  hitCorrelation,
  hitLevelVariationDb,
  leadingSilenceMs,
  logSpectralDistance,
  loudnessKMax,
  midSideRatioDb,
  peakDbfs,
  pumpingProfile,
  rmsDb,
  spectralCentroidHz,
  truePeakDbfs,
} from './audio-measures';

const SAMPLE_RATE = 48_000;

function sine(frequency: number, seconds: number, amplitude = 1): Float32Array {
  return Float32Array.from(
    { length: Math.round(seconds * SAMPLE_RATE) },
    (_, index) => Math.sin(2 * Math.PI * frequency * index / SAMPLE_RATE) * amplitude,
  );
}

describe('audio measures', () => {
  it('measures peak and RMS in a named sample window', () => {
    const signal = Float32Array.of(0, 0.5, -1, 0.5, 0);
    expect(peakDbfs(signal)).toBeCloseTo(0, 8);
    expect(peakDbfs(signal, { start: 0, end: 2 })).toBeCloseTo(-6.0206, 3);
    expect(rmsDb(Float32Array.of(1, -1))).toBeCloseTo(0, 8);
    expect(rmsDb(new Float32Array(8))).toBe(-Infinity);
  });

  it('detects an intersample peak that sample-peak measurement misses', () => {
    const signal = Float32Array.from(
      { length: 2_048 },
      (_, index) => 0.9 * Math.sin(Math.PI / 4 + index * Math.PI / 2),
    );
    const samplePeak = peakDbfs(signal);
    const truePeak = truePeakDbfs(signal);
    expect(truePeak).toBeGreaterThan(samplePeak + 2.5);
    expect(truePeak).toBeCloseTo(20 * Math.log10(0.9), 0);
  });

  it('aligns compressor latency and reports attenuation plus monotonic recovery', () => {
    const pre = new Float32Array(2_000).fill(0.5);
    const post = new Float32Array(2_064);
    for (let index = 0; index < pre.length; index++) {
      const recovery = index < 1_000 ? 0.5 : 0.5 + (index - 1_000) / 2_000;
      post[index + 64] = pre[index] * recovery;
    }
    const result = pumpingProfile(pre, post, SAMPLE_RATE, {
      windowMs: 1,
      latencyFrames: 64,
      recoveryStartFrame: 1_000,
    });
    expect(result.maxAttenuationDb).toBeCloseTo(6.0206, 2);
    expect(result.recoveryMonotonic).toBe(true);
    const impulse = new Float32Array(256);
    const delayedImpulse = new Float32Array(320);
    impulse[20] = 1;
    delayedImpulse[84] = 1;
    expect(estimateLatencyFrames(impulse, delayedImpulse, 128)).toBe(64);
  });

  it('separates hit gain spread from waveform correlation', () => {
    const hit = sine(1_000, 0.01);
    const signal = new Float32Array(hit.length * 3);
    signal.set(hit, 0);
    signal.set(hit.map(value => value * 0.5), hit.length);
    signal.set(hit.map(value => value * 0.25), hit.length * 2);
    const levels = hitLevelVariationDb(signal, [0, hit.length, hit.length * 2], hit.length);
    expect(levels.peakSpreadDb).toBeCloseTo(12.0412, 2);
    expect(levels.rmsSpreadDb).toBeCloseTo(12.0412, 2);
    expect(hitCorrelation(hit, hit.map(value => value * 0.1))).toBeCloseTo(1, 6);
    expect(hitCorrelation(hit, hit.map(value => -value))).toBeCloseTo(-1, 6);
  });

  it('measures stereo mid/side energy', () => {
    const mono = sine(440, 0.02);
    expect(midSideRatioDb(mono, mono)).toBe(-Infinity);
    expect(midSideRatioDb(mono, mono.map(value => -value))).toBe(Infinity);
  });

  it('reports a stable K-weighted maximum and preserves level deltas', () => {
    const full = sine(1_000, 1, 0.1);
    const half = sine(1_000, 1, 0.05);
    const fullLoudness = loudnessKMax(full, SAMPLE_RATE);
    const halfLoudness = loudnessKMax(half, SAMPLE_RATE);
    expect(fullLoudness).toBeGreaterThan(-25);
    expect(fullLoudness).toBeLessThan(-20);
    expect(fullLoudness - halfLoudness).toBeCloseTo(6.0206, 2);
  });

  it('measures spectral centroid, log-spectrum distance, and band energy', () => {
    const low = sine(500, 0.1);
    const high = sine(4_000, 0.1);
    expect(spectralCentroidHz(low, SAMPLE_RATE)).toBeCloseTo(500, -1);
    expect(spectralCentroidHz(high, SAMPLE_RATE)).toBeCloseTo(4_000, -1);
    expect(logSpectralDistance(low, low.map(value => value * 0.25))).toBeLessThan(1e-4);
    expect(logSpectralDistance(low, high)).toBeGreaterThan(20);
    expect(bandRmsDb(high, SAMPLE_RATE, 3_500, 4_500))
      .toBeGreaterThan(bandRmsDb(high, SAMPLE_RATE, 100, 1_000) + 40);
  });

  it('measures onset silence and DC offset', () => {
    const signal = new Float32Array(1_000);
    signal.fill(0.5, 480);
    expect(leadingSilenceMs(signal, SAMPLE_RATE)).toBeCloseTo(10, 8);
    expect(dcOffset(Float32Array.of(-1, 1, -0.5, 0.5))).toBe(0);
    expect(dcOffset(signal)).toBeCloseTo(0.26, 8);
  });
});
