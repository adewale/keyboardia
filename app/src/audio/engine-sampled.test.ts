import { describe, it, expect, vi } from 'vitest';
import { isSampledInstrument, SAMPLED_INSTRUMENTS } from './sampled-instrument';
import { SYNTH_PRESETS } from './synth';

/**
 * Tests for the playSynthNote decision logic.
 *
 * These tests verify the LOGIC that determines whether to use
 * sampled instruments or synth engine, without needing to
 * initialize the full AudioEngine.
 *
 * The key behavior:
 * "When piano is ready, use samples. When not ready, SKIP (never synth fallback)."
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
   *   // SKIP the note - don't fall back to synth for sampled instruments
   *   return;
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
  it('should have all 13 Phase 29A sampled instruments', () => {
    expect(SAMPLED_INSTRUMENTS).toEqual([
      'piano',
      '808-kick',
      '808-snare',
      '808-hihat-closed',
      '808-hihat-open',
      '808-clap',
      'acoustic-kick',
      'acoustic-snare',
      'acoustic-hihat-closed',
      'acoustic-hihat-open',
      'acoustic-ride',
      'finger-bass',
      'vinyl-crackle',
    ]);
  });

  it('isSampledInstrument correctly identifies sampled instruments', () => {
    for (const instrument of SAMPLED_INSTRUMENTS) {
      expect(isSampledInstrument(instrument)).toBe(true);
    }
  });

  it('isSampledInstrument rejects synth presets', () => {
    const synthPresets = Object.keys(SYNTH_PRESETS);

    for (const preset of synthPresets) {
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

  it('piano should NOT be a synth preset (it is a sampled instrument)', () => {
    // Piano is a SAMPLED instrument - it should never fall back to synth
    // If someone expects piano and gets a triangle wave, that's a bug
    expect(SYNTH_PRESETS).not.toHaveProperty('piano');
  });
});

/**
 * Tests for preloadInstrumentsForTracks logic.
 *
 * Phase 23 fix: The preload function must correctly identify both
 * synth:piano and sampled:piano formats to prevent the race condition
 * where piano samples aren't loaded before playback starts.
 */
describe('preloadInstrumentsForTracks Logic', () => {
  /**
   * Extract the logic from engine.ts preloadInstrumentsForTracks
   * for unit testing without needing full AudioEngine initialization.
   */
  function extractInstrumentsToLoad(tracks: { sampleId: string }[]): Set<string> {
    const instrumentsToLoad = new Set<string>();

    for (const track of tracks) {
      // Check synth:piano format (sampled instruments in synth namespace)
      if (track.sampleId.startsWith('synth:')) {
        const presetName = track.sampleId.replace('synth:', '');
        if (isSampledInstrument(presetName)) {
          instrumentsToLoad.add(presetName);
        }
      }
      // Check sampled:piano format (explicit sampled instrument namespace)
      else if (track.sampleId.startsWith('sampled:')) {
        const instrumentId = track.sampleId.replace('sampled:', '');
        instrumentsToLoad.add(instrumentId);
      }
    }

    return instrumentsToLoad;
  }

  it('identifies synth:piano tracks for preloading', () => {
    const tracks = [
      { sampleId: 'synth:piano' },
      { sampleId: 'synth:lead' },
      { sampleId: 'kick' },
    ];

    const result = extractInstrumentsToLoad(tracks);

    expect(result.has('piano')).toBe(true);
    expect(result.has('lead')).toBe(false);  // 'lead' is not a sampled instrument
    expect(result.size).toBe(1);
  });

  it('identifies sampled:piano tracks for preloading', () => {
    const tracks = [
      { sampleId: 'sampled:piano' },
      { sampleId: 'kick' },
    ];

    const result = extractInstrumentsToLoad(tracks);

    expect(result.has('piano')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('identifies both synth: and sampled: formats in mixed tracks', () => {
    const tracks = [
      { sampleId: 'synth:piano' },
      { sampleId: 'sampled:piano' },  // Duplicate - should dedupe
      { sampleId: 'synth:lead' },
      { sampleId: 'tone:fm-epiano' },
      { sampleId: 'kick' },
    ];

    const result = extractInstrumentsToLoad(tracks);

    // Should have piano only once (deduped)
    expect(result.has('piano')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('returns empty set when no sampled instruments in tracks', () => {
    const tracks = [
      { sampleId: 'synth:lead' },
      { sampleId: 'synth:pad' },
      { sampleId: 'tone:fm-epiano' },
      { sampleId: 'kick' },
      { sampleId: 'hihat' },
    ];

    const result = extractInstrumentsToLoad(tracks);

    expect(result.size).toBe(0);
  });

  it('handles empty track list', () => {
    const tracks: { sampleId: string }[] = [];

    const result = extractInstrumentsToLoad(tracks);

    expect(result.size).toBe(0);
  });

  it('handles tracks without synth: or sampled: prefix', () => {
    const tracks = [
      { sampleId: 'kick' },
      { sampleId: 'snare' },
      { sampleId: 'recording-123' },
    ];

    const result = extractInstrumentsToLoad(tracks);

    expect(result.size).toBe(0);
  });
});
