import { describe, expect, it } from 'vitest';
import type { TrackEnvelopeV2 } from './envelope-contract-v2';
import {
  amplitudeAtEnvelopeTimeV2,
  buildEnvelopeOracleTimelineV2,
  ENVELOPE_EPSILON_V2,
  resolveGateNoteOffSecondsV2,
} from './envelope-oracle-v2';

const AD: TrackEnvelopeV2 = {
  model: 'ad',
  attack: { value: 0.1, unit: 'seconds' },
  decay: { value: 0.4, unit: 'seconds' },
};
const AHD: TrackEnvelopeV2 = {
  model: 'ahd',
  attack: { value: 0.1, unit: 'seconds' },
  hold: { value: 1, unit: 'steps' },
  decay: { value: 0.4, unit: 'seconds' },
};
const AR: TrackEnvelopeV2 = {
  model: 'ar',
  attack: { value: 0.2, unit: 'seconds' },
  release: { value: 0.4, unit: 'seconds' },
};
const ADSR: TrackEnvelopeV2 = {
  model: 'adsr',
  attack: { value: 0.2, unit: 'seconds' },
  decay: { value: 0.4, unit: 'seconds' },
  sustain: 0.5,
  release: { value: 0.4, unit: 'seconds' },
};

describe('envelope v2 independent amplitude oracle', () => {
  it('computes final gate after the last cell in a tied run', () => {
    expect(resolveGateNoteOffSecondsV2(1, 120, 1, 90)).toBeCloseTo(1.1125);
    expect(resolveGateNoteOffSecondsV2(1, 120, 3, 90)).toBeCloseTo(1.3625);
    expect(resolveGateNoteOffSecondsV2(1, 120, 3, 0)).toBeCloseTo(1.25);
  });

  it('models AD attack and decay landmarks and ignores note-off', () => {
    const timeline = buildEnvelopeOracleTimelineV2({
      envelope: AD,
      bpm: 120,
      onsetSeconds: 1,
      noteOffSeconds: 1.05,
    });
    expect(timeline.attackEndSeconds).toBeCloseTo(1.1);
    expect(timeline.decayEndSeconds).toBeCloseTo(1.5);
    expect(timeline.releaseStartSeconds).toBeUndefined();
    expect(amplitudeAtEnvelopeTimeV2(timeline, 1)).toBe(ENVELOPE_EPSILON_V2);
    expect(amplitudeAtEnvelopeTimeV2(timeline, 1.1)).toBe(1);
    expect(amplitudeAtEnvelopeTimeV2(timeline, 1.3)).toBeCloseTo(0.50005);
    expect(amplitudeAtEnvelopeTimeV2(timeline, 1.5)).toBe(ENVELOPE_EPSILON_V2);
  });

  it('keeps AHD at peak for its typed hold duration', () => {
    const timeline = buildEnvelopeOracleTimelineV2({
      envelope: AHD,
      bpm: 120,
      onsetSeconds: 0,
    });
    expect(timeline.attackEndSeconds).toBeCloseTo(0.1);
    expect(timeline.holdEndSeconds).toBeCloseTo(0.225);
    expect(timeline.decayEndSeconds).toBeCloseTo(0.625);
    expect(amplitudeAtEnvelopeTimeV2(timeline, 0.2)).toBe(1);
    expect(amplitudeAtEnvelopeTimeV2(timeline, 0.425)).toBeCloseTo(0.50005);
  });

  it('releases AR continuously from an early note-off during attack', () => {
    const timeline = buildEnvelopeOracleTimelineV2({
      envelope: AR,
      bpm: 120,
      onsetSeconds: 0,
      noteOffSeconds: 0.1,
    });
    const held = amplitudeAtEnvelopeTimeV2(timeline, 0.1);
    expect(timeline.releaseStartAmplitude).toBeCloseTo(0.50005);
    expect(held).toBeCloseTo(timeline.releaseStartAmplitude ?? 0);
    expect(amplitudeAtEnvelopeTimeV2(timeline, 0.5)).toBe(ENVELOPE_EPSILON_V2);
  });

  it('releases ADSR continuously during decay and reaches epsilon exactly at R', () => {
    const timeline = buildEnvelopeOracleTimelineV2({
      envelope: ADSR,
      bpm: 120,
      onsetSeconds: 0,
      noteOffSeconds: 0.4,
    });
    expect(timeline.releaseStartAmplitude).toBeCloseTo(0.75);
    expect(amplitudeAtEnvelopeTimeV2(timeline, 0.4)).toBeCloseTo(0.75);
    expect(amplitudeAtEnvelopeTimeV2(timeline, 0.8)).toBe(ENVELOPE_EPSILON_V2);
    expect(amplitudeAtEnvelopeTimeV2(timeline, timeline.stopSeconds)).toBe(0);
  });

  it('preserves authored zero stages instead of substituting defaults', () => {
    const timeline = buildEnvelopeOracleTimelineV2({
      envelope: {
        model: 'adsr',
        attack: { value: 0, unit: 'seconds' },
        decay: { value: 0, unit: 'seconds' },
        sustain: 0,
        release: { value: 0, unit: 'seconds' },
      },
      bpm: 120,
      onsetSeconds: 2,
      gatePercent: 0,
    });
    expect(timeline.attackEndSeconds).toBe(2);
    expect(timeline.decayEndSeconds).toBe(2);
    expect(timeline.releaseStartSeconds).toBe(2);
    expect(timeline.releaseEndSeconds).toBe(2);
    expect(timeline.stopSeconds).toBe(2.01);
  });

  it('snapshots tempo per onset instead of retiming an existing voice', () => {
    const at120 = buildEnvelopeOracleTimelineV2({
      envelope: { ...AR, release: { value: 2, unit: 'steps' } },
      bpm: 120,
      onsetSeconds: 0,
      tiedSteps: 2,
      gatePercent: 100,
    });
    const at60 = buildEnvelopeOracleTimelineV2({
      envelope: { ...AR, release: { value: 2, unit: 'steps' } },
      bpm: 60,
      onsetSeconds: 0,
      tiedSteps: 2,
      gatePercent: 100,
    });
    expect(at120.releaseStartSeconds).toBeCloseTo(0.25);
    expect(at120.releaseEndSeconds).toBeCloseTo(0.5);
    expect(at60.releaseStartSeconds).toBeCloseTo(0.5);
    expect(at60.releaseEndSeconds).toBeCloseTo(1);
    expect(at120.releaseEndSeconds).toBeCloseTo(0.5);
  });

  it('rejects impossible scheduler inputs', () => {
    expect(() => resolveGateNoteOffSecondsV2(0, 120, 0, 90)).toThrow(RangeError);
    expect(() => resolveGateNoteOffSecondsV2(0, 120, 1, 101)).toThrow(RangeError);
    expect(() => buildEnvelopeOracleTimelineV2({
      envelope: AR,
      bpm: 120,
      onsetSeconds: 1,
      noteOffSeconds: 0.5,
    })).toThrow(RangeError);
  });
});
