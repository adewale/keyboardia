// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { ADVANCED_SYNTH_PRESETS } from './advancedSynth';
import { FakeAudioContext } from './__fakes__/FakeWebAudio';
import { createSynthesizedSamples } from './samples';
import { SYNTH_PRESETS } from './synth';
import { TONE_SYNTH_PRESETS } from './toneSynths';
import type { Sample } from '../types';

const MAX_SAFE_PEAK = 1;
const MIN_AUDIBLE_RMS = 0.005;

function rms(buffer: AudioBuffer): number {
  const samples = buffer.getChannelData(0);
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / samples.length);
}

function peak(buffer: AudioBuffer): number {
  const samples = buffer.getChannelData(0);
  let maximum = 0;
  for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample));
  return maximum;
}

describe('instrument volume contracts', () => {
  describe('Web Audio synth presets', () => {
    it.each(Object.entries(SYNTH_PRESETS))('%s has a sequencer-safe envelope', (_name, preset) => {
      expect(preset.attack).toBeGreaterThan(0);
      expect(preset.attack).toBeLessThan(0.1);
      expect(preset.decay).toBeGreaterThan(0);
      expect(preset.sustain).toBeGreaterThanOrEqual(0);
      expect(preset.sustain).toBeLessThanOrEqual(1);
      expect(preset.release).toBeGreaterThan(0);
    });
  });

  describe('Tone.js synth presets', () => {
    const envelopePresets = Object.entries(TONE_SYNTH_PRESETS).filter(
      ([, preset]) => preset.type !== 'pluck' && preset.type !== 'duo',
    );

    it.each(envelopePresets)('%s declares a bounded amplitude envelope', (_name, preset) => {
      const envelope = preset.config.envelope as { sustain?: number } | undefined;
      expect(envelope).toBeDefined();
      if (envelope?.sustain !== undefined) {
        expect(envelope.sustain).toBeGreaterThanOrEqual(0);
        expect(envelope.sustain).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('advanced synth presets', () => {
    it.each(Object.entries(ADVANCED_SYNTH_PRESETS))(
      '%s has audible oscillators and a bounded envelope',
      (_name, preset) => {
        expect(preset.oscillator1.level).toBeGreaterThanOrEqual(0);
        expect(preset.oscillator1.level).toBeLessThanOrEqual(1);
        expect(preset.oscillator2.level).toBeGreaterThanOrEqual(0);
        expect(preset.oscillator2.level).toBeLessThanOrEqual(1);
        expect(preset.oscillator1.level + preset.oscillator2.level).toBeGreaterThan(0);
        expect(preset.amplitudeEnvelope.attack).toBeGreaterThan(0);
        expect(preset.amplitudeEnvelope.sustain).toBeGreaterThanOrEqual(0);
        expect(preset.amplitudeEnvelope.sustain).toBeLessThanOrEqual(1);
      },
    );
  });

  describe('procedurally generated samples', () => {
    let samples: Map<string, Sample>;

    beforeAll(async () => {
      samples = await createSynthesizedSamples(new FakeAudioContext().asAudioContext());
    });

    it('renders every registered buffer as audible, finite mono audio', () => {
      expect(samples.size).toBeGreaterThan(0);
      for (const [id, sample] of samples) {
        expect(sample.buffer, `${id} has no rendered buffer`).toBeDefined();
        const buffer = sample.buffer!;
        expect(buffer.length, `${id} has an empty buffer`).toBeGreaterThan(0);
        expect(buffer.numberOfChannels, `${id} is not mono`).toBe(1);
        expect(buffer.sampleRate, `${id} has an invalid sample rate`).toBeGreaterThan(0);
        expect(rms(buffer), `${id} is effectively silent`).toBeGreaterThan(MIN_AUDIBLE_RMS);
        expect.soft(peak(buffer), `${id} clips`).toBeLessThanOrEqual(MAX_SAFE_PEAK);
      }
    });
  });
});
