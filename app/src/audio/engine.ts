import type { Sample } from '../types';
import { createSynthesizedSamples } from './samples';
import { synthEngine, SYNTH_PRESETS, semitoneToFrequency, type SynthParams } from './synth';

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private samples: Map<string, Sample> = new Map();
  private trackGains: Map<string, GainNode> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create AudioContext (must be triggered by user gesture)
    this.audioContext = new AudioContext();

    // Resume if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Create master gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(this.audioContext.destination);

    // Initialize synth engine
    synthEngine.initialize(this.audioContext, this.masterGain);

    // Load synthesized samples
    this.samples = await createSynthesizedSamples(this.audioContext);

    this.initialized = true;
    console.log('AudioEngine initialized, state:', this.audioContext.state);
    console.log('Loaded samples:', Array.from(this.samples.keys()));
  }

  /**
   * Play a synthesizer note (real-time synthesis, not sample-based)
   */
  playSynthNote(
    noteId: string,
    presetName: string,
    semitone: number,
    time: number,
    duration?: number
  ): void {
    const preset = SYNTH_PRESETS[presetName] || SYNTH_PRESETS.lead;
    const frequency = semitoneToFrequency(semitone);
    synthEngine.playNote(noteId, frequency, preset, time, duration);
  }

  /**
   * Play a synth note with custom parameters
   */
  playSynthNoteWithParams(
    noteId: string,
    params: SynthParams,
    semitone: number,
    time: number,
    duration?: number
  ): void {
    const frequency = semitoneToFrequency(semitone);
    synthEngine.playNote(noteId, frequency, params, time, duration);
  }

  stopSynthNote(noteId: string): void {
    synthEngine.stopNote(noteId);
  }

  getSynthPresets(): string[] {
    return Object.keys(SYNTH_PRESETS);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  // Create or get gain node for a track
  getTrackGain(trackId: string): GainNode {
    if (!this.audioContext || !this.masterGain) {
      throw new Error('AudioEngine not initialized');
    }

    let gain = this.trackGains.get(trackId);
    if (!gain) {
      gain = this.audioContext.createGain();
      gain.connect(this.masterGain);
      this.trackGains.set(trackId, gain);
    }
    return gain;
  }

  setTrackVolume(trackId: string, volume: number): void {
    const gain = this.trackGains.get(trackId);
    if (gain) {
      gain.gain.value = volume;
    }
  }

  setTrackMuted(trackId: string, muted: boolean): void {
    const gain = this.trackGains.get(trackId);
    if (gain) {
      gain.gain.value = muted ? 0 : 1;
    }
  }

  /**
   * Play a sample at a specific time.
   *
   * @param sampleId - ID of the sample to play
   * @param trackId - ID of the track (for gain control)
   * @param time - AudioContext time to start playback
   * @param duration - Step duration in seconds (only used if playbackMode is 'gate')
   * @param playbackMode - 'oneshot' plays full sample, 'gate' cuts at step boundary
   * @param pitchSemitones - Pitch shift in semitones (0 = original, 12 = octave up)
   *
   * Industry standard: Most samplers (Teenage Engineering, Elektron, Ableton)
   * default to one-shot. Gate mode is for sustained sounds like synth pads.
   */
  playSample(
    sampleId: string,
    trackId: string,
    time: number,
    duration?: number,
    playbackMode: 'oneshot' | 'gate' = 'oneshot',
    pitchSemitones: number = 0
  ): void {
    if (!this.audioContext || !this.masterGain) {
      console.warn('AudioContext not initialized');
      return;
    }

    // Resume audio context if suspended (required by browsers)
    if (this.audioContext.state === 'suspended') {
      console.log('Resuming suspended AudioContext');
      this.audioContext.resume();
    }

    const sample = this.samples.get(sampleId);
    if (!sample?.buffer) {
      console.warn(`Sample not found: ${sampleId}`, 'Available:', Array.from(this.samples.keys()));
      return;
    }

    // Log buffer details at playback time
    if (sampleId.startsWith('recording')) {
      console.log(`PLAYBACK ${sampleId}: buffer.length=${sample.buffer.length}, buffer.duration=${sample.buffer.duration.toFixed(3)}s, buffer.numberOfChannels=${sample.buffer.numberOfChannels}`);
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = sample.buffer;

    // Apply pitch shift via playbackRate
    // Each semitone is a factor of 2^(1/12) ≈ 1.0595
    if (pitchSemitones !== 0) {
      source.playbackRate.value = Math.pow(2, pitchSemitones / 12);
    }

    // Get or create track gain node
    let trackGain = this.trackGains.get(trackId);
    if (!trackGain) {
      trackGain = this.audioContext.createGain();
      trackGain.gain.value = 1;
      trackGain.connect(this.masterGain);
      this.trackGains.set(trackId, trackGain);
      console.log(`Created new track gain for ${trackId}, connected to master`);
    }

    source.connect(trackGain);

    const currentTime = this.audioContext.currentTime;
    const actualStartTime = Math.max(time, currentTime);

    // For recordings, try playing immediately to test
    if (sampleId.startsWith('recording')) {
      console.log(`Starting recording at ${actualStartTime.toFixed(3)}, current=${currentTime.toFixed(3)}, duration limit=${duration?.toFixed(3)}`);
    }

    source.start(actualStartTime);

    // Gate mode: cut sample at step boundary
    // One-shot mode (default): let sample play to completion
    // One-shot is industry standard for drums and recordings
    if (playbackMode === 'gate' && duration !== undefined) {
      source.stop(actualStartTime + duration);
    }
  }

  // Play immediately (for preview/testing)
  playNow(sampleId: string): void {
    if (!this.audioContext || !this.masterGain) return;

    const sample = this.samples.get(sampleId);
    if (!sample?.buffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = sample.buffer;
    source.connect(this.masterGain);
    source.start();
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0;
  }

  getSampleIds(): string[] {
    return Array.from(this.samples.keys());
  }

  getSample(id: string): Sample | undefined {
    return this.samples.get(id);
  }

  // Add a custom sample (for recordings)
  addSample(sample: Sample): void {
    this.samples.set(sample.id, sample);
    console.log(`Added sample: ${sample.id}, buffer duration: ${sample.buffer?.duration.toFixed(2)}s, channels: ${sample.buffer?.numberOfChannels}, sampleRate: ${sample.buffer?.sampleRate}, total samples: ${this.samples.size}`);
  }

  /**
   * Decode audio data into a buffer (converts to mono to match synthesized samples)
   * Phase 13B: Added proper error handling for decode failures
   */
  async decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('AudioEngine not initialized');
    }

    // Phase 13B: Validate input
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('Cannot decode empty audio data');
    }

    let decodedBuffer: AudioBuffer;
    try {
      decodedBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
      // Phase 13B: Handle decode errors gracefully
      // Common causes: corrupted file, unsupported format, empty data
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[AudioEngine] Failed to decode audio data: ${message}`);
      throw new Error(`Failed to decode audio: ${message}`);
    }

    // Validate decoded buffer
    if (!decodedBuffer || decodedBuffer.length === 0) {
      throw new Error('Decoded audio buffer is empty');
    }

    // Convert to mono to match synthesized samples format
    const channels = decodedBuffer.numberOfChannels;
    const sampleRate = decodedBuffer.sampleRate;
    const length = decodedBuffer.length;

    console.log(`Decoded audio: ${channels} channels, ${sampleRate}Hz, ${length} samples`);

    // Create mono buffer
    const monoBuffer = this.audioContext.createBuffer(1, length, sampleRate);
    const monoData = monoBuffer.getChannelData(0);

    if (channels === 1) {
      monoData.set(decodedBuffer.getChannelData(0));
    } else {
      // Mix stereo to mono
      const left = decodedBuffer.getChannelData(0);
      const right = decodedBuffer.getChannelData(1);
      for (let i = 0; i < length; i++) {
        monoData[i] = (left[i] + right[i]) / 2;
      }
    }

    console.log(`Converted to mono: ${monoBuffer.numberOfChannels} channel, ${monoBuffer.sampleRate}Hz`);
    return monoBuffer;
  }
}

// Singleton instance
export const audioEngine = new AudioEngine();
