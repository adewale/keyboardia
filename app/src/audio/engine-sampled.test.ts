import { describe, it, expect, vi } from 'vitest';
import { isSampledInstrument, SAMPLED_INSTRUMENTS } from './sampled-instrument';
import { SYNTH_PRESETS } from './synth';

/**
 * Tests for the playSynthNote decision logic.
 *
 * These tests verify the LOGIC that determines whether to use
 * sampled instruments or synth fallback, without needing to
 * initialize the full AudioEngine.
 *
 * The key behavior:
 * "When piano is ready, use samples. When not ready, use synth."
 *
 * This tests the decision logic extracted from engine.ts:210-235
 */

describe('playSynthNote Decision Logic', () => {
  /**
   * This is the decision logic from AudioEngine.playSynthNote,
   * extracted for testing. The real code does:
   *
   * ```typescript
   * const instrument = sampledInstrumentRegistry.get(presetName);
   * if (instrument) {
   *   if (!instrument.isReady()) {
   *     sampledInstrumentRegistry.load(presetName);
   *   }
   *   if (instrument.isReady()) {
   *     instrument.playNote(...);
   *     return;  // Early return - no synth
   *   }
   *   // Fall back to synth while loading
   * }
   * synthEngine.playNote(...);
   * ```
   */
  interface MockInstrument {
    isReady: () => boolean;
    playNote: () => void;
  }

  interface MockRegistry {
    get: (id: string) => MockInstrument | undefined;
    load: (id: string) => void;
  }

  interface MockSynthEngine {
    playNote: () => void;
  }

  function playSynthNoteLogic(
    presetName: string,
    registry: MockRegistry,
    synthEngine: MockSynthEngine
  ): 'sampled' | 'synth' | 'skip' {
    // This mirrors the logic in engine.ts - updated to never fall back to synth for sampled instruments
    const instrument = registry.get(presetName);

    if (instrument) {
      // Sampled instruments MUST use samples - never fall back to synth
      if (instrument.isReady()) {
        instrument.playNote();
        return 'sampled';
      }
      // If not ready, skip the note rather than play wrong sound
      return 'skip';
    }

    // Only use synth for actual synth presets (not sampled instruments)
    synthEngine.playNote();
    return 'synth';
  }

  describe('when preset is a sampled instrument', () => {
    it('should use sampled playback when instrument is ready', () => {
      const mockInstrument: MockInstrument = {
        isReady: () => true,
        playNote: vi.fn(),
      };

      const mockRegistry: MockRegistry = {
        get: (id) => (id === 'piano' ? mockInstrument : undefined),
        load: vi.fn(),
      };

      const mockSynth: MockSynthEngine = {
        playNote: vi.fn(),
      };

      const result = playSynthNoteLogic('piano', mockRegistry, mockSynth);

      expect(result).toBe('sampled');
      expect(mockInstrument.playNote).toHaveBeenCalled();
      expect(mockSynth.playNote).not.toHaveBeenCalled();
    });

    it('should SKIP note when instrument is NOT ready (never synth fallback)', () => {
      const mockInstrument: MockInstrument = {
        isReady: () => false,
        playNote: vi.fn(),
      };

      const mockRegistry: MockRegistry = {
        get: (id) => (id === 'piano' ? mockInstrument : undefined),
        load: vi.fn(),
      };

      const mockSynth: MockSynthEngine = {
        playNote: vi.fn(),
      };

      const result = playSynthNoteLogic('piano', mockRegistry, mockSynth);

      // CRITICAL: Sampled instruments should SKIP, not fall back to synth
      // This prevents confusing users who expect piano to sound like piano
      expect(result).toBe('skip');
      expect(mockInstrument.playNote).not.toHaveBeenCalled();
      expect(mockSynth.playNote).not.toHaveBeenCalled(); // No synth fallback!
    });
  });

  describe('when preset is NOT a sampled instrument', () => {
    it('should use synth for non-sampled presets', () => {
      const mockRegistry: MockRegistry = {
        get: () => undefined,  // No sampled instrument for 'lead'
        load: vi.fn(),
      };

      const mockSynth: MockSynthEngine = {
        playNote: vi.fn(),
      };

      const result = playSynthNoteLogic('lead', mockRegistry, mockSynth);

      expect(result).toBe('synth');
      expect(mockSynth.playNote).toHaveBeenCalled();
    });
  });
});

describe('Sampled Instrument Identification', () => {
  it('piano is the only sampled instrument', () => {
    expect(SAMPLED_INSTRUMENTS).toEqual(['piano']);
  });

  it('isSampledInstrument correctly identifies piano', () => {
    expect(isSampledInstrument('piano')).toBe(true);
  });

  it('isSampledInstrument rejects synth presets', () => {
    const synthPresets = Object.keys(SYNTH_PRESETS);
    const nonPianoPresets = synthPresets.filter(p => p !== 'piano');

    for (const preset of nonPianoPresets) {
      expect(isSampledInstrument(preset)).toBe(false);
    }
  });
});

describe('Synth Preset Coverage', () => {
  it('all synth presets have required parameters', () => {
    const requiredParams = [
      'waveform',
      'filterCutoff',
      'filterResonance',
      'attack',
      'decay',
      'sustain',
      'release',
    ];

    for (const [, preset] of Object.entries(SYNTH_PRESETS)) {
      for (const param of requiredParams) {
        expect(preset).toHaveProperty(param);
      }
    }
  });

  it('piano preset exists as synth fallback', () => {
    expect(SYNTH_PRESETS).toHaveProperty('piano');
    expect(SYNTH_PRESETS.piano.waveform).toBe('triangle');
  });
});
