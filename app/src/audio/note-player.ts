/**
 * NotePlayer Strategy Pattern - Phase 21A Refactoring
 *
 * This module provides a clean abstraction for playing notes,
 * allowing different playback strategies (sampled vs synth).
 *
 * The pattern allows:
 * - Clean separation of sampled vs synthesized playback
 * - Easy addition of new playback strategies
 * - Testable components via dependency injection
 */

import {
  SampledInstrumentRegistry,
  sampledInstrumentRegistry,
} from './sampled-instrument';
import { synthEngine, SYNTH_PRESETS, semitoneToFrequency } from './synth';

/**
 * Interface for note playback strategies.
 * Each player knows how to handle specific presets.
 */
export interface NotePlayer {
  /** Check if this player can handle the given preset */
  canHandle(preset: string): boolean;

  /** Check if the player is ready to play the preset */
  isReady(preset: string): boolean;

  /** Play a note */
  play(
    noteId: string,
    preset: string,
    semitone: number,
    time: number,
    duration?: number
  ): void;

  /** Ensure the player is ready (async loading) */
  ensureReady(preset: string): Promise<void>;
}

/**
 * SampledNotePlayer - plays notes using pre-recorded audio samples.
 * Used for realistic instrument sounds like piano.
 */
export class SampledNotePlayer implements NotePlayer {
  private registry: SampledInstrumentRegistry;

  constructor(registry: SampledInstrumentRegistry = sampledInstrumentRegistry) {
    this.registry = registry;
  }

  canHandle(preset: string): boolean {
    return this.registry.has(preset);
  }

  isReady(preset: string): boolean {
    const instrument = this.registry.get(preset);
    return instrument?.isReady() ?? false;
  }

  play(
    noteId: string,
    preset: string,
    semitone: number,
    time: number,
    duration?: number
  ): void {
    const instrument = this.registry.get(preset);
    if (!instrument || !instrument.isReady()) {
      return;
    }
    const midiNote = 60 + semitone;
    instrument.playNote(noteId, midiNote, time, duration);
  }

  async ensureReady(preset: string): Promise<void> {
    await this.registry.load(preset);
  }
}

/**
 * SynthNotePlayer - plays notes using real-time synthesis.
 * Always ready, used as fallback or for synth presets.
 */
export class SynthNotePlayer implements NotePlayer {
  private synth: typeof synthEngine;

  constructor(synth: typeof synthEngine = synthEngine) {
    this.synth = synth;
  }

  canHandle(_preset: string): boolean {
    // Synth can handle any preset (as fallback)
    return true;
  }

  isReady(_preset: string): boolean {
    // Synth is always ready (no loading required)
    return true;
  }

  play(
    noteId: string,
    preset: string,
    semitone: number,
    time: number,
    duration?: number
  ): void {
    const synthPreset = SYNTH_PRESETS[preset] || SYNTH_PRESETS.lead;
    const frequency = semitoneToFrequency(semitone);
    this.synth.playNote(noteId, frequency, synthPreset, time, duration);
  }

  async ensureReady(_preset: string): Promise<void> {
    // Synth requires no loading
    return;
  }
}

/**
 * NotePlayerChain - chains multiple players, trying each in order.
 * First player that canHandle AND isReady wins.
 * Falls back to synth if nothing else is ready.
 */
export class NotePlayerChain implements NotePlayer {
  private players: NotePlayer[];

  constructor(players: NotePlayer[]) {
    this.players = players;
  }

  canHandle(preset: string): boolean {
    return this.players.some(p => p.canHandle(preset));
  }

  isReady(preset: string): boolean {
    return this.players.some(p => p.canHandle(preset) && p.isReady(preset));
  }

  play(
    noteId: string,
    preset: string,
    semitone: number,
    time: number,
    duration?: number
  ): void {
    // Find first player that can handle AND is ready
    const readyPlayer = this.players.find(
      p => p.canHandle(preset) && p.isReady(preset)
    );

    if (readyPlayer) {
      readyPlayer.play(noteId, preset, semitone, time, duration);
      return;
    }

    // Fallback: use last player (should be synth)
    const fallback = this.players[this.players.length - 1];
    if (fallback) {
      fallback.play(noteId, preset, semitone, time, duration);
    }
  }

  async ensureReady(preset: string): Promise<void> {
    // Try to ensure readiness for the first player that can handle it
    const handler = this.players.find(p => p.canHandle(preset));
    if (handler) {
      await handler.ensureReady(preset);
    }
  }
}

/**
 * Create the default note player chain.
 * Order: SampledNotePlayer -> SynthNotePlayer (fallback)
 */
export function createDefaultPlayerChain(): NotePlayerChain {
  return new NotePlayerChain([
    new SampledNotePlayer(),
    new SynthNotePlayer(),
  ]);
}
