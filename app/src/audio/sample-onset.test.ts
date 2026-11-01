import { describe, expect, it } from 'vitest';
import {
  MAX_ADAPTIVE_CODEC_DELAY_SECONDS,
  MAX_CONFIGURED_ADAPTIVE_CODEC_DELAY_SECONDS,
  MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS,
  compensatedSampleStartOffset,
  measureDecodedLeadingSilenceSeconds,
  type DecodedAudioBufferView,
} from './sample-onset';

function decodedBuffer(onsetFrame: number, length = 2_000, sampleRate = 48_000): DecodedAudioBufferView {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  left[onsetFrame] = 0.8;
  right[onsetFrame + 1] = -0.5;
  return {
    length,
    numberOfChannels: 2,
    sampleRate,
    getChannelData: channel => channel === 0 ? left : right,
  };
}

describe('decoded sample onset compensation', () => {
  it('measures the earliest audible frame across channels', () => {
    expect(measureDecodedLeadingSilenceSeconds(decodedBuffer(624))).toBeCloseTo(0.013, 8);
  });

  it('leaves silent buffers untrimmed for the quality audit to report', () => {
    const silence = decodedBuffer(0);
    silence.getChannelData(0).fill(0);
    silence.getChannelData(1).fill(0);
    expect(measureDecodedLeadingSilenceSeconds(silence)).toBe(0);
  });

  it('keeps a transient safety margin while removing decoder-specific percussion delay', () => {
    expect(compensatedSampleStartOffset(undefined, 0.013, true))
      .toBeCloseTo(0.013 - MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS, 8);
  });

  it('never reduces an authored start offset', () => {
    expect(compensatedSampleStartOffset(0.012, 0.013, true)).toBe(0.012);
  });

  it('does not adapt melodic samples or authored silence beyond the codec-delay bound', () => {
    expect(compensatedSampleStartOffset(undefined, 0.013, false)).toBeUndefined();
    expect(compensatedSampleStartOffset(undefined, MAX_ADAPTIVE_CODEC_DELAY_SECONDS + 0.001, true))
      .toBeUndefined();
  });

  it('supports a bounded, provenance-backed AAC allowance without trimming an immediate browser attack', () => {
    expect(compensatedSampleStartOffset(undefined, 0.048, true, 0.06))
      .toBeCloseTo(0.048 - MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS, 8);
    expect(compensatedSampleStartOffset(undefined, 0.002, true, 0.06))
      .toBeUndefined();
    expect(compensatedSampleStartOffset(
      undefined,
      MAX_CONFIGURED_ADAPTIVE_CODEC_DELAY_SECONDS + 0.001,
      true,
      10,
    )).toBeUndefined();
  });
});
