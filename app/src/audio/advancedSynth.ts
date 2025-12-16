/**
 * Advanced Synthesis Engine
 *
 * Implements advanced synthesis features from specs/SYNTHESIS-ENGINE.md:
 * - Dual oscillator architecture with detuning
 * - Filter envelope (separate from amplitude envelope)
 * - LFO system for modulation (vibrato, tremolo, filter sweeps)
 *
 * Uses Tone.js components for high-quality audio processing.
 */

import * as Tone from 'tone';
import { logger } from '../utils/logger';
import { C4_FREQUENCY, NOTE_DURATIONS_120BPM } from './constants';

/**
 * Oscillator waveform types
 */
export type WaveformType = 'sine' | 'sawtooth' | 'square' | 'triangle';

/**
 * Oscillator configuration (from spec Section 2.1.1)
 */
export interface OscillatorConfig {
  waveform: WaveformType;
  level: number;           // 0 to 1 (mix level)
  detune: number;          // Cents (-100 to +100)
  coarseDetune: number;    // Semitones (-24 to +24)
}

/**
 * ADSR envelope configuration
 */
export interface ADSREnvelope {
  attack: number;    // 0.001 to 4s
  decay: number;     // 0.001 to 4s
  sustain: number;   // 0 to 1
  release: number;   // 0.001 to 8s
}

/**
 * Filter configuration (from spec Section 2.1.2)
 */
export interface FilterConfig {
  frequency: number;       // 20 to 20000 Hz
  resonance: number;       // 0 to 30 (Q factor)
  type: 'lowpass' | 'highpass' | 'bandpass';
  envelopeAmount: number;  // -1 to 1 (envelope → cutoff)
}

/**
 * LFO configuration (from spec Section 2.1.3)
 */
export interface LFOConfig {
  frequency: number;       // 0.1 to 20 Hz
  waveform: WaveformType;
  destination: 'filter' | 'pitch' | 'amplitude';
  amount: number;          // 0 to 1
  sync: boolean;           // Sync to transport tempo
}

/**
 * Complete advanced synth preset (from spec Section 2.1.4)
 */
export interface AdvancedSynthPreset {
  name: string;
  oscillator1: OscillatorConfig;
  oscillator2: OscillatorConfig;
  amplitudeEnvelope: ADSREnvelope;
  filter: FilterConfig;
  filterEnvelope: ADSREnvelope;
  lfo: LFOConfig;
  noiseLevel: number;      // 0 to 1
}

/**
 * Default oscillator configuration
 */
export const DEFAULT_OSCILLATOR: OscillatorConfig = {
  waveform: 'sawtooth',
  level: 0.5,
  detune: 0,
  coarseDetune: 0,
};

/**
 * Default amplitude envelope (typical pluck/lead)
 */
export const DEFAULT_AMP_ENVELOPE: ADSREnvelope = {
  attack: 0.01,
  decay: 0.3,
  sustain: 0.5,
  release: 0.5,
};

/**
 * Default filter envelope
 */
export const DEFAULT_FILTER_ENVELOPE: ADSREnvelope = {
  attack: 0.01,
  decay: 0.2,
  sustain: 0.4,
  release: 0.5,
};

/**
 * Default filter configuration
 */
export const DEFAULT_FILTER: FilterConfig = {
  frequency: 2000,
  resonance: 1,
  type: 'lowpass',
  envelopeAmount: 0.5,
};

/**
 * Default LFO configuration (subtle vibrato)
 */
export const DEFAULT_LFO: LFOConfig = {
  frequency: 5,
  waveform: 'sine',
  destination: 'pitch',
  amount: 0,
  sync: false,
};

/**
 * Advanced synth presets demonstrating dual oscillator, filter envelope, and LFO
 */
export const ADVANCED_SYNTH_PRESETS: Record<string, AdvancedSynthPreset> = {
  // Detuned supersaw (trance/EDM leads)
  'supersaw': {
    name: 'Supersaw',
    oscillator1: { waveform: 'sawtooth', level: 0.5, detune: -15, coarseDetune: 0 },
    oscillator2: { waveform: 'sawtooth', level: 0.5, detune: 15, coarseDetune: 0 },
    amplitudeEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.5 },
    filter: { frequency: 4000, resonance: 2, type: 'lowpass', envelopeAmount: 0.3 },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.5 },
    lfo: { frequency: 0.5, waveform: 'sine', destination: 'filter', amount: 0.2, sync: false },
    noiseLevel: 0,
  },

  // Sub bass with octave layer
  'sub-bass': {
    name: 'Sub Bass',
    oscillator1: { waveform: 'sine', level: 0.7, detune: 0, coarseDetune: 0 },
    oscillator2: { waveform: 'square', level: 0.3, detune: 0, coarseDetune: -12 },
    amplitudeEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.3 },
    filter: { frequency: 300, resonance: 1, type: 'lowpass', envelopeAmount: 0 },
    filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.3 },
    lfo: { frequency: 0, waveform: 'sine', destination: 'pitch', amount: 0, sync: false },
    noiseLevel: 0,
  },

  // Wobble bass (dubstep-style)
  'wobble-bass': {
    name: 'Wobble Bass',
    oscillator1: { waveform: 'sawtooth', level: 0.6, detune: 0, coarseDetune: 0 },
    oscillator2: { waveform: 'square', level: 0.4, detune: 5, coarseDetune: 0 },
    amplitudeEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.2 },
    filter: { frequency: 800, resonance: 8, type: 'lowpass', envelopeAmount: 0.2 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
    lfo: { frequency: 2, waveform: 'sine', destination: 'filter', amount: 0.8, sync: true },
    noiseLevel: 0,
  },

  // Warm pad with slow filter
  'warm-pad': {
    name: 'Warm Pad',
    oscillator1: { waveform: 'sawtooth', level: 0.4, detune: -10, coarseDetune: 0 },
    oscillator2: { waveform: 'triangle', level: 0.6, detune: 10, coarseDetune: 12 },
    amplitudeEnvelope: { attack: 0.5, decay: 0.3, sustain: 0.8, release: 1.5 },
    filter: { frequency: 1500, resonance: 1, type: 'lowpass', envelopeAmount: 0.4 },
    filterEnvelope: { attack: 0.8, decay: 0.5, sustain: 0.6, release: 1.0 },
    lfo: { frequency: 0.3, waveform: 'triangle', destination: 'filter', amount: 0.15, sync: false },
    noiseLevel: 0.02,
  },

  // Vibrato lead
  'vibrato-lead': {
    name: 'Vibrato Lead',
    oscillator1: { waveform: 'square', level: 0.6, detune: 0, coarseDetune: 0 },
    oscillator2: { waveform: 'sawtooth', level: 0.4, detune: -7, coarseDetune: 0 },
    amplitudeEnvelope: { attack: 0.05, decay: 0.2, sustain: 0.7, release: 0.4 },
    filter: { frequency: 3000, resonance: 2, type: 'lowpass', envelopeAmount: 0.5 },
    filterEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.4 },
    lfo: { frequency: 6, waveform: 'sine', destination: 'pitch', amount: 0.3, sync: false },
    noiseLevel: 0,
  },

  // Tremolo strings
  'tremolo-strings': {
    name: 'Tremolo Strings',
    oscillator1: { waveform: 'sawtooth', level: 0.5, detune: -5, coarseDetune: 0 },
    oscillator2: { waveform: 'sawtooth', level: 0.5, detune: 5, coarseDetune: 0 },
    amplitudeEnvelope: { attack: 0.3, decay: 0.2, sustain: 0.8, release: 0.8 },
    filter: { frequency: 2500, resonance: 0.5, type: 'lowpass', envelopeAmount: 0.2 },
    filterEnvelope: { attack: 0.4, decay: 0.3, sustain: 0.7, release: 0.6 },
    lfo: { frequency: 5, waveform: 'sine', destination: 'amplitude', amount: 0.25, sync: false },
    noiseLevel: 0.01,
  },

  // Acid bass (TB-303 style)
  'acid-bass': {
    name: 'Acid Bass',
    oscillator1: { waveform: 'sawtooth', level: 1.0, detune: 0, coarseDetune: 0 },
    oscillator2: { waveform: 'square', level: 0, detune: 0, coarseDetune: 0 },
    amplitudeEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.2 },
    filter: { frequency: 500, resonance: 15, type: 'lowpass', envelopeAmount: 0.9 },
    filterEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.2 },
    lfo: { frequency: 0, waveform: 'sine', destination: 'filter', amount: 0, sync: false },
    noiseLevel: 0,
  },

  // PWM-style thick lead
  'thick-lead': {
    name: 'Thick Lead',
    oscillator1: { waveform: 'square', level: 0.5, detune: -25, coarseDetune: 0 },
    oscillator2: { waveform: 'square', level: 0.5, detune: 25, coarseDetune: 0 },
    amplitudeEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.4 },
    filter: { frequency: 2500, resonance: 3, type: 'lowpass', envelopeAmount: 0.4 },
    filterEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.3 },
    lfo: { frequency: 4, waveform: 'triangle', destination: 'pitch', amount: 0.1, sync: false },
    noiseLevel: 0,
  },
};

/**
 * Advanced synth preset type
 */
export type AdvancedSynthPresetId = keyof typeof ADVANCED_SYNTH_PRESETS;

/**
 * Convert filter type to Tone.js BiquadFilterType
 */
function toToneFilterType(type: FilterConfig['type']): BiquadFilterType {
  return type;
}

/**
 * AdvancedSynthVoice - Single voice with dual oscillators, filter envelope, and LFO
 *
 * Signal flow:
 * OSC1 → Gain1 ─┐
 *               ├→ Filter → Amp Envelope → Output
 * OSC2 → Gain2 ─┘
 * Noise → Gain ─┘
 *
 * Modulation:
 * Filter Envelope → Filter Frequency
 * LFO → (Filter/Pitch/Amplitude based on config)
 */
export class AdvancedSynthVoice {
  private osc1: Tone.Oscillator | null = null;
  private osc2: Tone.Oscillator | null = null;
  private noise: Tone.Noise | null = null;
  private osc1Gain: Tone.Gain | null = null;
  private osc2Gain: Tone.Gain | null = null;
  private noiseGain: Tone.Gain | null = null;
  private filter: Tone.Filter | null = null;
  private ampEnvelope: Tone.AmplitudeEnvelope | null = null;
  private filterEnvelope: Tone.Envelope | null = null;
  private lfo: Tone.LFO | null = null;
  private output: Tone.Gain | null = null;

  private preset: AdvancedSynthPreset | null = null;
  private active = false;
  private filterEnvScaler: Tone.Multiply | null = null;
  private releaseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private noteStartTime = 0; // Track when note started for voice stealing priority

  /**
   * Initialize the voice with audio nodes
   */
  initialize(): void {
    if (this.output) return; // Already initialized

    // Create oscillators
    this.osc1 = new Tone.Oscillator({ type: 'sawtooth', frequency: 440 });
    this.osc2 = new Tone.Oscillator({ type: 'sawtooth', frequency: 440 });
    this.noise = new Tone.Noise('white');

    // Create gain nodes for mixing
    this.osc1Gain = new Tone.Gain(0.5);
    this.osc2Gain = new Tone.Gain(0.5);
    this.noiseGain = new Tone.Gain(0);

    // Create filter
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: 2000,
      Q: 1,
    });

    // Create amplitude envelope
    this.ampEnvelope = new Tone.AmplitudeEnvelope({
      attack: 0.01,
      decay: 0.2,
      sustain: 0.5,
      release: 0.5,
    });

    // Create filter envelope
    this.filterEnvelope = new Tone.Envelope({
      attack: 0.01,
      decay: 0.2,
      sustain: 0.4,
      release: 0.5,
    });

    // Create filter envelope scaler (for envelope amount)
    this.filterEnvScaler = new Tone.Multiply(1000);

    // Create LFO
    this.lfo = new Tone.LFO({
      frequency: 5,
      type: 'sine',
      min: -1,
      max: 1,
    });

    // Create output gain (0.5 for balanced volume with other engines)
    this.output = new Tone.Gain(0.5);

    // Connect signal flow
    // Oscillators → Gains → Filter → Amp Envelope → Output
    this.osc1.connect(this.osc1Gain);
    this.osc2.connect(this.osc2Gain);
    this.noise.connect(this.noiseGain);

    this.osc1Gain.connect(this.filter);
    this.osc2Gain.connect(this.filter);
    this.noiseGain.connect(this.filter);

    this.filter.connect(this.ampEnvelope);
    this.ampEnvelope.connect(this.output);

    // Connect filter envelope to filter frequency via scaler
    this.filterEnvelope.connect(this.filterEnvScaler);
    this.filterEnvScaler.connect(this.filter.frequency);

    logger.audio.log('AdvancedSynthVoice initialized');
  }

  /**
   * Get the output node
   */
  getOutput(): Tone.Gain | null {
    return this.output;
  }

  /**
   * Apply a preset to this voice
   */
  applyPreset(preset: AdvancedSynthPreset): void {
    this.preset = preset;

    if (!this.osc1 || !this.osc2 || !this.filter || !this.ampEnvelope || !this.filterEnvelope || !this.lfo) {
      logger.audio.warn('Voice not initialized');
      return;
    }

    // Apply oscillator 1 settings
    this.osc1.type = preset.oscillator1.waveform;
    this.osc1.detune.value = preset.oscillator1.detune + (preset.oscillator1.coarseDetune * 100);
    if (this.osc1Gain) {
      this.osc1Gain.gain.value = preset.oscillator1.level;
    }

    // Apply oscillator 2 settings
    this.osc2.type = preset.oscillator2.waveform;
    this.osc2.detune.value = preset.oscillator2.detune + (preset.oscillator2.coarseDetune * 100);
    if (this.osc2Gain) {
      this.osc2Gain.gain.value = preset.oscillator2.level;
    }

    // Apply noise level
    if (this.noiseGain) {
      this.noiseGain.gain.value = preset.noiseLevel;
    }

    // Apply filter settings
    this.filter.type = toToneFilterType(preset.filter.type);
    this.filter.frequency.value = preset.filter.frequency;
    this.filter.Q.value = preset.filter.resonance;

    // Apply amplitude envelope
    this.ampEnvelope.attack = preset.amplitudeEnvelope.attack;
    this.ampEnvelope.decay = preset.amplitudeEnvelope.decay;
    this.ampEnvelope.sustain = preset.amplitudeEnvelope.sustain;
    this.ampEnvelope.release = preset.amplitudeEnvelope.release;

    // Apply filter envelope
    this.filterEnvelope.attack = preset.filterEnvelope.attack;
    this.filterEnvelope.decay = preset.filterEnvelope.decay;
    this.filterEnvelope.sustain = preset.filterEnvelope.sustain;
    this.filterEnvelope.release = preset.filterEnvelope.release;

    // Apply filter envelope amount (scale in Hz)
    if (this.filterEnvScaler) {
      this.filterEnvScaler.value = preset.filter.envelopeAmount * 5000; // Scale to Hz range
    }

    // Apply LFO settings
    this.lfo.frequency.value = preset.lfo.frequency;
    this.lfo.type = preset.lfo.waveform;

    // Disconnect and reconnect LFO based on destination
    this.lfo.disconnect();

    if (preset.lfo.amount > 0) {
      const lfoAmount = preset.lfo.amount;

      switch (preset.lfo.destination) {
        case 'filter':
          // LFO modulates filter cutoff
          this.lfo.min = -lfoAmount * 2000;
          this.lfo.max = lfoAmount * 2000;
          this.lfo.connect(this.filter.frequency);
          break;
        case 'pitch':
          // LFO modulates pitch (vibrato) - modulate both oscillators
          this.lfo.min = -lfoAmount * 100; // cents
          this.lfo.max = lfoAmount * 100;
          this.lfo.connect(this.osc1.detune);
          this.lfo.connect(this.osc2.detune);
          break;
        case 'amplitude':
          // LFO modulates amplitude (tremolo)
          this.lfo.min = 1 - lfoAmount;
          this.lfo.max = 1;
          if (this.output) {
            this.lfo.connect(this.output.gain);
          }
          break;
      }
    }
  }

  /**
   * Trigger note on
   */
  triggerAttack(frequency: number, time?: number): void {
    if (!this.osc1 || !this.osc2 || !this.ampEnvelope || !this.filterEnvelope || !this.noise || !this.lfo) {
      return;
    }

    // Clear any pending release timeout
    if (this.releaseTimeoutId) {
      clearTimeout(this.releaseTimeoutId);
      this.releaseTimeoutId = null;
    }

    this.noteStartTime = Date.now();

    // Set oscillator frequencies
    this.osc1.frequency.value = frequency;
    this.osc2.frequency.value = frequency;

    // Start oscillators if not running
    if (!this.active) {
      this.osc1.start(time);
      this.osc2.start(time);
      if (this.preset && this.preset.noiseLevel > 0) {
        this.noise.start(time);
      }
      this.lfo.start(time);
      this.active = true;
    }

    // Trigger envelopes
    this.ampEnvelope.triggerAttack(time);
    this.filterEnvelope.triggerAttack(time);
  }

  /**
   * Trigger note off
   */
  triggerRelease(time?: number): void {
    if (!this.ampEnvelope || !this.filterEnvelope) return;

    this.ampEnvelope.triggerRelease(time);
    this.filterEnvelope.triggerRelease(time);
  }

  /**
   * Trigger attack and release with duration
   */
  triggerAttackRelease(frequency: number, duration: number | string, time?: number): void {
    if (!this.osc1 || !this.osc2 || !this.ampEnvelope || !this.filterEnvelope || !this.noise || !this.lfo) {
      logger.audio.warn('Voice triggerAttackRelease: nodes not initialized');
      return;
    }

    logger.audio.log(`Voice triggering: freq=${frequency.toFixed(1)}Hz, wasActive=${this.active}, time=${time?.toFixed(3) ?? 'undefined'}`);

    // Clear any pending release timeout
    if (this.releaseTimeoutId) {
      clearTimeout(this.releaseTimeoutId);
      this.releaseTimeoutId = null;
    }

    this.noteStartTime = Date.now();

    // Set oscillator frequencies
    this.osc1.frequency.value = frequency;
    this.osc2.frequency.value = frequency;

    // Start oscillators if not running
    if (!this.active) {
      this.osc1.start(time);
      this.osc2.start(time);
      if (this.preset && this.preset.noiseLevel > 0) {
        this.noise.start(time);
      }
      this.lfo.start(time);
      this.active = true;
    }

    // Trigger envelopes
    this.ampEnvelope.triggerAttackRelease(duration, time);
    this.filterEnvelope.triggerAttackRelease(duration, time);

    // Schedule voice to become inactive after duration + release
    // Convert duration to seconds if it's a string notation
    let durationSec: number;
    if (typeof duration === 'string') {
      durationSec = NOTE_DURATIONS_120BPM[duration] || 0.25;
    } else {
      durationSec = duration;
    }

    const releaseTime = this.preset?.amplitudeEnvelope.release || 0.5;
    const totalTime = (durationSec + releaseTime) * 1000 + 50; // +50ms buffer

    this.releaseTimeoutId = setTimeout(() => {
      this.active = false;
      this.releaseTimeoutId = null;
    }, totalTime);
  }

  /**
   * Check if voice is active
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Get note start time for voice stealing priority (older notes get stolen first)
   */
  getNoteStartTime(): number {
    return this.noteStartTime;
  }

  /**
   * Dispose voice resources
   */
  dispose(): void {
    // Clear pending release timeout
    if (this.releaseTimeoutId) {
      clearTimeout(this.releaseTimeoutId);
      this.releaseTimeoutId = null;
    }

    this.osc1?.stop();
    this.osc2?.stop();
    this.noise?.stop();
    this.lfo?.stop();

    this.osc1?.dispose();
    this.osc2?.dispose();
    this.noise?.dispose();
    this.osc1Gain?.dispose();
    this.osc2Gain?.dispose();
    this.noiseGain?.dispose();
    this.filter?.dispose();
    this.ampEnvelope?.dispose();
    this.filterEnvelope?.dispose();
    this.filterEnvScaler?.dispose();
    this.lfo?.dispose();
    this.output?.dispose();

    this.osc1 = null;
    this.osc2 = null;
    this.noise = null;
    this.osc1Gain = null;
    this.osc2Gain = null;
    this.noiseGain = null;
    this.filter = null;
    this.ampEnvelope = null;
    this.filterEnvelope = null;
    this.filterEnvScaler = null;
    this.lfo = null;
    this.output = null;
    this.active = false;
    this.noteStartTime = 0;

    logger.audio.log('AdvancedSynthVoice disposed');
  }
}

/**
 * AdvancedSynthEngine - Polyphonic advanced synth with voice management
 *
 * Features:
 * - 8 voice polyphony
 * - Voice stealing (oldest note first)
 * - Preset management
 * - Semitone to frequency conversion
 */
export class AdvancedSynthEngine {
  private voices: AdvancedSynthVoice[] = [];
  private output: Tone.Gain | null = null;
  private currentPreset: AdvancedSynthPreset | null = null;
  private ready = false;
  // Track last scheduled time to prevent "time must be greater than previous" errors
  private lastScheduledTime = 0;

  private static readonly MAX_VOICES = 8;

  /**
   * Initialize the synth engine
   */
  async initialize(): Promise<void> {
    if (this.ready) return;

    logger.audio.log('Initializing AdvancedSynthEngine...');

    // Create output gain
    this.output = new Tone.Gain(0.7);

    // Create voice pool
    for (let i = 0; i < AdvancedSynthEngine.MAX_VOICES; i++) {
      const voice = new AdvancedSynthVoice();
      voice.initialize();
      const voiceOutput = voice.getOutput();
      if (voiceOutput && this.output) {
        voiceOutput.connect(this.output);
      }
      this.voices.push(voice);
    }

    // Apply default preset
    this.setPreset('supersaw');

    this.ready = true;
    logger.audio.log('AdvancedSynthEngine initialized with', this.voices.length, 'voices');
  }

  /**
   * Get the output node
   */
  getOutput(): Tone.Gain | null {
    return this.output;
  }

  /**
   * Check if engine is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Set the current preset
   */
  setPreset(presetId: string): void {
    const preset = ADVANCED_SYNTH_PRESETS[presetId];
    if (!preset) {
      logger.audio.warn(`Unknown preset: ${presetId}`);
      return;
    }

    this.currentPreset = preset;

    // Apply preset to all voices
    for (const voice of this.voices) {
      voice.applyPreset(preset);
    }

    logger.audio.log(`Applied preset: ${preset.name}`);
  }

  /**
   * Get available preset names
   */
  getPresetNames(): string[] {
    return Object.keys(ADVANCED_SYNTH_PRESETS);
  }

  /**
   * Get current preset
   */
  getCurrentPreset(): AdvancedSynthPreset | null {
    return this.currentPreset;
  }

  /**
   * Get a free voice (or steal the oldest one)
   */
  private allocateVoice(): AdvancedSynthVoice | null {
    // First try to find an inactive voice
    for (const voice of this.voices) {
      if (!voice.isActive()) {
        return voice;
      }
    }

    // If all voices are active, steal the oldest one (earliest noteStartTime)
    let oldestVoice = this.voices[0];
    let oldestTime = oldestVoice?.getNoteStartTime() ?? Infinity;

    for (const voice of this.voices) {
      const startTime = voice.getNoteStartTime();
      if (startTime < oldestTime) {
        oldestTime = startTime;
        oldestVoice = voice;
      }
    }

    return oldestVoice || null;
  }

  /**
   * Play a note by semitone offset from C4
   */
  playNoteSemitone(
    semitone: number,
    duration: number | string,
    time?: number
  ): void {
    const frequency = this.semitoneToFrequency(semitone);
    this.playNoteFrequency(frequency, duration, time);
  }

  /**
   * Play a note by frequency
   */
  playNoteFrequency(
    frequency: number,
    duration: number | string,
    time?: number
  ): void {
    if (!this.ready) {
      logger.audio.warn('AdvancedSynthEngine not ready');
      return;
    }

    const voice = this.allocateVoice();
    if (!voice) {
      logger.audio.warn('AdvancedSynthEngine: no voice available');
      return;
    }

    // Apply current preset
    if (this.currentPreset) {
      voice.applyPreset(this.currentPreset);
    }

    // Phase 22: Ensure time is always positive and in the future
    // The scheduler passes a relative offset from now, but it can be 0 or negative
    // if audio context time advanced between calculation and playback.
    const safeTime = Math.max(0.001, time ?? 0);
    let startTime = Tone.now() + safeTime;

    // Ensure startTime is strictly greater than the last scheduled time
    // This prevents "time must be greater than previous" errors during BPM changes
    if (startTime <= this.lastScheduledTime) {
      startTime = this.lastScheduledTime + 0.001;
    }
    this.lastScheduledTime = startTime;

    logger.audio.log(`AdvancedSynth playing: freq=${frequency.toFixed(1)}Hz, duration=${duration}, time=${startTime.toFixed(3)}, preset=${this.currentPreset?.name}`);

    // Use try-catch to handle cases where Tone.js internal state rejects the time
    // This can happen during rapid BPM changes
    try {
      voice.triggerAttackRelease(frequency, duration, startTime);
    } catch (_err) {
      // If Tone.js rejects the time, retry with current time + buffer
      const retryTime = Tone.now() + 0.01;
      this.lastScheduledTime = retryTime;
      logger.audio.warn(`AdvancedSynth timing retry: original=${startTime.toFixed(3)}, retry=${retryTime.toFixed(3)}`);
      try {
        voice.triggerAttackRelease(frequency, duration, retryTime);
      } catch (retryErr) {
        logger.audio.error('AdvancedSynth timing error - note skipped:', retryErr);
      }
    }
  }

  /**
   * Play a note by note name (e.g., "C4", "F#5")
   */
  playNote(
    note: string,
    duration: number | string,
    time?: number
  ): void {
    const frequency = Tone.Frequency(note).toFrequency();
    this.playNoteFrequency(frequency, duration, time);
  }

  /**
   * Convert semitone offset from C4 to frequency
   */
  semitoneToFrequency(semitone: number): number {
    return C4_FREQUENCY * Math.pow(2, semitone / 12);
  }

  /**
   * Dispose engine resources
   */
  dispose(): void {
    if (!this.ready) return;

    logger.audio.log('Disposing AdvancedSynthEngine...');

    for (const voice of this.voices) {
      voice.dispose();
    }
    this.voices = [];

    this.output?.dispose();
    this.output = null;

    this.ready = false;
    this.currentPreset = null;

    logger.audio.log('AdvancedSynthEngine disposed');
  }
}

// Singleton instance
let advancedSynthInstance: AdvancedSynthEngine | null = null;

/**
 * Get the singleton advanced synth engine instance
 */
export function getAdvancedSynthEngine(): AdvancedSynthEngine {
  if (!advancedSynthInstance) {
    advancedSynthInstance = new AdvancedSynthEngine();
  }
  return advancedSynthInstance;
}

/**
 * Check if a sample ID is an advanced synth
 * Format: "advanced:{preset}" e.g., "advanced:supersaw"
 */
export function isAdvancedSynth(sampleId: string): boolean {
  return sampleId.startsWith('advanced:');
}

/**
 * Extract the preset name from an advanced synth sample ID
 */
export function getAdvancedSynthPresetId(sampleId: string): string | null {
  if (!isAdvancedSynth(sampleId)) return null;
  const presetId = sampleId.replace('advanced:', '');
  return ADVANCED_SYNTH_PRESETS[presetId] ? presetId : null;
}
