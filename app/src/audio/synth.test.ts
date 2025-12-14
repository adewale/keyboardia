import { describe, it, expect } from 'vitest';
import {
  SYNTH_PRESETS,
  getPresetCategories,
  type SynthParams,
  type Osc2Config,
  type FilterEnvConfig,
  type LFOConfig,
} from './synth';

/**
 * These tests verify that all synth presets are properly configured
 * for use in a step sequencer context.
 *
 * Key constraints:
 * - At 120 BPM, a 16th note step = 0.125 seconds
 * - Attack time must be < 0.1s for the note to be audible before release
 * - All parameters must be within valid Web Audio API ranges
 *
 * Phase 21A: Added tests for enhanced synthesis features:
 * - Dual oscillator (osc2)
 * - Filter envelope (filterEnv)
 * - LFO modulation (lfo)
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
  it('should have exactly 33 presets (19 original + 14 Phase 21A)', () => {
    expect(Object.keys(SYNTH_PRESETS).length).toBe(33);
  });

  it('should include all original preset names', () => {
    const originalPresets = [
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

    for (const preset of originalPresets) {
      expect(SYNTH_PRESETS).toHaveProperty(preset);
    }
  });

  it('should include all Phase 21A preset names', () => {
    const phase21APresets = [
      // Enhanced Electronic
      'supersaw', 'hypersaw', 'wobble', 'growl',
      // Atmospheric
      'evolving', 'sweep', 'warmpad', 'glass',
      // Vintage Keys
      'epiano', 'vibes', 'organphase',
      // Bass Enhancement
      'reese', 'hoover',
      // Piano (synthesized fallback)
      'piano',
    ];

    for (const preset of phase21APresets) {
      expect(SYNTH_PRESETS).toHaveProperty(preset);
    }
  });
});

// =============================================================================
// Phase 21A: Enhanced Synthesis Feature Tests
// =============================================================================

describe('Phase 21A: Dual Oscillator (osc2) presets', () => {
  const presetsWithOsc2 = Object.entries(SYNTH_PRESETS).filter(
    ([, params]) => params.osc2 !== undefined
  );

  it('should have multiple presets using dual oscillator', () => {
    expect(presetsWithOsc2.length).toBeGreaterThanOrEqual(8);
  });

  describe('osc2 parameter validation', () => {
    const validWaveforms = ['sine', 'triangle', 'sawtooth', 'square'];

    it.each(presetsWithOsc2)('%s osc2 should have valid waveform', (_name, params) => {
      const osc2 = params.osc2 as Osc2Config;
      expect(validWaveforms).toContain(osc2.waveform);
    });

    it.each(presetsWithOsc2)('%s osc2 detune should be -100 to +100 cents', (_name, params) => {
      const osc2 = params.osc2 as Osc2Config;
      expect(osc2.detune).toBeGreaterThanOrEqual(-100);
      expect(osc2.detune).toBeLessThanOrEqual(100);
    });

    it.each(presetsWithOsc2)('%s osc2 coarse should be -24 to +24 semitones', (_name, params) => {
      const osc2 = params.osc2 as Osc2Config;
      expect(osc2.coarse).toBeGreaterThanOrEqual(-24);
      expect(osc2.coarse).toBeLessThanOrEqual(24);
    });

    it.each(presetsWithOsc2)('%s osc2 mix should be 0 to 1', (_name, params) => {
      const osc2 = params.osc2 as Osc2Config;
      expect(osc2.mix).toBeGreaterThanOrEqual(0);
      expect(osc2.mix).toBeLessThanOrEqual(1);
    });
  });

  it('supersaw should use dual sawtooth with detuning', () => {
    const supersaw = SYNTH_PRESETS.supersaw;
    expect(supersaw.osc2).toBeDefined();
    expect(supersaw.waveform).toBe('sawtooth');
    expect(supersaw.osc2?.waveform).toBe('sawtooth');
    expect(supersaw.osc2?.detune).toBeGreaterThan(0); // Positive detune for beating
    expect(supersaw.osc2?.mix).toBe(0.5); // Equal mix
  });

  it('glass should use octave-up second oscillator', () => {
    const glass = SYNTH_PRESETS.glass;
    expect(glass.osc2).toBeDefined();
    expect(glass.osc2?.coarse).toBe(12); // Octave up
  });

  it('hoover should use octave-down second oscillator', () => {
    const hoover = SYNTH_PRESETS.hoover;
    expect(hoover.osc2).toBeDefined();
    expect(hoover.osc2?.coarse).toBe(-12); // Octave down
  });
});

describe('Phase 21A: Filter Envelope (filterEnv) presets', () => {
  const presetsWithFilterEnv = Object.entries(SYNTH_PRESETS).filter(
    ([, params]) => params.filterEnv !== undefined
  );

  it('should have multiple presets using filter envelope', () => {
    expect(presetsWithFilterEnv.length).toBeGreaterThanOrEqual(6);
  });

  describe('filterEnv parameter validation', () => {
    it.each(presetsWithFilterEnv)('%s filterEnv amount should be -1 to +1', (_name, params) => {
      const filterEnv = params.filterEnv as FilterEnvConfig;
      expect(filterEnv.amount).toBeGreaterThanOrEqual(-1);
      expect(filterEnv.amount).toBeLessThanOrEqual(1);
    });

    it.each(presetsWithFilterEnv)('%s filterEnv attack should be >= 0', (_name, params) => {
      const filterEnv = params.filterEnv as FilterEnvConfig;
      expect(filterEnv.attack).toBeGreaterThanOrEqual(0);
    });

    it.each(presetsWithFilterEnv)('%s filterEnv decay should be >= 0', (_name, params) => {
      const filterEnv = params.filterEnv as FilterEnvConfig;
      expect(filterEnv.decay).toBeGreaterThanOrEqual(0);
    });

    it.each(presetsWithFilterEnv)('%s filterEnv sustain should be 0 to 1', (_name, params) => {
      const filterEnv = params.filterEnv as FilterEnvConfig;
      expect(filterEnv.sustain).toBeGreaterThanOrEqual(0);
      expect(filterEnv.sustain).toBeLessThanOrEqual(1);
    });
  });

  it('evolving should have slow filter envelope attack', () => {
    const evolving = SYNTH_PRESETS.evolving;
    expect(evolving.filterEnv).toBeDefined();
    expect(evolving.filterEnv?.attack).toBeGreaterThan(1); // Slow opening
  });

  it('hoover should have negative filter envelope (closing filter)', () => {
    const hoover = SYNTH_PRESETS.hoover;
    expect(hoover.filterEnv).toBeDefined();
    expect(hoover.filterEnv?.amount).toBeLessThan(0); // Negative = filter closes
  });

  it('glass should have fast filter envelope for bright attack', () => {
    const glass = SYNTH_PRESETS.glass;
    expect(glass.filterEnv).toBeDefined();
    expect(glass.filterEnv?.attack).toBeLessThan(0.01); // Fast attack
    expect(glass.filterEnv?.amount).toBeGreaterThan(0); // Opens filter
  });
});

describe('Phase 21A: LFO (lfo) presets', () => {
  const presetsWithLFO = Object.entries(SYNTH_PRESETS).filter(
    ([, params]) => params.lfo !== undefined
  );

  it('should have multiple presets using LFO', () => {
    expect(presetsWithLFO.length).toBeGreaterThanOrEqual(6);
  });

  describe('lfo parameter validation', () => {
    const validWaveforms = ['sine', 'triangle', 'sawtooth', 'square'];
    const validDestinations = ['filter', 'pitch', 'amplitude'];

    it.each(presetsWithLFO)('%s lfo should have valid waveform', (_name, params) => {
      const lfo = params.lfo as LFOConfig;
      expect(validWaveforms).toContain(lfo.waveform);
    });

    it.each(presetsWithLFO)('%s lfo rate should be 0.1 to 20 Hz', (_name, params) => {
      const lfo = params.lfo as LFOConfig;
      expect(lfo.rate).toBeGreaterThanOrEqual(0.1);
      expect(lfo.rate).toBeLessThanOrEqual(20);
    });

    it.each(presetsWithLFO)('%s lfo depth should be 0 to 1', (_name, params) => {
      const lfo = params.lfo as LFOConfig;
      expect(lfo.depth).toBeGreaterThanOrEqual(0);
      expect(lfo.depth).toBeLessThanOrEqual(1);
    });

    it.each(presetsWithLFO)('%s lfo should have valid destination', (_name, params) => {
      const lfo = params.lfo as LFOConfig;
      expect(validDestinations).toContain(lfo.destination);
    });
  });

  it('wobble should have filter LFO at ~2 Hz', () => {
    const wobble = SYNTH_PRESETS.wobble;
    expect(wobble.lfo).toBeDefined();
    expect(wobble.lfo?.destination).toBe('filter');
    expect(wobble.lfo?.rate).toBe(2);
    expect(wobble.lfo?.depth).toBeGreaterThan(0.5); // Strong modulation
  });

  it('vibes should have amplitude LFO (tremolo)', () => {
    const vibes = SYNTH_PRESETS.vibes;
    expect(vibes.lfo).toBeDefined();
    expect(vibes.lfo?.destination).toBe('amplitude');
    expect(vibes.lfo?.rate).toBe(5); // Classic vibraphone speed
  });

  it('organphase should have pitch LFO (vibrato)', () => {
    const organphase = SYNTH_PRESETS.organphase;
    expect(organphase.lfo).toBeDefined();
    expect(organphase.lfo?.destination).toBe('pitch');
    expect(organphase.lfo?.depth).toBeLessThan(0.3); // Subtle modulation
  });

  it('evolving should have very slow LFO for organic movement', () => {
    const evolving = SYNTH_PRESETS.evolving;
    expect(evolving.lfo).toBeDefined();
    expect(evolving.lfo?.rate).toBeLessThan(0.5); // Very slow
  });
});

describe('Phase 21A: getPresetCategories()', () => {
  const categories = getPresetCategories();

  it('should return an object with category keys', () => {
    expect(typeof categories).toBe('object');
    expect(Object.keys(categories).length).toBeGreaterThan(0);
  });

  it('should have expected category names', () => {
    const expectedCategories = [
      'Core',
      'Funk / Soul',
      'Keys',
      'Disco',
      'House / Techno',
      'Atmospheric',
      'Electronic',
      'Bass',
    ];

    for (const category of expectedCategories) {
      expect(categories).toHaveProperty(category);
    }
  });

  it('each category should contain valid preset names', () => {
    const presetNames = Object.keys(SYNTH_PRESETS);

    for (const [category, presets] of Object.entries(categories)) {
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThan(0);

      for (const preset of presets) {
        expect(
          presetNames,
          `Preset "${preset}" in category "${category}" not found in SYNTH_PRESETS`
        ).toContain(preset);
      }
    }
  });

  it('Keys category should include piano', () => {
    expect(categories['Keys']).toContain('piano');
  });

  it('Electronic category should include supersaw and wobble', () => {
    expect(categories['Electronic']).toContain('supersaw');
    expect(categories['Electronic']).toContain('wobble');
  });

  it('all presets should appear in exactly one category', () => {
    const allCategorizedPresets = Object.values(categories).flat();
    const uniquePresets = new Set(allCategorizedPresets);

    // No duplicates
    expect(allCategorizedPresets.length).toBe(uniquePresets.size);

    // All SYNTH_PRESETS should be categorized
    for (const presetName of Object.keys(SYNTH_PRESETS)) {
      expect(uniquePresets.has(presetName)).toBe(true);
    }
  });
});

describe('Phase 21A: Piano preset (synthesized fallback)', () => {
  it('should exist as a synth preset', () => {
    expect(SYNTH_PRESETS).toHaveProperty('piano');
  });

  it('should have piano-like characteristics', () => {
    const piano = SYNTH_PRESETS.piano;

    // Fast attack (hammer strike)
    expect(piano.attack).toBeLessThan(0.01);

    // Medium-long decay (strings ringing)
    expect(piano.decay).toBeGreaterThan(0.5);

    // Has dual oscillator for richness
    expect(piano.osc2).toBeDefined();

    // Has filter envelope for bright attack
    expect(piano.filterEnv).toBeDefined();
    expect(piano.filterEnv?.amount).toBeGreaterThan(0);
  });
});
