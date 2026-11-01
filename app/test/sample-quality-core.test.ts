import { describe, expect, it } from 'vitest';

import {
  analyzeDecodedSample,
  classifySampleIssues,
  estimatePitch,
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

  it('uses first audible frame in any channel for onset despite mono cancellation', () => {
    const sampleRate = 1000;
    const left = new Float32Array(1000);
    const right = new Float32Array(1000);
    left[0] = 0.5;
    right[0] = -0.5;
    left.fill(0.2, 100, 300);
    right.fill(0.2, 100, 300);

    const metrics = analyzeDecodedSample(baseContext({ pitched: false }), fakeDecoded([left, right], sampleRate));

    expect(metrics.leadingSilenceMs).toBe(0);
    expect(metrics.activeStartMs).toBeCloseTo(100, 0);
    expect(classifySampleIssues(metrics).map(issue => issue.code)).not.toContain('LEADING_SILENCE');
  });

  it('estimates pitch cents for a steady sine wave', () => {
    const data = sine(69, 0.5);
    const pitch = estimatePitch(data, 44100, 69, 0, data.length - 1);

    expect(pitch.confidence).toBeGreaterThan(0.8);
    expect(pitch.foldedCents).not.toBeNull();
    expect(Math.abs(pitch.foldedCents ?? 999)).toBeLessThan(8);
  });

  it('checks loop seams that omit loopEnd against the extrapolated buffer endpoint', () => {
    const sampleRate = 10000;
    const data = new Float32Array(10000);
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.25 * Math.sin((2 * Math.PI * 10 * i) / sampleRate);
    }

    const metrics = analyzeDecodedSample(
      baseContext({ loop: true, loopStart: 0.1, loopEnd: undefined, pitched: false }),
      fakeDecoded([data], sampleRate)
    );

    expect(metrics.loop).not.toBeNull();
    expect(metrics.loop?.checked).toBe(true);
    expect(metrics.loop?.derivativeDiscontinuityRatio).not.toBeNull();
  });

  it('accepts a phase-correct loop without comparing unrelated seam windows', () => {
    const sampleRate = 10000;
    const data = new Float32Array(5000);
    // The 5ms window is half a cycle, so the retired window-correlation metric
    // would report -1 even though both the value and slope join exactly.
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / sampleRate);
    }

    const metrics = analyzeDecodedSample(
      baseContext({ loop: true, loopStart: 0.1, loopEnd: 0.4, pitched: false }),
      fakeDecoded([data], sampleRate),
    );
    const issues = classifySampleIssues(metrics);

    expect(metrics.loop?.seamJumpDb).toBeLessThanOrEqual(-100);
    expect(metrics.loop?.derivativeDiscontinuityRatio).toBeLessThan(0.01);
    expect(issues.some(issue => issue.code.startsWith('LOOP_'))).toBe(false);
  });

  it('reports loop boundary value and derivative discontinuities', () => {
    const sampleRate = 10000;
    const data = new Float32Array(5000);
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / sampleRate);
    }
    data[1000] += 0.3;

    const metrics = analyzeDecodedSample(
      baseContext({ loop: true, loopStart: 0.1, loopEnd: 0.4, pitched: false }),
      fakeDecoded([data], sampleRate),
    );
    const codes = classifySampleIssues(metrics).map(issue => issue.code);

    expect(codes).toContain('LOOP_VALUE_DISCONTINUITY');
    expect(codes).toContain('LOOP_DERIVATIVE_DISCONTINUITY');
  });

  it('does not let a value-matched but slope-broken loop game the seam gate', () => {
    const sampleRate = 10000;
    const data = new Float32Array(5000);
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / sampleRate);
    }
    data[1001] = data[1000] - 0.3;

    const metrics = analyzeDecodedSample(
      baseContext({ loop: true, loopStart: 0.1, loopEnd: 0.4, pitched: false }),
      fakeDecoded([data], sampleRate),
    );
    const codes = classifySampleIssues(metrics).map(issue => issue.code);

    expect(metrics.loop?.seamJumpDb).toBeLessThanOrEqual(-100);
    expect(codes).not.toContain('LOOP_VALUE_DISCONTINUITY');
    expect(codes).toContain('LOOP_DERIVATIVE_DISCONTINUITY');
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

  it('keeps flat-top shape detection invariant under attenuation', () => {
    const data = new Float32Array(1000);
    for (const start of [100, 300, 500, 700]) {
      data[start - 1] = 0.4;
      data.fill(0.8, start, start + 6);
      data[start + 6] = 0.35;
    }
    const attenuated = Float32Array.from(data, sample => sample * 0.125);

    const original = analyzeDecodedSample(baseContext({ pitched: false }), fakeDecoded([data], 1000));
    const quiet = analyzeDecodedSample(baseContext({ pitched: false }), fakeDecoded([attenuated], 1000));

    expect(original.flatTopRuns).toBe(4);
    expect(quiet.flatTopRuns).toBe(original.flatTopRuns);
    expect(classifySampleIssues(quiet).map(issue => issue.code)).toContain('FLAT_TOP_CLIPPING');
  });

  it('does not call ordinary smooth near-peak samples flat-topped', () => {
    const sampleRate = 44100;
    const data = new Float32Array(sampleRate);
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.9965 * Math.sin((2 * Math.PI * 82.4 * i) / sampleRate);
    }

    const metrics = analyzeDecodedSample(baseContext({ pitched: false }), fakeDecoded([data], sampleRate));

    expect(metrics.flatTopRuns).toBe(0);
  });

  it('scopes raw crest-margin review to lossy delivery rather than inferring the delivered bus', () => {
    const data = sine(69, 0.5);
    for (let i = 0; i < data.length; i++) data[i] *= 1.998;

    const lossless = analyzeDecodedSample(baseContext({ pitched: false, file: 'C4.wav' }), fakeDecoded([data]));
    const lossy = analyzeDecodedSample(
      baseContext({ pitched: false, file: 'C4.m4a', playbackGainDb: -3 }),
      fakeDecoded([data]),
    );

    expect(lossless.peakDb).toBeCloseTo(0, 1);
    expect(classifySampleIssues(lossless).map(issue => issue.code)).not.toContain('HOT_PEAK');
    expect(classifySampleIssues(lossy).map(issue => issue.code)).toContain('HOT_PEAK');
  });
});
