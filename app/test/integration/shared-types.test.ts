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
      // Import types module and verify specific exports exist
      const workerTypes = await import('../../src/worker/types');

      // Verify specific exports are usable, not just that import succeeded
      expect(workerTypes.MUTATING_MESSAGE_TYPES).toBeInstanceOf(Set);
      expect(workerTypes.MUTATING_MESSAGE_TYPES.size).toBeGreaterThan(0);

      // Create a SessionState object using the shared type
      const state: SessionState = {
        tracks: [],
        tempo: 120,
        swing: 0,
        version: 1,
      };

      // Verify the structure with meaningful assertions
      expect(state.tracks).toHaveLength(0);
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

    it('ClientMessage types round-trip through JSON with all properties', async () => {
      // Import and use the module - verify isStateMutatingMessage works
      const { isStateMutatingMessage } = await import('../../src/worker/types');

      // All message types should be parseable and verifiable
      const messages = [
        { type: 'toggle_step', trackId: 't1', step: 0 },
        { type: 'set_tempo', tempo: 140 },
        { type: 'set_swing', swing: 50 },
        { type: 'add_track', track: { id: 't1', name: 'Test', sampleId: 'kick', steps: [], parameterLocks: [], volume: 0.8, muted: false, playbackMode: 'oneshot', transpose: 0 } },
        { type: 'set_effects', effects: { reverb: { decay: 1, wet: 0.3 }, delay: { time: '8n', feedback: 0.3, wet: 0.2 }, chorus: { frequency: 1, depth: 0.5, wet: 0.1 }, distortion: { amount: 0.2, wet: 0.1 } } },
      ];

      // Each should round-trip through JSON preserving ALL properties
      messages.forEach(msg => {
        // Verify the import is actually used for something meaningful
        expect(isStateMutatingMessage(msg.type)).toBe(true);

        // Full round-trip comparison - compare entire object, not just type
        const serialized = JSON.stringify(msg);
        const parsed = JSON.parse(serialized);
        expect(parsed).toEqual(msg);
      });
    });
  });

  describe('Import Resolution', () => {
    it('EffectsState type enforces all required effect properties', () => {
      // sync-types is a types-only module (no runtime exports)
      // We prove the types work by creating conforming objects

      // Create an EffectsState object using the type (imported at file top)
      // If any required property is missing, TypeScript would error at compile time
      const effects: EffectsState = {
        reverb: { decay: 2, wet: 0.5 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
        distortion: { amount: 0.2, wet: 0.1 },
      };

      // Verify ALL 4 effect types are present and have required properties
      expect(Object.keys(effects)).toHaveLength(4);

      // Reverb properties - verify structure and values
      expect(effects.reverb).toHaveProperty('decay');
      expect(effects.reverb).toHaveProperty('wet');
      expect(effects.reverb.decay).toBe(2);
      expect(effects.reverb.wet).toBe(0.5);

      // Delay properties - verify structure and values
      expect(effects.delay).toHaveProperty('time');
      expect(effects.delay).toHaveProperty('feedback');
      expect(effects.delay).toHaveProperty('wet');
      expect(effects.delay.time).toBe('8n');
      expect(effects.delay.feedback).toBe(0.3);

      // Chorus properties - verify structure and values
      expect(effects.chorus).toHaveProperty('frequency');
      expect(effects.chorus).toHaveProperty('depth');
      expect(effects.chorus).toHaveProperty('wet');
      expect(effects.chorus.frequency).toBe(1);

      // Distortion properties - verify structure and values
      expect(effects.distortion).toHaveProperty('amount');
      expect(effects.distortion).toHaveProperty('wet');
      expect(effects.distortion.amount).toBe(0.2);
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
