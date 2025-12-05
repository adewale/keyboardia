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

// Preset synth patches
export const SYNTH_PRESETS: Record<string, SynthParams> = {
  bass: {
    waveform: 'sawtooth',
    filterCutoff: 800,
    filterResonance: 4,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.3,
    release: 0.1,
  },
  lead: {
    waveform: 'square',
    filterCutoff: 2000,
    filterResonance: 2,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.7,
    release: 0.3,
  },
  pad: {
    waveform: 'sine',
    filterCutoff: 4000,
    filterResonance: 1,
    attack: 0.3,
    decay: 0.5,
    sustain: 0.6,
    release: 1.0,
  },
  pluck: {
    waveform: 'triangle',
    filterCutoff: 3000,
    filterResonance: 8,
    attack: 0.005,
    decay: 0.3,
    sustain: 0,
    release: 0.2,
  },
  acid: {
    waveform: 'sawtooth',
    filterCutoff: 500,
    filterResonance: 15,
    attack: 0.01,
    decay: 0.15,
    sustain: 0.2,
    release: 0.1,
  },
};

export class SynthEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices: Map<string, SynthVoice> = new Map();

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

    const voice = new SynthVoice(this.audioContext, this.masterGain, params);
    voice.start(frequency, time);

    if (duration !== undefined) {
      voice.stop(time + duration);
      // Clean up after release
      setTimeout(() => {
        this.activeVoices.delete(noteId);
      }, (time - this.audioContext.currentTime + duration + params.release) * 1000 + 100);
    }

    this.activeVoices.set(noteId, voice);
  }

  stopNote(noteId: string): void {
    const voice = this.activeVoices.get(noteId);
    if (voice && this.audioContext) {
      voice.stop(this.audioContext.currentTime);
      this.activeVoices.delete(noteId);
    }
  }

  stopAll(): void {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    for (const voice of this.activeVoices.values()) {
      voice.stop(now);
    }
    this.activeVoices.clear();
  }
}

class SynthVoice {
  private oscillator: OscillatorNode;
  private filter: BiquadFilterNode;
  private gainNode: GainNode;
  private params: SynthParams;

  constructor(
    audioContext: AudioContext,
    destination: AudioNode,
    params: SynthParams
  ) {
    this.params = params;

    // Create oscillator
    this.oscillator = audioContext.createOscillator();
    this.oscillator.type = params.waveform;

    // Create filter
    this.filter = audioContext.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = params.filterCutoff;
    this.filter.Q.value = params.filterResonance;

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

    // ADSR envelope - Attack
    this.gainNode.gain.setValueAtTime(0, time);
    this.gainNode.gain.linearRampToValueAtTime(0.5, time + this.params.attack);

    // Decay to sustain
    this.gainNode.gain.linearRampToValueAtTime(
      0.5 * this.params.sustain,
      time + this.params.attack + this.params.decay
    );

    this.oscillator.start(time);
  }

  stop(time: number): void {
    // Release
    this.gainNode.gain.cancelScheduledValues(time);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, time);
    this.gainNode.gain.linearRampToValueAtTime(0, time + this.params.release);

    this.oscillator.stop(time + this.params.release + 0.01);
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
