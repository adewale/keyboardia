import { describe, expect, it } from 'vitest';
import { getEffectiveTrackEnvelopeV2, getPresetTrackEnvelopeV2 } from './envelope';

describe('effective envelope v2 capability resolution', () => {
  it('keeps oscillator preset defaults as ADSR', () => {
    expect(getPresetTrackEnvelopeV2('synth:pad')).toEqual({
      model: 'adsr',
      attack: { value: 0.05, unit: 'seconds' },
      decay: { value: 0.15, unit: 'seconds' },
      sustain: 0.85,
      release: { value: 1, unit: 'seconds' },
    });
  });

  it('does not fabricate sustain for a finite piano source', () => {
    expect(getPresetTrackEnvelopeV2('sampled:piano').model).toBe('ahd');
  });

  it('preserves an incompatible authored override while using the truthful preset', () => {
    const authored = {
      model: 'adsr' as const,
      attack: { value: 0.01, unit: 'seconds' as const },
      decay: { value: 0.2, unit: 'seconds' as const },
      sustain: 0.8,
      release: { value: 1, unit: 'seconds' as const },
    };
    const result = getEffectiveTrackEnvelopeV2({
      sampleId: 'sampled:piano',
      envelopeV2: authored,
      samplePlaybackMode: 'trigger',
    });
    expect(result.authored).toEqual(authored);
    expect(result.effective.model).toBe('ahd');
    expect(result.active).toBe(false);
    expect(result.inactiveReason).toContain('does not support');
  });

  it('retains an unsupported playback override as inactive but runs the preset mode', () => {
    const result = getEffectiveTrackEnvelopeV2({
      sampleId: 'sampled:piano',
      samplePlaybackMode: 'loop',
    });
    expect(result).toMatchObject({
      active: false,
      playbackMode: 'trigger',
      effective: { model: 'ahd' },
      inactiveReason: expect.stringContaining('does not support loop'),
    });
  });

  it('does not silently run AR as a trigger envelope', () => {
    const result = getEffectiveTrackEnvelopeV2({
      sampleId: 'sampled:piano',
      samplePlaybackMode: 'trigger',
      envelopeV2: {
        model: 'ar',
        attack: { value: 0, unit: 'seconds' },
        release: { value: 1, unit: 'seconds' },
      },
    });
    expect(result).toMatchObject({
      active: false,
      playbackMode: 'trigger',
      effective: { model: 'ahd' },
      inactiveReason: expect.stringContaining('not compatible'),
    });
  });
});
