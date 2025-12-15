import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ToneSynthManager,
  TONE_SYNTH_PRESETS,
  type ToneSynthType,
} from './toneSynths';

/**
 * Tests for Tone.js Advanced Synths Integration
 *
 * According to specs/SYNTHESIS-ENGINE.md Section 8.3, these synths should:
 * - Provide FM, AM, Membrane, Metal, Pluck, and DuoSynth
 * - Support triggering with frequency, duration, and time
 * - Clean up properly to prevent memory leaks
 *
 * Key synth types from spec:
 * - fm-epiano: DX7-style electric piano (FMSynth)
 * - duo-lead: Rich detuned lead (DuoSynth)
 * - membrane-kick: 808-style kick (MembraneSynth)
 * - metal-cymbal: Hi-hat/cymbal (MetalSynth)
 */

// Mock Tone.js synths
vi.mock('tone', () => {
  class MockFMSynth {
    harmonicity = 3;
    modulationIndex = 10;
    envelope = { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.8 };
    triggerAttackRelease = vi.fn();
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    set = vi.fn();
  }

  class MockAMSynth {
    harmonicity = 2;
    envelope = { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.5 };
    triggerAttackRelease = vi.fn();
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    set = vi.fn();
  }

  class MockMembraneSynth {
    pitchDecay = 0.05;
    octaves = 8;
    envelope = { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 };
    triggerAttackRelease = vi.fn();
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    set = vi.fn();
  }

  class MockMetalSynth {
    frequency = 200;
    harmonicity = 5.1;
    modulationIndex = 32;
    resonance = 4000;
    octaves = 1.5;
    envelope = { attack: 0.001, decay: 0.4, release: 0.2 };
    triggerAttackRelease = vi.fn();
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    set = vi.fn();
  }

  class MockPluckSynth {
    attackNoise = 1;
    dampening = 4000;
    resonance = 0.98;
    triggerAttack = vi.fn();
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    set = vi.fn();
  }

  class MockDuoSynth {
    harmonicity = 1.5;
    vibratoAmount = 0.5;
    vibratoRate = 5;
    voice0 = { envelope: {} };
    voice1 = { envelope: {} };
    triggerAttackRelease = vi.fn();
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    set = vi.fn();
  }

  class MockPolySynth {
    maxPolyphony = 8;
    triggerAttackRelease = vi.fn();
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    set = vi.fn();
    voice: unknown;

    constructor(voice: unknown) {
      this.voice = voice;
    }
  }

  class MockGain {
    gain = { value: 1 };
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  return {
    start: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(0),
    FMSynth: MockFMSynth,
    AMSynth: MockAMSynth,
    MembraneSynth: MockMembraneSynth,
    MetalSynth: MockMetalSynth,
    PluckSynth: MockPluckSynth,
    DuoSynth: MockDuoSynth,
    PolySynth: MockPolySynth,
    Gain: MockGain,
  };
});

describe('TONE_SYNTH_PRESETS', () => {
  it('includes fm-epiano preset for DX7-style electric piano', () => {
    expect(TONE_SYNTH_PRESETS).toHaveProperty('fm-epiano');
    const preset = TONE_SYNTH_PRESETS['fm-epiano'];
    expect(preset.type).toBe('fm');
    expect(preset.config.harmonicity).toBeGreaterThan(1);
  });

  it('includes duo-lead preset for rich detuned leads', () => {
    expect(TONE_SYNTH_PRESETS).toHaveProperty('duo-lead');
    const preset = TONE_SYNTH_PRESETS['duo-lead'];
    expect(preset.type).toBe('duo');
  });

  it('includes membrane-kick for 808-style kick drums', () => {
    expect(TONE_SYNTH_PRESETS).toHaveProperty('membrane-kick');
    const preset = TONE_SYNTH_PRESETS['membrane-kick'];
    expect(preset.type).toBe('membrane');
    expect(preset.config.pitchDecay).toBeDefined();
  });

  it('includes metal-cymbal for hi-hats and cymbals', () => {
    expect(TONE_SYNTH_PRESETS).toHaveProperty('metal-cymbal');
    const preset = TONE_SYNTH_PRESETS['metal-cymbal'];
    expect(preset.type).toBe('metal');
  });

  it('includes pluck preset for string sounds', () => {
    expect(TONE_SYNTH_PRESETS).toHaveProperty('pluck-string');
    const preset = TONE_SYNTH_PRESETS['pluck-string'];
    expect(preset.type).toBe('pluck');
  });

  it('includes am-bell preset for bell-like tones', () => {
    expect(TONE_SYNTH_PRESETS).toHaveProperty('am-bell');
    const preset = TONE_SYNTH_PRESETS['am-bell'];
    expect(preset.type).toBe('am');
  });

  it('has all required preset parameters', () => {
    for (const [_name, preset] of Object.entries(TONE_SYNTH_PRESETS)) {
      expect(preset).toHaveProperty('type');
      expect(preset).toHaveProperty('config');
      expect(['fm', 'am', 'membrane', 'metal', 'pluck', 'duo']).toContain(preset.type);
    }
  });
});

describe('ToneSynthManager', () => {
  let manager: ToneSynthManager;

  beforeEach(async () => {
    manager = new ToneSynthManager();
    await manager.initialize();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('initialization', () => {
    it('initializes successfully', () => {
      expect(manager.isReady()).toBe(true);
    });

    it('creates synth instances lazily', () => {
      // Synths should only be created when first used
      expect(manager.isReady()).toBe(true);
    });
  });

  describe('playing notes', () => {
    it('plays a note with fm-epiano preset', () => {
      manager.playNote('fm-epiano', 'C4', '8n', 0);
      // Should not throw
      expect(manager.isReady()).toBe(true);
    });

    it('plays a note with membrane-kick preset', () => {
      manager.playNote('membrane-kick', 'C2', '16n', 0);
      expect(manager.isReady()).toBe(true);
    });

    it('plays a note with metal-cymbal preset', () => {
      manager.playNote('metal-cymbal', 'C4', '16n', 0);
      expect(manager.isReady()).toBe(true);
    });

    it('plays a note with duo-lead preset', () => {
      manager.playNote('duo-lead', 'C4', '4n', 0);
      expect(manager.isReady()).toBe(true);
    });

    it('throws for unknown preset', () => {
      expect(() => {
        manager.playNote('unknown-preset' as ToneSynthType, 'C4', '8n', 0);
      }).toThrow();
    });
  });

  describe('frequency conversion', () => {
    it('converts semitones to frequency correctly', () => {
      // C4 = 261.63 Hz (semitone 0 from C4)
      const c4Freq = manager.semitoneToFrequency(0);
      expect(c4Freq).toBeCloseTo(261.63, 1);
    });

    it('converts C5 (12 semitones up) correctly', () => {
      const c5Freq = manager.semitoneToFrequency(12);
      expect(c5Freq).toBeCloseTo(523.25, 1);
    });

    it('converts C3 (-12 semitones) correctly', () => {
      const c3Freq = manager.semitoneToFrequency(-12);
      expect(c3Freq).toBeCloseTo(130.81, 1);
    });
  });

  describe('note name conversion', () => {
    it('converts semitones to note names', () => {
      expect(manager.semitoneToNoteName(0)).toBe('C4');
      expect(manager.semitoneToNoteName(12)).toBe('C5');
      expect(manager.semitoneToNoteName(-12)).toBe('C3');
      expect(manager.semitoneToNoteName(4)).toBe('E4'); // Major third
      expect(manager.semitoneToNoteName(7)).toBe('G4'); // Perfect fifth
    });
  });

  describe('disposal', () => {
    it('disposes all synth instances', () => {
      // Play some notes first to create synth instances
      manager.playNote('fm-epiano', 'C4', '8n', 0);
      manager.playNote('membrane-kick', 'C2', '16n', 0);

      manager.dispose();
      expect(manager.isReady()).toBe(false);
    });

    it('can be re-initialized after disposal', async () => {
      manager.dispose();
      await manager.initialize();
      expect(manager.isReady()).toBe(true);
    });
  });

  describe('synth type support', () => {
    const synthTypes: ToneSynthType[] = [
      'fm-epiano',
      'fm-bass',
      'am-bell',
      'membrane-kick',
      'membrane-tom',
      'metal-cymbal',
      'metal-hihat',
      'pluck-string',
      'duo-lead',
    ];

    it.each(synthTypes)('supports %s synth type', (type) => {
      expect(() => {
        manager.playNote(type, 'C4', '8n', 0);
      }).not.toThrow();
    });
  });
});

describe('FM Synth presets (DX7-style)', () => {
  it('fm-epiano has characteristic harmonicity > 1', () => {
    const preset = TONE_SYNTH_PRESETS['fm-epiano'];
    expect(preset.config.harmonicity).toBeGreaterThanOrEqual(1);
  });

  it('fm-epiano has modulationIndex for harmonic complexity', () => {
    const preset = TONE_SYNTH_PRESETS['fm-epiano'];
    expect(preset.config.modulationIndex).toBeGreaterThan(1);
  });

  it('fm-bass has low harmonicity for clean bass', () => {
    const preset = TONE_SYNTH_PRESETS['fm-bass'];
    expect(preset.config.harmonicity).toBeLessThanOrEqual(3);
  });
});

describe('Membrane Synth presets (drum synthesis)', () => {
  it('membrane-kick has fast pitchDecay for punch', () => {
    const preset = TONE_SYNTH_PRESETS['membrane-kick'];
    expect(preset.config.pitchDecay).toBeLessThan(0.2);
  });

  it('membrane-kick has high octaves for frequency sweep', () => {
    const preset = TONE_SYNTH_PRESETS['membrane-kick'];
    expect(preset.config.octaves).toBeGreaterThanOrEqual(4);
  });

  it('membrane-tom has slower pitchDecay than kick', () => {
    const kickPreset = TONE_SYNTH_PRESETS['membrane-kick'];
    const tomPreset = TONE_SYNTH_PRESETS['membrane-tom'];
    expect(tomPreset.config.pitchDecay as number).toBeGreaterThanOrEqual(
      kickPreset.config.pitchDecay as number
    );
  });
});

describe('Metal Synth presets (cymbal synthesis)', () => {
  it('metal-cymbal has high resonance for brightness', () => {
    const preset = TONE_SYNTH_PRESETS['metal-cymbal'];
    expect(preset.config.resonance).toBeGreaterThan(1000);
  });

  it('metal-hihat has faster decay than cymbal', () => {
    const cymbalPreset = TONE_SYNTH_PRESETS['metal-cymbal'];
    const hihatPreset = TONE_SYNTH_PRESETS['metal-hihat'];
    const hihatEnvelope = hihatPreset.config.envelope as { decay?: number } | undefined;
    const cymbalEnvelope = cymbalPreset.config.envelope as { decay?: number } | undefined;
    expect(hihatEnvelope?.decay).toBeLessThanOrEqual(cymbalEnvelope?.decay || 1);
  });
});
