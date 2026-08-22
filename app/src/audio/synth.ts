/**
 * Enhanced monophonic synth engine using Web Audio API.
 * Inspired by the OP-Z's synth tracks and Ableton's Learning Synths.
 *
 * Phase 22: Added dual oscillator, filter envelope, and LFO support.
 * All new features are optional and exposed via presets only.
 *
 * Waveforms: sine, triangle, sawtooth, square
 * Features:
 *   - Single or dual oscillator with detuning
 *   - Lowpass filter with resonance
 *   - Amplitude ADSR envelope
 *   - Optional filter envelope
 *   - Optional LFO (filter, pitch, or amplitude)
 */

import { semitoneToFrequency } from './constants';
import { getSourceCalibration } from './source-calibration';
import type { WaveformType, LFODestination } from './synth-types';
import { SYNTH_CONSTANTS } from './synth-types';
import type { ResolvedEnvelopeV2 } from '../shared/envelope-contract-v2';
import { RELEASE_TAIL_GUARD_SEC } from './note-schedule';

// Re-export for backwards compatibility
export { semitoneToFrequency };
export type { WaveformType } from './synth-types';

/**
 * Second oscillator configuration for layering and detuning.
 * When defined, creates a richer, thicker sound.
 */
export interface Osc2Config {
  waveform: WaveformType;
  detune: number;   // Cents: -100 to +100 (fine tuning for beating/chorus)
  coarse: number;   // Semitones: -24 to +24 (octave/interval shifts)
  mix: number;      // 0 = osc1 only, 1 = osc2 only, 0.5 = equal mix
  /** Shared is subtractive synthesis; bypass preserves the layer's harmonics. */
  filterRouting?: 'shared' | 'bypass';
  /** Optional source-level contour, still bounded by the main amp envelope. */
  levelEnvelope?: Pick<FilterEnvConfig, 'attack' | 'decay' | 'sustain'>;
}

/**
 * Filter envelope configuration.
 * Modulates the filter cutoff over time for movement and expression.
 */
export interface FilterEnvConfig {
  amount: number;   // -1 to +1 (how much envelope moves cutoff, negative = down)
  attack: number;   // 0 to 2 seconds
  decay: number;    // 0 to 2 seconds
  sustain: number;  // 0 to 1 (multiplier of amount at sustain)
}

/**
 * LFO (Low Frequency Oscillator) configuration.
 * Creates periodic modulation for movement, vibrato, tremolo, or wobble.
 */
export interface LFOConfig {
  waveform: WaveformType;
  rate: number;               // Hz: 0.1 to 20
  depth: number;              // 0 to 1 (modulation amount)
  destination: LFODestination;
}

export interface SynthParams {
  // === CORE (required) ===
  waveform: WaveformType;
  filterCutoff: number;    // 100-10000 Hz
  filterResonance: number; // 0-20
  attack: number;          // 0-1 seconds
  decay: number;           // 0-1 seconds
  sustain: number;         // 0-1 amplitude
  release: number;         // 0-2 seconds
  /** Source-side loudness calibration; independent of track and note gain. */
  outputGainDb?: number;

  // === ENHANCED (optional) ===
  osc2?: Osc2Config;       // Second oscillator for layering/detuning
  filterEnv?: FilterEnvConfig;  // Filter envelope modulation
  lfo?: LFOConfig;         // Low frequency oscillator
}

/**
 * Equal-power shaped crossfade, normalized so even perfectly correlated
 * oscillators cannot exceed the level of either endpoint.
 */
export function peakSafeOscillatorMix(mix: number): readonly [number, number] {
  const position = Math.max(0, Math.min(1, mix));
  const left = Math.cos(position * Math.PI / 2);
  const right = Math.sin(position * Math.PI / 2);
  const peak = left + right;
  return [left / peak, right / peak];
}

const WAVEFORMS = new Set<WaveformType>(['sine', 'triangle', 'sawtooth', 'square']);

/** JSON boundary for authored/custom synth definitions. */
export function serializeSynthParams(params: SynthParams): string {
  return JSON.stringify({ version: 1, params });
}

export function deserializeSynthParams(serialized: string): SynthParams {
  const payload = JSON.parse(serialized) as { version?: unknown; params?: Partial<SynthParams> };
  const params = payload.params;
  if (payload.version !== 1 || !params || !params.waveform || !WAVEFORMS.has(params.waveform)) {
    throw new Error('Unsupported or invalid synth-parameter payload');
  }
  const required = ['filterCutoff', 'filterResonance', 'attack', 'decay', 'sustain', 'release'] as const;
  if (required.some(key => !Number.isFinite(params[key]))) throw new Error('Synth-parameter payload has non-finite core values');
  if (params.osc2 && (!WAVEFORMS.has(params.osc2.waveform) || !Number.isFinite(params.osc2.mix))) {
    throw new Error('Synth-parameter payload has an invalid oscillator layer');
  }
  return JSON.parse(JSON.stringify(params)) as SynthParams;
}

/**
 * Keyboard velocity opens the native synth filter without changing the note's
 * resolved amplitude. At the canonical velocity (90) the cutoff is 88.9% of
 * the preset value; a soft 0.3-normalized strike is 68.3% of the full-velocity
 * cutoff, producing a clearly darker render while retaining audibility.
 */
export function velocityFilterCutoff(baseCutoff: number, midiVelocity: number): number {
  const normalized = Math.max(0, Math.min(127, midiVelocity)) / 127;
  const multiplier = 0.3 + 0.7 * Math.sqrt(normalized);
  return Math.max(MIN_FILTER_FREQ, Math.min(MAX_FILTER_FREQ, baseCutoff * multiplier));
}

// Audio Engineering Constants (from shared synth-types.ts)
const {
  MAX_VOICES,
  MAX_FILTER_RESONANCE,
  MIN_GAIN_VALUE,
  ENVELOPE_PEAK,
  MIN_FILTER_FREQ,
  MAX_FILTER_FREQ,
} = SYNTH_CONSTANTS;

// Preset synth patches
export const SYNTH_PRESETS: Record<string, SynthParams> = {
  // === CORE SYNTHS ===
  bass: {
    waveform: 'sawtooth',
    filterCutoff: 900,
    filterResonance: 6,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.5,
    release: 0.1,
    outputGainDb: -3.5,
    filterEnv: {
      amount: 0.5,
      attack: 0.003,
      decay: 0.24,
      sustain: 0.08,
    },
  },
  lead: {
    waveform: 'square',
    filterCutoff: 2500,
    filterResonance: 5,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.8,
    release: 0.3,
    outputGainDb: -7,
    filterEnv: {
      amount: 0.35,
      attack: 0.005,
      decay: 0.28,
      sustain: 0.2,
    },
  },
  pad: {
    waveform: 'triangle',
    filterCutoff: 1200,
    filterResonance: 2,
    attack: 0.05,   // Fast attack for step sequencer; long release creates pad feel
    decay: 0.15,
    sustain: 0.85,
    release: 1.0,
    outputGainDb: -4,
    filterEnv: {
      amount: 0.35,
      attack: 0.35,
      decay: 0.8,
      sustain: 0.5,
    },
  },
  pluck: {
    waveform: 'sawtooth',
    filterCutoff: 900,
    filterResonance: 2,
    attack: 0.005,
    decay: 0.4,
    sustain: 0.15,
    release: 0.25,
    outputGainDb: -2,
    filterEnv: {
      amount: 0.75,
      attack: 0.001,
      decay: 0.22,
      sustain: 0.03,
    },
  },
  acid: {
    waveform: 'sawtooth',
    filterCutoff: 600,
    filterResonance: 16,
    attack: 0.01,
    decay: 0.15,
    sustain: 0.35,
    release: 0.1,
    filterEnv: {
      amount: 0.8,
      attack: 0.001,
      decay: 0.18,
      sustain: 0.05,
    },
  },

  // === FUNK / SOUL ===
  funkbass: {
    waveform: 'square',
    filterCutoff: 1200,
    filterResonance: 6,
    attack: 0.005,
    decay: 0.1,
    sustain: 0.4,
    release: 0.05,  // Tight, punchy - Bootsy Collins style
  },
  clavinet: {
    waveform: 'sawtooth',
    filterCutoff: 4000,
    filterResonance: 5,
    attack: 0.001,
    decay: 0.15,
    sustain: 0.35,
    release: 0.1,  // Bright, percussive - Stevie Wonder style
  },

  // === ACID JAZZ ===
  rhodes: {
    waveform: 'sine',
    filterCutoff: 3000,
    filterResonance: 2,
    attack: 0.01,
    decay: 0.4,
    sustain: 0.65,
    release: 0.6,  // Mellow, bell-like - Herbie Hancock style
  },
  organ: {
    waveform: 'square',
    filterCutoff: 4000,
    filterResonance: 0.5,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.8,
    release: 0.15,  // Hammond B3 style - sustained, churchy
  },
  wurlitzer: {
    waveform: 'triangle',
    filterCutoff: 2500,
    filterResonance: 4,
    attack: 0.005,
    decay: 0.3,
    sustain: 0.55,
    release: 0.3,  // Warmer than Rhodes, more bark
  },

  // === DISCO ===
  discobass: {
    waveform: 'sawtooth',
    filterCutoff: 600,
    filterResonance: 5,
    attack: 0.01,
    decay: 0.15,
    sustain: 0.5,
    release: 0.1,  // Octave-jumping disco groove
  },
  strings: {
    waveform: 'sawtooth',
    filterCutoff: 3000,
    filterResonance: 0.5,
    attack: 0.05,   // Fast attack for step sequencer; sustain + release create lush swell
    decay: 0.15,
    sustain: 0.8,
    release: 0.8,   // Longer release for Philly strings feel
  },
  brass: {
    waveform: 'sawtooth',
    filterCutoff: 1800,
    filterResonance: 3,
    attack: 0.05,
    decay: 0.2,
    sustain: 0.6,
    release: 0.2,  // Punchy horn stabs
  },

  // === HOUSE / TECHNO ===
  stab: {
    waveform: 'sawtooth',
    filterCutoff: 3000,
    filterResonance: 10,
    attack: 0.001,
    decay: 0.2,
    sustain: 0.25,
    release: 0.15,  // Classic house chord stab
  },
  sub: {
    waveform: 'sine',
    filterCutoff: 200,
    filterResonance: 0,
    attack: 0.02,
    decay: 0.3,
    sustain: 0.6,
    release: 0.2,  // Deep sub bass
  },

  // === INDIE / ATMOSPHERIC ===
  // Note: Attack times must be < 0.1s to be audible at 120 BPM (step = 0.125s)
  shimmer: {
    waveform: 'sine',
    filterCutoff: 6000,
    filterResonance: 0.5,
    attack: 0.05,   // Fast attack for step sequencer compatibility
    decay: 0.15,
    sustain: 0.8,
    release: 2.0,   // Long release creates ethereal tail
  },
  jangle: {
    waveform: 'triangle',
    filterCutoff: 5500,
    filterResonance: 4,
    attack: 0.001,
    decay: 0.4,
    sustain: 0.45,
    release: 0.5,   // Bright, chiming - Jazzmaster clean tone
  },
  dreampop: {
    waveform: 'sawtooth',
    filterCutoff: 2000,
    filterResonance: 1,
    attack: 0.05,   // Fast attack for step sequencer compatibility
    decay: 0.3,
    sustain: 0.6,
    release: 1.5,   // Long release creates hazy, shoegaze texture
  },
  bell: {
    waveform: 'sine',
    filterCutoff: 8000,
    filterResonance: 1,
    attack: 0.001,
    decay: 0.5,
    sustain: 0.2,
    release: 1.0,   // Pure bell tone, vibraphone-like
  },

  // ============================================================
  // === PHASE 21A: ENHANCED PRESETS (using new synth features) ===
  // ============================================================

  // === ENHANCED ELECTRONIC ===

  /**
   * Supersaw - Classic trance/EDM lead
   * Two sawtooth oscillators with heavy detuning create the iconic thick sound.
   */
  supersaw: {
    waveform: 'sawtooth',
    filterCutoff: 4000,
    filterResonance: 2,
    attack: 0.01,
    decay: 0.12,
    sustain: 0.8,
    release: 0.3,
    osc2: {
      waveform: 'sawtooth',
      detune: 25,      // +25 cents for beating effect
      coarse: 0,
      mix: 0.5,        // Equal mix of both oscillators
    },
  },

  /**
   * Hypersaw - Even thicker than supersaw
   * Extreme detuning with slight filter envelope for movement.
   */
  hypersaw: {
    waveform: 'sawtooth',
    filterCutoff: 3500,
    filterResonance: 3,
    attack: 0.01,
    decay: 0.15,
    sustain: 0.75,
    release: 0.4,
    osc2: {
      waveform: 'sawtooth',
      detune: 50,      // Heavy detune for massive sound
      coarse: 0,
      mix: 0.5,
    },
    filterEnv: {
      amount: 0.3,     // Subtle filter open on attack
      attack: 0.01,
      decay: 0.3,
      sustain: 0.2,
    },
  },

  /**
   * Wobble - Dubstep bass
   * LFO modulating filter at 2Hz creates the classic wobble effect.
   */
  wobble: {
    waveform: 'sawtooth',
    filterCutoff: 400,
    filterResonance: 12,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.7,
    release: 0.1,
    lfo: {
      waveform: 'sine',
      rate: 2,         // 2 Hz wobble (half-notes at 120 BPM)
      depth: 0.8,      // Strong modulation
      destination: 'filter',
    },
  },

  /**
   * Growl - Aggressive bass
   * Faster LFO with square wave for more aggressive modulation.
   */
  growl: {
    waveform: 'square',
    filterCutoff: 500,
    filterResonance: 14,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.6,
    release: 0.1,
    lfo: {
      waveform: 'square',
      rate: 4,         // Faster wobble
      depth: 0.7,
      destination: 'filter',
    },
    filterEnv: {
      amount: 0.4,     // Filter opens on attack
      attack: 0.01,
      decay: 0.15,
      sustain: 0.3,
    },
  },

  // === ATMOSPHERIC ===

  /**
   * Evolving - Slow-moving texture
   * Slow filter envelope and very slow LFO create organic movement.
   * Note: Attack kept at 0.05s for step sequencer compatibility.
   */
  evolving: {
    waveform: 'sawtooth',
    filterCutoff: 800,
    filterResonance: 4,
    attack: 0.05,
    decay: 0.3,
    sustain: 0.7,
    release: 1.5,
    filterEnv: {
      amount: 0.6,     // Filter opens slowly
      attack: 2.0,     // Very slow attack (filter envelope, not amplitude)
      decay: 1.0,
      sustain: 0.4,
    },
    lfo: {
      waveform: 'sine',
      rate: 0.2,       // Very slow movement (5 seconds per cycle)
      depth: 0.3,
      destination: 'filter',
    },
  },

  /**
   * Sweep - Build/transition sound
   * Long filter envelope attack creates sweeping effect.
   */
  sweep: {
    waveform: 'sawtooth',
    filterCutoff: 300,
    filterResonance: 8,
    attack: 0.05,
    decay: 0.12,
    sustain: 0.8,
    release: 1.0,
    osc2: {
      waveform: 'square',
      detune: 10,
      coarse: 0,
      mix: 0.3,
    },
    filterEnv: {
      amount: 0.8,     // Big filter sweep
      attack: 1.0,     // Slow sweep up
      decay: 0.5,
      sustain: 0.5,
    },
  },

  /**
   * Warm Pad - Rich, evolving pad
   * Dual oscillator with slow LFO for movement.
   */
  warmpad: {
    waveform: 'sawtooth',
    filterCutoff: 1500,
    filterResonance: 2,
    attack: 0.05,
    decay: 0.15,
    sustain: 0.85,
    release: 1.5,
    osc2: {
      waveform: 'triangle',
      detune: 8,
      coarse: 0,
      mix: 0.4,
    },
    lfo: {
      waveform: 'sine',
      rate: 0.3,
      depth: 0.2,
      destination: 'filter',
    },
  },

  /**
   * Glass - Crystalline, bell-like
   * High filter with filter envelope creates glass-like timbre.
   */
  glass: {
    waveform: 'triangle',
    filterCutoff: 6000,
    filterResonance: 6,
    attack: 0.001,
    decay: 0.6,
    sustain: 0.2,
    release: 1.2,
    osc2: {
      waveform: 'sine',
      detune: 3,
      coarse: 12,      // Octave up for shimmer
      mix: 0.3,
    },
    filterEnv: {
      amount: 0.3,
      attack: 0.001,
      decay: 0.4,
      sustain: 0.1,
    },
  },

  // === ENHANCED KEYS ===

  /**
   * E-Piano - Electric piano with chorus
   * Dual oscillator creates the classic tine sound with chorus effect.
   */
  epiano: {
    waveform: 'triangle',
    filterCutoff: 3500,
    filterResonance: 2,
    attack: 0.005,
    decay: 0.5,
    sustain: 0.4,
    release: 0.5,
    osc2: {
      waveform: 'sine',
      detune: 5,       // Very subtle detune
      coarse: 0,
      mix: 0.4,
    },
    filterEnv: {
      amount: 0.2,
      attack: 0.005,
      decay: 0.3,
      sustain: 0.1,
    },
  },

  /**
   * Vibes - Vibraphone
   * Sine-based with tremolo LFO for motor effect.
   */
  vibes: {
    waveform: 'sine',
    filterCutoff: 5000,
    filterResonance: 1,
    attack: 0.001,
    decay: 0.8,
    sustain: 0.3,
    release: 1.0,
    lfo: {
      waveform: 'sine',
      rate: 5,         // Typical vibraphone motor speed
      depth: 0.15,     // Subtle tremolo
      destination: 'amplitude',
    },
  },

  /**
   * Organ Phase - Rotary speaker organ
   * Square waves with slow pitch LFO for Leslie effect.
   */
  organphase: {
    waveform: 'square',
    filterCutoff: 3500,
    filterResonance: 0.5,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.8,
    release: 0.15,
    osc2: {
      waveform: 'square',
      detune: 0,
      coarse: -12,     // Octave down for fullness
      mix: 0.3,
    },
    lfo: {
      waveform: 'sine',
      rate: 0.8,       // Slow rotation
      depth: 0.15,     // Subtle pitch wobble
      destination: 'pitch',
    },
  },

  // === BASS ENHANCEMENT ===

  /**
   * Reese - Reese bass
   * Two detuned saws with slow LFO modulation.
   */
  reese: {
    waveform: 'sawtooth',
    filterCutoff: 600,
    filterResonance: 5,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.6,
    release: 0.15,
    osc2: {
      waveform: 'sawtooth',
      detune: 15,
      coarse: 0,
      mix: 0.5,
    },
    lfo: {
      waveform: 'sine',
      rate: 0.5,       // Slow movement
      depth: 0.2,
      destination: 'filter',
    },
  },

  /**
   * Hoover - Hoover/mentasm bass
   * Heavy detune with downward filter envelope.
   */
  hoover: {
    waveform: 'sawtooth',
    filterCutoff: 2000,
    filterResonance: 6,
    attack: 0.01,
    decay: 0.3,
    sustain: 0.4,
    release: 0.2,
    osc2: {
      waveform: 'sawtooth',
      detune: 40,      // Heavy detune
      coarse: -12,     // Octave down
      mix: 0.5,
    },
    filterEnv: {
      amount: -0.5,    // Filter closes (negative envelope)
      attack: 0.01,
      decay: 0.4,
      sustain: 0.3,
    },
  },

  // NOTE: Piano is a SAMPLED instrument, not a synth preset.
  // Sampled instruments should SKIP when not ready, never fall back to synth.
  // This prevents confusing users who expect piano to sound like piano.
  // See: lessons-learned.md "Sampled Instrument Race Condition"
};

// Explicit authored layers replace the old inference of "copy osc1 and add a
// detune value". These preserve the current neutral voicing while making every
// layer's topology serializable and independently editable.
const EXPLICIT_OSC2_BY_PRESET: Readonly<Record<string, Osc2Config>> = {
  bass: { waveform: 'sawtooth', detune: 4, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  lead: { waveform: 'square', detune: 9, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  pad: { waveform: 'triangle', detune: 10, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  pluck: { waveform: 'sawtooth', detune: 7, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  acid: { waveform: 'sawtooth', detune: 5, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  funkbass: { waveform: 'square', detune: 4, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  clavinet: { waveform: 'sawtooth', detune: 8, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  rhodes: { waveform: 'sine', detune: 8, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  organ: { waveform: 'square', detune: 7, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  wurlitzer: { waveform: 'triangle', detune: 8, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  discobass: { waveform: 'sawtooth', detune: 4, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  strings: { waveform: 'sawtooth', detune: 10, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  brass: { waveform: 'sawtooth', detune: 8, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  stab: { waveform: 'square', detune: 8, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  shimmer: { waveform: 'triangle', detune: 11, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  jangle: { waveform: 'sawtooth', detune: 8, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  dreampop: { waveform: 'triangle', detune: 11, coarse: 0, mix: 0.42, filterRouting: 'shared' },
  bell: { waveform: 'sine', detune: 7, coarse: 0, mix: 0.42, filterRouting: 'shared' },
};

for (const [presetId, osc2] of Object.entries(EXPLICIT_OSC2_BY_PRESET)) {
  const preset = SYNTH_PRESETS[presetId];
  if (!preset || preset.osc2) continue;
  preset.osc2 = { ...osc2 };
}

for (const [presetId, preset] of Object.entries(SYNTH_PRESETS)) {
  const calibration = getSourceCalibration(`synth:${presetId}`);
  if (calibration?.kind !== 'fixed') {
    throw new Error(`Synth preset has no fixed source calibration: ${presetId}`);
  }
  preset.outputGainDb = calibration.gainDb;
}

import { logger } from '../utils/logger';
import { registerHmrDispose } from '../utils/hmr';

export class SynthEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices: Map<string, SynthVoice> = new Map();
  private voiceOrder: string[] = []; // Track order for voice stealing

  initialize(audioContext: AudioContext, masterGain: GainNode): void {
    this.audioContext = audioContext;
    this.masterGain = masterGain;
    logger.audio.log('SynthEngine initialized with context state:', audioContext.state);
  }

  /**
   * Play a synth note at a specific time.
   *
   * @param noteId - Unique ID for this note (for stopping)
   * @param frequency - Frequency in Hz (e.g., 440 for A4)
   * @param params - Synth parameters
   * @param time - AudioContext time to start
   * @param duration - Optional duration (for sequenced notes)
   * @param volume - Volume multiplier from P-lock (0-1, default 1)
   * @param destination - Optional destination node (Phase 25: for per-track routing)
   */
  playNote(
    noteId: string,
    frequency: number,
    params: SynthParams,
    time: number,
    duration?: number,
    volume: number = 1,
    destination?: GainNode,
    midiVelocity: number = 90,
    canonicalEnvelope?: ResolvedEnvelopeV2,
  ): void {
    // DEBUG: Log entry to verify method is being called
    logger.audio.log(`SynthEngine.playNote: noteId=${noteId}, freq=${frequency.toFixed(1)}Hz, time=${time.toFixed(3)}, duration=${duration}, vol=${volume}`);

    if (!this.audioContext || !this.masterGain) {
      logger.audio.error('SynthEngine.playNote: AudioContext or masterGain not initialized!', {
        hasContext: !!this.audioContext,
        hasMasterGain: !!this.masterGain,
      });
      return;
    }

    // DEBUG: Verify context state
    if (this.audioContext.state !== 'running') {
      logger.audio.warn(`SynthEngine.playNote: AudioContext state is "${this.audioContext.state}", not "running"`);
    }

    // Stop any existing voice with this ID
    this.stopNote(noteId);

    // Voice limiting: steal oldest voice if at capacity
    // This prevents CPU overload on mobile devices
    if (this.activeVoices.size >= MAX_VOICES) {
      const oldestNoteId = this.voiceOrder.shift();
      if (oldestNoteId) {
        this.stopNote(oldestNoteId);
      }
    }

    // Phase 25: Use provided destination or fall back to masterGain
    const outputNode = destination ?? this.masterGain;
    const voice = new SynthVoice(this.audioContext, outputNode, params, () => {
      // A note ID can be reused before an older oscillator ends. Never let the
      // old onended event evict the replacement voice.
      if (this.activeVoices.get(noteId) !== voice) return;
      this.activeVoices.delete(noteId);
      this.voiceOrder = this.voiceOrder.filter(id => id !== noteId);
    }, canonicalEnvelope);
    voice.start(frequency, time, volume, midiVelocity);
    logger.audio.log(`SynthEngine voice created and started: noteId=${noteId}, preset=${params.waveform}, vol=${volume}, activeVoices=${this.activeVoices.size + 1}`);

    if (duration !== undefined) {
      voice.stop(time + duration);
    }

    this.activeVoices.set(noteId, voice);
    this.voiceOrder.push(noteId);
  }

  /**
   * Get current voice count (for monitoring/testing)
   */
  getVoiceCount(): number {
    return this.activeVoices.size;
  }

  stopNote(noteId: string): void {
    const voice = this.activeVoices.get(noteId);
    if (voice && this.audioContext) {
      voice.stop(this.audioContext.currentTime);
      this.activeVoices.delete(noteId);
      this.voiceOrder = this.voiceOrder.filter(id => id !== noteId);
    }
  }

  stopAll(): void {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    for (const voice of this.activeVoices.values()) {
      voice.stop(now);
    }
    this.activeVoices.clear();
    this.voiceOrder = [];
  }
}

/**
 * Enhanced SynthVoice with support for:
 * - Dual oscillator (osc2)
 * - Filter envelope modulation
 * - LFO modulation (filter, pitch, or amplitude)
 */
class SynthVoice {
  private audioContext: AudioContext;
  private params: SynthParams;
  private isCleanedUp: boolean = false;
  private noteStartTime = 0;
  private envelopePeak: number = MIN_GAIN_VALUE;
  private activeFilterCutoff: number;
  private readonly onEnded: () => void;
  private readonly canonicalEnvelope?: ResolvedEnvelopeV2;
  private canonicalStartTime = 0;
  private canonicalPeak: number = MIN_GAIN_VALUE;

  // Core nodes (always present)
  private oscillator1: OscillatorNode;
  private filter: BiquadFilterNode;
  private gainNode: GainNode;

  // Optional nodes (created only when needed)
  private oscillator2: OscillatorNode | null = null;
  private osc1Gain: GainNode | null = null;
  private osc2Gain: GainNode | null = null;
  private osc2BaseLevel = 0;
  private lfoOscillator: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private filterEnvGain: GainNode | null = null;

  constructor(
    audioContext: AudioContext,
    destination: AudioNode,
    params: SynthParams,
    onEnded: () => void,
    canonicalEnvelope?: ResolvedEnvelopeV2,
  ) {
    this.params = params;
    this.audioContext = audioContext;
    this.activeFilterCutoff = params.filterCutoff;
    this.onEnded = onEnded;
    this.canonicalEnvelope = canonicalEnvelope;

    // Create main filter (shared by all oscillators)
    this.filter = audioContext.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = params.filterCutoff;
    this.filter.Q.value = Math.min(params.filterResonance, MAX_FILTER_RESONANCE);

    // Create main gain for amplitude envelope
    this.gainNode = audioContext.createGain();
    this.gainNode.gain.value = 0;

    // Create oscillator 1
    this.oscillator1 = audioContext.createOscillator();
    this.oscillator1.type = params.waveform;
    this.oscillator1.onended = () => {
      this.cleanup();
      this.onEnded();
    };

    // Check if we need dual oscillator
    if (params.osc2) {
      // Create oscillator 2
      this.oscillator2 = audioContext.createOscillator();
      this.oscillator2.type = params.osc2.waveform;

      // Create mixer gains for crossfading
      this.osc1Gain = audioContext.createGain();
      this.osc2Gain = audioContext.createGain();

      // Set mix levels (osc2.mix: 0 = osc1 only, 1 = osc2 only)
      const [osc1Level, osc2Level] = peakSafeOscillatorMix(params.osc2.mix);
      this.osc2BaseLevel = osc2Level;
      this.osc1Gain.gain.value = osc1Level;
      this.osc2Gain.gain.value = osc2Level;

      // Connect: osc1 -> osc1Gain -> filter
      //          osc2 -> osc2Gain -> filter
      this.oscillator1.connect(this.osc1Gain);
      this.osc1Gain.connect(this.filter);
      this.oscillator2.connect(this.osc2Gain);
      this.osc2Gain.connect(params.osc2.filterRouting === 'bypass' ? this.gainNode : this.filter);
    } else {
      // Single oscillator: osc1 -> filter
      this.oscillator1.connect(this.filter);
    }

    // Connect filter -> gain -> destination
    this.filter.connect(this.gainNode);
    this.gainNode.connect(destination);

    // Set up LFO if configured
    if (params.lfo) {
      this.setupLFO(params.lfo);
    }
  }

  /**
   * Set up LFO modulation.
   * The LFO is an oscillator running at sub-audio rate that modulates
   * a target parameter (filter cutoff, pitch, or amplitude).
   */
  private setupLFO(lfoConfig: LFOConfig): void {
    // Create LFO oscillator
    this.lfoOscillator = this.audioContext.createOscillator();
    this.lfoOscillator.type = lfoConfig.waveform;
    this.lfoOscillator.frequency.value = lfoConfig.rate;

    // Create gain to scale the LFO output
    this.lfoGain = this.audioContext.createGain();

    // Connect LFO oscillator to gain
    this.lfoOscillator.connect(this.lfoGain);

    // Route LFO to destination
    switch (lfoConfig.destination) {
      case 'filter': {
        // LFO modulates filter frequency
        // Scale: depth * cutoff creates reasonable sweep range
        const modRange = this.params.filterCutoff * lfoConfig.depth * 2;
        this.lfoGain.gain.value = modRange;
        this.lfoGain.connect(this.filter.frequency);
        break;
      }
      case 'pitch': {
        // LFO modulates oscillator frequency (vibrato)
        // Scale: depth * 100 cents = max 1 semitone at full depth
        const pitchMod = lfoConfig.depth * 100;
        this.lfoGain.gain.value = pitchMod;
        this.lfoGain.connect(this.oscillator1.detune);
        if (this.oscillator2) {
          // Create a second connection for osc2
          const lfoGain2 = this.audioContext.createGain();
          lfoGain2.gain.value = pitchMod;
          this.lfoOscillator.connect(lfoGain2);
          lfoGain2.connect(this.oscillator2.detune);
        }
        break;
      }
      case 'amplitude': {
        // LFO modulates output gain (tremolo)
        // Scale: depth controls tremolo intensity (0.5 = 50% volume variation)
        this.lfoGain.gain.value = lfoConfig.depth * 0.5;
        this.lfoGain.connect(this.gainNode.gain);
        break;
      }
    }
  }

  start(
    frequency: number,
    time: number,
    volume: number = 1,
    midiVelocity: number = 90,
  ): void {
    this.noteStartTime = time;
    const sourceGain = 10 ** ((this.params.outputGainDb ?? 0) / 20);
    this.envelopePeak = Math.max(ENVELOPE_PEAK * volume * sourceGain, MIN_GAIN_VALUE);
    this.activeFilterCutoff = velocityFilterCutoff(this.params.filterCutoff, midiVelocity);
    this.filter.frequency.setValueAtTime(this.activeFilterCutoff, time);

    // Set oscillator 1 frequency
    this.oscillator1.frequency.setValueAtTime(frequency, time);

    // Set oscillator 2 frequency with detuning if present
    if (this.oscillator2 && this.params.osc2) {
      // Calculate osc2 frequency: base frequency * coarse adjustment
      const coarseRatio = Math.pow(2, this.params.osc2.coarse / 12);
      const osc2Frequency = frequency * coarseRatio;
      this.oscillator2.frequency.setValueAtTime(osc2Frequency, time);
      // Apply fine detune in cents
      this.oscillator2.detune.setValueAtTime(this.params.osc2.detune, time);
      const layerEnvelope = this.params.osc2.levelEnvelope;
      if (layerEnvelope && this.osc2Gain) {
        const attackEnd = time + Math.max(layerEnvelope.attack, 0.001);
        const decayEnd = attackEnd + Math.max(layerEnvelope.decay, 0.001);
        this.osc2Gain.gain.setValueAtTime(MIN_GAIN_VALUE, time);
        this.osc2Gain.gain.exponentialRampToValueAtTime(Math.max(this.osc2BaseLevel, MIN_GAIN_VALUE), attackEnd);
        this.osc2Gain.gain.exponentialRampToValueAtTime(
          Math.max(this.osc2BaseLevel * layerEnvelope.sustain, MIN_GAIN_VALUE),
          decayEnd,
        );
      }
    }

    // === Amplitude Envelope (ADSR) ===
    // Using exponential ramps for natural sound (human hearing is logarithmic)
    // Volume P-lock scales the envelope peak and sustain levels

    // Attack phase (peak scaled by volume). Presets retain their characterized
    // renderer until migration; authored v2 curves use the normative linear
    // evaluator immediately.
    const scaledPeak = this.envelopePeak;
    if (this.canonicalEnvelope?.model === 'adsr') {
      const attack = Math.max(0, this.canonicalEnvelope.attackSeconds);
      const decay = Math.max(0, this.canonicalEnvelope.decaySeconds ?? 0);
      const sustainLevel = Math.max(
        scaledPeak * Math.min(1, Math.max(0, this.canonicalEnvelope.sustain ?? 1)),
        MIN_GAIN_VALUE,
      );
      this.canonicalStartTime = time;
      this.canonicalPeak = scaledPeak;
      this.gainNode.gain.setValueAtTime(MIN_GAIN_VALUE, time);
      if (attack === 0) this.gainNode.gain.setValueAtTime(scaledPeak, time);
      else this.gainNode.gain.linearRampToValueAtTime(scaledPeak, time + attack);
      if (decay === 0) this.gainNode.gain.setValueAtTime(sustainLevel, time + attack);
      else this.gainNode.gain.linearRampToValueAtTime(sustainLevel, time + attack + decay);
    } else {
      this.gainNode.gain.setValueAtTime(MIN_GAIN_VALUE, time);
      this.gainNode.gain.exponentialRampToValueAtTime(
        scaledPeak,
        time + Math.max(this.params.attack, 0.001)
      );

      // Decay to sustain (sustain also scaled by volume)
      const sustainLevel = Math.max(scaledPeak * this.params.sustain, MIN_GAIN_VALUE);
      this.gainNode.gain.exponentialRampToValueAtTime(
        sustainLevel,
        time + this.params.attack + this.params.decay
      );
    }

    // === Filter Envelope (if configured) ===
    if (this.params.filterEnv) {
      this.applyFilterEnvelope(time, this.activeFilterCutoff);
    }

    // Start oscillators
    this.oscillator1.start(time);
    if (this.oscillator2) {
      this.oscillator2.start(time);
    }
    if (this.lfoOscillator) {
      this.lfoOscillator.start(time);
    }
  }

  /**
   * Apply filter envelope modulation.
   * The envelope controls how the filter cutoff changes over time.
   */
  private applyFilterEnvelope(time: number, baseCutoff: number): void {
    if (!this.params.filterEnv) return;

    const { amount, attack, decay, sustain } = this.params.filterEnv;
    // Calculate target frequencies
    // amount > 0: filter opens (cutoff goes up)
    // amount < 0: filter closes (cutoff goes down)
    const maxCutoff = Math.min(baseCutoff + (amount * baseCutoff * 4), MAX_FILTER_FREQ);
    const sustainCutoff = baseCutoff + (amount * baseCutoff * 4 * sustain);
    const clampedMaxCutoff = Math.max(maxCutoff, MIN_FILTER_FREQ);
    const clampedSustainCutoff = Math.max(Math.min(sustainCutoff, MAX_FILTER_FREQ), MIN_FILTER_FREQ);

    // Apply envelope to filter frequency
    this.filter.frequency.setValueAtTime(baseCutoff, time);
    this.filter.frequency.exponentialRampToValueAtTime(
      clampedMaxCutoff,
      time + Math.max(attack, 0.001)
    );
    this.filter.frequency.exponentialRampToValueAtTime(
      clampedSustainCutoff,
      time + attack + decay
    );
  }

  private exponentialValue(start: number, end: number, progress: number): number {
    if (progress <= 0) return start;
    if (progress >= 1) return end;
    return start * Math.pow(end / start, progress);
  }

  /** Deterministic fallback for engines without cancelAndHoldAtTime(). */
  private amplitudeAt(time: number): number {
    const attack = Math.max(this.params.attack, 0.001);
    const attackEnd = this.noteStartTime + attack;
    if (time <= this.noteStartTime) return MIN_GAIN_VALUE;
    if (time < attackEnd) {
      return this.exponentialValue(
        MIN_GAIN_VALUE,
        this.envelopePeak,
        (time - this.noteStartTime) / attack,
      );
    }

    const sustain = Math.max(this.envelopePeak * this.params.sustain, MIN_GAIN_VALUE);
    if (this.params.decay <= 0) return sustain;
    const decayEnd = attackEnd + this.params.decay;
    if (time < decayEnd) {
      return this.exponentialValue(
        this.envelopePeak,
        sustain,
        (time - attackEnd) / this.params.decay,
      );
    }
    return sustain;
  }

  private filterFrequencyAt(time: number): number {
    const env = this.params.filterEnv;
    if (!env || time <= this.noteStartTime) return this.activeFilterCutoff;
    const base = this.activeFilterCutoff;
    const peak = Math.max(
      Math.min(base + env.amount * base * 4, MAX_FILTER_FREQ),
      MIN_FILTER_FREQ,
    );
    const sustain = Math.max(
      Math.min(base + env.amount * base * 4 * env.sustain, MAX_FILTER_FREQ),
      MIN_FILTER_FREQ,
    );
    const attack = Math.max(env.attack, 0.001);
    const attackEnd = this.noteStartTime + attack;
    if (time < attackEnd) {
      return this.exponentialValue(base, peak, (time - this.noteStartTime) / attack);
    }
    if (env.decay <= 0) return sustain;
    const decayEnd = attackEnd + env.decay;
    if (time < decayEnd) {
      return this.exponentialValue(peak, sustain, (time - attackEnd) / env.decay);
    }
    return sustain;
  }

  private holdAtTime(param: AudioParam, time: number, envelopeValue: number): void {
    // Modern engines can preserve the rendered automation value directly.
    // Keep the analytical path for older Safari/Web Audio implementations and
    // lightweight test/offline contexts that do not expose this method.
    const hold = (param as AudioParam & {
      cancelAndHoldAtTime?: (cancelTime: number) => AudioParam;
    }).cancelAndHoldAtTime;
    if (typeof hold === 'function') {
      try {
        hold.call(param, time);
        // Make the held future value explicit before scheduling release. This
        // composes consistently in browsers and lightweight offline contexts.
        param.cancelScheduledValues(time);
        param.setValueAtTime(envelopeValue, time);
        return;
      } catch {
        // Fall through for older/lightweight Web Audio implementations.
      }
    }
    param.cancelScheduledValues(time);
    if (time > this.noteStartTime) param.exponentialRampToValueAtTime(envelopeValue, time);
    else param.setValueAtTime(envelopeValue, time);
  }

  stop(time: number): void {
    if (this.canonicalEnvelope?.model === 'adsr') {
      const release = Math.max(0, this.canonicalEnvelope.releaseSeconds ?? 0);
      const heldValue = this.canonicalAmplitudeAt(time);
      this.gainNode.gain.cancelScheduledValues(time);
      this.gainNode.gain.setValueAtTime(heldValue, time);
      if (release === 0) this.gainNode.gain.setValueAtTime(MIN_GAIN_VALUE, time);
      else this.gainNode.gain.exponentialRampToValueAtTime(MIN_GAIN_VALUE, time + release);
      const stopTime = time + release + RELEASE_TAIL_GUARD_SEC;
      this.gainNode.gain.linearRampToValueAtTime(0, stopTime);
      this.oscillator1.stop(stopTime);
      this.oscillator2?.stop(stopTime);
      this.lfoOscillator?.stop(stopTime);
      return;
    }
    this.holdAtTime(this.gainNode.gain, time, this.amplitudeAt(time));
    if (this.params.release > 0) {
      this.gainNode.gain.setTargetAtTime(MIN_GAIN_VALUE, time, this.params.release / 4);
    } else {
      this.gainNode.gain.setValueAtTime(MIN_GAIN_VALUE, time);
    }

    // Release phase for filter envelope (return to base cutoff)
    if (this.params.filterEnv) {
      this.holdAtTime(this.filter.frequency, time, this.filterFrequencyAt(time));
      if (this.params.release > 0) {
        this.filter.frequency.setTargetAtTime(
          this.params.filterCutoff,
          time,
          this.params.release / 4
        );
      } else {
        this.filter.frequency.setValueAtTime(this.params.filterCutoff, time);
      }
    }

    // Native release uses setTargetAtTime(release / 4). Stopping after 1.5×
    // the authored release leaves ~0.25% of the held amplitude and documents a
    // stable, bounded tail convention instead of the previous +50ms truncation.
    const stopTime = time + (this.params.release > 0 ? this.params.release * 1.5 : 0.001);

    // Stop all oscillators
    this.oscillator1.stop(stopTime);
    if (this.oscillator2) {
      this.oscillator2.stop(stopTime);
    }
    if (this.lfoOscillator) {
      this.lfoOscillator.stop(stopTime);
    }

  }

  private canonicalAmplitudeAt(time: number): number {
    if (this.canonicalEnvelope?.model !== 'adsr') return MIN_GAIN_VALUE;
    const elapsed = Math.max(0, time - this.canonicalStartTime);
    const attack = Math.max(0, this.canonicalEnvelope.attackSeconds);
    if (attack > 0 && elapsed < attack) {
      const progress = elapsed / attack;
      return MIN_GAIN_VALUE + (this.canonicalPeak - MIN_GAIN_VALUE) * progress;
    }
    const sustain = Math.max(
      MIN_GAIN_VALUE,
      this.canonicalPeak * Math.min(1, Math.max(0, this.canonicalEnvelope.sustain ?? 1)),
    );
    const decay = Math.max(0, this.canonicalEnvelope.decaySeconds ?? 0);
    if (decay > 0 && elapsed < attack + decay) {
      const progress = (elapsed - attack) / decay;
      return Math.max(MIN_GAIN_VALUE, this.canonicalPeak + (sustain - this.canonicalPeak) * progress);
    }
    return sustain;
  }

  /**
   * Disconnect all nodes to allow garbage collection.
   * Memory leak fix: without this, nodes accumulate and are never GC'd.
   */
  private cleanup(): void {
    if (this.isCleanedUp) return;
    this.isCleanedUp = true;

    try {
      this.oscillator1.disconnect();
      this.filter.disconnect();
      this.gainNode.disconnect();

      if (this.oscillator2) {
        this.oscillator2.disconnect();
      }
      if (this.osc1Gain) {
        this.osc1Gain.disconnect();
      }
      if (this.osc2Gain) {
        this.osc2Gain.disconnect();
      }
      if (this.lfoOscillator) {
        this.lfoOscillator.disconnect();
      }
      if (this.lfoGain) {
        this.lfoGain.disconnect();
      }
      if (this.filterEnvGain) {
        this.filterEnvGain.disconnect();
      }
    } catch {
      // Nodes may already be disconnected if stopped multiple times
    }
  }
}

// Singleton instance
export const synthEngine = new SynthEngine();

// HMR cleanup - stops all voices and clears pending timers during development
registerHmrDispose('SynthEngine', () => synthEngine.stopAll());
