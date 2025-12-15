/**
 * Tone.js Sampler Integration
 *
 * This module provides sampled instruments using Tone.js Sampler,
 * following the spec in specs/SYNTHESIS-ENGINE.md Section 2.3
 *
 * Features:
 * - Auto-pitch-shifting between sampled notes
 * - Lazy loading (samples load on first use)
 * - Multi-sampling (one sample per octave for natural sound)
 *
 * Instrument samples are hosted on R2 or CDN.
 */

import * as Tone from 'tone';
import { logger } from '../utils/logger';
import { C4_FREQUENCY, NOTE_NAMES } from './constants';

/**
 * Sampler instrument configuration
 */
export interface SamplerInstrumentConfig {
  name: string;
  samples: Record<string, string>; // Note name -> filename
  baseUrl: string;
  envelope?: {
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
  };
}

/**
 * Available sampler instrument IDs
 */
export type SamplerInstrumentId = 'piano' | 'strings' | 'brass' | 'electric-piano';

/**
 * Sampler instrument definitions
 *
 * Each instrument has samples at key notes (typically C at each octave).
 * Tone.js Sampler automatically repitches to fill in the gaps.
 *
 * Sample URLs are relative to baseUrl.
 */
export const SAMPLER_INSTRUMENTS: Record<SamplerInstrumentId, SamplerInstrumentConfig> = {
  'piano': {
    name: 'Piano',
    baseUrl: '/api/samples/instruments/piano/',
    samples: {
      'C2': 'C2.mp3',
      'C3': 'C3.mp3',
      'C4': 'C4.mp3',
      'C5': 'C5.mp3',
      'C6': 'C6.mp3',
    },
    envelope: {
      attack: 0.001,
      decay: 0.2,
      sustain: 0.8,
      release: 1.0,
    },
  },
  'strings': {
    name: 'Strings',
    baseUrl: '/api/samples/instruments/strings/',
    samples: {
      'C2': 'C2.mp3',
      'C3': 'C3.mp3',
      'C4': 'C4.mp3',
      'C5': 'C5.mp3',
    },
    envelope: {
      attack: 0.3,
      decay: 0.1,
      sustain: 0.9,
      release: 0.5,
    },
  },
  'brass': {
    name: 'Brass',
    baseUrl: '/api/samples/instruments/brass/',
    samples: {
      'C3': 'C3.mp3',
      'C4': 'C4.mp3',
      'C5': 'C5.mp3',
    },
    envelope: {
      attack: 0.1,
      decay: 0.1,
      sustain: 0.8,
      release: 0.3,
    },
  },
  'electric-piano': {
    name: 'Electric Piano',
    baseUrl: '/api/samples/instruments/electric-piano/',
    samples: {
      'C3': 'C3.mp3',
      'C4': 'C4.mp3',
      'C5': 'C5.mp3',
    },
    envelope: {
      attack: 0.01,
      decay: 0.3,
      sustain: 0.5,
      release: 0.8,
    },
  },
};

/**
 * ToneSamplerInstrument - Wraps Tone.js Sampler for sampled playback
 *
 * Provides lazy loading and semitone-based note triggering.
 */
export class ToneSamplerInstrument {
  private sampler: Tone.Sampler | null = null;
  private output: Tone.Gain | null = null;
  private instrumentId: SamplerInstrumentId;
  private config: SamplerInstrumentConfig;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(instrumentId: SamplerInstrumentId) {
    const config = SAMPLER_INSTRUMENTS[instrumentId];
    if (!config) {
      throw new Error(`Unknown sampler instrument: ${instrumentId}`);
    }
    this.instrumentId = instrumentId;
    this.config = config;
  }

  /**
   * Get the instrument ID
   */
  getInstrumentId(): SamplerInstrumentId {
    return this.instrumentId;
  }

  /**
   * Check if samples are loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Load samples (lazy loading - call before first use)
   * Returns a promise that resolves when samples are loaded.
   * Multiple calls return the same promise.
   */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;

    logger.audio.log(`Loading sampler: ${this.instrumentId}...`);

    this.loadPromise = new Promise<void>((resolve, reject) => {
      try {
        // Create output gain node
        this.output = new Tone.Gain(0.8);

        // Create sampler with samples
        this.sampler = new Tone.Sampler({
          urls: this.config.samples,
          baseUrl: this.config.baseUrl,
          onload: () => {
            this.loaded = true;
            logger.audio.log(`Sampler loaded: ${this.instrumentId}`);
            resolve();
          },
          onerror: (err: Error) => {
            logger.audio.error(`Failed to load sampler ${this.instrumentId}:`, err);
            // Clear loadPromise to allow retry
            this.loadPromise = null;
            reject(err);
          },
        });

        // Connect to output
        this.sampler.connect(this.output);

      } catch (err) {
        logger.audio.error(`Error creating sampler ${this.instrumentId}:`, err);
        // Clear loadPromise to allow retry
        this.loadPromise = null;
        reject(err);
      }
    });

    return this.loadPromise;
  }

  /**
   * Get the output node for connecting to effects chain
   */
  getOutput(): Tone.Gain | null {
    return this.output;
  }

  /**
   * Play a note by name (e.g., "C4", "F#5")
   */
  playNote(
    note: string,
    duration: string | number,
    time: number
  ): void {
    if (!this.loaded || !this.sampler) {
      logger.audio.warn(`Sampler ${this.instrumentId} not loaded`);
      return;
    }

    const startTime = time + Tone.now();
    this.sampler.triggerAttackRelease(note, duration, startTime);
  }

  /**
   * Play a note by semitone offset from C4
   * @param semitone Semitone offset (0 = C4, 12 = C5, -12 = C3)
   */
  playNoteSemitone(
    semitone: number,
    duration: string | number,
    time: number
  ): void {
    const noteName = this.semitoneToNoteName(semitone);
    this.playNote(noteName, duration, time);
  }

  /**
   * Convert semitone offset from C4 to note name
   * @param semitone Semitone offset (0 = C4, 12 = C5, -12 = C3)
   * @returns Note name like "C4", "F#5", etc.
   */
  semitoneToNoteName(semitone: number): string {
    // C4 is semitone 0
    const baseOctave = 4;
    const baseSemitone = 0; // C

    const absoluteSemitone = semitone + (baseOctave * 12) + baseSemitone;
    const octave = Math.floor(absoluteSemitone / 12);
    const noteIndex = ((absoluteSemitone % 12) + 12) % 12;

    return `${NOTE_NAMES[noteIndex]}${octave}`;
  }

  /**
   * Convert semitone offset from C4 to frequency
   */
  semitoneToFrequency(semitone: number): number {
    return C4_FREQUENCY * Math.pow(2, semitone / 12);
  }

  /**
   * Dispose sampler resources
   */
  dispose(): void {
    if (this.sampler) {
      this.sampler.dispose();
      this.sampler = null;
    }
    if (this.output) {
      this.output.dispose();
      this.output = null;
    }
    this.loaded = false;
    this.loadPromise = null;
    logger.audio.log(`Sampler disposed: ${this.instrumentId}`);
  }
}

/**
 * Sampler manager for caching loaded samplers
 */
class SamplerManager {
  private samplers: Map<SamplerInstrumentId, ToneSamplerInstrument> = new Map();

  /**
   * Get or create a sampler for an instrument
   */
  getSampler(instrumentId: SamplerInstrumentId): ToneSamplerInstrument {
    let sampler = this.samplers.get(instrumentId);
    if (!sampler) {
      sampler = new ToneSamplerInstrument(instrumentId);
      this.samplers.set(instrumentId, sampler);
    }
    return sampler;
  }

  /**
   * Load a sampler (creates if needed)
   */
  async loadSampler(instrumentId: SamplerInstrumentId): Promise<ToneSamplerInstrument> {
    const sampler = this.getSampler(instrumentId);
    await sampler.load();
    return sampler;
  }

  /**
   * Dispose all samplers
   */
  disposeAll(): void {
    for (const sampler of this.samplers.values()) {
      sampler.dispose();
    }
    this.samplers.clear();
  }
}

// Singleton sampler manager
let samplerManagerInstance: SamplerManager | null = null;

/**
 * Get the singleton sampler manager
 */
export function getSamplerManager(): SamplerManager {
  if (!samplerManagerInstance) {
    samplerManagerInstance = new SamplerManager();
  }
  return samplerManagerInstance;
}

/**
 * Check if a sample ID is a sampler instrument
 * Format: "sampler:piano", "sampler:strings", etc.
 */
export function isSamplerInstrument(sampleId: string): boolean {
  return sampleId.startsWith('sampler:');
}

/**
 * Extract the instrument ID from a sampler sample ID
 */
export function getSamplerInstrumentId(sampleId: string): SamplerInstrumentId | null {
  if (!isSamplerInstrument(sampleId)) return null;
  const instrumentId = sampleId.replace('sampler:', '') as SamplerInstrumentId;
  return SAMPLER_INSTRUMENTS[instrumentId] ? instrumentId : null;
}

/**
 * Get available sampler instrument IDs
 */
export function getSamplerInstrumentIds(): SamplerInstrumentId[] {
  return Object.keys(SAMPLER_INSTRUMENTS) as SamplerInstrumentId[];
}
