import type { Sample } from '../types';
import { createSynthesizedSamples } from './samples';
import { synthEngine, SYNTH_PRESETS, semitoneToFrequency, type SynthParams } from './synth';
import { sampledInstrumentRegistry, SAMPLED_INSTRUMENTS, isSampledInstrument } from './sampled-instrument';
import { logger } from '../utils/logger';

// iOS Safari uses webkitAudioContext
const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

// Audio Engineering Constants
const FADE_TIME = 0.003; // 3ms fade to prevent clicks/pops
const COMPRESSOR_SETTINGS = {
  threshold: -6,    // Start compressing at -6dB
  knee: 12,         // Soft knee for natural sound
  ratio: 4,         // 4:1 compression ratio
  attack: 0.003,    // 3ms attack
  release: 0.25,    // 250ms release
};

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private samples: Map<string, Sample> = new Map();
  private trackGains: Map<string, GainNode> = new Map();
  private initialized = false;
  private unlockListenerAttached = false;

  // Non-destructive analyser for monitoring (parallel tap, doesn't interrupt signal)
  private analyser: AnalyserNode | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create AudioContext (must be triggered by user gesture)
    // Use webkitAudioContext for older iOS Safari
    this.audioContext = new AudioContextClass();

    // Resume if suspended or interrupted (iOS-specific state)
    // iOS can put the context in 'interrupted' state
    if (this.audioContext.state === 'suspended' || (this.audioContext.state as string) === 'interrupted') {
      logger.audio.log('AudioContext state:', this.audioContext.state, '- attempting resume');
      await this.audioContext.resume();
      logger.audio.log('AudioContext state after resume:', this.audioContext.state);
    }

    // Create master gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 1.0;

    // Create compressor/limiter to prevent clipping when multiple sources play
    // This is essential - without it, 8 samples at 0.85 each could sum to 6.8 (clipping)
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.compressor.threshold.value = COMPRESSOR_SETTINGS.threshold;
    this.compressor.knee.value = COMPRESSOR_SETTINGS.knee;
    this.compressor.ratio.value = COMPRESSOR_SETTINGS.ratio;
    this.compressor.attack.value = COMPRESSOR_SETTINGS.attack;
    this.compressor.release.value = COMPRESSOR_SETTINGS.release;

    // Signal chain: tracks -> masterGain -> compressor -> destination
    // IMPORTANT: These connections are IMMUTABLE - never disconnect/reconnect them
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.audioContext.destination);

    // Add non-destructive analyser as parallel tap (doesn't interrupt main signal)
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.masterGain.connect(this.analyser); // Parallel connection

    // Initialize synth engine
    synthEngine.initialize(this.audioContext, this.masterGain);

    // Initialize sampled instrument registry
    sampledInstrumentRegistry.initialize(this.audioContext, this.masterGain);
    // Register available sampled instruments
    for (const instrumentId of SAMPLED_INSTRUMENTS) {
      sampledInstrumentRegistry.register(instrumentId, '/instruments');
    }

    // Load synthesized samples (drums, synths - these are generated, not fetched)
    this.samples = await createSynthesizedSamples(this.audioContext);

    // NOTE: Piano samples are loaded LAZILY on first use, not at startup.
    // This keeps initial page load fast. The synth fallback handles any
    // notes played before samples are ready.

    this.initialized = true;
    logger.audio.log('AudioEngine initialized, state:', this.audioContext.state);
    logger.audio.log('Loaded samples:', Array.from(this.samples.keys()));

    // Mobile Chrome workaround: attach document-level listeners to unlock audio
    // This handles cases where the audio context gets re-suspended
    this.attachUnlockListeners();
  }

  /**
   * Mobile Chrome workaround: attach document-level listeners to unlock audio.
   * Chrome on Android requires user gesture to start audio, and the context
   * can become suspended again after periods of inactivity.
   * @see https://developer.chrome.com/blog/autoplay
   */
  private attachUnlockListeners(): void {
    if (this.unlockListenerAttached) return;
    this.unlockListenerAttached = true;

    const unlock = async () => {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        logger.audio.log('Unlocking AudioContext via user gesture');
        try {
          await this.audioContext.resume();
          logger.audio.log('AudioContext unlocked, state:', this.audioContext.state);
        } catch (e) {
          logger.audio.error('Failed to unlock AudioContext:', e);
        }
      }
    };

    // Listen for various user gestures that can unlock audio
    // touchstart is crucial for mobile Chrome
    const events = ['touchstart', 'touchend', 'click', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, unlock, { once: false, passive: true });
    });

    logger.audio.log('Audio unlock listeners attached');
  }

  /**
   * Ensure audio context is running (call before playback)
   * Returns true if audio is ready to play
   *
   * iOS Safari can put the context in 'interrupted' state which also needs resume()
   * @see https://developer.apple.com/forums/thread/23499
   */
  async ensureAudioReady(): Promise<boolean> {
    if (!this.audioContext) {
      logger.audio.warn('AudioContext not created');
      return false;
    }

    const state = this.audioContext.state as string;
    if (state === 'suspended' || state === 'interrupted') {
      logger.audio.log('Resuming AudioContext before playback, state:', state);
      try {
        await this.audioContext.resume();
        logger.audio.log('AudioContext resumed, state:', this.audioContext.state);
      } catch (e) {
        logger.audio.error('Failed to resume AudioContext:', e);
        return false;
      }
    }

    return this.audioContext.state === 'running';
  }

  /**
   * Preload any sampled instruments used by the given tracks.
   * Call this when session loads or when tracks change to ensure
   * instruments are ready before playback starts.
   *
   * @param tracks - Array of tracks with sampleId
   * @returns Promise that resolves when all instruments are loaded
   */
  async preloadInstrumentsForTracks(tracks: Array<{ sampleId: string }>): Promise<void> {
    // Extract unique synth preset names that are sampled instruments
    const sampledPresets = new Set<string>();

    for (const track of tracks) {
      // sampleId format is "synth:presetName" for synth tracks
      if (track.sampleId.startsWith('synth:')) {
        const presetName = track.sampleId.replace('synth:', '');
        if (isSampledInstrument(presetName)) {
          sampledPresets.add(presetName);
        }
      }
    }

    if (sampledPresets.size === 0) {
      return;
    }

    logger.audio.log(`[PRELOAD] Loading ${sampledPresets.size} sampled instrument(s):`, Array.from(sampledPresets));

    // Load all sampled instruments in parallel
    const loadPromises = Array.from(sampledPresets).map(async (presetName) => {
      const loaded = await sampledInstrumentRegistry.load(presetName);
      if (loaded) {
        logger.audio.log(`[PRELOAD] ${presetName} ready`);
      } else {
        logger.audio.error(`[PRELOAD] Failed to load ${presetName}`);
      }
      return loaded;
    });

    await Promise.all(loadPromises);
  }

  /**
   * Play a synthesizer note (real-time synthesis, not sample-based)
   * For sampled instruments (like piano), uses audio samples if loaded.
   * Triggers lazy loading on first use.
   */
  playSynthNote(
    noteId: string,
    presetName: string,
    semitone: number,
    time: number,
    duration?: number
  ): void {
    // Check if this is a sampled instrument
    const instrument = sampledInstrumentRegistry.get(presetName);

    if (instrument) {
      // Trigger lazy loading if not already loaded/loading
      // This is fire-and-forget - samples load in background
      if (!instrument.isReady()) {
        sampledInstrumentRegistry.load(presetName);
      }

      // Use samples if ready, otherwise fall back to synth
      if (instrument.isReady()) {
        const midiNote = 60 + semitone;
        instrument.playNote(noteId, midiNote, time, duration);
        return;
      }

      // Fall back to synth while loading
      logger.audio.log(`[LAZY] ${presetName} loading, using synth fallback`);
    }

    // Real-time synthesis (for synth presets or while samples load)
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
      logger.audio.warn('AudioContext not initialized');
      return;
    }

    // Resume audio context if suspended (required by browsers)
    if (this.audioContext.state === 'suspended') {
      logger.audio.log('Resuming suspended AudioContext');
      this.audioContext.resume();
    }

    const sample = this.samples.get(sampleId);
    if (!sample?.buffer) {
      logger.audio.warn(`Sample not found: ${sampleId}`, 'Available:', Array.from(this.samples.keys()));
      return;
    }

    // Log buffer details at playback time
    if (sampleId.startsWith('recording')) {
      logger.audio.log(`PLAYBACK ${sampleId}: buffer.length=${sample.buffer.length}, buffer.duration=${sample.buffer.duration.toFixed(3)}s, buffer.numberOfChannels=${sample.buffer.numberOfChannels}`);
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
      logger.audio.log(`Created new track gain for ${trackId}, connected to master`);
    }

    // Create envelope gain for click prevention (micro-fades)
    // Without this, abrupt starts/stops cause audible clicks
    const envGain = this.audioContext.createGain();
    envGain.gain.setValueAtTime(0, time);
    envGain.gain.linearRampToValueAtTime(1, time + FADE_TIME);

    // Connect: source -> envGain -> trackGain
    source.connect(envGain);
    envGain.connect(trackGain);

    const currentTime = this.audioContext.currentTime;
    const actualStartTime = Math.max(time, currentTime);

    // For recordings, try playing immediately to test
    if (sampleId.startsWith('recording')) {
      logger.audio.log(`Starting recording at ${actualStartTime.toFixed(3)}, current=${currentTime.toFixed(3)}, duration limit=${duration?.toFixed(3)}`);
    }

    source.start(actualStartTime);

    // Gate mode: cut sample at step boundary with fade-out to prevent clicks
    // One-shot mode (default): let sample play to completion
    // One-shot is industry standard for drums and recordings
    if (playbackMode === 'gate' && duration !== undefined) {
      const stopTime = actualStartTime + duration;
      // Fade out before stopping to prevent click
      envGain.gain.setValueAtTime(1, stopTime - FADE_TIME);
      envGain.gain.linearRampToValueAtTime(0, stopTime);
      source.stop(stopTime);
    }

    // Memory leak fix: disconnect nodes when playback ends
    // Without this, BufferSourceNodes accumulate and never get garbage collected
    source.onended = () => {
      source.disconnect();
      envGain.disconnect();
    };
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

    // Memory leak fix: disconnect when done
    source.onended = () => {
      source.disconnect();
    };
  }

  /**
   * Remove a track's gain node (call when track is deleted)
   * Prevents memory leak from orphaned gain nodes
   */
  removeTrackGain(trackId: string): void {
    const gain = this.trackGains.get(trackId);
    if (gain) {
      gain.disconnect();
      this.trackGains.delete(trackId);
      logger.audio.log(`Removed track gain for ${trackId}`);
    }
  }

  /**
   * Get the compressor node (for monitoring/testing)
   */
  getCompressor(): DynamicsCompressorNode | null {
    return this.compressor;
  }

  /**
   * DIAGNOSTIC: Verify the complete audio chain is intact.
   * This helps debug silent audio issues by checking every link in the chain.
   */
  verifyAudioChain(): {
    valid: boolean;
    issues: string[];
    diagnostics: Record<string, unknown>;
  } {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {};

    // 1. AudioContext checks
    if (!this.audioContext) {
      issues.push('No AudioContext');
      return { valid: false, issues, diagnostics };
    }
    diagnostics['context.state'] = this.audioContext.state;
    diagnostics['context.sampleRate'] = this.audioContext.sampleRate;
    diagnostics['context.currentTime'] = this.audioContext.currentTime;
    diagnostics['context.baseLatency'] = this.audioContext.baseLatency;

    if (this.audioContext.state !== 'running') {
      issues.push(`AudioContext state is '${this.audioContext.state}', expected 'running'`);
    }

    // 2. MasterGain checks
    if (!this.masterGain) {
      issues.push('No masterGain node');
    } else {
      diagnostics['masterGain.gain.value'] = this.masterGain.gain.value;
      diagnostics['masterGain.channelCount'] = this.masterGain.channelCount;
      diagnostics['masterGain.channelCountMode'] = this.masterGain.channelCountMode;
      diagnostics['masterGain.numberOfInputs'] = this.masterGain.numberOfInputs;
      diagnostics['masterGain.numberOfOutputs'] = this.masterGain.numberOfOutputs;

      if (this.masterGain.gain.value === 0) {
        issues.push('masterGain has gain of 0 (silent)');
      }
      if (this.masterGain.gain.value < 0.001) {
        issues.push(`masterGain has very low gain: ${this.masterGain.gain.value}`);
      }
    }

    // 3. Compressor checks
    if (!this.compressor) {
      issues.push('No compressor node');
    } else {
      diagnostics['compressor.threshold'] = this.compressor.threshold.value;
      diagnostics['compressor.knee'] = this.compressor.knee.value;
      diagnostics['compressor.ratio'] = this.compressor.ratio.value;
      diagnostics['compressor.attack'] = this.compressor.attack.value;
      diagnostics['compressor.release'] = this.compressor.release.value;
      diagnostics['compressor.reduction'] = this.compressor.reduction;
      diagnostics['compressor.channelCount'] = this.compressor.channelCount;
    }

    // 4. Destination checks
    const dest = this.audioContext.destination;
    diagnostics['destination.maxChannelCount'] = dest.maxChannelCount;
    diagnostics['destination.channelCount'] = dest.channelCount;
    diagnostics['destination.numberOfInputs'] = dest.numberOfInputs;

    // 5. Track gains check
    diagnostics['trackGains.count'] = this.trackGains.size;
    for (const [trackId, gain] of this.trackGains) {
      diagnostics[`trackGain.${trackId}.value`] = gain.gain.value;
    }

    return { valid: issues.length === 0, issues, diagnostics };
  }

  /**
   * Get current audio level from the non-destructive analyser.
   * Returns peak amplitude (0 = silence, >0 = audio flowing).
   * This does NOT modify the audio chain.
   */
  getAudioLevel(): number {
    if (!this.analyser) return 0;
    const dataArray = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(dataArray);
    let peak = 0;
    for (let i = 0; i < dataArray.length; i++) {
      peak = Math.max(peak, Math.abs(dataArray[i]));
    }
    return peak;
  }

  /**
   * Get the masterGain node (for testing/diagnostics)
   */
  getMasterGain(): GainNode | null {
    return this.masterGain;
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
    logger.audio.log(`Added sample: ${sample.id}, buffer duration: ${sample.buffer?.duration.toFixed(2)}s, channels: ${sample.buffer?.numberOfChannels}, sampleRate: ${sample.buffer?.sampleRate}, total samples: ${this.samples.size}`);
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
      logger.audio.error(`Failed to decode audio data: ${message}`);
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

    logger.audio.log(`Decoded audio: ${channels} channels, ${sampleRate}Hz, ${length} samples`);

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

    logger.audio.log(`Converted to mono: ${monoBuffer.numberOfChannels} channel, ${monoBuffer.sampleRate}Hz`);
    return monoBuffer;
  }
}

// Singleton instance
export const audioEngine = new AudioEngine();
