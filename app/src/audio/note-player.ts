/**
 * NotePlayer Strategy Pattern - Phase 21A Refactoring
 *
 * This module provides a clean abstraction for playing notes,
 * allowing different playback strategies (sampled vs synth).
 *
 * TODO: Implement after observable state is working
 */

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

// Placeholder export for tests - will be implemented after observable state
export const NotePlayer = null;
