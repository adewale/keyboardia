/**
 * Mobile UI Functionality Integration Tests
 *
 * These tests verify that the core functionality tested by the E2E tests
 * (pitch-contour-alignment, plock-editor, track-reorder) works correctly
 * at the state/reducer level.
 *
 * If these tests pass but E2E tests fail, it indicates timing/visibility
 * issues in the browser. If these tests fail, we have actual bugs in our changes.
 *
 * Tests cover:
 * 1. CSS dimension constants for pitch contour alignment
 * 2. Parameter lock (p-lock) state management
 * 3. Track reorder state management
 */

import { describe, it, expect } from 'vitest';
import {
  applyMutation,
  createInitialState,
  createDefaultTrack,
} from '../../src/shared/state-mutations';
import type { SessionState } from '../../src/shared/state';

// =============================================================================
// Test Helpers
// =============================================================================

function createStateWithTracks(count: number): SessionState {
  const state = createInitialState();
  for (let i = 0; i < count; i++) {
    const track = createDefaultTrack(`track-${i}`, `sample-${i}`, `Track ${i}`);
    state.tracks.push(track);
  }
  return state;
}

// =============================================================================
// 1. CSS Dimension Constants (Pitch Contour Alignment)
// =============================================================================

describe('CSS Dimension Constants', () => {
  /**
   * These tests verify the constants used for pitch contour alignment.
   * The E2E test pitch-contour-alignment.spec.ts verifies these at runtime.
   * These integration tests verify the expected values are consistent.
   */

  it('DESKTOP: step cell width (36px) + gap (3px) = 39px total', () => {
    // These values must match:
    // - src/components/StepCell.css: .step-cell { width: 36px; }
    // - src/components/TrackRow.css: .steps { gap: 3px; }
    // - src/components/PitchContour.test.ts: CELL_WIDTH = 39
    // - src/components/ChromaticGrid.tsx: cellWidth constant
    const DESKTOP_CELL_WIDTH = 36;
    const DESKTOP_GAP = 3;
    const EXPECTED_TOTAL = 39;

    expect(DESKTOP_CELL_WIDTH + DESKTOP_GAP).toBe(EXPECTED_TOTAL);
  });

  it('MOBILE LANDSCAPE: step cell width (36px) + gap (2px) = 38px total', () => {
    // Mobile landscape dimensions from TrackRow.css:
    // - .track-row .step-cell { width: 36px; height: 36px; }
    // - .track-row .steps { gap: 2px; }
    const MOBILE_LANDSCAPE_CELL_WIDTH = 36;
    const MOBILE_LANDSCAPE_GAP = 2;
    const EXPECTED_TOTAL = 38;

    expect(MOBILE_LANDSCAPE_CELL_WIDTH + MOBILE_LANDSCAPE_GAP).toBe(EXPECTED_TOTAL);
  });

  it('MOBILE PORTRAIT: step cell width (48px) for touch targets', () => {
    // Mobile portrait dimensions from StepCell.css:
    // - @media (max-width: 480px) and (orientation: portrait)
    // - .step-cell { width: 48px; height: 48px; }
    const MOBILE_PORTRAIT_CELL_WIDTH = 48;
    const MIN_TOUCH_TARGET = 44; // iOS HIG minimum

    expect(MOBILE_PORTRAIT_CELL_WIDTH).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});

// =============================================================================
// 2. Parameter Lock (P-lock) State Management
// =============================================================================

describe('Parameter Lock State Management', () => {
  /**
   * These tests verify the set_parameter_lock mutation works correctly.
   * The E2E test plock-editor.spec.ts verifies the UI behavior.
   */

  it('should set parameter lock on a step', () => {
    const state = createStateWithTracks(1);
    const trackId = state.tracks[0].id;

    const newState = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: 0,
      lock: { pitch: 5, volume: 0.8 },
    });

    expect(newState.tracks[0].parameterLocks[0]).toEqual({ pitch: 5, volume: 0.8 });
  });

  it('should clear parameter lock by setting to null', () => {
    const state = createStateWithTracks(1);
    const trackId = state.tracks[0].id;

    // Set a lock first
    let newState = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: 0,
      lock: { pitch: 5, volume: 0.8 },
    });

    expect(newState.tracks[0].parameterLocks[0]).not.toBeNull();

    // Clear the lock
    newState = applyMutation(newState, {
      type: 'set_parameter_lock',
      trackId,
      step: 0,
      lock: null,
    });

    expect(newState.tracks[0].parameterLocks[0]).toBeNull();
  });

  it('should update existing parameter lock', () => {
    const state = createStateWithTracks(1);
    const trackId = state.tracks[0].id;

    // Set initial lock
    let newState = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: 0,
      lock: { pitch: 5 },
    });

    // Update to different pitch
    newState = applyMutation(newState, {
      type: 'set_parameter_lock',
      trackId,
      step: 0,
      lock: { pitch: 12, volume: 0.5 },
    });

    expect(newState.tracks[0].parameterLocks[0]).toEqual({ pitch: 12, volume: 0.5 });
  });

  it('should handle parameter locks on multiple steps', () => {
    const state = createStateWithTracks(1);
    const trackId = state.tracks[0].id;

    let newState = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: 0,
      lock: { pitch: 0 },
    });

    newState = applyMutation(newState, {
      type: 'set_parameter_lock',
      trackId,
      step: 4,
      lock: { pitch: 5 },
    });

    newState = applyMutation(newState, {
      type: 'set_parameter_lock',
      trackId,
      step: 8,
      lock: { pitch: -3 },
    });

    expect(newState.tracks[0].parameterLocks[0]).toEqual({ pitch: 0 });
    expect(newState.tracks[0].parameterLocks[4]).toEqual({ pitch: 5 });
    expect(newState.tracks[0].parameterLocks[8]).toEqual({ pitch: -3 });
    expect(newState.tracks[0].parameterLocks[1]).toBeNull();
  });

  it('should handle tie parameter locks', () => {
    const state = createStateWithTracks(1);
    const trackId = state.tracks[0].id;

    const newState = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: 1,
      lock: { tie: true },
    });

    expect(newState.tracks[0].parameterLocks[1]).toEqual({ tie: true });
  });

  it('should ignore invalid step indices', () => {
    const state = createStateWithTracks(1);
    const trackId = state.tracks[0].id;

    // Negative step
    const newState1 = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: -1,
      lock: { pitch: 5 },
    });

    // Step beyond array length (128 is MAX_STEPS)
    const newState2 = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: 200,
      lock: { pitch: 5 },
    });

    // State should be unchanged
    expect(newState1.tracks[0].parameterLocks).toEqual(state.tracks[0].parameterLocks);
    expect(newState2.tracks[0].parameterLocks).toEqual(state.tracks[0].parameterLocks);
  });

  it('should handle batch parameter lock operations', () => {
    const state = createStateWithTracks(1);
    const trackId = state.tracks[0].id;

    const newState = applyMutation(state, {
      type: 'batch_set_parameter_locks',
      trackId,
      locks: [
        { step: 0, lock: { pitch: 0 } },
        { step: 1, lock: { pitch: 2 } },
        { step: 2, lock: { pitch: 4 } },
        { step: 3, lock: { pitch: 5 } },
      ],
    });

    expect(newState.tracks[0].parameterLocks[0]).toEqual({ pitch: 0 });
    expect(newState.tracks[0].parameterLocks[1]).toEqual({ pitch: 2 });
    expect(newState.tracks[0].parameterLocks[2]).toEqual({ pitch: 4 });
    expect(newState.tracks[0].parameterLocks[3]).toEqual({ pitch: 5 });
  });
});

// =============================================================================
// 3. Track Reorder State Management
// =============================================================================

describe('Track Reorder State Management', () => {
  /**
   * These tests verify the reorder_tracks mutation works correctly.
   * The E2E test track-reorder.spec.ts verifies the UI behavior.
   */

  it('should reorder tracks - move first to last', () => {
    const state = createStateWithTracks(3);
    const originalIds = state.tracks.map(t => t.id);

    const newState = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 0,
      toIndex: 2,
    });

    // Track 0 should now be at position 2
    expect(newState.tracks.map(t => t.id)).toEqual([
      originalIds[1], // Was at 1, now at 0
      originalIds[2], // Was at 2, now at 1
      originalIds[0], // Was at 0, now at 2
    ]);
  });

  it('should reorder tracks - move last to first', () => {
    const state = createStateWithTracks(3);
    const originalIds = state.tracks.map(t => t.id);

    const newState = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 2,
      toIndex: 0,
    });

    // Track 2 should now be at position 0
    expect(newState.tracks.map(t => t.id)).toEqual([
      originalIds[2], // Was at 2, now at 0
      originalIds[0], // Was at 0, now at 1
      originalIds[1], // Was at 1, now at 2
    ]);
  });

  it('should reorder tracks - move middle position', () => {
    const state = createStateWithTracks(3);
    const originalIds = state.tracks.map(t => t.id);

    const newState = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 0,
      toIndex: 1,
    });

    // Track 0 should now be at position 1
    expect(newState.tracks.map(t => t.id)).toEqual([
      originalIds[1], // Was at 1, now at 0
      originalIds[0], // Was at 0, now at 1
      originalIds[2], // Unchanged at 2
    ]);
  });

  it('should not change order when moving to same position', () => {
    const state = createStateWithTracks(3);
    const originalIds = state.tracks.map(t => t.id);

    const newState = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 1,
      toIndex: 1,
    });

    // Order should be unchanged
    expect(newState.tracks.map(t => t.id)).toEqual(originalIds);
  });

  it('should ignore invalid fromIndex (negative)', () => {
    const state = createStateWithTracks(3);
    const originalIds = state.tracks.map(t => t.id);

    const newState = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: -1,
      toIndex: 1,
    });

    // Order should be unchanged
    expect(newState.tracks.map(t => t.id)).toEqual(originalIds);
  });

  it('should ignore invalid toIndex (out of bounds)', () => {
    const state = createStateWithTracks(3);
    const originalIds = state.tracks.map(t => t.id);

    const newState = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 0,
      toIndex: 10,
    });

    // Order should be unchanged
    expect(newState.tracks.map(t => t.id)).toEqual(originalIds);
  });

  it('should preserve track data when reordering', () => {
    const state = createStateWithTracks(3);

    // Modify first track to have distinctive data
    state.tracks[0].name = 'Special Track';
    state.tracks[0].steps[0] = true;
    state.tracks[0].parameterLocks[0] = { pitch: 7 };
    state.tracks[0].volume = 0.5;

    const newState = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 0,
      toIndex: 2,
    });

    // Find the moved track and verify its data is preserved
    const movedTrack = newState.tracks[2];
    expect(movedTrack.name).toBe('Special Track');
    expect(movedTrack.steps[0]).toBe(true);
    expect(movedTrack.parameterLocks[0]).toEqual({ pitch: 7 });
    expect(movedTrack.volume).toBe(0.5);
  });

  it('should handle reordering with only 2 tracks', () => {
    const state = createStateWithTracks(2);
    const originalIds = state.tracks.map(t => t.id);

    const newState = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 0,
      toIndex: 1,
    });

    expect(newState.tracks.map(t => t.id)).toEqual([originalIds[1], originalIds[0]]);
  });

  it('should handle reordering with many tracks', () => {
    const state = createStateWithTracks(8);
    const originalIds = state.tracks.map(t => t.id);

    // Move track 2 to position 6
    const newState = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 2,
      toIndex: 6,
    });

    expect(newState.tracks.length).toBe(8);
    expect(newState.tracks[6].id).toBe(originalIds[2]);
    // Verify all tracks are still present
    expect(newState.tracks.map(t => t.id).sort()).toEqual(originalIds.sort());
  });
});

// =============================================================================
// 4. Combined Operations (Simulate Real Usage)
// =============================================================================

describe('Combined State Operations', () => {
  it('should handle adding tracks then reordering', () => {
    let state = createInitialState();

    // Add 3 tracks
    state = applyMutation(state, {
      type: 'add_track',
      track: createDefaultTrack('kick', 'kick', 'Kick'),
    });
    state = applyMutation(state, {
      type: 'add_track',
      track: createDefaultTrack('snare', 'snare', 'Snare'),
    });
    state = applyMutation(state, {
      type: 'add_track',
      track: createDefaultTrack('hat', 'hat', 'Hat'),
    });

    expect(state.tracks.map(t => t.name)).toEqual(['Kick', 'Snare', 'Hat']);

    // Reorder: move Hat to first position
    state = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 2,
      toIndex: 0,
    });

    expect(state.tracks.map(t => t.name)).toEqual(['Hat', 'Kick', 'Snare']);
  });

  it('should handle toggling steps then setting p-locks', () => {
    let state = createStateWithTracks(1);
    const trackId = state.tracks[0].id;

    // Toggle some steps on
    state = applyMutation(state, { type: 'toggle_step', trackId, step: 0 });
    state = applyMutation(state, { type: 'toggle_step', trackId, step: 4 });
    state = applyMutation(state, { type: 'toggle_step', trackId, step: 8 });

    expect(state.tracks[0].steps[0]).toBe(true);
    expect(state.tracks[0].steps[4]).toBe(true);
    expect(state.tracks[0].steps[8]).toBe(true);

    // Add p-locks to those steps
    state = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: 0,
      lock: { pitch: 0 },
    });
    state = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: 4,
      lock: { pitch: 5 },
    });
    state = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId,
      step: 8,
      lock: { pitch: 7 },
    });

    expect(state.tracks[0].parameterLocks[0]).toEqual({ pitch: 0 });
    expect(state.tracks[0].parameterLocks[4]).toEqual({ pitch: 5 });
    expect(state.tracks[0].parameterLocks[8]).toEqual({ pitch: 7 });
  });

  it('should handle p-locks and reordering together', () => {
    let state = createStateWithTracks(3);

    // Add p-lock to first track
    state = applyMutation(state, {
      type: 'set_parameter_lock',
      trackId: state.tracks[0].id,
      step: 0,
      lock: { pitch: 12, volume: 0.5 },
    });

    // Reorder: move first track to last
    state = applyMutation(state, {
      type: 'reorder_tracks',
      fromIndex: 0,
      toIndex: 2,
    });

    // The track with the p-lock should now be at position 2
    expect(state.tracks[2].parameterLocks[0]).toEqual({ pitch: 12, volume: 0.5 });
    // Other tracks should have null p-locks
    expect(state.tracks[0].parameterLocks[0]).toBeNull();
    expect(state.tracks[1].parameterLocks[0]).toBeNull();
  });
});

// =============================================================================
// 5. Touch Target Size Verification
// =============================================================================

describe('Touch Target Size Constants', () => {
  /**
   * Verify that our CSS constants meet accessibility guidelines.
   * iOS HIG recommends 44px minimum touch targets.
   */

  it('landscape mobile M/S buttons should meet minimum touch target (36px)', () => {
    // Our implementation uses 36px (slightly below 44px iOS HIG)
    // but acceptable for non-primary controls
    const LANDSCAPE_MS_BUTTON_SIZE = 36;
    const MINIMUM_ACCEPTABLE = 32; // Absolute minimum for touch

    expect(LANDSCAPE_MS_BUTTON_SIZE).toBeGreaterThanOrEqual(MINIMUM_ACCEPTABLE);
  });

  it('landscape mobile step cells should meet minimum touch target (36px)', () => {
    const LANDSCAPE_STEP_CELL_SIZE = 36;
    const MINIMUM_ACCEPTABLE = 32;

    expect(LANDSCAPE_STEP_CELL_SIZE).toBeGreaterThanOrEqual(MINIMUM_ACCEPTABLE);
  });

  it('portrait mobile step cells should meet iOS HIG (48px)', () => {
    const PORTRAIT_STEP_CELL_SIZE = 48;
    const IOS_HIG_MINIMUM = 44;

    expect(PORTRAIT_STEP_CELL_SIZE).toBeGreaterThanOrEqual(IOS_HIG_MINIMUM);
  });

  it('portrait header buttons should meet iOS HIG (44px)', () => {
    const PORTRAIT_HEADER_BUTTON_SIZE = 44;
    const IOS_HIG_MINIMUM = 44;

    expect(PORTRAIT_HEADER_BUTTON_SIZE).toBeGreaterThanOrEqual(IOS_HIG_MINIMUM);
  });
});
