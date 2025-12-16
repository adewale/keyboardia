/**
 * NotePlayer Strategy Pattern
 *
 * Adapted from Phase 21A for Tone.js integration.
 * Provides clean abstraction for playing notes with proper initialization checks.
 *
 * Key features:
 * - Clean separation of synth, tone, and advanced playback
 * - isReady() checks prevent race conditions
 * - Fallback behavior via NotePlayerChain
 * - Testable via dependency injection
 */

import { logger } from '../utils/logger';

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
    preset: string,
    semitone: number,
    time: number,
    duration?: number
  ): void;

  /** Ensure the player is ready (async loading/initialization) */
  ensureReady(preset: string): Promise<void>;
}

/**
 * Loading state for observable state pattern.
 */
export type PlayerState = 'idle' | 'initializing' | 'ready' | 'error';

/**
 * Callback for state change notifications.
 */
export type PlayerStateChangeCallback = (
  playerId: string,
  state: PlayerState,
  error?: Error
) => void;

/**
 * NotePlayerChain - chains multiple players, trying each in order.
 * First player that canHandle AND isReady wins.
 * Falls back to last player (synth) if nothing else is ready.
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
      readyPlayer.play(preset, semitone, time, duration);
      return;
    }

    // No ready player found - log and skip
    logger.audio.warn(`No ready player for preset "${preset}", note skipped`);
  }

  async ensureReady(preset: string): Promise<void> {
    // Ensure readiness for all players that can handle this preset
    const handlers = this.players.filter(p => p.canHandle(preset));
    await Promise.all(handlers.map(h => h.ensureReady(preset)));
  }

  /**
   * Check if any player is ready for any preset.
   */
  hasAnyReadyPlayer(): boolean {
    return this.players.some(p => p.isReady(''));
  }
}

/**
 * Registry for managing note player state observability.
 * Allows UI to track initialization progress.
 */
export class NotePlayerRegistry {
  private states: Map<string, PlayerState> = new Map();
  private errors: Map<string, Error> = new Map();
  private listeners: Set<PlayerStateChangeCallback> = new Set();

  /**
   * Set the state for a player.
   */
  setState(playerId: string, state: PlayerState, error?: Error): void {
    this.states.set(playerId, state);
    if (error) {
      this.errors.set(playerId, error);
    } else {
      this.errors.delete(playerId);
    }
    // Notify listeners
    for (const listener of this.listeners) {
      listener(playerId, state, error);
    }
  }

  /**
   * Get the current state for a player.
   */
  getState(playerId: string): PlayerState {
    return this.states.get(playerId) ?? 'idle';
  }

  /**
   * Get error for a player (if in error state).
   */
  getError(playerId: string): Error | null {
    return this.errors.get(playerId) ?? null;
  }

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   */
  onStateChange(callback: PlayerStateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Check if all players are ready.
   */
  allReady(): boolean {
    for (const state of this.states.values()) {
      if (state !== 'ready') return false;
    }
    return true;
  }

  /**
   * Check if any player has an error.
   */
  hasError(): boolean {
    return this.errors.size > 0;
  }
}

// Singleton registry for global state tracking
export const notePlayerRegistry = new NotePlayerRegistry();
