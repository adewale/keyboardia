import { describe, expect, it } from 'vitest';
import { SYNTH_PRESETS } from './synth';
import {
  ENVELOPE_PCM_FIXED_CANARIES,
  ENVELOPE_PCM_FIXTURE_AXES,
  ENVELOPE_PCM_PRESET_FIXTURES,
  ENVELOPE_PCM_SAMPLE_RATE,
  ENVELOPE_PCM_TOLERANCES,
} from '../test/envelope-pcm-manifest';

describe('offline PCM migration fixture manifest', () => {
  it('pins the normative sample rate, axes, and tolerances', () => {
    expect(ENVELOPE_PCM_SAMPLE_RATE).toBe(48_000);
    expect(ENVELOPE_PCM_FIXTURE_AXES).toEqual({
      midiNotes: [36, 60, 84],
      velocities: [0.25, 0.7, 1],
      gates: [25, 90, 100],
      phrases: ['one-step', 'four-step-tie', 'early-release', 'eight-voice', 'effects-on'],
    });
    expect(ENVELOPE_PCM_TOLERANCES.maximumAbsoluteSample).toBe(1);
  });

  it('discovers every native preset and fixed canary', () => {
    const ids = Object.keys(SYNTH_PRESETS).sort();
    expect(ENVELOPE_PCM_PRESET_FIXTURES.map(fixture => fixture.presetId).sort()).toEqual(ids);
    expect(ENVELOPE_PCM_FIXED_CANARIES.every(id => id in SYNTH_PRESETS)).toBe(true);
  });
});
