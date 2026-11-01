import { describe, it, expect } from 'vitest';

/**
 * Tests for session loading behavior.
 *
 * The useSession hook has a critical race condition:
 * When loading a session, React state is still empty when status becomes 'ready'.
 * The auto-save effect would see empty state and save it, overwriting the loaded session.
 *
 * The fix uses a skipNextSaveRef flag to skip the first auto-save after loading,
 * allowing React to re-render with the loaded state first.
 *
 * These tests verify the logic that prevents this race condition.
 */

describe('Session loading race condition prevention', () => {
  /**
   * Simulates the auto-save logic with skip flag
   */
  function simulateAutoSave(
    currentState: { tracks: unknown[]; tempo: number; swing: number },
    lastStateRef: { current: string },
    skipNextSaveRef: { current: boolean }
  ): { saved: boolean; lastStateUpdated: boolean } {
    // Skip save after loading a session
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      lastStateRef.current = JSON.stringify({
        tracks: currentState.tracks,
        tempo: currentState.tempo,
        swing: currentState.swing,
      });
      return { saved: false, lastStateUpdated: true };
    }

    const stateJson = JSON.stringify({
      tracks: currentState.tracks,
      tempo: currentState.tempo,
      swing: currentState.swing,
    });

    if (stateJson === lastStateRef.current) {
      return { saved: false, lastStateUpdated: false };
    }

    lastStateRef.current = stateJson;
    return { saved: true, lastStateUpdated: true };
  }

  it('should skip first save after loading (race condition fix)', () => {
    // Simulate: session loads, status becomes 'ready', but React state is still empty
    const emptyState = { tracks: [], tempo: 120, swing: 0 };
    const lastStateRef = { current: '' };
    const skipNextSaveRef = { current: true }; // Set by loadSession

    // First auto-save effect run (with empty state due to React not re-rendering yet)
    const result = simulateAutoSave(emptyState, lastStateRef, skipNextSaveRef);

    // Should NOT save - the skip flag prevents it
    expect(result.saved).toBe(false);
    expect(skipNextSaveRef.current).toBe(false); // Flag consumed
  });

  it('should save on second render after load (with loaded state)', () => {
    const loadedState = {
      tracks: [{ id: 'track-1', name: 'Kick', sampleId: 'kick' }],
      tempo: 108,
      swing: 15,
    };
    const lastStateRef = { current: JSON.stringify({ tracks: [], tempo: 120, swing: 0 }) };
    const skipNextSaveRef = { current: false }; // Already consumed

    // Second auto-save run (now React has the loaded state)
    const result = simulateAutoSave(loadedState, lastStateRef, skipNextSaveRef);

    // Should save because state changed from empty to loaded
    expect(result.saved).toBe(true);
  });

  it('should NOT save when loaded state matches (no change after load)', () => {
    const loadedState = {
      tracks: [{ id: 'track-1', name: 'Kick', sampleId: 'kick' }],
      tempo: 108,
      swing: 15,
    };
    // lastStateRef already has the loaded state from previous save
    const lastStateRef = { current: JSON.stringify(loadedState) };
    const skipNextSaveRef = { current: false };

    const result = simulateAutoSave(loadedState, lastStateRef, skipNextSaveRef);

    // Should NOT save - state hasn't changed
    expect(result.saved).toBe(false);
  });

  it('should save when user modifies state after load', () => {
    const loadedState = {
      tracks: [{ id: 'track-1', name: 'Kick', sampleId: 'kick' }],
      tempo: 108,
      swing: 15,
    };
    const lastStateRef = { current: JSON.stringify(loadedState) };
    const skipNextSaveRef = { current: false };

    // User changes tempo
    const modifiedState = { ...loadedState, tempo: 120 };
    const result = simulateAutoSave(modifiedState, lastStateRef, skipNextSaveRef);

    // Should save because user made a change
    expect(result.saved).toBe(true);
  });

  it('full flow: load session, skip first save, then track user changes', () => {
    const lastStateRef = { current: '' };
    const skipNextSaveRef = { current: true };

    // Step 1: Status becomes 'ready', React state still empty
    const emptyState = { tracks: [], tempo: 120, swing: 0 };
    const result1 = simulateAutoSave(emptyState, lastStateRef, skipNextSaveRef);
    expect(result1.saved).toBe(false); // Skipped!

    // Step 2: React re-renders with loaded state
    const loadedState = {
      tracks: [{ id: 'track-1', name: 'Kick', sampleId: 'kick' }],
      tempo: 108,
      swing: 15,
    };
    const result2 = simulateAutoSave(loadedState, lastStateRef, skipNextSaveRef);
    expect(result2.saved).toBe(true); // Saved (state changed from empty to loaded)

    // Step 3: No changes, should not save again
    const result3 = simulateAutoSave(loadedState, lastStateRef, skipNextSaveRef);
    expect(result3.saved).toBe(false); // No change

    // Step 4: User adds a track
    const userModifiedState = {
      tracks: [
        { id: 'track-1', name: 'Kick', sampleId: 'kick' },
        { id: 'track-2', name: 'Snare', sampleId: 'snare' },
      ],
      tempo: 108,
      swing: 15,
    };
    const result4 = simulateAutoSave(userModifiedState, lastStateRef, skipNextSaveRef);
    expect(result4.saved).toBe(true); // User change saved
  });
});
