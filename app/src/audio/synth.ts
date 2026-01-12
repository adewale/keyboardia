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
import type { WaveformType, LFODestination } from './synth-types';
import { SYNTH_CONSTANTS } from './synth-types';

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

  // === ENHANCED (optional) ===
  osc2?: Osc2Config;       // Second oscillator for layering/detuning
  filterEnv?: FilterEnvConfig;  // Filter envelope modulation
  lfo?: LFOConfig;         // Low frequency oscillator
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
  },
  lead: {
    waveform: 'square',
    filterCutoff: 2500,
    filterResonance: 5,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.8,
    release: 0.3,
  },
  pad: {
    waveform: 'sine',
    filterCutoff: 5000,
    filterResonance: 2,
    attack: 0.05,   // Fast attack for step sequencer; long release creates pad feel
    decay: 0.3,
    sustain: 0.85,
    release: 1.0,
  },
  pluck: {
    waveform: 'triangle',
    filterCutoff: 3500,
    filterResonance: 10,
    attack: 0.005,
    decay: 0.4,
    sustain: 0.15,
    release: 0.25,
  },
  acid: {
    waveform: 'sawtooth',
    filterCutoff: 600,
    filterResonance: 16,
    attack: 0.01,
    decay: 0.15,
    sustain: 0.35,
    release: 0.1,
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
    decay: 0.3,
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
    decay: 0.3,
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
    decay: 0.2,
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
    decay: 0.2,
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
    decay: 0.3,
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

import { logger } from '../utils/logger';
import { registerHmrDispose } from '../utils/hmr';

export class SynthEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices: Map<string, SynthVoice> = new Map();
  private voiceOrder: string[] = []; // Track order for voice stealing
  private pendingCleanups: Set<ReturnType<typeof setTimeout>> = new Set();

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
    destination?: GainNode
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
    const voice = new SynthVoice(this.audioContext, outputNode, params);
    voice.start(frequency, time, volume);
    logger.audio.log(`SynthEngine voice created and started: noteId=${noteId}, preset=${params.waveform}, vol=${volume}, activeVoices=${this.activeVoices.size + 1}`);

    if (duration !== undefined) {
      voice.stop(time + duration);
      // Clean up after release (tracked for stopAll cleanup)
      const cleanupTimer = setTimeout(() => {
        this.pendingCleanups.delete(cleanupTimer);
        this.activeVoices.delete(noteId);
        this.voiceOrder = this.voiceOrder.filter(id => id !== noteId);
      }, (time - this.audioContext.currentTime + duration + params.release) * 1000 + 100);
      this.pendingCleanups.add(cleanupTimer);
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
      // Cancel any pending cleanup timer before stopping
      voice.cancelPendingCleanup();
      voice.stop(now);
    }
    this.activeVoices.clear();
    this.voiceOrder = [];
    // Clear pending cleanup timers to prevent stale state after stop
    for (const timer of this.pendingCleanups) {
      clearTimeout(timer);
    }
    this.pendingCleanups.clear();
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
  private cleanupTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Core nodes (always present)
  private oscillator1: OscillatorNode;
  private filter: BiquadFilterNode;
  private gainNode: GainNode;

  // Optional nodes (created only when needed)
  private oscillator2: OscillatorNode | null = null;
  private osc1Gain: GainNode | null = null;
  private osc2Gain: GainNode | null = null;
  private lfoOscillator: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private filterEnvGain: GainNode | null = null;

  constructor(
    audioContext: AudioContext,
    destination: AudioNode,
    params: SynthParams
  ) {
    this.params = params;
    this.audioContext = audioContext;

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

    // Check if we need dual oscillator
    if (params.osc2) {
      // Create oscillator 2
      this.oscillator2 = audioContext.createOscillator();
      this.oscillator2.type = params.osc2.waveform;

      // Create mixer gains for crossfading
      this.osc1Gain = audioContext.createGain();
      this.osc2Gain = audioContext.createGain();

      // Set mix levels (osc2.mix: 0 = osc1 only, 1 = osc2 only)
      const osc1Level = 1 - params.osc2.mix;
      const osc2Level = params.osc2.mix;
      this.osc1Gain.gain.value = osc1Level;
      this.osc2Gain.gain.value = osc2Level;

      // Connect: osc1 -> osc1Gain -> filter
      //          osc2 -> osc2Gain -> filter
      this.oscillator1.connect(this.osc1Gain);
      this.osc1Gain.connect(this.filter);
      this.oscillator2.connect(this.osc2Gain);
      this.osc2Gain.connect(this.filter);
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

  start(frequency: number, time: number, volume: number = 1): void {
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
    }

    // === Amplitude Envelope (ADSR) ===
    // Using exponential ramps for natural sound (human hearing is logarithmic)
    // Volume P-lock scales the envelope peak and sustain levels

    // Attack phase (peak scaled by volume)
    const scaledPeak = ENVELOPE_PEAK * volume;
    this.gainNode.gain.setValueAtTime(MIN_GAIN_VALUE, time);
    this.gainNode.gain.exponentialRampToValueAtTime(
      Math.max(scaledPeak, MIN_GAIN_VALUE), // Ensure we don't go below min
      time + Math.max(this.params.attack, 0.001)
    );

    // Decay to sustain (sustain also scaled by volume)
    const sustainLevel = Math.max(scaledPeak * this.params.sustain, MIN_GAIN_VALUE);
    this.gainNode.gain.exponentialRampToValueAtTime(
      sustainLevel,
      time + this.params.attack + this.params.decay
    );

    // === Filter Envelope (if configured) ===
    if (this.params.filterEnv) {
      this.applyFilterEnvelope(time);
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
  private applyFilterEnvelope(time: number): void {
    if (!this.params.filterEnv) return;

    const { amount, attack, decay, sustain } = this.params.filterEnv;
    const baseCutoff = this.params.filterCutoff;

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

  stop(time: number): void {
    // Release phase for amplitude envelope
    this.gainNode.gain.cancelScheduledValues(time);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, time);
    this.gainNode.gain.setTargetAtTime(MIN_GAIN_VALUE, time, this.params.release / 4);

    // Release phase for filter envelope (return to base cutoff)
    if (this.params.filterEnv) {
      this.filter.frequency.cancelScheduledValues(time);
      this.filter.frequency.setValueAtTime(this.filter.frequency.value, time);
      this.filter.frequency.setTargetAtTime(
        this.params.filterCutoff,
        time,
        this.params.release / 4
      );
    }

    const stopTime = time + this.params.release + 0.05;

    // Stop all oscillators
    this.oscillator1.stop(stopTime);
    if (this.oscillator2) {
      this.oscillator2.stop(stopTime);
    }
    if (this.lfoOscillator) {
      this.lfoOscillator.stop(stopTime);
    }

    // Schedule cleanup - track the timer so it can be cancelled
    const cleanupDelay = (stopTime - this.audioContext.currentTime) * 1000 + 50;
    this.cleanupTimeoutId = setTimeout(() => {
      this.cleanupTimeoutId = null;
      this.cleanup();
    }, Math.max(cleanupDelay, 0));
  }

  /**
   * Cancel pending cleanup timer.
   * Called when stopAll() is invoked to prevent stale timers.
   */
  cancelPendingCleanup(): void {
    if (this.cleanupTimeoutId) {
      clearTimeout(this.cleanupTimeoutId);
      this.cleanupTimeoutId = null;
    }
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

// Helper to convert MIDI note to frequency
export function midiToFrequency(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

/**
 * Get preset names grouped by category for UI display.
 */
export function getPresetCategories(): Record<string, string[]> {
  // NOTE: Piano is NOT included here - it's a SAMPLED instrument, not a synth.
  // Piano is available via sample-constants.ts as 'synth:piano' which routes to sampled playback.
  return {
    'Core': ['bass', 'lead', 'pad', 'pluck', 'acid'],
    'Funk / Soul': ['funkbass', 'clavinet'],
    'Keys': ['rhodes', 'organ', 'wurlitzer', 'epiano', 'vibes', 'organphase'],
    'Disco': ['discobass', 'strings', 'brass'],
    'House / Techno': ['stab', 'sub'],
    'Atmospheric': ['shimmer', 'jangle', 'dreampop', 'bell', 'evolving', 'sweep', 'warmpad', 'glass'],
    'Electronic': ['supersaw', 'hypersaw', 'wobble', 'growl'],
    'Bass': ['reese', 'hoover'],
  };
}
