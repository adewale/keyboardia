import { describe, expect, it } from 'vitest';
import { VALID_SAMPLE_IDS } from './instrument-catalog';
import {
  adaptEnvelopeToPlaybackMode,
  ENVELOPE_CAPABILITY_REGISTRY,
  describeEnvelopeCompatibility,
  getEnvelopeCapability,
} from './envelope-capabilities';

describe('envelope capability inventory', () => {
  it('has exactly one row for every published catalogue instrument', () => {
    expect(Object.keys(ENVELOPE_CAPABILITY_REGISTRY).sort()).toEqual([...VALID_SAMPLE_IDS].sort());
  });

  it('only offers loop playback for the validated Hammond source', () => {
    const loopIds = Object.entries(ENVELOPE_CAPABILITY_REGISTRY)
      .filter(([, capability]) => capability.samplePlaybackModes?.includes('loop'))
      .map(([id]) => id);
    expect(loopIds).toEqual(['sampled:hammond-organ']);
    expect(getEnvelopeCapability('sampled:hammond-organ').sustainSource).toBe('sample-loop');
  });

  it('preserves but marks a finite-sample ADSR override inactive', () => {
    const result = describeEnvelopeCompatibility('sampled:piano', {
      model: 'adsr',
      attack: { value: 0.01, unit: 'seconds' },
      decay: { value: 0.2, unit: 'seconds' },
      sustain: 0.8,
      release: { value: 1, unit: 'seconds' },
    }, 'trigger');
    expect(result.active).toBe(false);
    expect(result.reason).toContain('does not support');
  });

  it.each([
    ['ar', 'trigger'],
    ['ahd', 'gate'],
    ['ar', 'loop'],
  ] as const)('rejects the silent sample pairing %s + %s', (model, mode) => {
    const envelope = model === 'ar'
      ? { model, attack: { value: 0, unit: 'seconds' as const }, release: { value: 1, unit: 'seconds' as const } }
      : { model, attack: { value: 0, unit: 'seconds' as const }, hold: { value: 1, unit: 'seconds' as const }, decay: { value: 1, unit: 'seconds' as const } };
    expect(describeEnvelopeCompatibility('sampled:hammond-organ', envelope, mode))
      .toMatchObject({ active: false, reason: expect.stringContaining('not compatible') });
  });

  it('changes finite-sample playback and envelope shape atomically', () => {
    const trigger = {
      model: 'ahd' as const,
      attack: { value: 0.02, unit: 'seconds' as const },
      hold: { value: 2, unit: 'steps' as const },
      decay: { value: 0.4, unit: 'seconds' as const },
    };

    expect(adaptEnvelopeToPlaybackMode(trigger, 'gate')).toEqual({
      model: 'ar',
      attack: trigger.attack,
      release: { value: 0.1, unit: 'seconds' },
    });
    expect(adaptEnvelopeToPlaybackMode(trigger, 'loop')).toEqual({
      model: 'adsr',
      attack: trigger.attack,
      decay: trigger.decay,
      sustain: 1,
      release: { value: 0.1, unit: 'seconds' },
    });
  });

  it('preserves compatible authored shapes without allocating a replacement', () => {
    const gate = {
      model: 'ar' as const,
      attack: { value: 1, unit: 'steps' as const },
      release: { value: 3, unit: 'steps' as const },
    };
    expect(adaptEnvelopeToPlaybackMode(gate, 'gate')).toBe(gate);
  });
});
