import { describe, expect, it } from 'vitest';
import { INSTRUMENT_GROUPS } from '../shared/instrument-catalog';
import {
  GENERATED_INSTRUMENT_QUALITY_PROFILES,
} from '../test/generated-instrument-quality-profiles';
import {
  proceduralVelocityLowpassHz,
  toneVelocityLowpassHz,
} from './velocity-timbre';

describe('generated instrument quality contracts', () => {
  it('covers every generated picker instrument exactly once', () => {
    const generatedIds = (Object.values(INSTRUMENT_GROUPS) as readonly {
      instruments: readonly { id: string; type: string }[];
    }[])
      .flatMap(group => group.instruments)
      .filter(instrument => instrument.type !== 'sampled')
      .map(instrument => instrument.id)
      .sort();
    const profileIds = GENERATED_INSTRUMENT_QUALITY_PROFILES.map(profile => profile.id).sort();

    expect(profileIds).toEqual(generatedIds);
    expect(new Set(profileIds).size).toBe(profileIds.length);
    expect(profileIds).toHaveLength(73);
  });

  it('declares range, duration, velocity, motion, and level conditions for every voice', () => {
    for (const profile of GENERATED_INSTRUMENT_QUALITY_PROFILES) {
      expect(profile.noteOffsets.length, profile.id).toBeGreaterThan(0);
      expect(profile.durationsSeconds, profile.id).toHaveLength(2);
      expect(profile.velocities, profile.id).toEqual([40, 90, 127]);
      expect(Number.isFinite(profile.minimumLoudnessLkfs), profile.id).toBe(true);
    }
  });

  it('keeps canonical and hard notes unchanged while soft notes darken deterministically', () => {
    expect(proceduralVelocityLowpassHz('lead', 90)).toBeNull();
    expect(proceduralVelocityLowpassHz('lead', 127)).toBeNull();
    expect(proceduralVelocityLowpassHz('lead', 40)).toBeLessThan(20_000);
    expect(toneVelocityLowpassHz('fm-epiano', 90)).toBe(20_000);
    expect(toneVelocityLowpassHz('fm-epiano', 127)).toBe(20_000);
    expect(toneVelocityLowpassHz('fm-epiano', 40)).toBeLessThan(20_000);
  });
});
