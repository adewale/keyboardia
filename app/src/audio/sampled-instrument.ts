/**
 * Sampled Instrument Engine - Phase 22
 *
 * Handles loading and playback of multi-sampled instruments (piano, strings, etc.)
 * stored in R2. Uses pitch-shifting to fill gaps between sampled notes.
 *
 * Key design decisions:
 * - Progressive loading: C4 loads first for fast initial playback, rest load in background
 * - Piano preloads during AudioEngine.initialize() to be ready before first note
 * - Pitch mapping: finds nearest sample and pitch-shifts to target note
 * - Memory efficient: one sample per octave (C2, C3, C4, C5) covers full range
 * - NO synth fallback: sampled instruments never fall back to synth (would confuse users)
 */

import { logger } from '../utils/logger';

/**
 * Manifest file format for sampled instruments.
 * Stored alongside samples in R2 or local assets.
 *
 * Supports two modes:
 * - Individual files: Each sample is a separate file (file: 'C4.mp3')
 * - Audio sprite: All samples in one file with timing offsets (offset/duration)
 */
export interface InstrumentManifest {
  id: string;              // e.g., 'piano'
  name: string;            // e.g., 'Grand Piano'
  type: 'sampled';
  sprite?: string;         // If using audio sprite: the sprite filename (e.g., 'mf.mp3')
  samples: SampleMapping[];
  baseNote: number;        // MIDI note of the "center" sample (default pitch reference)
  releaseTime: number;     // Seconds for note release
  credits?: {              // Attribution for samples
    source: string;        // Source name
    url: string;           // Source URL
    license: string;       // License type
  };
}

export interface SampleMapping {
  note: number;            // MIDI note number (C4 = 60)
  file?: string;           // Filename for individual file mode (e.g., 'C4.mp3')
  offset?: number;         // Sprite mode: start time in seconds
  duration?: number;       // Sprite mode: duration in seconds
}

/**
 * Loaded sample with its audio buffer and optional timing.
 */
interface LoadedSample {
  note: number;
  buffer: AudioBuffer;
  offset?: number;      // For sprite mode: start offset in seconds
  duration?: number;    // For sprite mode: duration in seconds
}

/**
 * SampledInstrument handles loading and playback for a single instrument.
 */
export class SampledInstrument {
  private audioContext: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private manifest: InstrumentManifest | null = null;
  private samples: Map<number, LoadedSample> = new Map();
  private spriteBuffer: AudioBuffer | null = null;  // For sprite mode
  private loadingPromise: Promise<void> | null = null;
  private isLoaded = false;
  private baseUrl: string;

  constructor(instrumentId: string, baseUrl: string = '/instruments') {
    this.baseUrl = `${baseUrl}/${instrumentId}`;
  }

  /**
   * Initialize with audio context and destination node.
   * Must be called before loading or playing.
   */
  initialize(audioContext: AudioContext, destination: AudioNode): void {
    this.audioContext = audioContext;
    this.destination = destination;

    // DIAGNOSTIC: Log destination details for debugging
    logger.audio.log(`SampledInstrument initialized with destination:`, {
      type: destination.constructor.name,
      numberOfInputs: destination.numberOfInputs,
      numberOfOutputs: destination.numberOfOutputs,
      channelCount: destination.channelCount,
      contextState: audioContext.state,
    });
  }

  /**
   * Ensure the instrument is loaded.
   * Returns immediately if already loaded.
   * Safe to call multiple times (deduplicates concurrent loads).
   */
  async ensureLoaded(): Promise<boolean> {
    if (this.isLoaded) return true;
    if (this.loadingPromise) {
      await this.loadingPromise;
      return this.isLoaded;
    }

    this.loadingPromise = this.loadInstrument();

    try {
      await this.loadingPromise;
      return this.isLoaded;
    } catch (error) {
      logger.audio.error('Failed to load sampled instrument:', error);
      return false;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Load the instrument manifest and all samples.
   * Supports both individual file mode and audio sprite mode.
   */
  private async loadInstrument(): Promise<void> {
    if (!this.audioContext) {
      throw new Error('SampledInstrument not initialized');
    }

    // Load manifest
    const manifestUrl = `${this.baseUrl}/manifest.json`;
    logger.audio.log(`Loading instrument manifest from ${manifestUrl}`);

    const manifestResponse = await fetch(manifestUrl);
    if (!manifestResponse.ok) {
      throw new Error(`Failed to load manifest: ${manifestResponse.status}`);
    }

    this.manifest = await manifestResponse.json();
    logger.audio.log(`Loaded manifest for ${this.manifest?.name}: ${this.manifest?.samples.length} samples`);

    // Check if using sprite mode or individual files
    if (this.manifest!.sprite) {
      await this.loadSprite();
      this.isLoaded = true;  // Sprite mode loads all at once
    } else {
      // Individual file mode sets isLoaded after first sample (progressive)
      await this.loadIndividualFiles();
    }

    logger.audio.log(`Instrument ${this.manifest?.name} ready for playback`);
  }

  /**
   * Load audio sprite mode: single file with multiple samples at offsets.
   */
  private async loadSprite(): Promise<void> {
    const spriteUrl = `${this.baseUrl}/${this.manifest!.sprite}`;
    logger.audio.log(`Loading audio sprite from ${spriteUrl}`);

    const response = await fetch(spriteUrl);
    if (!response.ok) {
      throw new Error(`Failed to load sprite: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    this.spriteBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
    logger.audio.log(`Sprite loaded: ${this.spriteBuffer.duration.toFixed(1)}s`);

    // Store sample mappings with offset/duration from manifest
    for (const mapping of this.manifest!.samples) {
      this.samples.set(mapping.note, {
        note: mapping.note,
        buffer: this.spriteBuffer,
        offset: mapping.offset,
        duration: mapping.duration,
      });
    }
  }

  /**
   * Load individual file mode: separate file per sample.
   * Uses progressive loading: C4 (middle C) first for fastest playback,
   * then remaining samples load in background.
   */
  private async loadIndividualFiles(): Promise<void> {
    // Sort samples by priority: C4 (60) first, then by distance from C4
    const sortedMappings = [...this.manifest!.samples].sort((a, b) => {
      // C4 (note 60) has highest priority
      if (a.note === 60) return -1;
      if (b.note === 60) return 1;
      // Then sort by distance from C4
      return Math.abs(a.note - 60) - Math.abs(b.note - 60);
    });

    // Load first sample (C4) immediately for fast initial playback
    const firstMapping = sortedMappings[0];
    const firstSample = await this.loadSingleSample(firstMapping);
    this.samples.set(firstSample.note, firstSample);
    logger.audio.log(`[PROGRESSIVE] First sample ready: note ${firstSample.note}, playback enabled`);

    // Mark as loaded after first sample - playback can start now
    // findNearestSample will use C4 for all notes until others load
    this.isLoaded = true;

    // Load remaining samples in background (fire-and-forget)
    const remainingMappings = sortedMappings.slice(1);
    if (remainingMappings.length > 0) {
      this.loadRemainingSamples(remainingMappings);
    }
  }

  /**
   * Load remaining samples in background after initial sample is ready.
   */
  private async loadRemainingSamples(mappings: SampleMapping[]): Promise<void> {
    try {
      const promises = mappings.map(m => this.loadSingleSample(m));
      const samples = await Promise.all(promises);
      for (const sample of samples) {
        this.samples.set(sample.note, sample);
      }
      logger.audio.log(`[PROGRESSIVE] All ${this.samples.size} samples loaded`);
    } catch (error) {
      logger.audio.error(`[PROGRESSIVE] Failed to load remaining samples:`, error);
    }
  }

  /**
   * Load a single sample file.
   */
  private async loadSingleSample(mapping: SampleMapping): Promise<LoadedSample> {
    const sampleUrl = `${this.baseUrl}/${mapping.file}`;
    logger.audio.log(`Loading sample ${mapping.file} (note ${mapping.note})`);

    const response = await fetch(sampleUrl);
    if (!response.ok) {
      throw new Error(`Failed to load sample ${mapping.file}: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
    return { note: mapping.note, buffer: audioBuffer };
  }

  /**
   * Play a note at the given MIDI pitch.
   *
   * @param noteId - Unique ID for this note (for stopping)
   * @param midiNote - MIDI note number (60 = middle C)
   * @param time - AudioContext time to start
   * @param duration - Note duration in seconds (undefined = sustained until stop)
   * @param volume - Note volume (0-1)
   */
  playNote(
    _noteId: string, // Reserved for future stop functionality
    midiNote: number,
    _time: number, // Currently unused - we play immediately
    duration?: number,
    volume: number = 1
  ): AudioBufferSourceNode | null {
    if (!this.audioContext || !this.destination || !this.isLoaded || !this.manifest) {
      return null;
    }

    // Ensure AudioContext is running (required for iOS/mobile)
    if (this.audioContext.state !== 'running') {
      this.audioContext.resume();
    }

    // Find nearest sample and calculate pitch ratio
    const sampleInfo = this.findNearestSample(midiNote);
    if (!sampleInfo.buffer) {
      return null;
    }

    // Create source with pitch shifting
    const source = this.audioContext.createBufferSource();
    source.buffer = sampleInfo.buffer;
    source.playbackRate.value = sampleInfo.pitchRatio;

    // Create gain for volume
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = volume;

    // Connect audio chain: source -> gainNode -> destination
    // The destination is a stable reference set at initialization (masterGain)
    // Trust it - the audio chain is immutable after init
    source.connect(gainNode);
    gainNode.connect(this.destination!);

    // Start immediately
    source.start();

    // Handle duration with release envelope
    if (duration !== undefined) {
      const currentTime = this.audioContext.currentTime;
      const releaseTime = this.manifest.releaseTime;
      const effectiveDuration = Math.max(duration, 0.1);
      const stopTime = currentTime + effectiveDuration;

      // Apply release envelope
      gainNode.gain.setValueAtTime(volume, stopTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, stopTime + releaseTime);
      source.stop(stopTime + releaseTime + 0.01);
    }

    // Memory cleanup when done
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
    };

    return source;
  }

  /**
   * Find the nearest sample to the requested MIDI note
   * and calculate the pitch ratio needed.
   *
   * Returns buffer, pitch ratio, and optional offset/duration for sprite mode.
   */
  private findNearestSample(midiNote: number): {
    buffer: AudioBuffer | null;
    pitchRatio: number;
    offset?: number;
    sampleDuration?: number;
  } {
    if (this.samples.size === 0) {
      return { buffer: null, pitchRatio: 1 };
    }

    // Find the nearest sampled note
    let nearestNote = -1;
    let minDistance = Infinity;

    for (const sampleNote of this.samples.keys()) {
      const distance = Math.abs(midiNote - sampleNote);
      if (distance < minDistance) {
        minDistance = distance;
        nearestNote = sampleNote;
      }
    }

    const sample = this.samples.get(nearestNote);
    if (!sample) {
      return { buffer: null, pitchRatio: 1 };
    }

    // Calculate pitch ratio: 2^(semitones/12)
    const semitoneOffset = midiNote - nearestNote;
    const pitchRatio = Math.pow(2, semitoneOffset / 12);

    return {
      buffer: sample.buffer,
      pitchRatio,
      offset: sample.offset,
      sampleDuration: sample.duration,
    };
  }

  /**
   * Check if the instrument is loaded and ready.
   */
  isReady(): boolean {
    return this.isLoaded;
  }

  /**
   * Get the instrument name (for display).
   */
  getName(): string {
    return this.manifest?.name || 'Unknown';
  }
}

/**
 * Loading state for observable state pattern.
 */
export type InstrumentState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Callback for state change notifications.
 */
export type StateChangeCallback = (
  instrumentId: string,
  state: InstrumentState,
  error?: Error
) => void;

/**
 * Registry of all sampled instruments.
 * Handles lazy loading and provides a unified interface.
 *
 * Implements Observable State Pattern (Phase 22 refactoring):
 * - getState(id) - Get current loading state
 * - getError(id) - Get error if in error state
 * - onStateChange(callback) - Subscribe to state changes
 * - retry(id) - Retry loading after error
 */
export class SampledInstrumentRegistry {
  private instruments: Map<string, SampledInstrument> = new Map();
  private audioContext: AudioContext | null = null;
  private destination: AudioNode | null = null;

  // Observable state
  private states: Map<string, InstrumentState> = new Map();
  private errors: Map<string, Error> = new Map();
  private listeners: Set<StateChangeCallback> = new Set();

  /**
   * Initialize the registry with audio context.
   */
  initialize(audioContext: AudioContext, destination: AudioNode): void {
    this.audioContext = audioContext;
    this.destination = destination;

    // Initialize any already-registered instruments
    for (const instrument of this.instruments.values()) {
      instrument.initialize(audioContext, destination);
    }
  }

  /**
   * Register a sampled instrument.
   * Call this at startup to make instruments available.
   */
  register(instrumentId: string, baseUrl?: string): void {
    if (this.instruments.has(instrumentId)) return;

    const instrument = new SampledInstrument(instrumentId, baseUrl);
    if (this.audioContext && this.destination) {
      instrument.initialize(this.audioContext, this.destination);
    }
    this.instruments.set(instrumentId, instrument);
    this.states.set(instrumentId, 'idle');
  }

  /**
   * Get an instrument by ID.
   * Returns undefined if not registered.
   */
  get(instrumentId: string): SampledInstrument | undefined {
    return this.instruments.get(instrumentId);
  }

  /**
   * Check if an instrument is registered.
   */
  has(instrumentId: string): boolean {
    return this.instruments.has(instrumentId);
  }

  /**
   * Load an instrument (lazy load on demand).
   * Updates state: idle -> loading -> ready/error
   */
  async load(instrumentId: string): Promise<boolean> {
    const instrument = this.instruments.get(instrumentId);
    if (!instrument) return false;

    // Transition to loading state
    this.setState(instrumentId, 'loading');

    try {
      const success = await instrument.ensureLoaded();
      if (success) {
        this.setState(instrumentId, 'ready');
      } else {
        this.setState(instrumentId, 'error', new Error('Failed to load instrument'));
      }
      return success;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.setState(instrumentId, 'error', err);
      return false;
    }
  }

  /**
   * Retry loading an instrument after error.
   */
  async retry(instrumentId: string): Promise<boolean> {
    // Clear error state and retry
    this.errors.delete(instrumentId);
    this.states.set(instrumentId, 'idle');
    return this.load(instrumentId);
  }

  /**
   * Get the current loading state for an instrument.
   */
  getState(instrumentId: string): InstrumentState {
    return this.states.get(instrumentId) ?? 'idle';
  }

  /**
   * Get the error for an instrument (if in error state).
   */
  getError(instrumentId: string): Error | null {
    return this.errors.get(instrumentId) ?? null;
  }

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Update state and notify listeners.
   */
  private setState(instrumentId: string, state: InstrumentState, error?: Error): void {
    this.states.set(instrumentId, state);
    if (error) {
      this.errors.set(instrumentId, error);
    } else {
      this.errors.delete(instrumentId);
    }
    // Notify all listeners
    for (const listener of this.listeners) {
      listener(instrumentId, state, error);
    }
  }

  /**
   * Get all registered instrument IDs.
   */
  getInstrumentIds(): string[] {
    return Array.from(this.instruments.keys());
  }
}

// Singleton registry
export const sampledInstrumentRegistry = new SampledInstrumentRegistry();

/**
 * List of available sampled instruments.
 * These will be registered at startup.
 */
export const SAMPLED_INSTRUMENTS = [
  'piano',  // Phase 22: First sampled instrument
  // Phase 25 remaining: 'strings', 'brass', 'vibraphone', etc.
] as const;

export type SampledInstrumentId = typeof SAMPLED_INSTRUMENTS[number];

/**
 * Check if a sample ID is a sampled instrument (vs synth preset).
 */
export function isSampledInstrument(sampleId: string): boolean {
  return SAMPLED_INSTRUMENTS.includes(sampleId as SampledInstrumentId);
}
