/**
 * Advanced Synthesis Engine for Keyboardia
 *
 * Features:
 * - Dual oscillators with independent waveforms and detune
 * - LFO with multiple destinations (filter, pitch, amplitude)
 * - Separate filter envelope (ADSR)
 * - White noise oscillator
 * - Polyphonic voice management
 *
 * Architecture inspired by Ableton Learning Synths and classic analog synths.
 */

export type WaveformType = 'sine' | 'triangle' | 'sawtooth' | 'square';

/**
 * Oscillator configuration for dual-oscillator setup.
 */
export interface OscillatorConfig {
  waveform: WaveformType;
  level: number; // 0 to 1 - volume of this oscillator
  detuneCents: number; // -100 to +100 cents (fine tuning)
  detuneCoarse: number; // -24 to +24 semitones (octave/interval shifts)
}

/**
 * ADSR envelope configuration.
 */
export interface ADSREnvelope {
  attack: number; // 0.001 to 2 seconds
  decay: number; // 0.001 to 2 seconds
  sustain: number; // 0 to 1 amplitude
  release: number; // 0.001 to 4 seconds
}

/**
 * LFO (Low Frequency Oscillator) configuration.
 */
export interface LFOConfig {
  rate: number; // 0.1 to 20 Hz
  waveform: WaveformType;
  destination: 'filter' | 'pitch' | 'amplitude' | 'none';
  amount: number; // 0 to 1 (modulation depth)
  sync: boolean; // Sync to tempo (future feature)
}

/**
 * Filter configuration with envelope modulation.
 */
export interface FilterConfig {
  type: 'lowpass' | 'highpass' | 'bandpass';
  frequency: number; // 20 to 20000 Hz
  resonance: number; // 0 to 30 (Q factor)
  envelopeAmount: number; // -1 to 1 (how much envelope modulates cutoff)
  keyTracking: number; // 0 to 1 (how much pitch affects cutoff)
}

/**
 * Complete advanced synth preset.
 */
export interface AdvancedSynthParams {
  name?: string;
  // Oscillators
  oscillator1: OscillatorConfig;
  oscillator2: OscillatorConfig;
  oscillatorMix: number; // 0 to 1 (0 = osc1 only, 1 = osc2 only, 0.5 = equal)
  noise: number; // 0 to 1 (noise level)
  // Envelopes
  amplitudeEnvelope: ADSREnvelope;
  filterEnvelope: ADSREnvelope;
  // Filter
  filter: FilterConfig;
  // LFO
  lfo: LFOConfig;
  // Master
  masterVolume: number; // 0 to 1
}

/**
 * Create default advanced synth parameters.
 */
export function createDefaultAdvancedParams(): AdvancedSynthParams {
  return {
    oscillator1: {
      waveform: 'sawtooth',
      level: 1,
      detuneCents: 0,
      detuneCoarse: 0,
    },
    oscillator2: {
      waveform: 'sawtooth',
      level: 1,
      detuneCents: 7, // Slight detune for thickness
      detuneCoarse: 0,
    },
    oscillatorMix: 0.5,
    noise: 0,
    amplitudeEnvelope: {
      attack: 0.01,
      decay: 0.2,
      sustain: 0.5,
      release: 0.3,
    },
    filterEnvelope: {
      attack: 0.01,
      decay: 0.3,
      sustain: 0.3,
      release: 0.5,
    },
    filter: {
      type: 'lowpass',
      frequency: 2000,
      resonance: 4,
      envelopeAmount: 0.5,
      keyTracking: 0.5,
    },
    lfo: {
      rate: 2,
      waveform: 'sine',
      destination: 'none',
      amount: 0,
      sync: false,
    },
    masterVolume: 0.7,
  };
}

/**
 * A single voice in the advanced synth.
 * Each voice handles one note with full synthesis chain.
 */
class AdvancedSynthVoice {
  private audioContext: AudioContext;
  private params: AdvancedSynthParams;
  private baseFrequency: number;
  private startTime: number;

  // Oscillators
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;

  // Gains
  private osc1Gain: GainNode;
  private osc2Gain: GainNode;
  private noiseGain: GainNode;
  private mixerGain: GainNode;
  private ampEnvGain: GainNode;
  private masterGain: GainNode;

  // Filter
  private filter: BiquadFilterNode;
  private filterEnvGain: GainNode;

  // LFO
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode;

  private isReleased = false;
  private releaseEndTime = 0;

  constructor(
    audioContext: AudioContext,
    destination: AudioNode,
    params: AdvancedSynthParams
  ) {
    this.audioContext = audioContext;
    this.params = params;
    this.baseFrequency = 440;
    this.startTime = 0;

    // Create audio nodes
    this.osc1Gain = audioContext.createGain();
    this.osc2Gain = audioContext.createGain();
    this.noiseGain = audioContext.createGain();
    this.mixerGain = audioContext.createGain();
    this.ampEnvGain = audioContext.createGain();
    this.masterGain = audioContext.createGain();
    this.filter = audioContext.createBiquadFilter();
    this.filterEnvGain = audioContext.createGain();
    this.lfoGain = audioContext.createGain();

    // Connect audio chain: oscs -> mixer -> filter -> ampEnv -> master -> destination
    this.osc1Gain.connect(this.mixerGain);
    this.osc2Gain.connect(this.mixerGain);
    this.noiseGain.connect(this.mixerGain);
    this.mixerGain.connect(this.filter);
    this.filter.connect(this.ampEnvGain);
    this.ampEnvGain.connect(this.masterGain);
    this.masterGain.connect(destination);

    // Set up filter
    this.filter.type = params.filter.type;
    this.filter.Q.value = params.filter.resonance;

    // Set master volume
    this.masterGain.gain.value = params.masterVolume;
  }

  /**
   * Start playing a note.
   */
  start(frequency: number, time: number): void {
    this.baseFrequency = frequency;
    this.startTime = time;
    this.isReleased = false;

    const params = this.params;
    const ctx = this.audioContext;

    // Calculate oscillator frequencies with detuning
    const freq1 = this.calculateOscFrequency(frequency, params.oscillator1);
    const freq2 = this.calculateOscFrequency(frequency, params.oscillator2);

    // Create and configure oscillator 1
    this.osc1 = ctx.createOscillator();
    this.osc1.type = params.oscillator1.waveform;
    this.osc1.frequency.setValueAtTime(freq1, time);
    this.osc1.connect(this.osc1Gain);

    // Create and configure oscillator 2
    this.osc2 = ctx.createOscillator();
    this.osc2.type = params.oscillator2.waveform;
    this.osc2.frequency.setValueAtTime(freq2, time);
    this.osc2.connect(this.osc2Gain);

    // Set oscillator mix
    const mix = params.oscillatorMix;
    this.osc1Gain.gain.setValueAtTime(params.oscillator1.level * (1 - mix), time);
    this.osc2Gain.gain.setValueAtTime(params.oscillator2.level * mix, time);

    // Create noise if needed
    if (params.noise > 0) {
      this.noiseSource = this.createNoiseSource();
      this.noiseSource.connect(this.noiseGain);
      this.noiseGain.gain.setValueAtTime(params.noise * 0.5, time);
      this.noiseSource.start(time);
    }

    // Set up filter with key tracking
    const filterFreq = this.calculateFilterFrequency(frequency, params);
    this.filter.frequency.setValueAtTime(filterFreq, time);

    // Apply amplitude envelope
    this.applyAmplitudeEnvelope(time, params.amplitudeEnvelope);

    // Apply filter envelope
    this.applyFilterEnvelope(time, filterFreq, params);

    // Set up LFO if enabled
    if (params.lfo.destination !== 'none' && params.lfo.amount > 0) {
      this.setupLFO(time, frequency, params);
    }

    // Start oscillators
    this.osc1.start(time);
    this.osc2.start(time);
  }

  /**
   * Release the note (trigger release phase of envelopes).
   */
  stop(time: number): void {
    if (this.isReleased) return;
    this.isReleased = true;

    const params = this.params;
    const releaseTime = params.amplitudeEnvelope.release;

    // Cancel scheduled values and apply release
    this.ampEnvGain.gain.cancelScheduledValues(time);
    this.ampEnvGain.gain.setValueAtTime(this.ampEnvGain.gain.value, time);
    this.ampEnvGain.gain.linearRampToValueAtTime(0, time + releaseTime);

    // Filter release
    this.filter.frequency.cancelScheduledValues(time);
    const currentFilterFreq = this.filter.frequency.value;
    const baseFilterFreq = params.filter.frequency;
    this.filter.frequency.setValueAtTime(currentFilterFreq, time);
    this.filter.frequency.linearRampToValueAtTime(
      baseFilterFreq,
      time + params.filterEnvelope.release
    );

    // Schedule stop
    this.releaseEndTime = time + releaseTime + 0.1;
    this.osc1?.stop(this.releaseEndTime);
    this.osc2?.stop(this.releaseEndTime);
    this.noiseSource?.stop(this.releaseEndTime);
    this.lfo?.stop(this.releaseEndTime);
  }

  /**
   * Check if voice has finished playing.
   */
  isFinished(): boolean {
    return this.isReleased && this.audioContext.currentTime >= this.releaseEndTime;
  }

  /**
   * Forcefully disconnect all nodes.
   */
  disconnect(): void {
    try {
      this.osc1?.disconnect();
      this.osc2?.disconnect();
      this.noiseSource?.disconnect();
      this.lfo?.disconnect();
      this.osc1Gain.disconnect();
      this.osc2Gain.disconnect();
      this.noiseGain.disconnect();
      this.mixerGain.disconnect();
      this.filter.disconnect();
      this.ampEnvGain.disconnect();
      this.masterGain.disconnect();
      this.lfoGain.disconnect();
    } catch {
      // Ignore disconnection errors
    }
  }

  private calculateOscFrequency(baseFreq: number, osc: OscillatorConfig): number {
    // Apply coarse detune (semitones)
    let freq = baseFreq * Math.pow(2, osc.detuneCoarse / 12);
    // Apply fine detune (cents)
    freq *= Math.pow(2, osc.detuneCents / 1200);
    return freq;
  }

  private calculateFilterFrequency(noteFreq: number, params: AdvancedSynthParams): number {
    const baseFreq = params.filter.frequency;
    // Apply key tracking: higher notes = higher filter frequency
    const keyTrackingAmount = (noteFreq / 440) * params.filter.keyTracking;
    return Math.min(20000, baseFreq * (1 + keyTrackingAmount));
  }

  private applyAmplitudeEnvelope(time: number, env: ADSREnvelope): void {
    const gain = this.ampEnvGain.gain;

    // Start at 0
    gain.setValueAtTime(0, time);

    // Attack
    gain.linearRampToValueAtTime(1, time + env.attack);

    // Decay to sustain
    gain.linearRampToValueAtTime(env.sustain, time + env.attack + env.decay);

    // Sustain holds until stop() is called
  }

  private applyFilterEnvelope(
    time: number,
    baseFreq: number,
    params: AdvancedSynthParams
  ): void {
    const filter = this.filter.frequency;
    const env = params.filterEnvelope;
    const amount = params.filter.envelopeAmount;

    // Calculate envelope range
    const envRange = baseFreq * 4; // Envelope can sweep up to 4x base frequency
    const peakFreq = Math.min(20000, baseFreq + envRange * amount);
    const sustainFreq = baseFreq + (peakFreq - baseFreq) * env.sustain;

    // Start at base frequency
    filter.setValueAtTime(baseFreq, time);

    // Attack to peak
    if (amount > 0) {
      filter.exponentialRampToValueAtTime(Math.max(20, peakFreq), time + env.attack);
    }

    // Decay to sustain level
    filter.exponentialRampToValueAtTime(
      Math.max(20, sustainFreq),
      time + env.attack + env.decay
    );
  }

  private setupLFO(time: number, noteFreq: number, params: AdvancedSynthParams): void {
    const ctx = this.audioContext;
    const lfoConfig = params.lfo;

    this.lfo = ctx.createOscillator();
    this.lfo.type = lfoConfig.waveform;
    this.lfo.frequency.setValueAtTime(lfoConfig.rate, time);
    this.lfo.connect(this.lfoGain);

    // Route LFO based on destination
    switch (lfoConfig.destination) {
      case 'filter':
        // Modulate filter cutoff
        this.lfoGain.gain.setValueAtTime(
          params.filter.frequency * lfoConfig.amount,
          time
        );
        this.lfoGain.connect(this.filter.frequency);
        break;

      case 'pitch':
        // Modulate oscillator pitch (vibrato)
        const pitchModAmount = noteFreq * 0.05 * lfoConfig.amount; // Up to 5% pitch variation
        this.lfoGain.gain.setValueAtTime(pitchModAmount, time);
        if (this.osc1) this.lfoGain.connect(this.osc1.frequency);
        if (this.osc2) this.lfoGain.connect(this.osc2.frequency);
        break;

      case 'amplitude':
        // Modulate amplitude (tremolo)
        this.lfoGain.gain.setValueAtTime(lfoConfig.amount * 0.5, time);
        this.lfoGain.connect(this.ampEnvGain.gain);
        // Offset the tremolo so it modulates around the envelope value
        this.mixerGain.gain.setValueAtTime(1 - lfoConfig.amount * 0.25, time);
        break;
    }

    this.lfo.start(time);
  }

  private createNoiseSource(): AudioBufferSourceNode {
    const ctx = this.audioContext;
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }
}

/**
 * Advanced Synth Engine with voice management.
 */
export class AdvancedSynthEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices: Map<string, AdvancedSynthVoice> = new Map();
  private cleanupInterval: number | null = null;

  initialize(audioContext: AudioContext, masterGain: GainNode): void {
    this.audioContext = audioContext;
    this.masterGain = masterGain;

    // Set up periodic cleanup of finished voices
    this.cleanupInterval = window.setInterval(() => {
      this.cleanupFinishedVoices();
    }, 500);
  }

  /**
   * Play a note with advanced synthesis.
   */
  playNote(
    noteId: string,
    frequency: number,
    params: AdvancedSynthParams,
    time: number,
    duration?: number
  ): void {
    if (!this.audioContext || !this.masterGain) return;

    // Stop any existing voice with this ID
    this.stopNote(noteId);

    const voice = new AdvancedSynthVoice(
      this.audioContext,
      this.masterGain,
      params
    );
    voice.start(frequency, time);

    if (duration !== undefined) {
      voice.stop(time + duration);
    }

    this.activeVoices.set(noteId, voice);
  }

  /**
   * Stop a note by ID.
   */
  stopNote(noteId: string): void {
    const voice = this.activeVoices.get(noteId);
    if (voice && this.audioContext) {
      voice.stop(this.audioContext.currentTime);
    }
  }

  /**
   * Stop all active notes.
   */
  stopAll(): void {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    for (const voice of this.activeVoices.values()) {
      voice.stop(now);
    }
  }

  private cleanupFinishedVoices(): void {
    for (const [id, voice] of this.activeVoices.entries()) {
      if (voice.isFinished()) {
        voice.disconnect();
        this.activeVoices.delete(id);
      }
    }
  }

  dispose(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.stopAll();
    for (const voice of this.activeVoices.values()) {
      voice.disconnect();
    }
    this.activeVoices.clear();
  }
}

// Singleton instance
export const advancedSynthEngine = new AdvancedSynthEngine();

// Helper to convert semitone offset from A4 (440Hz) to frequency
export function semitoneToFrequency(semitone: number, baseFrequency: number = 440): number {
  return baseFrequency * Math.pow(2, semitone / 12);
}

/**
 * Advanced Synth Presets
 *
 * Organized by musical style and character.
 * Each preset showcases different synthesis techniques.
 */
export const ADVANCED_SYNTH_PRESETS: Record<string, AdvancedSynthParams> = {
  // === SUPERSAW / TRANCE ===
  supersaw: {
    name: 'Supersaw',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: -12, detuneCoarse: 0 },
    oscillator2: { waveform: 'sawtooth', level: 1, detuneCents: 12, detuneCoarse: 0 },
    oscillatorMix: 0.5,
    noise: 0,
    amplitudeEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.5 },
    filterEnvelope: { attack: 0.01, decay: 0.4, sustain: 0.4, release: 0.6 },
    filter: { type: 'lowpass', frequency: 3000, resonance: 2, envelopeAmount: 0.3, keyTracking: 0.3 },
    lfo: { rate: 0.3, waveform: 'sine', destination: 'filter', amount: 0.1, sync: false },
    masterVolume: 0.6,
  },

  // === BASS ===
  fatbass: {
    name: 'Fat Bass',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: -5, detuneCoarse: 0 },
    oscillator2: { waveform: 'square', level: 0.8, detuneCents: 5, detuneCoarse: -12 },
    oscillatorMix: 0.4,
    noise: 0,
    amplitudeEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.1 },
    filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.15 },
    filter: { type: 'lowpass', frequency: 800, resonance: 6, envelopeAmount: 0.6, keyTracking: 0.2 },
    lfo: { rate: 0, waveform: 'sine', destination: 'none', amount: 0, sync: false },
    masterVolume: 0.8,
  },

  wobblebass: {
    name: 'Wobble Bass',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'square', level: 0.7, detuneCents: 0, detuneCoarse: -12 },
    oscillatorMix: 0.35,
    noise: 0,
    amplitudeEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.15 },
    filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 },
    filter: { type: 'lowpass', frequency: 400, resonance: 12, envelopeAmount: 0.3, keyTracking: 0.1 },
    lfo: { rate: 4, waveform: 'sine', destination: 'filter', amount: 0.7, sync: false },
    masterVolume: 0.75,
  },

  reesebass: {
    name: 'Reese Bass',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: -15, detuneCoarse: 0 },
    oscillator2: { waveform: 'sawtooth', level: 1, detuneCents: 15, detuneCoarse: 0 },
    oscillatorMix: 0.5,
    noise: 0,
    amplitudeEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.2 },
    filterEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.3, release: 0.3 },
    filter: { type: 'lowpass', frequency: 600, resonance: 4, envelopeAmount: 0.4, keyTracking: 0.2 },
    lfo: { rate: 0.2, waveform: 'sine', destination: 'filter', amount: 0.15, sync: false },
    masterVolume: 0.7,
  },

  // === LEADS ===
  analogLead: {
    name: 'Analog Lead',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'square', level: 0.6, detuneCents: 7, detuneCoarse: 0 },
    oscillatorMix: 0.4,
    noise: 0,
    amplitudeEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.4 },
    filter: { type: 'lowpass', frequency: 2500, resonance: 4, envelopeAmount: 0.5, keyTracking: 0.5 },
    lfo: { rate: 5, waveform: 'sine', destination: 'pitch', amount: 0.15, sync: false },
    masterVolume: 0.65,
  },

  syncLead: {
    name: 'Sync Lead',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'sawtooth', level: 0.8, detuneCents: 0, detuneCoarse: 7 },
    oscillatorMix: 0.5,
    noise: 0,
    amplitudeEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.6, release: 0.25 },
    filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 },
    filter: { type: 'lowpass', frequency: 4000, resonance: 6, envelopeAmount: 0.6, keyTracking: 0.6 },
    lfo: { rate: 0, waveform: 'sine', destination: 'none', amount: 0, sync: false },
    masterVolume: 0.6,
  },

  // === PADS ===
  warmPad: {
    name: 'Warm Pad',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: -8, detuneCoarse: 0 },
    oscillator2: { waveform: 'triangle', level: 0.7, detuneCents: 8, detuneCoarse: 0 },
    oscillatorMix: 0.45,
    noise: 0.05,
    amplitudeEnvelope: { attack: 0.3, decay: 0.5, sustain: 0.8, release: 1.5 },
    filterEnvelope: { attack: 0.4, decay: 0.6, sustain: 0.5, release: 1.0 },
    filter: { type: 'lowpass', frequency: 2000, resonance: 1, envelopeAmount: 0.3, keyTracking: 0.3 },
    lfo: { rate: 0.5, waveform: 'sine', destination: 'filter', amount: 0.1, sync: false },
    masterVolume: 0.55,
  },

  shimmerPad: {
    name: 'Shimmer Pad',
    oscillator1: { waveform: 'sine', level: 1, detuneCents: -5, detuneCoarse: 0 },
    oscillator2: { waveform: 'sine', level: 0.8, detuneCents: 5, detuneCoarse: 12 },
    oscillatorMix: 0.5,
    noise: 0.02,
    amplitudeEnvelope: { attack: 0.5, decay: 0.8, sustain: 0.9, release: 2.0 },
    filterEnvelope: { attack: 0.6, decay: 1.0, sustain: 0.7, release: 1.5 },
    filter: { type: 'lowpass', frequency: 6000, resonance: 0.5, envelopeAmount: 0.2, keyTracking: 0.4 },
    lfo: { rate: 3, waveform: 'sine', destination: 'amplitude', amount: 0.1, sync: false },
    masterVolume: 0.5,
  },

  // === PLUCKS ===
  synthPluck: {
    name: 'Synth Pluck',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'triangle', level: 0.5, detuneCents: 5, detuneCoarse: 0 },
    oscillatorMix: 0.35,
    noise: 0,
    amplitudeEnvelope: { attack: 0.005, decay: 0.25, sustain: 0, release: 0.2 },
    filterEnvelope: { attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.2 },
    filter: { type: 'lowpass', frequency: 3000, resonance: 8, envelopeAmount: 0.7, keyTracking: 0.5 },
    lfo: { rate: 0, waveform: 'sine', destination: 'none', amount: 0, sync: false },
    masterVolume: 0.7,
  },

  bellPluck: {
    name: 'Bell Pluck',
    oscillator1: { waveform: 'sine', level: 1, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'sine', level: 0.6, detuneCents: 0, detuneCoarse: 19 },
    oscillatorMix: 0.4,
    noise: 0,
    amplitudeEnvelope: { attack: 0.001, decay: 0.4, sustain: 0.1, release: 0.8 },
    filterEnvelope: { attack: 0.001, decay: 0.3, sustain: 0.2, release: 0.5 },
    filter: { type: 'lowpass', frequency: 8000, resonance: 0, envelopeAmount: 0.2, keyTracking: 0.6 },
    lfo: { rate: 0, waveform: 'sine', destination: 'none', amount: 0, sync: false },
    masterVolume: 0.6,
  },

  // === KEYS ===
  electricPiano: {
    name: 'Electric Piano',
    oscillator1: { waveform: 'sine', level: 1, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'triangle', level: 0.3, detuneCents: 0, detuneCoarse: 12 },
    oscillatorMix: 0.25,
    noise: 0,
    amplitudeEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.4, release: 0.6 },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.4 },
    filter: { type: 'lowpass', frequency: 3000, resonance: 1, envelopeAmount: 0.3, keyTracking: 0.7 },
    lfo: { rate: 4, waveform: 'sine', destination: 'amplitude', amount: 0.05, sync: false },
    masterVolume: 0.65,
  },

  clavSynth: {
    name: 'Clav Synth',
    oscillator1: { waveform: 'square', level: 1, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'square', level: 0.7, detuneCents: 0, detuneCoarse: 12 },
    oscillatorMix: 0.35,
    noise: 0,
    amplitudeEnvelope: { attack: 0.001, decay: 0.15, sustain: 0.3, release: 0.1 },
    filterEnvelope: { attack: 0.001, decay: 0.1, sustain: 0.2, release: 0.1 },
    filter: { type: 'lowpass', frequency: 4000, resonance: 4, envelopeAmount: 0.5, keyTracking: 0.5 },
    lfo: { rate: 0, waveform: 'sine', destination: 'none', amount: 0, sync: false },
    masterVolume: 0.65,
  },

  // === ACID ===
  acid303: {
    name: 'Acid 303',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'square', level: 0, detuneCents: 0, detuneCoarse: 0 },
    oscillatorMix: 0,
    noise: 0,
    amplitudeEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.05 },
    filterEnvelope: { attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.1 },
    filter: { type: 'lowpass', frequency: 500, resonance: 18, envelopeAmount: 0.8, keyTracking: 0.3 },
    lfo: { rate: 0, waveform: 'sine', destination: 'none', amount: 0, sync: false },
    masterVolume: 0.7,
  },

  acidSquare: {
    name: 'Acid Square',
    oscillator1: { waveform: 'square', level: 1, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'square', level: 0, detuneCents: 0, detuneCoarse: 0 },
    oscillatorMix: 0,
    noise: 0,
    amplitudeEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.05 },
    filterEnvelope: { attack: 0.001, decay: 0.12, sustain: 0.15, release: 0.1 },
    filter: { type: 'lowpass', frequency: 600, resonance: 16, envelopeAmount: 0.75, keyTracking: 0.3 },
    lfo: { rate: 0, waveform: 'sine', destination: 'none', amount: 0, sync: false },
    masterVolume: 0.7,
  },

  // === ATMOSPHERIC ===
  darkAmbient: {
    name: 'Dark Ambient',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: -20, detuneCoarse: 0 },
    oscillator2: { waveform: 'sawtooth', level: 1, detuneCents: 20, detuneCoarse: -12 },
    oscillatorMix: 0.5,
    noise: 0.1,
    amplitudeEnvelope: { attack: 1.0, decay: 1.5, sustain: 0.6, release: 3.0 },
    filterEnvelope: { attack: 1.5, decay: 2.0, sustain: 0.4, release: 2.5 },
    filter: { type: 'lowpass', frequency: 800, resonance: 2, envelopeAmount: 0.3, keyTracking: 0.2 },
    lfo: { rate: 0.1, waveform: 'sine', destination: 'filter', amount: 0.2, sync: false },
    masterVolume: 0.5,
  },

  ethereal: {
    name: 'Ethereal',
    oscillator1: { waveform: 'sine', level: 1, detuneCents: -7, detuneCoarse: 0 },
    oscillator2: { waveform: 'sine', level: 0.8, detuneCents: 7, detuneCoarse: 12 },
    oscillatorMix: 0.5,
    noise: 0.03,
    amplitudeEnvelope: { attack: 0.8, decay: 1.0, sustain: 0.8, release: 2.5 },
    filterEnvelope: { attack: 1.0, decay: 1.5, sustain: 0.6, release: 2.0 },
    filter: { type: 'lowpass', frequency: 4000, resonance: 1, envelopeAmount: 0.2, keyTracking: 0.5 },
    lfo: { rate: 0.3, waveform: 'sine', destination: 'amplitude', amount: 0.08, sync: false },
    masterVolume: 0.5,
  },

  // === BRASS / STRINGS ===
  brassStab: {
    name: 'Brass Stab',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: -3, detuneCoarse: 0 },
    oscillator2: { waveform: 'sawtooth', level: 0.9, detuneCents: 3, detuneCoarse: 0 },
    oscillatorMix: 0.5,
    noise: 0,
    amplitudeEnvelope: { attack: 0.03, decay: 0.2, sustain: 0.5, release: 0.15 },
    filterEnvelope: { attack: 0.02, decay: 0.15, sustain: 0.4, release: 0.2 },
    filter: { type: 'lowpass', frequency: 2000, resonance: 3, envelopeAmount: 0.5, keyTracking: 0.4 },
    lfo: { rate: 0, waveform: 'sine', destination: 'none', amount: 0, sync: false },
    masterVolume: 0.65,
  },

  stringEnsemble: {
    name: 'String Ensemble',
    oscillator1: { waveform: 'sawtooth', level: 1, detuneCents: -10, detuneCoarse: 0 },
    oscillator2: { waveform: 'sawtooth', level: 1, detuneCents: 10, detuneCoarse: 0 },
    oscillatorMix: 0.5,
    noise: 0.02,
    amplitudeEnvelope: { attack: 0.2, decay: 0.4, sustain: 0.8, release: 0.8 },
    filterEnvelope: { attack: 0.3, decay: 0.5, sustain: 0.6, release: 0.6 },
    filter: { type: 'lowpass', frequency: 3500, resonance: 0.5, envelopeAmount: 0.2, keyTracking: 0.3 },
    lfo: { rate: 5, waveform: 'sine', destination: 'pitch', amount: 0.08, sync: false },
    masterVolume: 0.55,
  },

  // === NOISE / TEXTURE ===
  noiseHit: {
    name: 'Noise Hit',
    oscillator1: { waveform: 'square', level: 0.3, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'sawtooth', level: 0.3, detuneCents: 0, detuneCoarse: 0 },
    oscillatorMix: 0.5,
    noise: 0.8,
    amplitudeEnvelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
    filterEnvelope: { attack: 0.001, decay: 0.1, sustain: 0.1, release: 0.1 },
    filter: { type: 'bandpass', frequency: 2000, resonance: 4, envelopeAmount: 0.5, keyTracking: 0.3 },
    lfo: { rate: 0, waveform: 'sine', destination: 'none', amount: 0, sync: false },
    masterVolume: 0.6,
  },

  windTexture: {
    name: 'Wind Texture',
    oscillator1: { waveform: 'sine', level: 0.2, detuneCents: 0, detuneCoarse: 0 },
    oscillator2: { waveform: 'sine', level: 0.2, detuneCents: 0, detuneCoarse: 0 },
    oscillatorMix: 0.5,
    noise: 0.9,
    amplitudeEnvelope: { attack: 0.5, decay: 1.0, sustain: 0.6, release: 1.5 },
    filterEnvelope: { attack: 0.8, decay: 1.5, sustain: 0.4, release: 1.0 },
    filter: { type: 'bandpass', frequency: 1500, resonance: 2, envelopeAmount: 0.4, keyTracking: 0.2 },
    lfo: { rate: 0.5, waveform: 'sine', destination: 'filter', amount: 0.3, sync: false },
    masterVolume: 0.45,
  },
};

/**
 * Get list of advanced synth preset names.
 */
export function getAdvancedSynthPresetNames(): string[] {
  return Object.keys(ADVANCED_SYNTH_PRESETS);
}

/**
 * Get an advanced synth preset by name.
 */
export function getAdvancedSynthPreset(name: string): AdvancedSynthParams | undefined {
  return ADVANCED_SYNTH_PRESETS[name];
}
