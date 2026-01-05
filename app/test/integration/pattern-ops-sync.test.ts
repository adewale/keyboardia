/**
 * Pattern Operations Sync Integration Tests
 *
 * These tests verify that pattern operations (rotate, invert, reverse, mirror, euclidean)
 * correctly sync between client and server.
 *
 * BACKGROUND: Phase 31B implemented pattern operations locally but never wired up
 * the sync layer. This was discovered in the sync bug audit (2026-01-04).
 *
 * TEST STRATEGY:
 * 1. Unit tests verify pure functions work (patternOps.test.ts) ✅
 * 2. Unit tests verify reducer handles actions (grid.test.ts) ✅
 * 3. This file verifies the sync pipeline works end-to-end
 *
 * CURRENT STATUS: These tests document the expected behavior.
 * Tests marked with .fails() are known bugs that should be fixed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { gridReducer } from '../../src/state/grid';
import { applyMutation, createInitialState as _createInitialState, createDefaultTrack as _createDefaultTrack } from '../../src/shared/state-mutations';
import { actionToMessage } from '../../src/sync/multiplayer';
import type { GridState, GridAction } from '../../src/types';
import type { SessionState } from '../../src/shared/state';
import type { ClientMessageBase } from '../../src/shared/message-types';

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestGridState(): GridState {
  return {
    tracks: [
      {
        id: 'track-1',
        name: 'Test Track',
        sampleId: 'kick',
        steps: [true, true, false, false, true, false, false, false, ...Array(120).fill(false)],
        parameterLocks: [{ pitch: 3 }, null, null, null, { volume: 0.5 }, ...Array(123).fill(null)],
        volume: 0.8,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 8,
      },
    ],
    tempo: 120,
    swing: 0,
    isPlaying: false,
    currentStep: -1,
  };
}

function createTestSessionState(): SessionState {
  return {
    tracks: [
      {
        id: 'track-1',
        name: 'Test Track',
        sampleId: 'kick',
        steps: [true, true, false, false, true, false, false, false, ...Array(120).fill(false)],
        parameterLocks: [{ pitch: 3 }, null, null, null, { volume: 0.5 }, ...Array(123).fill(null)],
        volume: 0.8,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 8,
      },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  };
}

// ============================================================================
// Pattern Operations Unit Tests (Pure Functions)
// ============================================================================

describe('Pattern Operations - Pure Function Tests', () => {
  describe('gridReducer handles pattern actions', () => {
    let state: GridState;

    beforeEach(() => {
      state = createTestGridState();
    });

    it('ROTATE_PATTERN left shifts steps within stepCount', () => {
      const action: GridAction = { type: 'ROTATE_PATTERN', trackId: 'track-1', direction: 'left' };
      const newState = gridReducer(state, action);

      // Original: [T, T, F, F, T, F, F, F]
      // After left rotate: [T, F, F, T, F, F, F, T]
      expect(newState.tracks[0].steps.slice(0, 8)).toEqual([true, false, false, true, false, false, false, true]);
    });

    it('INVERT_PATTERN toggles all steps within stepCount', () => {
      const action: GridAction = { type: 'INVERT_PATTERN', trackId: 'track-1' };
      const newState = gridReducer(state, action);

      // Original: [T, T, F, F, T, F, F, F]
      // After invert: [F, F, T, T, F, T, T, T]
      expect(newState.tracks[0].steps.slice(0, 8)).toEqual([false, false, true, true, false, true, true, true]);
    });

    it('REVERSE_PATTERN reverses steps within stepCount', () => {
      const action: GridAction = { type: 'REVERSE_PATTERN', trackId: 'track-1' };
      const newState = gridReducer(state, action);

      // Original: [T, T, F, F, T, F, F, F]
      // After reverse: [F, F, F, T, F, F, T, T]
      expect(newState.tracks[0].steps.slice(0, 8)).toEqual([false, false, false, true, false, false, true, true]);
    });

    it('MIRROR_PATTERN creates palindrome', () => {
      const action: GridAction = { type: 'MIRROR_PATTERN', trackId: 'track-1' };
      const newState = gridReducer(state, action);

      // Original: [T, T, F, F, T, F, F, F] - first half [T,T,F,F] has more content
      // Mirror left-to-right: first half mirrors to second
      // Result: [T, T, F, F, F, F, T, T]
      expect(newState.tracks[0].steps.slice(0, 8)).toEqual([true, true, false, false, false, false, true, true]);
    });

    it('EUCLIDEAN_FILL distributes hits evenly', () => {
      const action: GridAction = { type: 'EUCLIDEAN_FILL', trackId: 'track-1', hits: 3 };
      const newState = gridReducer(state, action);

      // E(3, 8) = Cuban tresillo: [T, F, F, T, F, F, T, F]
      expect(newState.tracks[0].steps.slice(0, 8)).toEqual([true, false, false, true, false, false, true, false]);
    });
  });
});

// ============================================================================
// Pattern Operations Sync Tests (Client → Message)
// ============================================================================

describe('Pattern Operations - Sync Layer Tests', () => {
  describe('actionToMessage mapping', () => {
    /**
     * These tests verify that pattern operations produce sync messages.
     *
     * FIXED: Pattern operations now sync correctly (Phase 32, 2026-01-04).
     */

    it('ROTATE_PATTERN produces rotate_pattern message', () => {
      const action: GridAction = { type: 'ROTATE_PATTERN', trackId: 'track-1', direction: 'left' };
      const message = actionToMessage(action) as Record<string, unknown> | null;

      expect(message).not.toBeNull();
      expect(message?.type).toBe('rotate_pattern');
      expect(message?.trackId).toBe('track-1');
      expect(message?.direction).toBe('left');
    });

    it('INVERT_PATTERN produces invert_pattern message', () => {
      const action: GridAction = { type: 'INVERT_PATTERN', trackId: 'track-1' };
      const message = actionToMessage(action) as Record<string, unknown> | null;

      expect(message).not.toBeNull();
      expect(message?.type).toBe('invert_pattern');
      expect(message?.trackId).toBe('track-1');
    });

    it('REVERSE_PATTERN produces reverse_pattern message', () => {
      const action: GridAction = { type: 'REVERSE_PATTERN', trackId: 'track-1' };
      const message = actionToMessage(action) as Record<string, unknown> | null;

      expect(message).not.toBeNull();
      expect(message?.type).toBe('reverse_pattern');
      expect(message?.trackId).toBe('track-1');
    });

    it('MIRROR_PATTERN produces mirror_pattern message', () => {
      const action: GridAction = { type: 'MIRROR_PATTERN', trackId: 'track-1' };
      const message = actionToMessage(action) as Record<string, unknown> | null;

      expect(message).not.toBeNull();
      expect(message?.type).toBe('mirror_pattern');
      expect(message?.trackId).toBe('track-1');
    });

    it('EUCLIDEAN_FILL produces euclidean_fill message', () => {
      const action: GridAction = { type: 'EUCLIDEAN_FILL', trackId: 'track-1', hits: 5 };
      const message = actionToMessage(action) as Record<string, unknown> | null;

      expect(message).not.toBeNull();
      expect(message?.type).toBe('euclidean_fill');
      expect(message?.trackId).toBe('track-1');
      expect(message?.hits).toBe(5);
    });
  });
});

// ============================================================================
// Pattern Operations Integration Tests (Client → Server → Client)
// ============================================================================

describe('Pattern Operations - Integration Tests', () => {
  /**
   * These tests verify the complete sync round-trip:
   * 1. Client applies action via gridReducer
   * 2. Action converts to message via actionToMessage
   * 3. Server applies mutation via applyMutation
   * 4. States should match
   *
   * FIXED: Pattern operations now sync correctly (Phase 32, 2026-01-04).
   */

  describe('client-server state convergence', () => {
    it('ROTATE_PATTERN: client and server reach same state', () => {
      // Client side
      const clientState = createTestGridState();
      const action: GridAction = { type: 'ROTATE_PATTERN', trackId: 'track-1', direction: 'left' };
      const clientResult = gridReducer(clientState, action);

      // Server side (via message)
      const serverState = createTestSessionState();
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const serverResult = applyMutation(serverState, message as ClientMessageBase);

      // Compare states (only the steps that matter)
      expect(clientResult.tracks[0].steps.slice(0, 8)).toEqual(
        serverResult.tracks[0].steps.slice(0, 8)
      );
    });

    it('INVERT_PATTERN: client and server reach same state', () => {
      const clientState = createTestGridState();
      const action: GridAction = { type: 'INVERT_PATTERN', trackId: 'track-1' };
      const clientResult = gridReducer(clientState, action);

      const serverState = createTestSessionState();
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const serverResult = applyMutation(serverState, message as ClientMessageBase);

      expect(clientResult.tracks[0].steps.slice(0, 8)).toEqual(
        serverResult.tracks[0].steps.slice(0, 8)
      );
    });

    it('EUCLIDEAN_FILL: client and server reach same state', () => {
      const clientState = createTestGridState();
      const action: GridAction = { type: 'EUCLIDEAN_FILL', trackId: 'track-1', hits: 3 };
      const clientResult = gridReducer(clientState, action);

      const serverState = createTestSessionState();
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const serverResult = applyMutation(serverState, message as ClientMessageBase);

      expect(clientResult.tracks[0].steps.slice(0, 8)).toEqual(
        serverResult.tracks[0].steps.slice(0, 8)
      );
    });
  });

  describe('parameter lock preservation', () => {
    it('ROTATE_PATTERN: parameter locks rotate with steps', () => {
      const clientState = createTestGridState();
      const action: GridAction = { type: 'ROTATE_PATTERN', trackId: 'track-1', direction: 'left' };
      const clientResult = gridReducer(clientState, action);

      const serverState = createTestSessionState();
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const serverResult = applyMutation(serverState, message as ClientMessageBase);

      // Original p-locks at [0] and [4] should now be at [7] and [3]
      expect(clientResult.tracks[0].parameterLocks[7]).toEqual({ pitch: 3 });
      expect(clientResult.tracks[0].parameterLocks[3]).toEqual({ volume: 0.5 });

      expect(serverResult.tracks[0].parameterLocks[7]).toEqual({ pitch: 3 });
      expect(serverResult.tracks[0].parameterLocks[3]).toEqual({ volume: 0.5 });
    });

    it('INVERT_PATTERN: clears p-locks on deactivated steps', () => {
      const clientState = createTestGridState();
      const action: GridAction = { type: 'INVERT_PATTERN', trackId: 'track-1' };
      const clientResult = gridReducer(clientState, action);

      const serverState = createTestSessionState();
      const message = actionToMessage(action);
      expect(message).not.toBeNull();
      const serverResult = applyMutation(serverState, message as ClientMessageBase);

      // Steps [0] and [1] were active (with p-lock at [0]), now inactive
      // P-lock should be cleared
      expect(clientResult.tracks[0].parameterLocks[0]).toBeNull();
      expect(serverResult.tracks[0].parameterLocks[0]).toBeNull();
    });
  });
});

// ============================================================================
// SET_TRACK_NAME Sync Tests
// ============================================================================

describe('SET_TRACK_NAME - Sync Tests', () => {
  it('SET_TRACK_NAME produces set_track_name message', () => {
    const action: GridAction = { type: 'SET_TRACK_NAME', trackId: 'track-1', name: 'My Kick' };
    const message = actionToMessage(action) as Record<string, unknown> | null;

    expect(message).not.toBeNull();
    expect(message?.type).toBe('set_track_name');
    expect(message?.trackId).toBe('track-1');
    expect(message?.name).toBe('My Kick');
  });
});
