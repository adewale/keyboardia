/**
 * Simple monophonic synth engine using Web Audio API.
 * Inspired by OP-Z's synth tracks.
 *
 * Waveforms: sine, triangle, sawtooth, square
 * Parameters: filter cutoff, filter resonance, attack, decay, sustain, release
 */

export type WaveformType = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface SynthParams {
  waveform: WaveformType;
  filterCutoff: number;  // 100-10000 Hz
  filterResonance: number; // 0-20
  attack: number;   // 0-1 seconds
  decay: number;    // 0-1 seconds
  sustain: number;  // 0-1 amplitude
  release: number;  // 0-2 seconds
}

// Audio Engineering Constants
const MAX_VOICES = 16;           // Maximum simultaneous voices (prevents CPU overload)
const MAX_FILTER_RESONANCE = 20; // Prevent self-oscillation
const MIN_GAIN_VALUE = 0.0001;   // Minimum for exponential ramps (can't target 0)
const ENVELOPE_PEAK = 0.85;      // Peak amplitude for full, rich sound

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
};

export class SynthEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices: Map<string, SynthVoice> = new Map();
  private voiceOrder: string[] = []; // Track order for voice stealing

  initialize(audioContext: AudioContext, masterGain: GainNode): void {
    this.audioContext = audioContext;
    this.masterGain = masterGain;
  }

  /**
   * Play a synth note at a specific time.
   *
   * @param noteId - Unique ID for this note (for stopping)
   * @param frequency - Frequency in Hz (e.g., 440 for A4)
   * @param params - Synth parameters
   * @param time - AudioContext time to start
   * @param duration - Optional duration (for sequenced notes)
   */
  playNote(
    noteId: string,
    frequency: number,
    params: SynthParams,
    time: number,
    duration?: number
  ): void {
    if (!this.audioContext || !this.masterGain) return;

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

    const voice = new SynthVoice(this.audioContext, this.masterGain, params);
    voice.start(frequency, time);

    if (duration !== undefined) {
      voice.stop(time + duration);
      // Clean up after release
      setTimeout(() => {
        this.activeVoices.delete(noteId);
        this.voiceOrder = this.voiceOrder.filter(id => id !== noteId);
      }, (time - this.audioContext.currentTime + duration + params.release) * 1000 + 100);
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

class SynthVoice {
  private oscillator: OscillatorNode;
  private filter: BiquadFilterNode;
  private gainNode: GainNode;
  private params: SynthParams;
  private audioContext: AudioContext;
  private isCleanedUp: boolean = false;

  constructor(
    audioContext: AudioContext,
    destination: AudioNode,
    params: SynthParams
  ) {
    this.params = params;
    this.audioContext = audioContext;

    // Create oscillator
    this.oscillator = audioContext.createOscillator();
    this.oscillator.type = params.waveform;

    // Create filter with clamped resonance to prevent self-oscillation
    this.filter = audioContext.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = params.filterCutoff;
    this.filter.Q.value = Math.min(params.filterResonance, MAX_FILTER_RESONANCE);

    // Create gain for envelope
    this.gainNode = audioContext.createGain();
    this.gainNode.gain.value = 0;

    // Connect: osc -> filter -> gain -> destination
    this.oscillator.connect(this.filter);
    this.filter.connect(this.gainNode);
    this.gainNode.connect(destination);
  }

  start(frequency: number, time: number): void {
    this.oscillator.frequency.setValueAtTime(frequency, time);

    // ADSR envelope using exponential ramps for more natural sound
    // Human hearing is logarithmic, so exponential changes sound more musical
    // Note: exponentialRampToValueAtTime cannot target 0, so we use MIN_GAIN_VALUE

    // Attack phase - exponential feels punchier
    this.gainNode.gain.setValueAtTime(MIN_GAIN_VALUE, time);
    this.gainNode.gain.exponentialRampToValueAtTime(ENVELOPE_PEAK, time + Math.max(this.params.attack, 0.001));

    // Decay to sustain - exponential sounds more natural
    const sustainLevel = Math.max(ENVELOPE_PEAK * this.params.sustain, MIN_GAIN_VALUE);
    this.gainNode.gain.exponentialRampToValueAtTime(
      sustainLevel,
      time + this.params.attack + this.params.decay
    );

    this.oscillator.start(time);
  }

  stop(time: number): void {
    // Release phase using setTargetAtTime for smooth decay
    // This avoids the discontinuity issues with exponentialRampToValueAtTime at small values
    this.gainNode.gain.cancelScheduledValues(time);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, time);

    // Use setTargetAtTime for smooth exponential decay to near-zero
    // Time constant = release / 4 means ~98% decay after release time
    this.gainNode.gain.setTargetAtTime(MIN_GAIN_VALUE, time, this.params.release / 4);

    const stopTime = time + this.params.release + 0.05;
    this.oscillator.stop(stopTime);

    // Memory leak fix: disconnect all nodes after release completes
    // Without this, OscillatorNodes and FilterNodes accumulate
    const cleanupDelay = (stopTime - this.audioContext.currentTime) * 1000 + 50;
    setTimeout(() => this.cleanup(), Math.max(cleanupDelay, 0));
  }

  /**
   * Disconnect all nodes to allow garbage collection
   */
  private cleanup(): void {
    if (this.isCleanedUp) return;
    this.isCleanedUp = true;

    try {
      this.oscillator.disconnect();
      this.filter.disconnect();
      this.gainNode.disconnect();
    } catch {
      // Nodes may already be disconnected if stopped multiple times
    }
  }
}

// Singleton instance
export const synthEngine = new SynthEngine();

// Helper to convert MIDI note to frequency
export function midiToFrequency(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

// Helper to convert semitone offset from A4 (440Hz) to frequency
export function semitoneToFrequency(semitone: number, baseFrequency: number = 440): number {
  return baseFrequency * Math.pow(2, semitone / 12);
}
