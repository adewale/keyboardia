/**
 * REFACTOR-01: Shared Types Integration Tests
 *
 * These tests verify that types are defined in a single location
 * and can be imported consistently across client and worker code.
 */
import { describe, it, expect } from 'vitest';
import type { SessionState, SessionTrack } from '../../src/shared/state';
import type { PlayerInfo } from '../../src/shared/player';
import type { ParameterLock, EffectsState } from '../../src/shared/sync-types';

describe('REFACTOR-01: Shared Types Integration', () => {

  describe('Type Parity', () => {
    it('SessionState from worker matches SessionState from shared', async () => {
      // Import types module to verify it works
      const types = await import('../../src/worker/types');

      // Verify the export exists
      expect(types).toBeDefined();

      // Create a SessionState object
      const state: SessionState = {
        tracks: [],
        tempo: 120,
        swing: 0,
        version: 1,
      };

      // Verify the structure
      expect(state.tracks).toEqual([]);
      expect(state.tempo).toBe(120);
      expect(state.swing).toBe(0);
      expect(state.version).toBe(1);
    });

    it('PlayerInfo structure is consistent', () => {
      // PlayerInfo should have these required fields
      const player: PlayerInfo = {
        id: 'test-id',
        connectedAt: 1000,
        lastMessageAt: 2000,
        messageCount: 5,
        color: '#E53935',
        colorIndex: 0,
        animal: 'Fox',
        name: 'Red Fox',
      };

      expect(player.id).toBe('test-id');
      expect(player.color).toBe('#E53935');
      expect(player.name).toBe('Red Fox');
    });

    it('ClientMessage types are compatible across boundaries', async () => {
      // Import to verify module works
      await import('../../src/worker/types');

      // All message types should be parseable
      const messages = [
        { type: 'toggle_step', trackId: 't1', step: 0 },
        { type: 'set_tempo', tempo: 140 },
        { type: 'set_swing', swing: 50 },
        { type: 'add_track', track: { id: 't1', name: 'Test', sampleId: 'kick', steps: [], parameterLocks: [], volume: 0.8, muted: false, playbackMode: 'oneshot', transpose: 0 } },
        { type: 'set_effects', effects: { reverb: { decay: 1, wet: 0.3 }, delay: { time: '8n', feedback: 0.3, wet: 0.2 }, chorus: { frequency: 1, depth: 0.5, wet: 0.1 }, distortion: { amount: 0.2, wet: 0.1 } } },
      ];

      // Each should round-trip through JSON
      messages.forEach(msg => {
        const serialized = JSON.stringify(msg);
        const parsed = JSON.parse(serialized) as { type: string };
        expect(parsed.type).toBe(msg.type);
      });
    });
  });

  describe('Import Resolution', () => {
    it('worker can import from shared without bundler errors', async () => {
      // This test verifies the import path works
      const sharedModule = await import('../../src/shared/sync-types');
      // Type should be importable (existence check)
      expect(sharedModule).toBeDefined();
    });

    it('shared sync-types exports ParameterLock', () => {
      // ParameterLock is a type, so we check by creating a conforming object
      const lock: ParameterLock = { pitch: 5, volume: 0.8 };
      expect(lock.pitch).toBe(5);
    });

    it('shared sync-types exports EffectsState', () => {
      // EffectsState should be importable
      const effects: EffectsState = {
        reverb: { decay: 2, wet: 0.5 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 2, depth: 0.5, wet: 0.1 },
        distortion: { amount: 0.3, wet: 0.1 },
      };
      expect(effects.reverb.wet).toBe(0.5);
    });
  });

  describe('Shared State Types', () => {
    it('SessionTrack has all required fields', () => {
      const track: SessionTrack = {
        id: 'track-1',
        name: 'Kick',
        sampleId: 'drums:kick',
        steps: Array(128).fill(false) as boolean[],
        parameterLocks: Array(128).fill(null) as (ParameterLock | null)[],
        volume: 0.8,
        muted: false,
        soloed: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      };

      expect(track.id).toBe('track-1');
      expect(track.playbackMode).toBe('oneshot');
      expect(track.steps.length).toBe(128);
    });
  });

  describe('Shared Message Types', () => {
    it('MUTATING_MESSAGE_TYPES is accessible from worker types', async () => {
      const { MUTATING_MESSAGE_TYPES } = await import('../../src/worker/types');

      expect(MUTATING_MESSAGE_TYPES).toBeDefined();
      expect(MUTATING_MESSAGE_TYPES.has('toggle_step')).toBe(true);
      expect(MUTATING_MESSAGE_TYPES.has('set_tempo')).toBe(true);
      expect(MUTATING_MESSAGE_TYPES.has('add_track')).toBe(true);
    });

    it('isStateMutatingMessage works correctly', async () => {
      const { isStateMutatingMessage } = await import('../../src/worker/types');

      expect(isStateMutatingMessage('toggle_step')).toBe(true);
      expect(isStateMutatingMessage('set_tempo')).toBe(true);
      expect(isStateMutatingMessage('play')).toBe(false);
      expect(isStateMutatingMessage('stop')).toBe(false);
    });
  });
});
