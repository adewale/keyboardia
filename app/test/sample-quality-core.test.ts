import { describe, expect, it } from 'vitest';

import {
  analyzeDecodedSample,
  classifySampleIssues,
  estimatePitch,
  waveformCorrelation,
  type DecodedAudioLike,
  type SampleContext,
} from '../scripts/sample-quality-core';

function fakeDecoded(channels: Float32Array[], sampleRate = 44100): DecodedAudioLike {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    getChannelData: (channel: number) => channels[channel],
  };
}

function sine(midi: number, seconds = 0.5, sampleRate = 44100): Float32Array {
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.5 * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return out;
}

function baseContext(overrides: Partial<SampleContext> = {}): SampleContext {
  return {
    instrumentId: 'test-instrument',
    instrumentName: 'Test Instrument',
    file: 'C4.wav',
    note: 60,
    pitched: true,
    ...overrides,
  };
}

describe('sample quality core', () => {
  it('measures leading silence and active RMS from decoded PCM', () => {
    const sampleRate = 1000;
    const data = new Float32Array(1000);
    data.fill(0, 0, 100);
    data.fill(0.25, 100, 400);

    const metrics = analyzeDecodedSample(baseContext({ pitched: false }), fakeDecoded([data], sampleRate));

    expect(metrics.leadingSilenceMs).toBeCloseTo(100, 0);
    expect(metrics.activeRmsDb).toBeCloseTo(-12.0, 1);
    expect(metrics.peakDb).toBeCloseTo(-12.0, 1);
  });

  it('estimates pitch cents for a steady sine wave', () => {
    const data = sine(69, 0.5);
    const pitch = estimatePitch(data, 44100, 69, 0, data.length - 1);

    expect(pitch.confidence).toBeGreaterThan(0.8);
    expect(pitch.foldedCents).not.toBeNull();
    expect(Math.abs(pitch.foldedCents ?? 999)).toBeLessThan(8);
  });

  it('classifies flat-top clipping as a hard error', () => {
    const data = new Float32Array(1000);
    data.fill(1, 100, 130);
    data.fill(1, 200, 230);
    data.fill(1, 300, 330);
    data.fill(1, 400, 430);

    const metrics = analyzeDecodedSample(baseContext({ pitched: false }), fakeDecoded([data], 1000));
    const issues = classifySampleIssues(metrics);

    expect(issues.some(issue => issue.severity === 'error' && issue.code === 'FLAT_TOP_CLIPPING')).toBe(true);
  });

  it('computes waveform correlation for round-robin similarity checks', () => {
    const a = new Float32Array([0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1]);
    const b = new Float32Array([0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1]);
    const c = new Float32Array([1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1, 0]);

    expect(waveformCorrelation(a, b)).toBeCloseTo(1, 5);
    expect(Math.abs(waveformCorrelation(a, c) ?? 0)).toBeLessThan(0.4);
  });
});
