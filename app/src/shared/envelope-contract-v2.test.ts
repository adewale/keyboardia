import { describe, expect, it } from 'vitest';
import {
  activeEnvelopeStages,
  clampTrackEnvelopeV2,
  convertTrackEnvelopeUnitsWithReportV2,
  durationToSeconds,
  legacyTrackEnvelopeToV2,
  normalizeTrackEnvelopeV2,
  resolveEnvelopeV2,
  trackEnvelopeV2ToLegacySeconds,
  validateTrackEnvelopeV2,
  type TrackEnvelopeV2,
} from './envelope-contract-v2';

describe('envelope v2 semantic contract', () => {
  it('converts absolute and sixteenth-step durations at the scheduling tempo', () => {
    expect(durationToSeconds({ value: 0.25, unit: 'seconds' }, 60)).toBe(0.25);
    expect(durationToSeconds({ value: 1, unit: 'steps' }, 120)).toBe(0.125);
    expect(durationToSeconds({ value: 4, unit: 'steps' }, 120)).toBe(0.5);
    expect(durationToSeconds({ value: 0, unit: 'steps' }, 93)).toBe(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid scheduling tempo %s',
    (tempo) => {
      expect(() => durationToSeconds({ value: 1, unit: 'steps' }, tempo)).toThrow(RangeError);
    },
  );

  it('resolves every coarse model without inventing inactive stages', () => {
    const cases: Array<[TrackEnvelopeV2, object]> = [
      [
        {
          model: 'ad',
          attack: { value: 0.01, unit: 'seconds' },
          decay: { value: 2, unit: 'steps' },
        },
        { model: 'ad', attackSeconds: 0.01, decaySeconds: 0.25 },
      ],
      [
        {
          model: 'ahd',
          attack: { value: 0, unit: 'seconds' },
          hold: { value: 0.5, unit: 'steps' },
          decay: { value: 0.4, unit: 'seconds' },
        },
        { model: 'ahd', attackSeconds: 0, holdSeconds: 0.0625, decaySeconds: 0.4 },
      ],
      [
        {
          model: 'ar',
          attack: { value: 0.005, unit: 'seconds' },
          release: { value: 2, unit: 'steps' },
        },
        { model: 'ar', attackSeconds: 0.005, releaseSeconds: 0.25 },
      ],
      [
        {
          model: 'adsr',
          attack: { value: 0.01, unit: 'seconds' },
          decay: { value: 0.2, unit: 'seconds' },
          sustain: 0.7,
          release: { value: 2, unit: 'steps' },
        },
        {
          model: 'adsr',
          attackSeconds: 0.01,
          decaySeconds: 0.2,
          sustain: 0.7,
          releaseSeconds: 0.25,
        },
      ],
    ];

    for (const [envelope, expected] of cases) {
      expect(resolveEnvelopeV2(envelope, 120)).toEqual(expected);
    }
  });

  it('declares only stages that can affect each model', () => {
    expect(activeEnvelopeStages('ad')).toEqual(['attack', 'decay']);
    expect(activeEnvelopeStages('ahd')).toEqual(['attack', 'hold', 'decay']);
    expect(activeEnvelopeStages('ar')).toEqual(['attack', 'release']);
    expect(activeEnvelopeStages('adsr')).toEqual(['attack', 'decay', 'release']);
  });

  it('normalizes v2.3 detached-unit ADSR without changing audible time', () => {
    const canonical = legacyTrackEnvelopeToV2({
      attack: 2,
      decay: 4,
      sustain: 0.75,
      release: 8,
    }, 'steps');
    expect(canonical).toEqual({
      model: 'adsr',
      attack: { value: 2, unit: 'steps' },
      decay: { value: 4, unit: 'steps' },
      sustain: 0.75,
      release: { value: 8, unit: 'steps' },
    });
    expect(trackEnvelopeV2ToLegacySeconds(canonical, 120)).toEqual({
      attack: 0.25,
      decay: 0.5,
      sustain: 0.75,
      release: 1,
    });
    expect(normalizeTrackEnvelopeV2(canonical)).toEqual(canonical);
  });

  it('converts every timed stage atomically and reports clamp loss', () => {
    const source: TrackEnvelopeV2 = {
      model: 'ahd',
      attack: { value: 4, unit: 'seconds' },
      hold: { value: 8, unit: 'seconds' },
      decay: { value: 8, unit: 'seconds' },
    };
    const result = convertTrackEnvelopeUnitsWithReportV2(source, 'steps', 180);
    expect(result.envelope).toEqual({
      model: 'ahd',
      attack: { value: 48, unit: 'steps' },
      hold: { value: 96, unit: 'steps' },
      decay: { value: 96, unit: 'steps' },
    });
    expect(result.clampedStages).toEqual([]);
    const roundTrip = convertTrackEnvelopeUnitsWithReportV2(result.envelope, 'seconds', 180);
    expect(roundTrip.envelope).toEqual(source);
  });

  it('keeps exact zero and clamps every model-specific range', () => {
    expect(clampTrackEnvelopeV2({
      model: 'adsr',
      attack: { value: -1, unit: 'seconds' },
      decay: { value: 200, unit: 'steps' },
      sustain: 2,
      release: { value: 0, unit: 'seconds' },
    })).toEqual({
      model: 'adsr',
      attack: { value: 0, unit: 'seconds' },
      decay: { value: 96, unit: 'steps' },
      sustain: 1,
      release: { value: 0, unit: 'seconds' },
    });
  });

  it('strict validation rejects unknown and inactive stage keys', () => {
    const result = validateTrackEnvelopeV2({
      model: 'ad',
      attack: { value: 0.01, unit: 'seconds' },
      decay: { value: 0.2, unit: 'seconds' },
      sustain: 9,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('sustain');
  });
});
