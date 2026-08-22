import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ADVANCED_SYNTH_PRESETS, NATIVE_ADVANCED_SYNTH_PRESETS } from './advancedSynth';
import {
  effectiveAudioEnvelope,
  envelopeTimeScale,
  resolvedEnvelopeV2ToToneSchedule,
  translateTrackEnvelope,
} from './envelope-translate';
import { SYNTH_PRESETS } from './synth';
import { XY_PAD_PRESETS } from './xyPad';
import { ENVELOPE_RANGES, getPresetTrackEnvelope } from '../shared/envelope';

describe('canonical envelope translation', () => {
  it('preserves authored zeroes instead of substituting defaults', () => {
    expect(translateTrackEnvelope({ attack: 0, decay: 0, sustain: 0, release: 0 }, 120))
      .toEqual({ attack: 0, decay: 0, sustain: 0, release: 0 });
  });

  it('expresses step-relative A/D/R as sixteenth-note fractions', () => {
    expect(envelopeTimeScale(120, 'steps')).toBe(.125);
    expect(translateTrackEnvelope({ attack: 2, decay: 1, sustain: .5, release: 4 }, 120, 'steps'))
      .toEqual({ attack: .25, decay: .125, sustain: .5, release: .5 });
  });

  it('applies note locks after the track/preset envelope and in the track unit', () => {
    expect(effectiveAudioEnvelope(
      { attack: .125, decay: .25, sustain: .75, release: .375 },
      120,
      'steps',
      { attack: 0, release: 2 },
    )).toEqual({
      attack: 0,
      decay: .25,
      sustain: .75,
      release: .25,
    });
  });

  it('maps AHD to a finite Tone schedule that ignores the sequencer gate', () => {
    expect(resolvedEnvelopeV2ToToneSchedule({
      model: 'ahd',
      attackSeconds: 0.1,
      holdSeconds: 0.4,
      decaySeconds: 0.8,
    }, 0.01)).toEqual({
      duration: 0.5,
      envelope: { attack: 0.1, decay: 0, sustain: 1, release: 0.8 },
    });
  });

  it('clamps every finite authored envelope into the shared range', () => {
    fc.assert(fc.property(
      fc.record({
        attack: fc.double({ noNaN: true, noDefaultInfinity: true }),
        decay: fc.double({ noNaN: true, noDefaultInfinity: true }),
        sustain: fc.double({ noNaN: true, noDefaultInfinity: true }),
        release: fc.double({ noNaN: true, noDefaultInfinity: true }),
      }),
      envelope => {
        const result = translateTrackEnvelope(envelope, 120);
        expect(result.attack).toBeGreaterThanOrEqual(ENVELOPE_RANGES.attack.min);
        expect(result.attack).toBeLessThanOrEqual(ENVELOPE_RANGES.attack.max);
        expect(result.decay).toBeGreaterThanOrEqual(ENVELOPE_RANGES.decay.min);
        expect(result.decay).toBeLessThanOrEqual(ENVELOPE_RANGES.decay.max);
        expect(result.sustain).toBeGreaterThanOrEqual(ENVELOPE_RANGES.sustain.min);
        expect(result.sustain).toBeLessThanOrEqual(ENVELOPE_RANGES.sustain.max);
        expect(result.release).toBeGreaterThanOrEqual(ENVELOPE_RANGES.release.min);
        expect(result.release).toBeLessThanOrEqual(ENVELOPE_RANGES.release.max);
      },
    ));
  });
});

describe('preset migration gate', () => {
  it('migrates every synth preset with identical ADSR and core oscillator/filter authorship', () => {
    expect(Object.keys(NATIVE_ADVANCED_SYNTH_PRESETS)).toHaveLength(Object.keys(SYNTH_PRESETS).length);
    for (const [id, before] of Object.entries(SYNTH_PRESETS)) {
      const after = NATIVE_ADVANCED_SYNTH_PRESETS[`native:${id}`];
      expect(after, id).toBeDefined();
      expect(after!.amplitudeEnvelope, id).toEqual({
        attack: before.attack,
        decay: before.decay,
        sustain: before.sustain,
        release: before.release,
      });
      expect(after!.oscillator1.waveform, id).toBe(before.waveform);
      expect(after!.filter.frequency, id).toBe(before.filterCutoff);
      expect(after!.filter.resonance, id).toBe(before.filterResonance);
      expect(getPresetTrackEnvelope(`synth:${id}`), id).toEqual(after!.amplitudeEnvelope);
    }
  });

  it('keeps the runtime-neutral effective-envelope index aligned with advanced presets', () => {
    for (const [id, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
      expect(getPresetTrackEnvelope(`advanced:${id}`), id).toEqual(preset.amplitudeEnvelope);
    }
  });

  it('uses the exact shared envelope ranges in the XY macro', () => {
    const [attack, release] = XY_PAD_PRESETS['envelope-shape']!.mappings;
    expect({ min: attack!.min, max: attack!.max }).toEqual(ENVELOPE_RANGES.attack);
    expect({ min: release!.min, max: release!.max }).toEqual(ENVELOPE_RANGES.release);
  });
});
