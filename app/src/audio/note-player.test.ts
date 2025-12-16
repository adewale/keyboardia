import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotePlayerChain,
  NotePlayerRegistry,
} from './note-player';
import type { NotePlayer } from './note-player';

/**
 * Tests for NotePlayer Strategy Pattern
 *
 * Based on Phase 21A architecture - ensures clean abstraction
 * for playing notes with proper initialization checks.
 */

// Mock NotePlayer for testing
class MockNotePlayer implements NotePlayer {
  public handled: string[] = [];
  public ready = true;
  public played: Array<{ preset: string; semitone: number; time: number }> = [];
  private prefixes: string[];
  private isReadyFn: () => boolean;

  constructor(
    prefixes: string[],
    isReadyFn: () => boolean = () => true
  ) {
    this.prefixes = prefixes;
    this.isReadyFn = isReadyFn;
  }

  canHandle(preset: string): boolean {
    return this.prefixes.some(p => preset.startsWith(p));
  }

  isReady(_preset: string): boolean {
    return this.isReadyFn();
  }

  play(preset: string, semitone: number, time: number, _duration?: number): void {
    if (!this.isReady(preset)) return;
    this.played.push({ preset, semitone, time });
  }

  async ensureReady(_preset: string): Promise<void> {
    // Mock implementation
  }
}

describe('NotePlayer interface', () => {
  it('mock player can handle its prefixes', () => {
    const player = new MockNotePlayer(['tone:', 'advanced:']);

    expect(player.canHandle('tone:fm-epiano')).toBe(true);
    expect(player.canHandle('advanced:supersaw')).toBe(true);
    expect(player.canHandle('synth:bass')).toBe(false);
    expect(player.canHandle('kick')).toBe(false);
  });

  it('mock player tracks plays', () => {
    const player = new MockNotePlayer(['tone:']);

    player.play('tone:fm-epiano', 0, 0.5, 0.3);
    player.play('tone:fm-bass', 5, 1.0, 0.3);

    expect(player.played).toHaveLength(2);
    expect(player.played[0]).toEqual({ preset: 'tone:fm-epiano', semitone: 0, time: 0.5 });
    expect(player.played[1]).toEqual({ preset: 'tone:fm-bass', semitone: 5, time: 1.0 });
  });

  it('mock player respects isReady', () => {
    const player = new MockNotePlayer(['tone:'], () => false);

    player.play('tone:fm-epiano', 0, 0.5, 0.3);

    expect(player.played).toHaveLength(0);
  });
});

describe('NotePlayerChain', () => {
  it('routes to first player that can handle', () => {
    const tonePlayer = new MockNotePlayer(['tone:']);
    const synthPlayer = new MockNotePlayer(['synth:']);
    const chain = new NotePlayerChain([tonePlayer, synthPlayer]);

    chain.play('tone:fm-epiano', 0, 0.5, 0.3);
    chain.play('synth:bass', 0, 1.0, 0.3);

    expect(tonePlayer.played).toHaveLength(1);
    expect(synthPlayer.played).toHaveLength(1);
  });

  it('skips players that are not ready', () => {
    const notReadyPlayer = new MockNotePlayer(['tone:'], () => false);
    const fallbackPlayer = new MockNotePlayer(['tone:', 'synth:']);
    const chain = new NotePlayerChain([notReadyPlayer, fallbackPlayer]);

    chain.play('tone:fm-epiano', 0, 0.5, 0.3);

    expect(notReadyPlayer.played).toHaveLength(0);
    expect(fallbackPlayer.played).toHaveLength(1);
  });

  it('canHandle returns true if any player can handle', () => {
    const tonePlayer = new MockNotePlayer(['tone:']);
    const synthPlayer = new MockNotePlayer(['synth:']);
    const chain = new NotePlayerChain([tonePlayer, synthPlayer]);

    expect(chain.canHandle('tone:fm-epiano')).toBe(true);
    expect(chain.canHandle('synth:bass')).toBe(true);
    expect(chain.canHandle('kick')).toBe(false);
  });

  it('isReady returns true if a handler is ready', () => {
    const readyPlayer = new MockNotePlayer(['tone:']);
    const notReadyPlayer = new MockNotePlayer(['synth:'], () => false);
    const chain = new NotePlayerChain([readyPlayer, notReadyPlayer]);

    expect(chain.isReady('tone:fm-epiano')).toBe(true);
    expect(chain.isReady('synth:bass')).toBe(false);
  });

  it('logs warning when no player is ready', () => {
    const notReadyPlayer = new MockNotePlayer(['tone:'], () => false);
    const chain = new NotePlayerChain([notReadyPlayer]);

    // Should not throw, just log warning
    expect(() => chain.play('tone:fm-epiano', 0, 0.5, 0.3)).not.toThrow();
  });
});

describe('NotePlayerRegistry', () => {
  let registry: NotePlayerRegistry;

  beforeEach(() => {
    registry = new NotePlayerRegistry();
  });

  it('tracks player state', () => {
    expect(registry.getState('tone')).toBe('idle');

    registry.setState('tone', 'initializing');
    expect(registry.getState('tone')).toBe('initializing');

    registry.setState('tone', 'ready');
    expect(registry.getState('tone')).toBe('ready');
  });

  it('tracks errors', () => {
    const error = new Error('Test error');
    registry.setState('tone', 'error', error);

    expect(registry.getState('tone')).toBe('error');
    expect(registry.getError('tone')).toBe(error);
  });

  it('clears error when state changes to non-error', () => {
    const error = new Error('Test error');
    registry.setState('tone', 'error', error);
    registry.setState('tone', 'ready');

    expect(registry.getError('tone')).toBeNull();
  });

  it('notifies listeners on state change', () => {
    const listener = vi.fn();
    registry.onStateChange(listener);

    registry.setState('tone', 'initializing');

    expect(listener).toHaveBeenCalledWith('tone', 'initializing', undefined);
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsubscribe = registry.onStateChange(listener);

    unsubscribe();
    registry.setState('tone', 'ready');

    expect(listener).not.toHaveBeenCalled();
  });

  it('allReady returns true when all players are ready', () => {
    registry.setState('tone', 'ready');
    registry.setState('advanced', 'ready');

    expect(registry.allReady()).toBe(true);
  });

  it('allReady returns false when any player is not ready', () => {
    registry.setState('tone', 'ready');
    registry.setState('advanced', 'initializing');

    expect(registry.allReady()).toBe(false);
  });

  it('hasError returns true when any player has error', () => {
    registry.setState('tone', 'ready');
    registry.setState('advanced', 'error', new Error('Test'));

    expect(registry.hasError()).toBe(true);
  });
});

describe('Phase 21A: Race condition prevention', () => {
  it('player chain only plays when ready', () => {
    // Simulate the race condition: scheduler calls play before init completes
    let toneReady = false;
    const tonePlayer = new MockNotePlayer(['tone:'], () => toneReady);
    const fallbackPlayer = new MockNotePlayer([''], () => true); // Always ready
    const chain = new NotePlayerChain([tonePlayer, fallbackPlayer]);

    // First play - tone not ready, should use fallback
    chain.play('tone:fm-epiano', 0, 0.5, 0.3);
    expect(tonePlayer.played).toHaveLength(0);
    expect(fallbackPlayer.played).toHaveLength(1);

    // Tone becomes ready
    toneReady = true;

    // Second play - tone is ready, should use tone player
    chain.play('tone:fm-bass', 0, 1.0, 0.3);
    expect(tonePlayer.played).toHaveLength(1);
    expect(fallbackPlayer.played).toHaveLength(1); // No change
  });
});
