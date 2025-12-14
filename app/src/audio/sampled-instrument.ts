/**
 * Sampled Instrument Engine - Phase 21A
 *
 * Handles loading and playback of multi-sampled instruments (piano, strings, etc.)
 * stored in R2. Uses pitch-shifting to fill gaps between sampled notes.
 *
 * Key design decisions:
 * - Lazy loading: samples load on first use, not at startup
 * - Pitch mapping: finds nearest sample and pitch-shifts to target note
 * - Memory efficient: one sample per octave (C2, C3, C4, C5) covers full range
 * - Graceful fallback: if loading fails, falls back to synth preset
 */

import { logger } from '../utils/logger';

/**
 * Manifest file format for sampled instruments.
 * Stored alongside samples in R2.
 */
export interface InstrumentManifest {
  id: string;              // e.g., 'piano'
  name: string;            // e.g., 'Grand Piano'
  type: 'sampled';
  samples: SampleMapping[];
  baseNote: number;        // MIDI note of the "center" sample (default pitch reference)
  releaseTime: number;     // Seconds for note release
}

export interface SampleMapping {
  note: number;            // MIDI note number (C4 = 60)
  file: string;            // Filename (e.g., 'C4.mp3')
}

/**
 * Loaded sample with its audio buffer.
 */
interface LoadedSample {
  note: number;
  buffer: AudioBuffer;
}

/**
 * SampledInstrument handles loading and playback for a single instrument.
 */
export class SampledInstrument {
  private audioContext: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private manifest: InstrumentManifest | null = null;
  private samples: Map<number, AudioBuffer> = new Map();
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

    // Load all samples in parallel
    const loadPromises = this.manifest!.samples.map(async (mapping) => {
      const sampleUrl = `${this.baseUrl}/${mapping.file}`;
      logger.audio.log(`Loading sample ${mapping.file} (note ${mapping.note})`);

      const response = await fetch(sampleUrl);
      if (!response.ok) {
        throw new Error(`Failed to load sample ${mapping.file}: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);

      return { note: mapping.note, buffer: audioBuffer } as LoadedSample;
    });

    const loadedSamples = await Promise.all(loadPromises);

    // Store in map
    for (const sample of loadedSamples) {
      this.samples.set(sample.note, sample.buffer);
    }

    this.isLoaded = true;
    logger.audio.log(`Instrument ${this.manifest?.name} fully loaded`);
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
    noteId: string,
    midiNote: number,
    time: number,
    duration?: number,
    volume: number = 1
  ): AudioBufferSourceNode | null {
    if (!this.audioContext || !this.destination || !this.isLoaded || !this.manifest) {
      logger.audio.warn('SampledInstrument not ready for playback');
      return null;
    }

    // Find nearest sample
    const { buffer, pitchRatio } = this.findNearestSample(midiNote);
    if (!buffer) {
      logger.audio.warn(`No sample found for note ${midiNote}`);
      return null;
    }

    // Create source node
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitchRatio;

    // Create gain for volume and release envelope
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = volume;

    // Connect: source -> gain -> destination
    source.connect(gainNode);
    gainNode.connect(this.destination);

    // Start playback
    source.start(time);

    // Handle duration and release
    if (duration !== undefined) {
      const releaseTime = this.manifest.releaseTime;
      const stopTime = time + duration;

      // Apply release envelope
      gainNode.gain.setValueAtTime(volume, stopTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, stopTime + releaseTime);

      // Stop source after release
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
   */
  private findNearestSample(midiNote: number): { buffer: AudioBuffer | null; pitchRatio: number } {
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

    const buffer = this.samples.get(nearestNote) || null;

    // Calculate pitch ratio: 2^(semitones/12)
    const semitoneOffset = midiNote - nearestNote;
    const pitchRatio = Math.pow(2, semitoneOffset / 12);

    return { buffer, pitchRatio };
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
 * Registry of all sampled instruments.
 * Handles lazy loading and provides a unified interface.
 */
class SampledInstrumentRegistry {
  private instruments: Map<string, SampledInstrument> = new Map();
  private audioContext: AudioContext | null = null;
  private destination: AudioNode | null = null;

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
   */
  async load(instrumentId: string): Promise<boolean> {
    const instrument = this.instruments.get(instrumentId);
    if (!instrument) return false;
    return instrument.ensureLoaded();
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
  'piano',  // Phase 21A: First sampled instrument
  // Future: 'strings', 'brass', 'vibraphone', etc.
] as const;

export type SampledInstrumentId = typeof SAMPLED_INSTRUMENTS[number];

/**
 * Check if a sample ID is a sampled instrument (vs synth preset).
 */
export function isSampledInstrument(sampleId: string): boolean {
  return SAMPLED_INSTRUMENTS.includes(sampleId as SampledInstrumentId);
}
