import type { Sample } from '../types';
import { createSynthesizedSamples } from './samples';
import { synthEngine, SYNTH_PRESETS, semitoneToFrequency, type SynthParams } from './synth';
import { logger } from '../utils/logger';
import { ToneEffectsChain, type EffectsState, DEFAULT_EFFECTS_STATE } from './toneEffects';
import { ToneSynthManager, isToneSynth, getToneSynthPreset, type ToneSynthType } from './toneSynths';
import {
  AdvancedSynthEngine,
  isAdvancedSynth,
  getAdvancedSynthPresetId,
  ADVANCED_SYNTH_PRESETS,
} from './advancedSynth';
import {
  sampledInstrumentRegistry,
  SAMPLED_INSTRUMENTS,
  isSampledInstrument,
} from './sampled-instrument';
import { collectSampledInstruments } from './instrument-types';
import { tracer } from '../utils/debug-tracer';
import { runAllDetections } from '../utils/bug-patterns';
import * as Tone from 'tone';

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
  private unlockHandler: (() => Promise<void>) | null = null; // Store reference for cleanup

  // Race condition prevention flags
  private resumeInProgress = false;
  private resumePromise: Promise<void> | null = null;

  // Tone.js integration (Phase 22: Synthesis Engine)
  private toneEffects: ToneEffectsChain | null = null;
  private toneSynths: ToneSynthManager | null = null;
  private advancedSynth: AdvancedSynthEngine | null = null;
  private toneInitialized = false;
  private toneInitPromise: Promise<void> | null = null;
  private effectsChainConnected = false; // Track if masterGain was rerouted to effects

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
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.audioContext.destination);

    // Initialize synth engine
    synthEngine.initialize(this.audioContext, this.masterGain);

    // Initialize sampled instrument registry (Phase 22)
    // Phase 23: Lazy loading - instruments load on-demand, not at startup
    sampledInstrumentRegistry.initialize(this.audioContext, this.masterGain);
    for (const instrumentId of SAMPLED_INSTRUMENTS) {
      sampledInstrumentRegistry.register(instrumentId, '/instruments');
    }
    logger.audio.log('Registered sampled instruments (lazy loading enabled):', SAMPLED_INSTRUMENTS);

    // Load synthesized samples
    this.samples = await createSynthesizedSamples(this.audioContext);

    this.initialized = true;

    // Note: Debug tools (initDebugTracer, initPlaybackDebug, initBugPatterns) are
    // initialized by debug-coordinator.ts on page load, not here.
    // This prevents double-initialization when AudioEngine initializes on first play.

    // Expose engine reference for debug tools
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__audioEngine__ = this;

    // Run initial bug detection (logs warnings if patterns detected)
    if (typeof window !== 'undefined' && window.__DEBUG_TRACE__) {
      const detectionResults = runAllDetections();
      for (const [patternId, result] of detectionResults) {
        if (result.detected) {
          tracer.warning('bug-detection', `Pattern detected: ${patternId}`, result.message || 'Bug pattern detected', result.evidence);
        }
      }
    }

    logger.audio.log('AudioEngine initialized, state:', this.audioContext.state);
    logger.audio.log('Loaded samples:', Array.from(this.samples.keys()));

    // Mobile Chrome workaround: attach document-level listeners to unlock audio
    // This handles cases where the audio context gets re-suspended
    this.attachUnlockListeners();

    // Initialize Tone.js effects and synths (async, non-blocking)
    // This is done after basic initialization so audio can start playing
    // while effects are being set up
    this.initializeTone().catch(err => {
      logger.audio.error('Failed to initialize Tone.js:', err);
    });
  }

  /**
   * Initialize Tone.js effects and advanced synths
   * Called automatically after basic initialization
   * Uses promise locking to prevent concurrent initialization attempts
   * Public to allow external components to trigger Tone.js initialization on demand
   */
  async initializeTone(): Promise<void> {
    // Already initialized
    if (this.toneInitialized) return;

    // Initialization in progress - wait for existing promise
    if (this.toneInitPromise) {
      return this.toneInitPromise;
    }

    // Create and store the initialization promise
    this.toneInitPromise = (async () => {
      try {
        // CRITICAL: Set Tone.js to use our existing AudioContext BEFORE starting
        // This ensures all Tone.js nodes are in the same context as our native nodes
        // (masterGain, compressor, etc.) so they can be connected together.
        if (this.audioContext) {
          Tone.setContext(this.audioContext);
        }

        // Start Tone.js audio context (now using our context)
        await Tone.start();
        logger.audio.log('Tone.js started, context state:', Tone.getContext().state);

        // SAFEGUARD: Verify Tone.js is using our AudioContext
        // This catches HMR issues where Tone.js might have a stale context
        const toneContext = Tone.getContext().rawContext;
        if (toneContext !== this.audioContext) {
          logger.audio.error('AudioContext mismatch detected! Tone.js context differs from engine context.');
          throw new Error('AudioContext mismatch: Tone.js and AudioEngine have different contexts');
        }

        // Initialize effects chain
        this.toneEffects = new ToneEffectsChain();
        await this.toneEffects.initialize();

        // Connect master gain to effects chain input
        // Signal flow: masterGain -> toneEffects -> destination
        // Note: We disconnect from compressor and route through effects instead
        // Only do this once - prevent errors on retry if first attempt partially succeeded
        if (this.masterGain && this.compressor && !this.effectsChainConnected) {
          const effectsInput = this.toneEffects.getInput();
          if (effectsInput) {
            // CRITICAL: Actually connect masterGain to effects chain!
            // This routes ALL audio (procedural samples, synth:* presets, piano)
            // through the effects before reaching destination.
            // Effects are dry by default (wet=0), users enable via FX panel.
            //
            // Disconnect masterGain from compressor (original: masterGain -> compressor -> destination)
            this.masterGain.disconnect(this.compressor);

            // Connect masterGain to effects input. Since we called Tone.setContext() above,
            // both our native nodes and Tone.js nodes are in the same AudioContext.
            // We use Tone.connect() which handles the native-to-Tone bridging.
            Tone.connect(this.masterGain, effectsInput);

            this.effectsChainConnected = true;
            logger.audio.log('Master gain connected to Tone.js effects chain');
          }
        }

        // Initialize Tone.js synth manager
        this.toneSynths = new ToneSynthManager();
        await this.toneSynths.initialize();

        // Connect synth output to effects
        const synthOutput = this.toneSynths.getOutput();
        const effectsInput = this.toneEffects.getInput();
        if (synthOutput && effectsInput) {
          synthOutput.connect(effectsInput);
          logger.audio.log('Tone.js synths connected to effects chain');
        }

        // Initialize advanced synth engine (dual oscillator)
        // Use fresh instance (not singleton) to ensure nodes are in current AudioContext.
        // The singleton pattern can retain stale nodes across HMR (Hot Module Reload).
        this.advancedSynth = new AdvancedSynthEngine();
        await this.advancedSynth.initialize();

        // Connect advanced synth output to effects
        const advancedOutput = this.advancedSynth.getOutput();
        if (advancedOutput && effectsInput) {
          advancedOutput.connect(effectsInput);
          logger.audio.log('Advanced synth connected to effects chain');
        }

        this.toneInitialized = true;
        logger.audio.log('Tone.js and advanced synths fully initialized');
      } catch (err) {
        // Clear promise on error to allow retry
        this.toneInitPromise = null;
        logger.audio.error('Tone.js initialization error:', err);
        throw err;
      }
    })();

    return this.toneInitPromise;
  }

  /**
   * Mobile Chrome workaround: attach document-level listeners to unlock audio.
   * Chrome on Android requires user gesture to start audio, and the context
   * can become suspended again after periods of inactivity.
   * @see https://developer.chrome.com/blog/autoplay
   *
   * Uses promise locking to prevent concurrent resume() calls when multiple
   * events fire (e.g., touchstart + touchend on single tap).
   */
  private attachUnlockListeners(): void {
    if (this.unlockListenerAttached) return;
    this.unlockListenerAttached = true;

    // Store handler reference for cleanup
    this.unlockHandler = async () => {
      // Only unlock if we have a context and it's suspended
      if (!this.audioContext || this.audioContext.state !== 'suspended') {
        return;
      }

      // Prevent concurrent resume() calls
      if (this.resumeInProgress) {
        // Wait for existing resume to complete
        if (this.resumePromise) {
          await this.resumePromise;
        }
        return;
      }

      this.resumeInProgress = true;
      logger.audio.log('Unlocking AudioContext via user gesture');

      this.resumePromise = (async () => {
        try {
          await this.audioContext!.resume();
          logger.audio.log('AudioContext unlocked, state:', this.audioContext!.state);
        } catch (e) {
          logger.audio.error('Failed to unlock AudioContext:', e);
        } finally {
          this.resumeInProgress = false;
          this.resumePromise = null;
        }
      })();

      await this.resumePromise;
    };

    // Listen for various user gestures that can unlock audio
    // touchstart is crucial for mobile Chrome
    const events = ['touchstart', 'touchend', 'click', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, this.unlockHandler!, { once: false, passive: true });
    });

    logger.audio.log('Audio unlock listeners attached');
  }

  // Note: Audio unlock listeners are not removed because AudioEngine is a singleton
  // that persists for the lifetime of the application. If a dispose() method is
  // needed in the future, unlockHandler reference is available for cleanup.

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
   * Play a synthesizer note (real-time synthesis, not sample-based)
   */
  playSynthNote(
    noteId: string,
    presetName: string,
    semitone: number,
    time: number,
    duration?: number
  ): void {
    const preset = SYNTH_PRESETS[presetName];
    if (!preset) {
      logger.audio.warn(`playSynthNote: Unknown preset "${presetName}", falling back to "lead"`);
    }
    const actualPreset = preset || SYNTH_PRESETS.lead;
    const frequency = semitoneToFrequency(semitone);

    logger.audio.log(`playSynthNote: noteId=${noteId}, preset=${presetName}, freq=${frequency.toFixed(1)}Hz, time=${time.toFixed(3)}`);

    synthEngine.playNote(noteId, frequency, actualPreset, time, duration);
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

  /**
   * Check if Tone.js synths are initialized and ready.
   * Use this before playing tone:* or advanced:* presets.
   */
  isToneInitialized(): boolean {
    return this.toneInitialized;
  }

  /**
   * Check if Tone.js synths are ready for a specific preset type.
   */
  isToneSynthReady(presetType: 'tone' | 'advanced'): boolean {
    if (!this.toneInitialized) return false;
    if (presetType === 'tone') {
      return this.toneSynths !== null;
    }
    if (presetType === 'advanced') {
      return this.advancedSynth !== null;
    }
    return false;
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
    // Note: We don't await here because playSample is sync and called from scheduler
    // The ensureAudioReady() call in handlePlayPause awaits resume before playback starts
    if (this.audioContext.state === 'suspended') {
      logger.audio.log('Resuming suspended AudioContext');
      this.audioContext.resume().catch(err => {
        logger.audio.error('Failed to resume AudioContext:', err);
      });
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

  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0;
  }

  /**
   * Convert absolute Web Audio time to relative Tone.js time offset
   *
   * Phase 22: Centralizes Tone.js time conversion to prevent timing bugs.
   * Ensures the offset is always positive (at least 1ms in the future).
   *
   * @param webAudioTime Absolute Web Audio context time
   * @returns Safe relative time offset for Tone.js scheduling
   */
  private toToneRelativeTime(webAudioTime: number): number {
    const relativeTime = webAudioTime - this.getCurrentTime();
    // Ensure minimum 1ms offset to prevent "start time must be greater than previous" errors
    return Math.max(0.001, relativeTime);
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

  // ========================
  // Tone.js Integration API
  // ========================

  /**
   * Check if Tone.js is initialized
   */
  isToneReady(): boolean {
    return this.toneInitialized;
  }

  /**
   * Get current effects state for session persistence
   */
  getEffectsState(): EffectsState {
    return this.toneEffects?.getState() ?? { ...DEFAULT_EFFECTS_STATE };
  }

  /**
   * Apply effects state from session load or multiplayer sync
   */
  applyEffectsState(state: EffectsState): void {
    if (!this.toneEffects) {
      logger.audio.warn('Cannot apply effects state: Tone.js not initialized');
      return;
    }
    this.toneEffects.applyState(state);
  }

  /**
   * Set reverb wet amount (0 = dry, 1 = fully wet)
   */
  setReverbWet(wet: number): void {
    this.toneEffects?.setReverbWet(wet);
  }

  /**
   * Set reverb decay time in seconds
   */
  setReverbDecay(decay: number): void {
    this.toneEffects?.setReverbDecay(decay);
  }

  /**
   * Set delay wet amount
   */
  setDelayWet(wet: number): void {
    this.toneEffects?.setDelayWet(wet);
  }

  /**
   * Set delay time (e.g., "8n", "4n", "16n")
   */
  setDelayTime(time: string): void {
    this.toneEffects?.setDelayTime(time);
  }

  /**
   * Set delay feedback (0 to 0.95)
   */
  setDelayFeedback(feedback: number): void {
    this.toneEffects?.setDelayFeedback(feedback);
  }

  /**
   * Set chorus wet amount
   */
  setChorusWet(wet: number): void {
    this.toneEffects?.setChorusWet(wet);
  }

  /**
   * Set chorus frequency
   */
  setChorusFrequency(frequency: number): void {
    this.toneEffects?.setChorusFrequency(frequency);
  }

  /**
   * Set chorus depth
   */
  setChorusDepth(depth: number): void {
    this.toneEffects?.setChorusDepth(depth);
  }

  /**
   * Set distortion wet amount (0 = dry, 1 = fully wet)
   */
  setDistortionWet(wet: number): void {
    this.toneEffects?.setDistortionWet(wet);
  }

  /**
   * Set distortion amount (0 = clean, 1 = heavy distortion)
   */
  setDistortionAmount(amount: number): void {
    this.toneEffects?.setDistortionAmount(amount);
  }

  /**
   * Enable or disable all effects (bypass mode)
   */
  setEffectsEnabled(enabled: boolean): void {
    this.toneEffects?.setEnabled(enabled);
  }

  /**
   * Check if effects are enabled
   */
  areEffectsEnabled(): boolean {
    return this.toneEffects?.isEnabled() ?? false;
  }

  /**
   * Play a Tone.js synth note
   * Used for advanced synth types (FM, AM, Membrane, Metal, etc.)
   *
   * Phase 22: Now accepts absolute Web Audio time (consistent with other play methods).
   * Time conversion to Tone.js is handled internally.
   *
   * @param presetName Tone.js synth preset (e.g., "fm-epiano", "membrane-kick")
   * @param semitone Semitone offset from C4 (0 = C4, 12 = C5, -12 = C3)
   * @param time Absolute Web Audio context time to start playback
   * @param duration Note duration (e.g., "8n", "4n", or seconds)
   */
  playToneSynth(
    presetName: ToneSynthType,
    semitone: number,
    time: number,
    duration: string | number = '8n'
  ): void {
    if (!this.toneSynths) {
      logger.audio.warn('Cannot play Tone.js synth: not initialized');
      return;
    }

    const noteName = this.toneSynths.semitoneToNoteName(semitone);
    // Convert absolute Web Audio time to safe Tone.js relative time
    const toneTime = this.toToneRelativeTime(time);
    this.toneSynths.playNote(presetName, noteName, duration, toneTime);
  }

  /**
   * Get available Tone.js synth presets
   */
  getToneSynthPresets(): ToneSynthType[] {
    return this.toneSynths?.getPresetNames() ?? [];
  }

  /**
   * Check if a sample ID is a Tone.js synth
   */
  isToneSynthSample(sampleId: string): boolean {
    return isToneSynth(sampleId);
  }

  /**
   * Get Tone.js preset from sample ID
   */
  getToneSynthFromSampleId(sampleId: string): ToneSynthType | null {
    return getToneSynthPreset(sampleId);
  }

  // ========================
  // Advanced Synth API
  // ========================

  /**
   * Play an advanced synth note (dual oscillator, filter envelope, LFO)
   *
   * Phase 22: Now accepts absolute Web Audio time (consistent with other play methods).
   * Time conversion to Tone.js is handled internally.
   *
   * @param presetName Advanced synth preset (e.g., "supersaw", "wobble-bass")
   * @param semitone Semitone offset from C4 (0 = C4, 12 = C5, -12 = C3)
   * @param time Absolute Web Audio context time to start playback
   * @param duration Note duration in seconds
   */
  playAdvancedSynth(
    presetName: string,
    semitone: number,
    time: number,
    duration: number = 0.3
  ): void {
    if (!this.advancedSynth) {
      logger.audio.warn('Cannot play advanced synth: not initialized');
      return;
    }

    // Load the preset
    const preset = ADVANCED_SYNTH_PRESETS[presetName];
    if (!preset) {
      logger.audio.warn(`Unknown advanced synth preset: ${presetName}`);
      return;
    }

    this.advancedSynth.setPreset(presetName);
    // Convert absolute Web Audio time to safe Tone.js relative time
    const toneTime = this.toToneRelativeTime(time);
    this.advancedSynth.playNoteSemitone(semitone, duration, toneTime);
  }

  /**
   * Get available advanced synth presets
   */
  getAdvancedSynthPresets(): string[] {
    return Object.keys(ADVANCED_SYNTH_PRESETS);
  }

  /**
   * Check if a sample ID is an advanced synth
   */
  isAdvancedSynthSample(sampleId: string): boolean {
    return isAdvancedSynth(sampleId);
  }

  /**
   * Get advanced synth preset from sample ID
   */
  getAdvancedSynthFromSampleId(sampleId: string): string | null {
    return getAdvancedSynthPresetId(sampleId);
  }

  // ============================================================
  // Sampled Instruments (Phase 22)
  // ============================================================

  /**
   * Check if a preset name is a sampled instrument (e.g., 'piano')
   */
  isSampledInstrument(presetName: string): boolean {
    return isSampledInstrument(presetName);
  }

  /**
   * Check if a sampled instrument is ready for playback
   */
  isSampledInstrumentReady(instrumentId: string): boolean {
    const instrument = sampledInstrumentRegistry.get(instrumentId);
    return instrument?.isReady() ?? false;
  }

  /**
   * Load a sampled instrument (lazy loading)
   * Returns true if loaded successfully
   */
  async loadSampledInstrument(instrumentId: string): Promise<boolean> {
    return sampledInstrumentRegistry.load(instrumentId);
  }

  /**
   * Preload sampled instruments that are used by tracks
   * Call this when loading a session to ensure instruments are ready before playback
   *
   * Phase 23: Uses centralized collectSampledInstruments utility
   */
  async preloadInstrumentsForTracks(tracks: { sampleId: string }[]): Promise<void> {
    // Use centralized utility for consistent handling of synth: and sampled: prefixes
    const instrumentsToLoad = collectSampledInstruments(tracks);

    if (instrumentsToLoad.size === 0) {
      logger.audio.log('No sampled instruments to preload');
      return;
    }

    logger.audio.log(`Preloading sampled instruments: ${Array.from(instrumentsToLoad).join(', ')}`);

    // Load all needed instruments in parallel
    const loadResults = await Promise.all(
      Array.from(instrumentsToLoad).map(async id => {
        const success = await sampledInstrumentRegistry.load(id);
        return { id, success };
      })
    );

    // Log results with details
    const successful = loadResults.filter(r => r.success).map(r => r.id);
    const failed = loadResults.filter(r => !r.success).map(r => r.id);

    if (successful.length > 0) {
      logger.audio.log(`Preloaded sampled instruments: ${successful.join(', ')}`);
    }
    if (failed.length > 0) {
      logger.audio.warn(`Failed to preload sampled instruments: ${failed.join(', ')}`);
    }
  }

  /**
   * Play a sampled instrument note
   *
   * @param instrumentId The instrument to play (e.g., 'piano')
   * @param noteId Unique ID for this note instance
   * @param midiNote MIDI note number (60 = C4)
   * @param time Absolute Web Audio time to start (currently ignored - plays immediately)
   * @param duration Note duration in seconds
   * @param volume Note volume (0-1)
   */
  playSampledInstrument(
    instrumentId: string,
    noteId: string,
    midiNote: number,
    _time: number,
    duration: number = 0.3,
    volume: number = 1
  ): void {
    const instrument = sampledInstrumentRegistry.get(instrumentId);
    if (!instrument) {
      logger.audio.warn(`Cannot play sampled instrument: ${instrumentId} not registered`);
      return;
    }

    if (!instrument.isReady()) {
      logger.audio.warn(`Cannot play sampled instrument: ${instrumentId} not loaded`);
      return;
    }

    instrument.playNote(noteId, midiNote, 0, duration, volume);
  }

  /**
   * Get the loading state of a sampled instrument (for UI)
   * Phase 23: Exposes loading state for UI components
   */
  getSampledInstrumentState(instrumentId: string): 'idle' | 'loading' | 'ready' | 'error' {
    return sampledInstrumentRegistry.getState(instrumentId);
  }

  /**
   * Subscribe to sampled instrument state changes (for UI updates)
   * Phase 23: Returns unsubscribe function
   */
  onSampledInstrumentStateChange(
    callback: (instrumentId: string, state: 'idle' | 'loading' | 'ready' | 'error', error?: Error) => void
  ): () => void {
    return sampledInstrumentRegistry.onStateChange(callback);
  }

  /**
   * Acquire cache references for a sampled instrument
   * Phase 23: Call when a track starts using this instrument
   */
  acquireInstrumentSamples(instrumentId: string): void {
    sampledInstrumentRegistry.acquireInstrumentSamples(instrumentId);
  }

  /**
   * Release cache references for a sampled instrument
   * Phase 23: Call when a track stops using this instrument
   */
  releaseInstrumentSamples(instrumentId: string): void {
    sampledInstrumentRegistry.releaseInstrumentSamples(instrumentId);
  }
}

// Singleton instance
export const audioEngine = new AudioEngine();

// Re-export types for convenience
export type { EffectsState, ToneSynthType };
