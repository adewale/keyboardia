/**
 * Tests for Advanced Synthesis Engine
 *
 * Tests dual oscillator, filter envelope, and LFO functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AdvancedSynthVoice,
  AdvancedSynthEngine,
  ADVANCED_SYNTH_PRESETS,
  getAdvancedSynthEngine,
  isAdvancedSynth,
  getAdvancedSynthPresetId,
} from './advancedSynth';

// Mock Tone.js
vi.mock('tone', () => {
  class MockOscillator {
    type = 'sawtooth';
    frequency = { value: 440 };
    detune = { value: 0 };
    start = vi.fn();
    stop = vi.fn();
    connect = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockNoise {
    start = vi.fn();
    stop = vi.fn();
    connect = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockGain {
    gain = { value: 1 };
    connect = vi.fn().mockReturnThis();
    dispose = vi.fn();
    constructor(value?: number) {
      if (value !== undefined) {
        this.gain.value = value;
      }
    }
  }

  class MockFilter {
    type = 'lowpass';
    frequency = { value: 2000 };
    Q = { value: 1 };
    connect = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockAmplitudeEnvelope {
    attack = 0.01;
    decay = 0.2;
    sustain = 0.5;
    release = 0.5;
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    triggerAttackRelease = vi.fn();
    connect = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockEnvelope {
    attack = 0.01;
    decay = 0.2;
    sustain = 0.4;
    release = 0.5;
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    triggerAttackRelease = vi.fn();
    connect = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockMultiply {
    value = 1;
    connect = vi.fn().mockReturnThis();
    dispose = vi.fn();
    constructor(value?: number) {
      if (value !== undefined) {
        this.value = value;
      }
    }
  }

  class MockLFO {
    frequency = { value: 5 };
    type = 'sine';
    min = -1;
    max = 1;
    start = vi.fn();
    stop = vi.fn();
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn();
    dispose = vi.fn();
  }

  return {
    Oscillator: MockOscillator,
    Noise: MockNoise,
    Gain: MockGain,
    Filter: MockFilter,
    AmplitudeEnvelope: MockAmplitudeEnvelope,
    Envelope: MockEnvelope,
    Multiply: MockMultiply,
    LFO: MockLFO,
    Frequency: vi.fn().mockReturnValue({
      toFrequency: () => 440,
    }),
    now: vi.fn().mockReturnValue(0),
  };
});

describe('AdvancedSynthVoice', () => {
  let voice: AdvancedSynthVoice;

  beforeEach(() => {
    voice = new AdvancedSynthVoice();
    voice.initialize();
  });

  afterEach(() => {
    voice.dispose();
  });

  describe('initialization', () => {
    it('creates voice with output node', () => {
      expect(voice.getOutput()).not.toBeNull();
    });

    it('starts inactive', () => {
      expect(voice.isActive()).toBe(false);
    });
  });

  describe('preset application', () => {
    it('applies preset settings', () => {
      const preset = ADVANCED_SYNTH_PRESETS['supersaw'];
      voice.applyPreset(preset);
      // Preset is stored and applied
      expect(voice.isActive()).toBe(false);
    });

    it('handles all preset types', () => {
      for (const presetId of Object.keys(ADVANCED_SYNTH_PRESETS)) {
        const preset = ADVANCED_SYNTH_PRESETS[presetId];
        expect(() => voice.applyPreset(preset)).not.toThrow();
      }
    });
  });

  describe('note triggering', () => {
    it('triggers attack and becomes active', () => {
      voice.applyPreset(ADVANCED_SYNTH_PRESETS['supersaw']);
      voice.triggerAttack(440);
      expect(voice.isActive()).toBe(true);
    });

    it('triggers attack and release', () => {
      voice.applyPreset(ADVANCED_SYNTH_PRESETS['supersaw']);
      voice.triggerAttackRelease(440, 0.5);
      expect(voice.isActive()).toBe(true);
    });

    it('triggers release', () => {
      voice.applyPreset(ADVANCED_SYNTH_PRESETS['supersaw']);
      voice.triggerAttack(440);
      voice.triggerRelease();
      // Voice is still technically active until envelope completes
      expect(voice.isActive()).toBe(true);
    });
  });

  describe('disposal', () => {
    it('disposes all resources', () => {
      voice.applyPreset(ADVANCED_SYNTH_PRESETS['supersaw']);
      voice.triggerAttack(440);
      voice.dispose();
      expect(voice.getOutput()).toBeNull();
      expect(voice.isActive()).toBe(false);
    });
  });
});

describe('AdvancedSynthEngine', () => {
  let engine: AdvancedSynthEngine;

  beforeEach(async () => {
    engine = new AdvancedSynthEngine();
    await engine.initialize();
  });

  afterEach(() => {
    engine.dispose();
  });

  describe('initialization', () => {
    it('initializes with output node', () => {
      expect(engine.getOutput()).not.toBeNull();
    });

    it('reports ready after initialization', () => {
      expect(engine.isReady()).toBe(true);
    });

    it('applies default preset on initialization', () => {
      expect(engine.getCurrentPreset()).not.toBeNull();
    });
  });

  describe('preset management', () => {
    it('sets preset by name', () => {
      engine.setPreset('wobble-bass');
      expect(engine.getCurrentPreset()?.name).toBe('Wobble Bass');
    });

    it('returns available preset names', () => {
      const names = engine.getPresetNames();
      expect(names).toContain('supersaw');
      expect(names).toContain('wobble-bass');
      expect(names).toContain('acid-bass');
    });

    it('warns for unknown preset', () => {
      const originalPreset = engine.getCurrentPreset();
      engine.setPreset('unknown-preset');
      // Should not change preset
      expect(engine.getCurrentPreset()).toBe(originalPreset);
    });
  });

  describe('note playback', () => {
    it('plays note by semitone', () => {
      expect(() => engine.playNoteSemitone(0, 0.5)).not.toThrow();
    });

    it('plays note by frequency', () => {
      expect(() => engine.playNoteFrequency(440, 0.5)).not.toThrow();
    });

    it('plays note by name', () => {
      expect(() => engine.playNote('C4', 0.5)).not.toThrow();
    });

    it('plays with scheduled time', () => {
      expect(() => engine.playNoteSemitone(0, 0.5, 0.1)).not.toThrow();
    });
  });

  describe('frequency conversion', () => {
    it('converts semitone 0 to C4 frequency (~261.6 Hz)', () => {
      const freq = engine.semitoneToFrequency(0);
      expect(freq).toBeCloseTo(261.625565, 2);
    });

    it('converts semitone 12 to C5 frequency (~523.3 Hz)', () => {
      const freq = engine.semitoneToFrequency(12);
      expect(freq).toBeCloseTo(523.25, 1);
    });

    it('converts semitone -12 to C3 frequency (~130.8 Hz)', () => {
      const freq = engine.semitoneToFrequency(-12);
      expect(freq).toBeCloseTo(130.81, 1);
    });
  });

  describe('disposal', () => {
    it('disposes all resources', () => {
      engine.dispose();
      expect(engine.getOutput()).toBeNull();
      expect(engine.isReady()).toBe(false);
      expect(engine.getCurrentPreset()).toBeNull();
    });
  });
});

describe('ADVANCED_SYNTH_PRESETS', () => {
  it('has all expected presets', () => {
    const expectedPresets = [
      'supersaw',
      'sub-bass',
      'wobble-bass',
      'warm-pad',
      'vibrato-lead',
      'tremolo-strings',
      'acid-bass',
      'thick-lead',
    ];
    for (const preset of expectedPresets) {
      expect(ADVANCED_SYNTH_PRESETS[preset]).toBeDefined();
    }
  });

  it('all presets have valid oscillator configs', () => {
    for (const [_name, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
      expect(preset.oscillator1.waveform).toMatch(/^(sine|sawtooth|square|triangle)$/);
      expect(preset.oscillator1.level).toBeGreaterThanOrEqual(0);
      expect(preset.oscillator1.level).toBeLessThanOrEqual(1);
      expect(preset.oscillator2.waveform).toMatch(/^(sine|sawtooth|square|triangle)$/);
      expect(preset.oscillator2.level).toBeGreaterThanOrEqual(0);
      expect(preset.oscillator2.level).toBeLessThanOrEqual(1);
    }
  });

  it('all presets have valid filter configs', () => {
    for (const [_name, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
      expect(preset.filter.frequency).toBeGreaterThanOrEqual(20);
      expect(preset.filter.frequency).toBeLessThanOrEqual(20000);
      expect(preset.filter.resonance).toBeGreaterThanOrEqual(0);
      expect(preset.filter.type).toMatch(/^(lowpass|highpass|bandpass)$/);
    }
  });

  it('all presets have valid LFO configs', () => {
    for (const [_name, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
      expect(preset.lfo.frequency).toBeGreaterThanOrEqual(0);
      expect(preset.lfo.frequency).toBeLessThanOrEqual(20);
      expect(preset.lfo.amount).toBeGreaterThanOrEqual(0);
      expect(preset.lfo.amount).toBeLessThanOrEqual(1);
      expect(preset.lfo.destination).toMatch(/^(filter|pitch|amplitude)$/);
    }
  });

  it('all presets have valid envelope values', () => {
    for (const [_name, preset] of Object.entries(ADVANCED_SYNTH_PRESETS)) {
      // Amplitude envelope
      expect(preset.amplitudeEnvelope.attack).toBeGreaterThan(0);
      expect(preset.amplitudeEnvelope.decay).toBeGreaterThan(0);
      expect(preset.amplitudeEnvelope.sustain).toBeGreaterThanOrEqual(0);
      expect(preset.amplitudeEnvelope.sustain).toBeLessThanOrEqual(1);
      expect(preset.amplitudeEnvelope.release).toBeGreaterThan(0);

      // Filter envelope
      expect(preset.filterEnvelope.attack).toBeGreaterThan(0);
      expect(preset.filterEnvelope.decay).toBeGreaterThan(0);
      expect(preset.filterEnvelope.sustain).toBeGreaterThanOrEqual(0);
      expect(preset.filterEnvelope.sustain).toBeLessThanOrEqual(1);
      expect(preset.filterEnvelope.release).toBeGreaterThan(0);
    }
  });
});

describe('helper functions', () => {
  describe('isAdvancedSynth', () => {
    it('returns true for advanced synth sample IDs', () => {
      expect(isAdvancedSynth('advanced:supersaw')).toBe(true);
      expect(isAdvancedSynth('advanced:wobble-bass')).toBe(true);
    });

    it('returns false for other sample IDs', () => {
      expect(isAdvancedSynth('kick')).toBe(false);
      expect(isAdvancedSynth('synth:bass')).toBe(false);
      expect(isAdvancedSynth('tone:fm-epiano')).toBe(false);
    });
  });

  describe('getAdvancedSynthPresetId', () => {
    it('extracts preset ID from sample ID', () => {
      expect(getAdvancedSynthPresetId('advanced:supersaw')).toBe('supersaw');
      expect(getAdvancedSynthPresetId('advanced:acid-bass')).toBe('acid-bass');
    });

    it('returns null for non-advanced synth IDs', () => {
      expect(getAdvancedSynthPresetId('kick')).toBeNull();
      expect(getAdvancedSynthPresetId('synth:bass')).toBeNull();
    });

    it('returns null for unknown presets', () => {
      expect(getAdvancedSynthPresetId('advanced:unknown')).toBeNull();
    });
  });

  describe('getAdvancedSynthEngine', () => {
    it('returns singleton instance', () => {
      const engine1 = getAdvancedSynthEngine();
      const engine2 = getAdvancedSynthEngine();
      expect(engine1).toBe(engine2);
    });
  });
});

describe('LFO destinations', () => {
  let engine: AdvancedSynthEngine;

  beforeEach(async () => {
    engine = new AdvancedSynthEngine();
    await engine.initialize();
  });

  afterEach(() => {
    engine.dispose();
  });

  it('wobble-bass uses filter LFO', () => {
    engine.setPreset('wobble-bass');
    const preset = engine.getCurrentPreset();
    expect(preset?.lfo.destination).toBe('filter');
    expect(preset?.lfo.amount).toBeGreaterThan(0);
  });

  it('vibrato-lead uses pitch LFO', () => {
    engine.setPreset('vibrato-lead');
    const preset = engine.getCurrentPreset();
    expect(preset?.lfo.destination).toBe('pitch');
    expect(preset?.lfo.amount).toBeGreaterThan(0);
  });

  it('tremolo-strings uses amplitude LFO', () => {
    engine.setPreset('tremolo-strings');
    const preset = engine.getCurrentPreset();
    expect(preset?.lfo.destination).toBe('amplitude');
    expect(preset?.lfo.amount).toBeGreaterThan(0);
  });
});

describe('dual oscillator features', () => {
  it('supersaw has detuned oscillators', () => {
    const preset = ADVANCED_SYNTH_PRESETS['supersaw'];
    expect(preset.oscillator1.detune).toBeLessThan(0);
    expect(preset.oscillator2.detune).toBeGreaterThan(0);
  });

  it('sub-bass has octave-layered oscillators', () => {
    const preset = ADVANCED_SYNTH_PRESETS['sub-bass'];
    expect(preset.oscillator2.coarseDetune).toBe(-12); // One octave down
  });

  it('thick-lead has wide detuning', () => {
    const preset = ADVANCED_SYNTH_PRESETS['thick-lead'];
    const detuneRange = Math.abs(preset.oscillator1.detune - preset.oscillator2.detune);
    expect(detuneRange).toBeGreaterThanOrEqual(50); // Wide detuning
  });
});

describe('filter envelope', () => {
  it('acid-bass has high filter envelope amount', () => {
    const preset = ADVANCED_SYNTH_PRESETS['acid-bass'];
    expect(preset.filter.envelopeAmount).toBeGreaterThan(0.8);
  });

  it('acid-bass has high resonance', () => {
    const preset = ADVANCED_SYNTH_PRESETS['acid-bass'];
    expect(preset.filter.resonance).toBeGreaterThan(10);
  });

  it('warm-pad has slow filter envelope', () => {
    const preset = ADVANCED_SYNTH_PRESETS['warm-pad'];
    expect(preset.filterEnvelope.attack).toBeGreaterThan(0.5);
  });
});

describe('voice release tracking', () => {
  let voice: AdvancedSynthVoice;

  beforeEach(() => {
    vi.useFakeTimers();
    voice = new AdvancedSynthVoice();
    voice.initialize();
  });

  afterEach(() => {
    voice.dispose();
    vi.useRealTimers();
  });

  it('voice becomes inactive after note duration + release', () => {
    const preset = ADVANCED_SYNTH_PRESETS['supersaw'];
    voice.applyPreset(preset);

    // Trigger note with 0.5s duration
    voice.triggerAttackRelease(440, 0.5);

    // Voice should be active immediately
    expect(voice.isActive()).toBe(true);

    // Advance time past duration + release + buffer
    // duration=0.5s, release=0.5s, buffer=50ms = ~1050ms
    vi.advanceTimersByTime(1100);

    // Voice should now be inactive
    expect(voice.isActive()).toBe(false);
  });

  it('triggerAttack does not schedule release timeout', () => {
    const preset = ADVANCED_SYNTH_PRESETS['supersaw'];
    voice.applyPreset(preset);

    // Trigger attack only (no duration)
    voice.triggerAttack(440);

    // Voice should be active
    expect(voice.isActive()).toBe(true);

    // Advance time
    vi.advanceTimersByTime(5000);

    // Voice should still be active (no automatic release)
    expect(voice.isActive()).toBe(true);
  });

  it('tracks note start time for voice stealing priority', () => {
    const preset = ADVANCED_SYNTH_PRESETS['supersaw'];
    voice.applyPreset(preset);

    const timeBefore = Date.now();
    voice.triggerAttack(440);
    const timeAfter = Date.now();

    expect(voice.getNoteStartTime()).toBeGreaterThanOrEqual(timeBefore);
    expect(voice.getNoteStartTime()).toBeLessThanOrEqual(timeAfter);
  });

  it('dispose clears pending release timeout', () => {
    const preset = ADVANCED_SYNTH_PRESETS['supersaw'];
    voice.applyPreset(preset);

    voice.triggerAttackRelease(440, 0.5);
    expect(voice.isActive()).toBe(true);

    // Dispose should clear the release timeout
    voice.dispose();

    // Should not throw when timers advance
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(voice.isActive()).toBe(false);
  });
});

describe('voice stealing', () => {
  let engine: AdvancedSynthEngine;

  beforeEach(async () => {
    vi.useFakeTimers();
    engine = new AdvancedSynthEngine();
    await engine.initialize();
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  it('steals oldest voice when all voices are active', () => {
    // Play 8 notes (max voices) with delays between them
    for (let i = 0; i < 8; i++) {
      engine.playNoteSemitone(i, 10); // Long duration to keep active
      vi.advanceTimersByTime(100); // 100ms between notes
    }

    // All voices should be active
    // Play a 9th note - should steal the oldest (first) voice
    expect(() => engine.playNoteSemitone(10, 10)).not.toThrow();
  });
});
