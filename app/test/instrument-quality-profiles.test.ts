import { describe, expect, it } from 'vitest';

import { getInstrumentRange } from '../src/audio/instrument-ranges';
import { INSTRUMENT_GROUPS } from '../src/shared/instrument-catalog';
import {
  INSTRUMENT_QUALITY_PROFILES,
  assertInstrumentQualityProfileCoverage,
} from '../scripts/instrument-quality-profiles';

const catalogueIds = Object.values(INSTRUMENT_GROUPS)
  .flatMap(group => group.instruments.map(instrument => instrument.id));

describe('instrument quality profiles', () => {
  it('covers all 99 selectable IDs exactly once', () => {
    expect(catalogueIds).toHaveLength(99);
    expect(INSTRUMENT_QUALITY_PROFILES).toHaveLength(99);
    expect(() => assertInstrumentQualityProfileCoverage(catalogueIds)).not.toThrow();
    expect(INSTRUMENT_QUALITY_PROFILES.map(profile => profile.id).sort())
      .toEqual([...catalogueIds].sort());
  });

  it('fails closed when the catalogue and committed profile set diverge', () => {
    expect(() => assertInstrumentQualityProfileCoverage([...catalogueIds, 'future:missing']))
      .toThrow(/missing=\[future:missing\]/);
    expect(() => assertInstrumentQualityProfileCoverage(catalogueIds.slice(1)))
      .toThrow(/unexpected=/);
  });

  it('commits usable render and role expectations for every instrument', () => {
    for (const profile of INSTRUMENT_QUALITY_PROFILES) {
      const range = getInstrumentRange(profile.id);
      expect(profile.render.canonicalMidi, profile.id).toBeGreaterThanOrEqual(range.minMidi);
      expect(profile.render.canonicalMidi, profile.id).toBeLessThanOrEqual(range.maxMidi);
      expect(profile.render.tailSeconds, profile.id).toBeGreaterThanOrEqual(2.1);
      expect(profile.render.gateSeconds, profile.id).toBeGreaterThan(0);
      expect(profile.render.polyphonyMidi.length, profile.id).toBeGreaterThan(0);
      expect(profile.role, profile.id).toBeTruthy();
      expect(profile.pitchMode, profile.id).toBeTruthy();
      expect(profile.pitchReference, profile.id).toBeTruthy();
      expect(profile.envelopeClass, profile.id).toBeTruthy();
      expect(profile.loudnessClass, profile.id).toBeTruthy();
      expect(profile.velocityPolicy, profile.id).toBe('measure-only');
      expect(profile.releasePolicy, profile.id).toMatch(/^(lifecycle|natural-decay)$/);
      expect(profile.variationPolicy, profile.id).toMatch(/^(replay-only|alternate-seed-must-differ)$/);
      expect(profile.stereoPolicy, profile.id).toBe('mono-fold-only');
    }
  });

  it('does not assert unmeasured velocity-layer timbre as profile fact', () => {
    expect(new Set(INSTRUMENT_QUALITY_PROFILES.map(profile => profile.velocityPolicy)))
      .toEqual(new Set(['measure-only']));
    expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === 'sampled:kalimba')?.velocityPolicy)
      .toBe('measure-only');
  });

  it('marks pitched FX as tonal without treating noise FX as pitched', () => {
    const tonalFx = [
      'synth:bell', 'synth:stab', 'synth:brass', 'synth:wobble',
      'synth:growl', 'tone:fm-bell', 'tone:am-bell', 'tone:am-tremolo',
    ];
    for (const id of tonalFx) {
      expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === id)?.pitchMode, id).toBe('tonal');
    }
    for (const id of ['sampled:vinyl-crackle', 'zap', 'noise']) {
      expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === id)?.pitchMode, id).not.toBe('tonal');
    }
  });

  it('preregisters harmonic-rich pitch references instead of applying one universal fundamental rule', () => {
    expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === 'sampled:hammond-organ')?.pitchReference)
      .toBe('fundamental-one-octave-below');
    for (const id of ['sampled:finger-bass', 'sampled:slap-bass']) {
      expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === id)?.pitchReference, id)
        .toBe('harmonic-pitch-class');
    }
    expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === 'bass')?.pitchReference)
      .toBe('absolute-fundamental');
    expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === 'noise')?.pitchReference)
      .toBe('not-applicable');
  });

  it('requires release lifecycle checks for sustained oscillator and Tone voices', () => {
    const lifecycleIds = [
      'synth:vibes', 'synth:stab', 'synth:brass', 'synth:wobble',
      'synth:growl', 'tone:fm-bell', 'tone:am-bell', 'tone:am-tremolo',
    ];
    for (const id of lifecycleIds) {
      expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === id)?.releasePolicy, id)
        .toBe('lifecycle');
    }
  });

  it('declares alternate-seed enforcement only for seeded procedural variation', () => {
    expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === 'kick')?.variationPolicy)
      .toBe('alternate-seed-must-differ');
    expect(INSTRUMENT_QUALITY_PROFILES.find(profile => profile.id === 'sampled:acoustic-kick')?.variationPolicy)
      .toBe('replay-only');
  });
});
