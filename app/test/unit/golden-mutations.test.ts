/**
 * Golden Mutation Tests
 *
 * These tests capture the EXACT current behavior of state mutations.
 * They serve as a regression safety net - if any test fails after a refactoring,
 * we've accidentally changed behavior.
 *
 * Phase 0 of SHARED-MUTATION-REFACTORING-PLAN.md
 *
 * IMPORTANT: These tests should NEVER be modified to make them pass.
 * If a test fails, it means behavior changed - investigate why!
 *
 * Test Categories:
 * 1. Basic mutations - Simple state changes (tempo, swing, etc.)
 * 2. Track mutations - Track-level changes (volume, transpose, steps)
 * 3. Pattern operations - Complex pattern manipulations
 * 4. Edge cases - Boundary conditions, empty state, max values
 * 5. Round-trip tests - Client mutation → message → applyMutation consistency
 */

import { describe, it, expect } from 'vitest';
import { gridReducer } from '../../src/state/grid';
import { applyMutation, createInitialState as _createInitialState, createDefaultTrack as _createDefaultTrack } from '../../src/shared/state-mutations';
import type { GridState, GridAction as _GridAction, Track as _Track } from '../../src/types';
import type { SessionState } from '../../src/shared/state';
import { MAX_STEPS, STEPS_PER_PAGE as _STEPS_PER_PAGE } from '../../src/types';
import { DEFAULT_EFFECTS_STATE } from '../../src/audio/toneEffects';
import { DEFAULT_SCALE_STATE } from '../../src/state/grid';
import {
  MIN_TEMPO, MAX_TEMPO,
  MIN_SWING, MAX_SWING,
  MIN_VOLUME, MAX_VOLUME,
  MIN_TRANSPOSE, MAX_TRANSPOSE,
} from '../../src/shared/constants';

// ============================================================================
// Test Fixtures
// ============================================================================

function createGoldenGridState(): GridState {
  return {
    tracks: [
      {
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false, ...Array(120).fill(false)],
        parameterLocks: [{ volume: 0.8 }, null, null, null, { pitch: 2 }, ...Array(123).fill(null)],
        volume: 0.9,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'track-2',
        name: 'Snare',
        sampleId: 'snare',
        steps: [false, false, false, false, true, false, false, false, ...Array(120).fill(false)],
        parameterLocks: Array(MAX_STEPS).fill(null),
        volume: 1.0,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
    ],
    tempo: 120,
    swing: 0,
    effects: DEFAULT_EFFECTS_STATE,
    scale: DEFAULT_SCALE_STATE,
    isPlaying: false,
    currentStep: -1,
  };
}

function createGoldenSessionState(): SessionState {
  return {
    tracks: [
      {
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false, ...Array(120).fill(false)],
        parameterLocks: [{ volume: 0.8 }, null, null, null, { pitch: 2 }, ...Array(123).fill(null)],
        volume: 0.9,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'track-2',
        name: 'Snare',
        sampleId: 'snare',
        steps: [false, false, false, false, true, false, false, false, ...Array(120).fill(false)],
        parameterLocks: Array(MAX_STEPS).fill(null),
        volume: 1.0,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
    ],
    tempo: 120,
    swing: 0,
    effects: DEFAULT_EFFECTS_STATE,
    scale: DEFAULT_SCALE_STATE,
    version: 1,
  };
}

// ============================================================================
// 1. Basic Mutation Golden Tests
// ============================================================================

describe('Golden Mutations - Basic', () => {
  describe('SET_TEMPO', () => {
    it('sets tempo to exact value within bounds', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TEMPO', tempo: 140 });
      expect(result.tempo).toBe(140);
    });

    it('clamps tempo to MIN_TEMPO when below', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TEMPO', tempo: 10 });
      expect(result.tempo).toBe(MIN_TEMPO);
    });

    it('clamps tempo to MAX_TEMPO when above', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TEMPO', tempo: 500 });
      expect(result.tempo).toBe(MAX_TEMPO);
    });

    it('preserves other state fields', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TEMPO', tempo: 140 });
      expect(result.tracks).toEqual(state.tracks);
      expect(result.swing).toBe(state.swing);
      expect(result.isPlaying).toBe(state.isPlaying);
    });
  });

  describe('SET_SWING', () => {
    it('sets swing to exact value within bounds', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_SWING', swing: 50 });
      expect(result.swing).toBe(50);
    });

    it('clamps swing to MIN_SWING when below', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_SWING', swing: -10 });
      expect(result.swing).toBe(MIN_SWING);
    });

    it('clamps swing to MAX_SWING when above', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_SWING', swing: 150 });
      expect(result.swing).toBe(MAX_SWING);
    });
  });
});

// ============================================================================
// 2. Track Mutation Golden Tests
// ============================================================================

describe('Golden Mutations - Track', () => {
  describe('TOGGLE_STEP', () => {
    it('toggles step from false to true', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'TOGGLE_STEP', trackId: 'track-1', step: 1 });
      expect(result.tracks[0].steps[1]).toBe(true);
    });

    it('toggles step from true to false', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'TOGGLE_STEP', trackId: 'track-1', step: 0 });
      expect(result.tracks[0].steps[0]).toBe(false);
    });

    it('does not affect other tracks', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'TOGGLE_STEP', trackId: 'track-1', step: 1 });
      expect(result.tracks[1]).toEqual(state.tracks[1]);
    });

    it('handles non-existent track gracefully', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'TOGGLE_STEP', trackId: 'nonexistent', step: 0 });
      expect(result.tracks).toEqual(state.tracks);
    });
  });

  describe('SET_TRACK_VOLUME', () => {
    it('sets volume to exact value within bounds', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_VOLUME', trackId: 'track-1', volume: 0.5 });
      expect(result.tracks[0].volume).toBe(0.5);
    });

    it('clamps volume to MIN_VOLUME when below', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_VOLUME', trackId: 'track-1', volume: -0.5 });
      expect(result.tracks[0].volume).toBe(MIN_VOLUME);
    });

    it('clamps volume to MAX_VOLUME when above', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_VOLUME', trackId: 'track-1', volume: 2.0 });
      expect(result.tracks[0].volume).toBe(MAX_VOLUME);
    });
  });

  describe('SET_TRACK_TRANSPOSE', () => {
    it('sets transpose to exact value within bounds', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_TRANSPOSE', trackId: 'track-1', transpose: 5 });
      expect(result.tracks[0].transpose).toBe(5);
    });

    it('clamps transpose to MIN_TRANSPOSE when below', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_TRANSPOSE', trackId: 'track-1', transpose: -50 });
      expect(result.tracks[0].transpose).toBe(MIN_TRANSPOSE);
    });

    it('clamps transpose to MAX_TRANSPOSE when above', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_TRANSPOSE', trackId: 'track-1', transpose: 50 });
      expect(result.tracks[0].transpose).toBe(MAX_TRANSPOSE);
    });
  });

  describe('SET_TRACK_STEP_COUNT', () => {
    it('sets step count to exact value', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_STEP_COUNT', trackId: 'track-1', stepCount: 32 });
      expect(result.tracks[0].stepCount).toBe(32);
    });

    it('clamps step count to minimum 1', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_STEP_COUNT', trackId: 'track-1', stepCount: 0 });
      expect(result.tracks[0].stepCount).toBe(1);
    });

    it('clamps step count to MAX_STEPS', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_STEP_COUNT', trackId: 'track-1', stepCount: 200 });
      expect(result.tracks[0].stepCount).toBe(MAX_STEPS);
    });

    it('preserves step data when reducing step count', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_STEP_COUNT', trackId: 'track-1', stepCount: 8 });
      // Step data at indices 0-15 should still exist
      expect(result.tracks[0].steps[0]).toBe(true);
      expect(result.tracks[0].steps[4]).toBe(true);
    });
  });

  describe('CLEAR_TRACK', () => {
    it('clears all steps to false', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'CLEAR_TRACK', trackId: 'track-1' });
      expect(result.tracks[0].steps.every(s => s === false)).toBe(true);
    });

    it('clears all parameter locks to null', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'CLEAR_TRACK', trackId: 'track-1' });
      expect(result.tracks[0].parameterLocks.every(l => l === null)).toBe(true);
    });

    it('preserves track metadata (name, sample, volume, etc.)', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'CLEAR_TRACK', trackId: 'track-1' });
      expect(result.tracks[0].name).toBe('Kick');
      expect(result.tracks[0].sampleId).toBe('kick');
      expect(result.tracks[0].volume).toBe(0.9);
    });
  });

  describe('DELETE_TRACK', () => {
    it('removes track from tracks array', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'DELETE_TRACK', trackId: 'track-1' });
      expect(result.tracks.length).toBe(1);
      expect(result.tracks[0].id).toBe('track-2');
    });

    it('does nothing for non-existent track', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'DELETE_TRACK', trackId: 'nonexistent' });
      expect(result.tracks.length).toBe(2);
    });
  });

  describe('SET_TRACK_NAME', () => {
    it('sets track name', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_NAME', trackId: 'track-1', name: 'Bass Drum' });
      expect(result.tracks[0].name).toBe('Bass Drum');
    });

    it('trims whitespace', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_NAME', trackId: 'track-1', name: '  Bass Drum  ' });
      expect(result.tracks[0].name).toBe('Bass Drum');
    });

    it('limits length to 32 characters', () => {
      const state = createGoldenGridState();
      const longName = 'A'.repeat(50);
      const result = gridReducer(state, { type: 'SET_TRACK_NAME', trackId: 'track-1', name: longName });
      expect(result.tracks[0].name.length).toBe(32);
    });

    it('removes HTML tags (XSS prevention)', () => {
      const state = createGoldenGridState();
      // Note: The 32-char limit is applied BEFORE HTML removal
      // '<script>alert("xss")</script>Kick' = 33 chars
      // After slice(0,32): '<script>alert("xss")</script>Kic'
      // After HTML removal: 'alert("xss")Kic'
      const result = gridReducer(state, { type: 'SET_TRACK_NAME', trackId: 'track-1', name: '<script>alert("xss")</script>Kick' });
      expect(result.tracks[0].name).toBe('alert("xss")Kic');
    });

    it('rejects empty name after sanitization', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_TRACK_NAME', trackId: 'track-1', name: '   ' });
      expect(result.tracks[0].name).toBe('Kick'); // Unchanged
    });
  });
});

// ============================================================================
// 3. Pattern Operation Golden Tests
// ============================================================================

describe('Golden Mutations - Pattern Operations', () => {
  describe('ROTATE_PATTERN', () => {
    it('rotates pattern left by one step', () => {
      const state = createGoldenGridState();
      // Original: [true, false, false, false, true, ...]
      const result = gridReducer(state, { type: 'ROTATE_PATTERN', trackId: 'track-1', direction: 'left' });
      // After rotate left: [false, false, false, true, false, ...]
      expect(result.tracks[0].steps[0]).toBe(false);
      expect(result.tracks[0].steps[3]).toBe(true);
    });

    it('rotates pattern right by one step', () => {
      const state = createGoldenGridState();
      // Original: [true, false, false, false, true, ...]
      const result = gridReducer(state, { type: 'ROTATE_PATTERN', trackId: 'track-1', direction: 'right' });
      // After rotate right: [false, true, false, false, false, true, ...]
      expect(result.tracks[0].steps[0]).toBe(false);
      expect(result.tracks[0].steps[1]).toBe(true);
    });

    it('rotates parameter locks with steps', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'ROTATE_PATTERN', trackId: 'track-1', direction: 'left' });
      // Original p-lock at index 0 should now be at index 15 (wrapped)
      expect(result.tracks[0].parameterLocks[15]).toEqual({ volume: 0.8 });
    });
  });

  describe('INVERT_PATTERN', () => {
    it('inverts all steps within stepCount', () => {
      const state = createGoldenGridState();
      // Original: [true, false, false, false, true, ...]
      const result = gridReducer(state, { type: 'INVERT_PATTERN', trackId: 'track-1' });
      expect(result.tracks[0].steps[0]).toBe(false);
      expect(result.tracks[0].steps[1]).toBe(true);
      expect(result.tracks[0].steps[4]).toBe(false);
    });

    it('clears p-locks on steps that become inactive', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'INVERT_PATTERN', trackId: 'track-1' });
      // Step 0 was active with p-lock, now inactive - p-lock should be cleared
      expect(result.tracks[0].parameterLocks[0]).toBeNull();
    });
  });

  describe('REVERSE_PATTERN', () => {
    it('reverses steps within stepCount', () => {
      const state = createGoldenGridState();
      // Original: [true, false, false, false, true, false, false, false, ...]
      const result = gridReducer(state, { type: 'REVERSE_PATTERN', trackId: 'track-1' });
      // After reverse (16 steps): [..., false, false, false, true, false, false, false, true]
      expect(result.tracks[0].steps[15]).toBe(true);
      expect(result.tracks[0].steps[11]).toBe(true);
      expect(result.tracks[0].steps[0]).toBe(false);
    });
  });

  describe('EUCLIDEAN_FILL', () => {
    it('distributes hits evenly across step count', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'EUCLIDEAN_FILL', trackId: 'track-1', hits: 4 });
      // 4 hits in 16 steps = every 4th step
      const activeSteps = result.tracks[0].steps.slice(0, 16).filter(s => s).length;
      expect(activeSteps).toBe(4);
    });

    it('handles hits = 0 (clear all)', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'EUCLIDEAN_FILL', trackId: 'track-1', hits: 0 });
      const activeSteps = result.tracks[0].steps.slice(0, 16).filter(s => s).length;
      expect(activeSteps).toBe(0);
    });

    it('handles hits = stepCount (fill all)', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'EUCLIDEAN_FILL', trackId: 'track-1', hits: 16 });
      const activeSteps = result.tracks[0].steps.slice(0, 16).filter(s => s).length;
      expect(activeSteps).toBe(16);
    });
  });
});

// ============================================================================
// 4. Edge Case Golden Tests
// ============================================================================

describe('Golden Mutations - Edge Cases', () => {
  describe('Empty State', () => {
    it('handles SET_TEMPO on empty state', () => {
      const state: GridState = {
        tracks: [],
        tempo: 120,
        swing: 0,
        isPlaying: false,
        currentStep: -1,
      };
      const result = gridReducer(state, { type: 'SET_TEMPO', tempo: 140 });
      expect(result.tempo).toBe(140);
      expect(result.tracks).toEqual([]);
    });

    it('handles track operation on empty state', () => {
      const state: GridState = {
        tracks: [],
        tempo: 120,
        swing: 0,
        isPlaying: false,
        currentStep: -1,
      };
      const result = gridReducer(state, { type: 'TOGGLE_STEP', trackId: 'track-1', step: 0 });
      expect(result.tracks).toEqual([]);
    });
  });

  describe('Boundary Values', () => {
    it('handles step at index 0', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'TOGGLE_STEP', trackId: 'track-1', step: 0 });
      expect(result.tracks[0].steps[0]).toBe(false);
    });

    it('handles step at MAX_STEPS - 1', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'TOGGLE_STEP', trackId: 'track-1', step: MAX_STEPS - 1 });
      expect(result.tracks[0].steps[MAX_STEPS - 1]).toBe(true);
    });

    it('handles negative step index (no change)', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'TOGGLE_STEP', trackId: 'track-1', step: -1 });
      // Should not crash, may or may not change state depending on implementation
      expect(result.tracks[0].steps[0]).toBe(true); // Original value preserved
    });
  });

  describe('Local-Only State Preservation', () => {
    it('preserves isPlaying during SYNCED mutations', () => {
      const state = { ...createGoldenGridState(), isPlaying: true };
      const result = gridReducer(state, { type: 'SET_TEMPO', tempo: 140 });
      expect(result.isPlaying).toBe(true);
    });

    it('preserves currentStep during SYNCED mutations', () => {
      const state = { ...createGoldenGridState(), currentStep: 5 };
      const result = gridReducer(state, { type: 'SET_TEMPO', tempo: 140 });
      expect(result.currentStep).toBe(5);
    });

    it('preserves muted state during SYNCED mutations', () => {
      const state = createGoldenGridState();
      state.tracks[0].muted = true;
      const result = gridReducer(state, { type: 'SET_TEMPO', tempo: 140 });
      expect(result.tracks[0].muted).toBe(true);
    });

    it('preserves soloed state during SYNCED mutations', () => {
      const state = createGoldenGridState();
      state.tracks[0].soloed = true;
      const result = gridReducer(state, { type: 'SET_TEMPO', tempo: 140 });
      expect(result.tracks[0].soloed).toBe(true);
    });
  });
});

// ============================================================================
// 5. Round-Trip Consistency Tests
// ============================================================================

describe('Golden Mutations - Round-Trip Consistency', () => {
  describe('gridReducer and applyMutation produce same results', () => {
    it('SET_TEMPO produces identical results', () => {
      const gridState = createGoldenGridState();
      const sessionState = createGoldenSessionState();

      const gridResult = gridReducer(gridState, { type: 'SET_TEMPO', tempo: 140 });
      const sessionResult = applyMutation(sessionState, { type: 'set_tempo', tempo: 140 });

      expect(gridResult.tempo).toBe(sessionResult.tempo);
    });

    it('TOGGLE_STEP produces identical results', () => {
      const gridState = createGoldenGridState();
      const sessionState = createGoldenSessionState();

      const gridResult = gridReducer(gridState, { type: 'TOGGLE_STEP', trackId: 'track-1', step: 2 });
      const sessionResult = applyMutation(sessionState, { type: 'toggle_step', trackId: 'track-1', step: 2 });

      expect(gridResult.tracks[0].steps[2]).toBe(sessionResult.tracks[0].steps[2]);
    });

    it('ROTATE_PATTERN produces identical results', () => {
      const gridState = createGoldenGridState();
      const sessionState = createGoldenSessionState();

      const gridResult = gridReducer(gridState, { type: 'ROTATE_PATTERN', trackId: 'track-1', direction: 'left' });
      const sessionResult = applyMutation(sessionState, { type: 'rotate_pattern', trackId: 'track-1', direction: 'left' });

      // Compare first 16 steps (stepCount)
      for (let i = 0; i < 16; i++) {
        expect(gridResult.tracks[0].steps[i]).toBe(sessionResult.tracks[0].steps[i]);
      }
    });
  });
});

// ============================================================================
// 6. Copy/Move Sequence Golden Tests
// ============================================================================

describe('Golden Mutations - Copy/Move Sequence', () => {
  describe('COPY_SEQUENCE', () => {
    it('copies steps from source to target track', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'COPY_SEQUENCE', fromTrackId: 'track-1', toTrackId: 'track-2' });
      expect(result.tracks[1].steps).toEqual(state.tracks[0].steps);
    });

    it('copies parameter locks from source to target', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'COPY_SEQUENCE', fromTrackId: 'track-1', toTrackId: 'track-2' });
      expect(result.tracks[1].parameterLocks).toEqual(state.tracks[0].parameterLocks);
    });

    it('copies stepCount from source to target', () => {
      const state = createGoldenGridState();
      state.tracks[0].stepCount = 32;
      const result = gridReducer(state, { type: 'COPY_SEQUENCE', fromTrackId: 'track-1', toTrackId: 'track-2' });
      expect(result.tracks[1].stepCount).toBe(32);
    });

    it('does not modify source track', () => {
      const state = createGoldenGridState();
      const originalSource = { ...state.tracks[0], steps: [...state.tracks[0].steps] };
      const result = gridReducer(state, { type: 'COPY_SEQUENCE', fromTrackId: 'track-1', toTrackId: 'track-2' });
      expect(result.tracks[0].steps).toEqual(originalSource.steps);
    });
  });

  describe('MOVE_SEQUENCE', () => {
    it('moves steps from source to target and clears source', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'MOVE_SEQUENCE', fromTrackId: 'track-1', toTrackId: 'track-2' });

      // Target has source's pattern
      expect(result.tracks[1].steps[0]).toBe(true);
      expect(result.tracks[1].steps[4]).toBe(true);

      // Source is cleared
      expect(result.tracks[0].steps.every(s => s === false)).toBe(true);
    });
  });
});

// ============================================================================
// 7. Loop Region Golden Tests
// ============================================================================

describe('Golden Mutations - Loop Region', () => {
  describe('SET_LOOP_REGION', () => {
    it('sets loop region with valid values', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_LOOP_REGION', region: { start: 4, end: 8 } });
      expect(result.loopRegion).toEqual({ start: 4, end: 8 });
    });

    it('swaps start and end if start > end', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_LOOP_REGION', region: { start: 8, end: 4 } });
      expect(result.loopRegion).toEqual({ start: 4, end: 8 });
    });

    it('clears loop region when null', () => {
      const state = { ...createGoldenGridState(), loopRegion: { start: 4, end: 8 } };
      const result = gridReducer(state, { type: 'SET_LOOP_REGION', region: null });
      expect(result.loopRegion).toBeNull();
    });

    it('clamps to valid range based on longest track', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'SET_LOOP_REGION', region: { start: 0, end: 100 } });
      // Should clamp to longestTrack - 1 (which is 15 for 16-step tracks)
      expect(result.loopRegion?.end).toBeLessThanOrEqual(15);
    });
  });
});

// ============================================================================
// 8. Reorder Tracks Golden Tests
// ============================================================================

describe('Golden Mutations - Reorder Tracks', () => {
  describe('REORDER_TRACKS', () => {
    it('moves track from index 0 to index 1', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 1 });
      expect(result.tracks[0].id).toBe('track-2');
      expect(result.tracks[1].id).toBe('track-1');
    });

    it('does nothing when fromIndex equals toIndex', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: 0, toIndex: 0 });
      expect(result.tracks[0].id).toBe('track-1');
      expect(result.tracks[1].id).toBe('track-2');
    });

    it('does nothing for invalid indices', () => {
      const state = createGoldenGridState();
      const result = gridReducer(state, { type: 'REORDER_TRACKS', fromIndex: -1, toIndex: 0 });
      expect(result.tracks).toEqual(state.tracks);
    });
  });
});
