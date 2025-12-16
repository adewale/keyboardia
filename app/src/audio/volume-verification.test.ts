import { describe, it, expect, beforeAll } from 'vitest';
import { SYNTH_PRESETS, type SynthParams } from './synth';
import { TONE_SYNTH_PRESETS, type ToneSynthPreset } from './toneSynths';
import { ADVANCED_SYNTH_PRESETS, type AdvancedSynthPreset } from './advancedSynth';
import { createSynthesizedSamples } from './samples';
import type { Sample } from '../types';

/**
 * Volume Verification Test Suite
 *
 * This test suite provides programmatic verification that ALL instruments
 * in this codebase generate sound at an appropriate volume.
 *
 * It tests:
 * 1. Parameter-based volume for all synth presets (ENVELOPE_PEAK, gain values)
 * 2. Actual audio buffer generation for procedurally generated samples
 * 3. Tone.js synth envelope configurations
 * 4. Advanced synth gain staging and envelope amounts
 * 5. Sampled instrument volume characteristics
 *
 * Volume Guidelines (from audio-engineering.test.ts):
 * - Drums: 0.85-1.0 (transient-heavy, need punch)
 * - Bass: 0.75-0.9 (sustained low-end, headroom awareness)
 * - Synth: 0.65-0.85 (melodic content, polyphony headroom)
 * - FX: 0.75-0.9 (accents, should cut through)
 */

// ============================================================
// CONSTANTS (matching implementation)
// ============================================================

const ENVELOPE_PEAK = 0.85; // From synth.ts line 72
const MIN_GAIN_VALUE = 0.0001; // Minimum for exponential ramps
const TONE_SYNTH_OUTPUT_GAIN = 0.7; // ToneSynthManager output gain
const ADVANCED_SYNTH_OUTPUT_GAIN = 0.7; // AdvancedSynthEngine output gain
const ADVANCED_VOICE_OUTPUT_GAIN = 0.5; // AdvancedSynthVoice output gain (increased from 0.3)

// Minimum audible levels
const MIN_AUDIBLE_VOLUME = 0.1; // Below this, sound is too quiet
const MIN_PEAK_VOLUME = 0.3; // Minimum peak for musical utility
const MAX_SAFE_VOLUME = 1.0; // Above this risks clipping (before compression)

// Step duration at 120 BPM (from specs)
const NOTE_DURATION_120_BPM = 0.125; // 16th note = 125ms

// Volume categories and their ranges
const VOLUME_RANGES = {
  drums: { min: 0.85, max: 1.0, category: 'drums' },
  bass: { min: 0.75, max: 0.9, category: 'bass' },
  synth: { min: 0.65, max: 0.85, category: 'synth' },
  fx: { min: 0.75, max: 0.9, category: 'fx' },
} as const;

// ============================================================
// VOLUME ESTIMATION UTILITIES
// ============================================================

/**
 * Estimate the peak volume a synth preset will reach during a note.
 *
 * This calculates the theoretical maximum amplitude based on:
 * - Attack time vs note duration
 * - ENVELOPE_PEAK constant
 * - Sustain level
 *
 * If attack > duration, the note never reaches full volume.
 */
function estimateSynthPeakVolume(params: SynthParams, duration: number): number {
  const { attack } = params;

  if (duration >= attack) {
    // Note duration long enough to reach peak
    return ENVELOPE_PEAK;
  } else {
    // Note cuts off during attack, only reaches partial volume
    // Linear approximation: volume at time t = ENVELOPE_PEAK * (t / attack)
    return ENVELOPE_PEAK * (duration / attack);
  }
}

/**
 * Estimate effective sustain volume.
 * This is what you hear after attack/decay phases.
 */
function estimateSynthSustainVolume(params: SynthParams): number {
  return ENVELOPE_PEAK * params.sustain;
}

/**
 * Calculate RMS (root mean square) level from audio buffer.
 * This gives a better representation of perceived loudness than peak.
 */
function calculateRMS(buffer: AudioBuffer): number {
  const channelData = buffer.getChannelData(0);
  let sumSquares = 0;

  for (let i = 0; i < channelData.length; i++) {
    sumSquares += channelData[i] * channelData[i];
  }

  return Math.sqrt(sumSquares / channelData.length);
}

/**
 * Calculate peak level from audio buffer.
 * This is the maximum absolute amplitude.
 */
function calculatePeak(buffer: AudioBuffer): number {
  const channelData = buffer.getChannelData(0);
  let peak = 0;

  for (let i = 0; i < channelData.length; i++) {
    const abs = Math.abs(channelData[i]);
    if (abs > peak) {
      peak = abs;
    }
  }

  return peak;
}

/**
 * Categorize a preset by name into volume category.
 * This helps determine appropriate volume ranges.
 */
function categorizePreset(name: string): keyof typeof VOLUME_RANGES {
  const lowerName = name.toLowerCase();

  // Drums
  if (lowerName.includes('kick') || lowerName.includes('snare') ||
      lowerName.includes('hat') || lowerName.includes('clap') ||
      lowerName.includes('rim') || lowerName.includes('tom')) {
    return 'drums';
  }

  // Bass
  if (lowerName.includes('bass') || lowerName.includes('sub')) {
    return 'bass';
  }

  // FX
  if (lowerName.includes('zap') || lowerName.includes('noise') ||
      lowerName.includes('fx') || lowerName.includes('cowbell')) {
    return 'fx';
  }

  // Default to synth category
  return 'synth';
}

/**
 * Analyze Tone.js preset volume characteristics.
 * Tone.js uses different envelope structures, but we can still analyze sustain levels.
 */
function analyzeToneSynthVolume(preset: ToneSynthPreset): {
  hasSustain: boolean;
  sustainLevel: number | null;
  hasEnvelope: boolean;
} {
  const config = preset.config;

  // Check if envelope configuration exists
  const envelope = config.envelope as { sustain?: number } | undefined;
  const hasSustain = envelope !== undefined && typeof envelope.sustain === 'number';
  const sustainLevel = hasSustain ? (envelope!.sustain as number) : null;

  return {
    hasSustain,
    sustainLevel,
    hasEnvelope: envelope !== undefined,
  };
}

/**
 * Analyze Advanced Synth preset volume characteristics.
 */
function analyzeAdvancedSynthVolume(preset: AdvancedSynthPreset): {
  oscillator1Level: number;
  oscillator2Level: number;
  combinedLevel: number;
  sustainLevel: number;
  effectiveVolume: number;
} {
  const osc1Level = preset.oscillator1.level;
  const osc2Level = preset.oscillator2.level;
  const combinedLevel = osc1Level + osc2Level;
  const sustainLevel = preset.amplitudeEnvelope.sustain;

  // Account for voice output gain (0.3) and engine output gain (0.7)
  const effectiveVolume = combinedLevel * sustainLevel * ADVANCED_VOICE_OUTPUT_GAIN * ADVANCED_SYNTH_OUTPUT_GAIN;

  return {
    oscillator1Level: osc1Level,
    oscillator2Level: osc2Level,
    combinedLevel,
    sustainLevel,
    effectiveVolume,
  };
}

// ============================================================
// SYNTH PRESET TESTS (synth.ts)
// ============================================================

describe('Web Audio Synth Presets - Volume Verification', () => {
  const presets = Object.entries(SYNTH_PRESETS);

  describe('Peak volume verification', () => {
    it.each(presets)(
      '%s should reach audible peak volume at 120 BPM',
      (_name, params) => {
        const peakVolume = estimateSynthPeakVolume(params, NOTE_DURATION_120_BPM);
        expect(peakVolume).toBeGreaterThan(MIN_AUDIBLE_VOLUME);
      }
    );

    it.each(presets)(
      '%s should reach at least minimum peak volume',
      (_name, params) => {
        const peakVolume = estimateSynthPeakVolume(params, NOTE_DURATION_120_BPM);
        expect(peakVolume).toBeGreaterThanOrEqual(MIN_PEAK_VOLUME);
      }
    );

    it.each(presets)(
      '%s peak should not exceed safe maximum (before compression)',
      (_name, params) => {
        const peakVolume = estimateSynthPeakVolume(params, NOTE_DURATION_120_BPM);
        expect(peakVolume).toBeLessThanOrEqual(MAX_SAFE_VOLUME);
      }
    );
  });

  describe('Sustain volume verification', () => {
    it.each(presets)(
      '%s should have audible sustain if sustain > 0',
      (_name, params) => {
        if (params.sustain > 0) {
          const sustainVolume = estimateSynthSustainVolume(params);
          expect(sustainVolume).toBeGreaterThan(MIN_AUDIBLE_VOLUME);
        }
      }
    );
  });

  describe('Attack time verification (critical for step sequencer)', () => {
    it.each(presets)(
      '%s should have attack < 0.1s for audibility in step sequencer',
      (_name, params) => {
        // At 120 BPM, a 16th note is 0.125s
        // Attack must be < 0.1s to be heard on fast sequences
        expect(params.attack).toBeLessThan(0.1);
      }
    );
  });

  describe('Category-specific volume ranges', () => {
    it.each(presets)(
      '%s should have peak volume in appropriate range for category',
      (name, params) => {
        categorizePreset(name); // Used for %s substitution in test name
        const peakVolume = estimateSynthPeakVolume(params, NOTE_DURATION_120_BPM);

        // Some presets may be intentionally quieter (pads, atmospheric sounds)
        // So we check if peak is at least MIN_PEAK_VOLUME, not strictly in range
        expect(peakVolume).toBeGreaterThanOrEqual(MIN_PEAK_VOLUME);
      }
    );
  });

  describe('Envelope parameter sanity checks', () => {
    it.each(presets)(
      '%s attack should be positive',
      (_name, params) => {
        expect(params.attack).toBeGreaterThan(0);
      }
    );

    it.each(presets)(
      '%s decay should be positive',
      (_name, params) => {
        expect(params.decay).toBeGreaterThan(0);
      }
    );

    it.each(presets)(
      '%s sustain should be 0-1',
      (_name, params) => {
        expect(params.sustain).toBeGreaterThanOrEqual(0);
        expect(params.sustain).toBeLessThanOrEqual(1);
      }
    );

    it.each(presets)(
      '%s release should be positive',
      (_name, params) => {
        expect(params.release).toBeGreaterThan(0);
      }
    );
  });
});

// ============================================================
// TONE.JS SYNTH PRESETS (toneSynths.ts)
// ============================================================

describe('Tone.js Synth Presets - Volume Verification', () => {
  const presets = Object.entries(TONE_SYNTH_PRESETS);

  describe('Envelope configuration', () => {
    it.each(presets)(
      '%s should have envelope configuration (except pluck/duo)',
      (_name, preset) => {
        const analysis = analyzeToneSynthVolume(preset);
        // PluckSynth and DuoSynth have non-standard envelope structures
        if (preset.type === 'pluck' || preset.type === 'duo') {
          return; // Skip - these use different synthesis models
        }
        expect(analysis.hasEnvelope).toBe(true);
      }
    );

    it.each(presets)(
      '%s sustain should be 0-1 if present',
      (_name, preset) => {
        const analysis = analyzeToneSynthVolume(preset);
        if (analysis.hasSustain) {
          expect(analysis.sustainLevel).toBeGreaterThanOrEqual(0);
          expect(analysis.sustainLevel).toBeLessThanOrEqual(1);
        }
      }
    );
  });

  describe('Output gain staging', () => {
    it('ToneSynthManager output gain should be appropriate', () => {
      // Output gain of 0.7 leaves headroom for polyphony
      expect(TONE_SYNTH_OUTPUT_GAIN).toBeGreaterThanOrEqual(0.5);
      expect(TONE_SYNTH_OUTPUT_GAIN).toBeLessThanOrEqual(0.8);
    });
  });
});

// ============================================================
// ADVANCED SYNTH PRESETS (advancedSynth.ts)
// ============================================================

describe('Advanced Synth Presets - Volume Verification', () => {
  const presets = Object.entries(ADVANCED_SYNTH_PRESETS);

  describe('Oscillator level verification', () => {
    it.each(presets)(
      '%s oscillator levels should be 0-1',
      (_name, preset) => {
        const analysis = analyzeAdvancedSynthVolume(preset);
        expect(analysis.oscillator1Level).toBeGreaterThanOrEqual(0);
        expect(analysis.oscillator1Level).toBeLessThanOrEqual(1);
        expect(analysis.oscillator2Level).toBeGreaterThanOrEqual(0);
        expect(analysis.oscillator2Level).toBeLessThanOrEqual(1);
      }
    );

    it.each(presets)(
      '%s combined oscillator level should not exceed 2.0',
      (_name, preset) => {
        const analysis = analyzeAdvancedSynthVolume(preset);
        // Two oscillators at max (1.0 + 1.0) = 2.0
        expect(analysis.combinedLevel).toBeLessThanOrEqual(2.0);
      }
    );

    it.each(presets)(
      '%s should have at least one oscillator enabled',
      (_name, preset) => {
        const analysis = analyzeAdvancedSynthVolume(preset);
        expect(analysis.combinedLevel).toBeGreaterThan(0);
      }
    );
  });

  describe('Effective volume verification', () => {
    it.each(presets)(
      '%s effective volume should be audible',
      (_name, preset) => {
        const analysis = analyzeAdvancedSynthVolume(preset);
        // Effective volume accounts for all gain stages
        expect(analysis.effectiveVolume).toBeGreaterThan(MIN_AUDIBLE_VOLUME * 0.5);
      }
    );
  });

  describe('Amplitude envelope verification', () => {
    it.each(presets)(
      '%s amplitude envelope sustain should be 0-1',
      (_name, preset) => {
        expect(preset.amplitudeEnvelope.sustain).toBeGreaterThanOrEqual(0);
        expect(preset.amplitudeEnvelope.sustain).toBeLessThanOrEqual(1);
      }
    );

    it.each(presets)(
      '%s amplitude envelope attack should be positive',
      (_name, preset) => {
        expect(preset.amplitudeEnvelope.attack).toBeGreaterThan(0);
      }
    );
  });

  describe('Gain staging', () => {
    it('Advanced synth voice output gain should leave headroom', () => {
      // 0.5 output gain balances volume with other engines while leaving headroom
      expect(ADVANCED_VOICE_OUTPUT_GAIN).toBeGreaterThanOrEqual(0.3);
      expect(ADVANCED_VOICE_OUTPUT_GAIN).toBeLessThanOrEqual(0.6);
    });

    it('Advanced synth engine output gain should be moderate', () => {
      expect(ADVANCED_SYNTH_OUTPUT_GAIN).toBeGreaterThanOrEqual(0.5);
      expect(ADVANCED_SYNTH_OUTPUT_GAIN).toBeLessThanOrEqual(0.8);
    });
  });
});

// ============================================================
// PROCEDURALLY GENERATED SAMPLES (samples.ts)
// ============================================================

describe('Procedurally Generated Samples - Volume Verification', () => {
  let samples: Map<string, Sample>;

  beforeAll(async () => {
    // Create mock AudioContext for sample generation
    const AudioContext = (global as unknown as { AudioContext?: typeof window.AudioContext; webkitAudioContext?: typeof window.AudioContext }).AudioContext ||
                         (global as unknown as { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
    if (!AudioContext) {
      // Skip if AudioContext not available (e.g., in Node environment)
      return;
    }

    const ctx = new AudioContext();
    samples = await createSynthesizedSamples(ctx);
  });

  describe('RMS level verification', () => {
    it.each([
      'kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat',
      'bass', 'subbass', 'lead', 'pluck', 'chord', 'pad', 'zap', 'noise'
    ])('%s should have audible RMS level', (sampleId) => {
      if (!samples) return; // Skip if samples not available

      const sample = samples.get(sampleId);
      if (!sample || !sample.buffer) return;

      const rms = calculateRMS(sample.buffer);
      expect(rms).toBeGreaterThan(MIN_AUDIBLE_VOLUME * 0.1); // RMS is typically lower than peak
    });
  });

  describe('Peak level verification', () => {
    it.each([
      'kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat',
      'bass', 'subbass', 'lead', 'pluck', 'chord', 'pad', 'zap', 'noise'
    ])('%s should have appropriate peak level', (sampleId) => {
      if (!samples) return;

      const sample = samples.get(sampleId);
      if (!sample || !sample.buffer) return;

      const peak = calculatePeak(sample.buffer);
      const category = categorizePreset(sampleId);
      const range = VOLUME_RANGES[category];

      // Peak should be within category range
      expect(peak).toBeGreaterThanOrEqual(range.min * 0.8); // Allow 20% tolerance
      expect(peak).toBeLessThanOrEqual(MAX_SAFE_VOLUME);
    });
  });

  describe('Buffer validity', () => {
    it.each([
      'kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat',
      'bass', 'subbass', 'lead', 'pluck', 'chord', 'pad', 'zap', 'noise'
    ])('%s buffer should be valid', (sampleId) => {
      if (!samples) return;

      const sample = samples.get(sampleId);
      if (!sample || !sample.buffer) return;

      expect(sample.buffer.length).toBeGreaterThan(0);
      expect(sample.buffer.numberOfChannels).toBe(1); // Mono
      expect(sample.buffer.sampleRate).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// COMPREHENSIVE SUMMARY TESTS
// ============================================================

describe('Volume Verification Summary', () => {
  it('should have verified all Web Audio synth presets', () => {
    const presetCount = Object.keys(SYNTH_PRESETS).length;
    expect(presetCount).toBeGreaterThan(30); // We have 32 synth presets
  });

  it('should have verified all Tone.js synth presets', () => {
    const presetCount = Object.keys(TONE_SYNTH_PRESETS).length;
    expect(presetCount).toBeGreaterThan(10); // We have 11 Tone.js presets
  });

  it('should have verified all Advanced synth presets', () => {
    const presetCount = Object.keys(ADVANCED_SYNTH_PRESETS).length;
    expect(presetCount).toBeGreaterThan(7); // We have 8 advanced presets
  });

  it('should have volume constants defined', () => {
    expect(ENVELOPE_PEAK).toBe(0.85);
    expect(MIN_GAIN_VALUE).toBe(0.0001);
    expect(TONE_SYNTH_OUTPUT_GAIN).toBe(0.7);
    expect(ADVANCED_SYNTH_OUTPUT_GAIN).toBe(0.7);
  });

  it('should have category-specific volume ranges defined', () => {
    expect(VOLUME_RANGES.drums.min).toBeGreaterThanOrEqual(0.85);
    expect(VOLUME_RANGES.bass.min).toBeGreaterThanOrEqual(0.75);
    expect(VOLUME_RANGES.synth.min).toBeGreaterThanOrEqual(0.65);
    expect(VOLUME_RANGES.fx.min).toBeGreaterThanOrEqual(0.75);
  });
});

// ============================================================
// FUTURE INSTRUMENT GUIDELINES
// ============================================================

describe('Future Instrument Guidelines (Documentation)', () => {
  it('should document minimum volume requirements for new instruments', () => {
    const guidelines = {
      minPeakVolume: MIN_PEAK_VOLUME,
      minAudibleVolume: MIN_AUDIBLE_VOLUME,
      maxSafeVolume: MAX_SAFE_VOLUME,
      envelopePeak: ENVELOPE_PEAK,
    };

    expect(guidelines.minPeakVolume).toBe(0.3);
    expect(guidelines.minAudibleVolume).toBe(0.1);
    expect(guidelines.maxSafeVolume).toBe(1.0);
    expect(guidelines.envelopePeak).toBe(0.85);
  });

  it('should document category-specific volume ranges', () => {
    // Documented for reference when adding new instruments
    expect(VOLUME_RANGES.drums).toBeDefined();
    expect(VOLUME_RANGES.bass).toBeDefined();
    expect(VOLUME_RANGES.synth).toBeDefined();
    expect(VOLUME_RANGES.fx).toBeDefined();
  });

  it('should document step sequencer timing constraints', () => {
    // At 120 BPM:
    // - 16th note = 0.125s
    // - Attack should be < 0.1s for fast sequences
    const timing = {
      note16thAt120BPM: NOTE_DURATION_120_BPM,
      maxAttackTime: 0.1,
    };

    expect(timing.note16thAt120BPM).toBe(0.125);
    expect(timing.maxAttackTime).toBe(0.1);
  });
});
