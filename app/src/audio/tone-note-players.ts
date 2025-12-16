/**
 * Tone.js NotePlayer Implementations
 *
 * Concrete implementations of the NotePlayer interface for:
 * - Basic Web Audio synths (synth:*)
 * - Tone.js synths (tone:*)
 * - Advanced dual-oscillator synths (advanced:*)
 * - Sample playback (regular samples)
 *
 * Each player knows its prefix and checks readiness before playing.
 */

import type { NotePlayer } from './note-player';
import { notePlayerRegistry } from './note-player';
import { audioEngine } from './engine';
import { logger } from '../utils/logger';

/**
 * SynthNotePlayer - plays notes using basic Web Audio synth engine.
 * Handles presets with "synth:" prefix.
 * Always ready after AudioEngine initializes (no async loading).
 */
export class SynthNotePlayer implements NotePlayer {
  private prefix = 'synth:';

  canHandle(preset: string): boolean {
    return preset.startsWith(this.prefix);
  }

  isReady(_preset: string): boolean {
    // Basic synth is ready as soon as AudioEngine initializes
    return audioEngine.isInitialized();
  }

  play(preset: string, semitone: number, time: number, duration?: number): void {
    if (!this.isReady(preset)) {
      logger.audio.warn(`SynthNotePlayer not ready for ${preset}`);
      return;
    }

    const presetName = preset.replace(this.prefix, '');
    // Generate unique noteId for voice management
    const noteId = `synth-${presetName}-${semitone}-${Date.now()}`;
    audioEngine.playSynthNote(noteId, presetName, semitone, time, duration ?? 0.3);
  }

  async ensureReady(_preset: string): Promise<void> {
    // Wait for AudioEngine to initialize
    if (!audioEngine.isInitialized()) {
      await audioEngine.initialize();
    }
  }
}

/**
 * ToneSynthNotePlayer - plays notes using Tone.js synthesizers.
 * Handles presets with "tone:" prefix (FM, AM, Membrane, Metal, etc.)
 * Requires Tone.js initialization before playing.
 */
export class ToneSynthNotePlayer implements NotePlayer {
  private prefix = 'tone:';
  private initPromise: Promise<void> | null = null;

  canHandle(preset: string): boolean {
    return preset.startsWith(this.prefix);
  }

  isReady(_preset: string): boolean {
    return audioEngine.isToneSynthReady('tone');
  }

  play(preset: string, semitone: number, time: number, duration?: number): void {
    if (!this.isReady(preset)) {
      logger.audio.warn(`ToneSynthNotePlayer not ready for ${preset}`);
      return;
    }

    const presetName = preset.replace(this.prefix, '');
    audioEngine.playToneSynth(
      presetName as Parameters<typeof audioEngine.playToneSynth>[0],
      semitone,
      time,
      duration ?? '8n'
    );
  }

  async ensureReady(_preset: string): Promise<void> {
    if (this.isReady(_preset)) return;

    // Track initialization state
    notePlayerRegistry.setState('tone', 'initializing');

    if (!this.initPromise) {
      this.initPromise = audioEngine.initializeTone().then(() => {
        notePlayerRegistry.setState('tone', 'ready');
      }).catch(err => {
        notePlayerRegistry.setState('tone', 'error', err);
        this.initPromise = null;
        throw err;
      });
    }

    await this.initPromise;
  }
}

/**
 * AdvancedSynthNotePlayer - plays notes using the advanced dual-oscillator engine.
 * Handles presets with "advanced:" prefix (supersaw, wobble-bass, etc.)
 * Requires Tone.js initialization before playing.
 */
export class AdvancedSynthNotePlayer implements NotePlayer {
  private prefix = 'advanced:';
  private initPromise: Promise<void> | null = null;

  canHandle(preset: string): boolean {
    return preset.startsWith(this.prefix);
  }

  isReady(_preset: string): boolean {
    return audioEngine.isToneSynthReady('advanced');
  }

  play(preset: string, semitone: number, time: number, duration?: number): void {
    if (!this.isReady(preset)) {
      logger.audio.warn(`AdvancedSynthNotePlayer not ready for ${preset}`);
      return;
    }

    const presetName = preset.replace(this.prefix, '');
    audioEngine.playAdvancedSynth(presetName, semitone, time, duration ?? 0.3);
  }

  async ensureReady(_preset: string): Promise<void> {
    if (this.isReady(_preset)) return;

    // Track initialization state
    notePlayerRegistry.setState('advanced', 'initializing');

    if (!this.initPromise) {
      this.initPromise = audioEngine.initializeTone().then(() => {
        notePlayerRegistry.setState('advanced', 'ready');
      }).catch(err => {
        notePlayerRegistry.setState('advanced', 'error', err);
        this.initPromise = null;
        throw err;
      });
    }

    await this.initPromise;
  }
}

/**
 * SampleNotePlayer - plays audio samples (drums, effects).
 * Handles presets without any prefix (kick, snare, hihat, etc.)
 * Always ready after samples are loaded.
 */
export class SampleNotePlayer implements NotePlayer {
  canHandle(preset: string): boolean {
    // Handle anything that doesn't have a synth prefix
    return !preset.startsWith('synth:') &&
           !preset.startsWith('tone:') &&
           !preset.startsWith('advanced:');
  }

  isReady(_preset: string): boolean {
    return audioEngine.isInitialized();
  }

  play(preset: string, semitone: number, time: number, duration?: number): void {
    if (!this.isReady(preset)) {
      logger.audio.warn(`SampleNotePlayer not ready for ${preset}`);
      return;
    }

    // Generate unique trackId for this sample playback
    const trackId = `sample-${preset}-${Date.now()}`;
    // Use semitones directly for pitch shifting (engine handles conversion)
    audioEngine.playSample(preset, trackId, time, duration, 'oneshot', semitone);
  }

  async ensureReady(_preset: string): Promise<void> {
    if (!audioEngine.isInitialized()) {
      await audioEngine.initialize();
    }
  }
}

/**
 * Create the default note player chain for the application.
 * Order matters: specific players first, samples as fallback.
 */
export async function createDefaultNotePlayerChain() {
  // Import here to avoid circular dependency
  const { NotePlayerChain } = await import('./note-player');

  return new NotePlayerChain([
    new ToneSynthNotePlayer(),
    new AdvancedSynthNotePlayer(),
    new SynthNotePlayer(),
    new SampleNotePlayer(),
  ]);
}

// Singleton instances for direct use
export const synthNotePlayer = new SynthNotePlayer();
export const toneSynthNotePlayer = new ToneSynthNotePlayer();
export const advancedSynthNotePlayer = new AdvancedSynthNotePlayer();
export const sampleNotePlayer = new SampleNotePlayer();
