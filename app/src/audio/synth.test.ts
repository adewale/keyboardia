import { describe, it, expect } from 'vitest';
import { SYNTH_PRESETS, type SynthParams } from './synth';

/**
 * These tests verify that all synth presets are properly configured
 * for use in a step sequencer context.
 *
 * Key constraints:
 * - At 120 BPM, a 16th note step = 0.125 seconds
 * - Attack time must be < 0.1s for the note to be audible before release
 * - All parameters must be within valid Web Audio API ranges
 */

// At 120 BPM, a 16th note is 0.125 seconds
// Note duration in scheduler is `stepDuration * 0.9` ≈ 0.1125 seconds
const MAX_ATTACK_TIME = 0.1; // Attack must complete before note ends

describe('Synth preset parameters', () => {
  const presets = Object.entries(SYNTH_PRESETS);

  describe('all presets have valid structure', () => {
    it.each(presets)('%s should have all required parameters', (_name, params) => {
      expect(params).toHaveProperty('waveform');
      expect(params).toHaveProperty('filterCutoff');
      expect(params).toHaveProperty('filterResonance');
      expect(params).toHaveProperty('attack');
      expect(params).toHaveProperty('decay');
      expect(params).toHaveProperty('sustain');
      expect(params).toHaveProperty('release');
    });
  });

  describe('waveform types are valid', () => {
    const validWaveforms = ['sine', 'triangle', 'sawtooth', 'square'];

    it.each(presets)('%s should have a valid waveform type', (_name, params) => {
      expect(validWaveforms).toContain(params.waveform);
    });
  });

  describe('attack times are sequencer-compatible', () => {
    it.each(presets)(
      '%s attack time (%s s) should be < 0.1s for audibility at 120 BPM',
      (_name, params) => {
        expect(params.attack).toBeLessThan(MAX_ATTACK_TIME);
      }
    );
  });

  describe('filter parameters are within valid ranges', () => {
    it.each(presets)('%s filter cutoff should be 20-20000 Hz', (_name, params) => {
      expect(params.filterCutoff).toBeGreaterThanOrEqual(20);
      expect(params.filterCutoff).toBeLessThanOrEqual(20000);
    });

    it.each(presets)('%s filter resonance should be 0-30', (_name, params) => {
      expect(params.filterResonance).toBeGreaterThanOrEqual(0);
      expect(params.filterResonance).toBeLessThanOrEqual(30);
    });
  });

  describe('envelope parameters are within valid ranges', () => {
    it.each(presets)('%s attack should be >= 0', (_name, params) => {
      expect(params.attack).toBeGreaterThanOrEqual(0);
    });

    it.each(presets)('%s decay should be >= 0', (_name, params) => {
      expect(params.decay).toBeGreaterThanOrEqual(0);
    });

    it.each(presets)('%s sustain should be 0-1', (_name, params) => {
      expect(params.sustain).toBeGreaterThanOrEqual(0);
      expect(params.sustain).toBeLessThanOrEqual(1);
    });

    it.each(presets)('%s release should be >= 0', (_name, params) => {
      expect(params.release).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Synth preset audibility verification', () => {
  /**
   * Calculate the approximate peak volume a synth will reach
   * given a note duration at 120 BPM.
   *
   * At 120 BPM:
   * - 1 step = 0.125s
   * - Note duration = step * 0.9 = 0.1125s
   *
   * If attack > noteDuration, the note never reaches full volume.
   *
   * Note: ENVELOPE_PEAK is 0.85 for full, rich sound (updated from 0.5)
   */
  const ENVELOPE_PEAK = 0.85;

  function estimatePeakVolume(params: SynthParams, noteDuration: number): number {
    const { attack } = params;

    if (noteDuration >= attack) {
      // Note plays long enough to complete attack
      // Volume reaches ENVELOPE_PEAK (0.85), then decays toward sustain
      return ENVELOPE_PEAK;
    } else {
      // Note ends during attack phase
      // Exponential ramp approximation
      return ENVELOPE_PEAK * (noteDuration / attack);
    }
  }

  const NOTE_DURATION_120_BPM = 0.1125; // 16th note at 120 BPM * 0.9
  const MIN_AUDIBLE_VOLUME = 0.1; // Minimum volume to be heard

  const presets = Object.entries(SYNTH_PRESETS);

  it.each(presets)(
    '%s should reach audible volume (> 0.1) at 120 BPM',
    (_name, params) => {
      const peakVolume = estimatePeakVolume(params, NOTE_DURATION_120_BPM);
      expect(peakVolume).toBeGreaterThan(MIN_AUDIBLE_VOLUME);
    }
  );

  it.each(presets)(
    '%s should reach full attack (0.85) within step duration',
    (_name, params) => {
      const peakVolume = estimatePeakVolume(params, NOTE_DURATION_120_BPM);
      expect(peakVolume).toBe(ENVELOPE_PEAK); // Full attack reached
    }
  );
});

describe('Synth preset count', () => {
  it('should have exactly 19 presets', () => {
    expect(Object.keys(SYNTH_PRESETS).length).toBe(19);
  });

  it('should include all expected preset names', () => {
    const expectedPresets = [
      // Core
      'bass', 'lead', 'pad', 'pluck', 'acid',
      // Keys
      'rhodes', 'organ', 'wurlitzer', 'clavinet',
      // Funk/Soul
      'funkbass',
      // Disco
      'discobass', 'strings', 'brass',
      // House/Techno
      'stab', 'sub',
      // Indie/Atmospheric
      'shimmer', 'jangle', 'dreampop', 'bell',
    ];

    for (const preset of expectedPresets) {
      expect(SYNTH_PRESETS).toHaveProperty(preset);
    }
  });
});
