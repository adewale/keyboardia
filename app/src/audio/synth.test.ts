import { describe, it, expect } from 'vitest';
import {
  SYNTH_PRESETS,
  deserializeSynthParams,
  peakSafeOscillatorMix,
  serializeSynthParams,
  type SynthParams,
  velocityFilterCutoff,
} from './synth';

describe('neutral oscillator structure', () => {
  it('keeps correlated oscillator-layer gain at unity or below', () => {
    for (const mix of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const [first, second] = peakSafeOscillatorMix(mix);
      expect(first + second).toBeCloseTo(1, 10);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(second).toBeGreaterThanOrEqual(0);
    }
  });

  it('round-trips explicit layer routing and envelopes through JSON', () => {
    const params: SynthParams = {
      ...SYNTH_PRESETS.pluck,
      osc2: {
        waveform: 'sine', detune: 0, coarse: -12, mix: 0.25,
        filterRouting: 'bypass',
        levelEnvelope: { attack: 0.001, decay: 0.04, sustain: 0.1 },
      },
    };
    expect(deserializeSynthParams(serializeSynthParams(params))).toEqual(params);
  });
});

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

  describe('Phase 43.6 timbre response', () => {
    it('keeps the canonical velocity close to the preset cutoff and darkens soft notes', () => {
      const base = 4000;
      expect(velocityFilterCutoff(base, 90) / base).toBeGreaterThanOrEqual(0.85);
      expect(velocityFilterCutoff(base, 90) / base).toBeLessThanOrEqual(0.9);
      expect(velocityFilterCutoff(base, Math.round(127 * 0.3)))
        .toBeLessThanOrEqual(velocityFilterCutoff(base, 127) * 0.75);
    });

    it('layers formerly bare melodic presets while preserving a mono-stable sub', () => {
      const expectedLayered = [
        'bass', 'lead', 'pad', 'pluck', 'acid', 'funkbass', 'clavinet',
        'rhodes', 'organ', 'wurlitzer', 'discobass', 'strings', 'brass',
        'stab', 'shimmer', 'jangle', 'dreampop', 'bell',
      ];
      for (const id of expectedLayered) {
        const osc2 = SYNTH_PRESETS[id].osc2;
        expect(osc2, `${id} is still single-oscillator`).toBeDefined();
        expect(Math.abs(osc2!.detune)).toBeLessThanOrEqual(id.includes('bass') ? 5 : 12);
      }
      expect(SYNTH_PRESETS.sub.osc2).toBeUndefined();
    });

    it('gives the acid preset a fast, positive filter envelope', () => {
      expect(SYNTH_PRESETS.acid.filterEnv).toMatchObject({
        amount: expect.any(Number),
        attack: expect.any(Number),
        decay: expect.any(Number),
      });
      expect(SYNTH_PRESETS.acid.filterEnv!.amount).toBeGreaterThan(0);
      expect(SYNTH_PRESETS.acid.filterEnv!.attack).toBeLessThanOrEqual(0.01);
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
  it('should have exactly 32 presets (Phase 22: +13 enhanced presets)', () => {
    // Original 19 + 13 enhanced = 32
    // NOTE: Piano is NOT a synth preset - it's a sampled instrument
    expect(Object.keys(SYNTH_PRESETS).length).toBe(32);
  });

  it('should include all expected preset names', () => {
    const expectedPresets = [
      // Core (5)
      'bass', 'lead', 'pad', 'pluck', 'acid',
      // Funk/Soul (2)
      'funkbass', 'clavinet',
      // Keys (3 original)
      'rhodes', 'organ', 'wurlitzer',
      // Disco (3)
      'discobass', 'strings', 'brass',
      // House/Techno (2)
      'stab', 'sub',
      // Atmospheric (4 original)
      'shimmer', 'jangle', 'dreampop', 'bell',
      // Phase 22 Enhanced Electronic (4)
      'supersaw', 'hypersaw', 'wobble', 'growl',
      // Phase 22 Enhanced Atmospheric (4)
      'evolving', 'sweep', 'warmpad', 'glass',
      // Phase 22 Enhanced Keys (3)
      'epiano', 'vibes', 'organphase',
      // Phase 22 Enhanced Bass (2)
      'reese', 'hoover',
    ];

    for (const preset of expectedPresets) {
      expect(SYNTH_PRESETS).toHaveProperty(preset);
    }
  });

  it('should NOT include piano as a synth preset', () => {
    // Piano is a SAMPLED instrument, not a synth
    // Sampled instruments should SKIP when not ready, not fall back to synth
    expect(SYNTH_PRESETS).not.toHaveProperty('piano');
  });
});
