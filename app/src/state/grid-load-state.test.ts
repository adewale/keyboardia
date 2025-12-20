import { describe, it, expect } from 'vitest';
import { gridReducer, DEFAULT_EFFECTS_STATE } from './grid';
import type { GridState, Track } from '../types';
import { MAX_STEPS, STEPS_PER_PAGE } from '../types';

/**
 * BUG-10: LOAD_STATE must preserve local-only state (muted, soloed)
 *
 * Per "My Ears, My Control" philosophy:
 * - muted and soloed are LOCAL ONLY - each player controls their own mix
 * - When a snapshot is received, local mute/solo state should be preserved
 * - Server sends muted/soloed but client should ignore for existing tracks
 *
 * This was a bug where LOAD_STATE completely overwrote tracks, losing local state.
 */

function createTestTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    name: 'Test Track',
    sampleId: 'kick',
    steps: Array(MAX_STEPS).fill(false),
    parameterLocks: Array(MAX_STEPS).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    playbackMode: 'oneshot',
    transpose: 0,
    stepCount: STEPS_PER_PAGE,
    ...overrides,
  };
}

function createTestState(overrides: Partial<GridState> = {}): GridState {
  return {
    tracks: [],
    tempo: 120,
    swing: 0,
    effects: DEFAULT_EFFECTS_STATE,
    isPlaying: false,
    currentStep: 0,
    ...overrides,
  };
}

describe('LOAD_STATE: Local-Only State Preservation (BUG-10)', () => {
  describe('muted state preservation', () => {
    it('should preserve muted=true when server sends muted=false for existing track', () => {
      // Local state: track is muted
      const localTrack = createTestTrack({ id: 'track-1', muted: true });
      const localState = createTestState({ tracks: [localTrack] });

      // Server sends snapshot with muted=false (stale/default value)
      const serverTrack = createTestTrack({ id: 'track-1', muted: false });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [serverTrack],
        tempo: 120,
        swing: 0,
      });

      // Local muted state should be preserved
      expect(newState.tracks[0].muted).toBe(true);
    });

    it('should preserve muted=false when server sends muted=true for existing track', () => {
      // Local state: track is NOT muted
      const localTrack = createTestTrack({ id: 'track-1', muted: false });
      const localState = createTestState({ tracks: [localTrack] });

      // Server sends snapshot with muted=true (stale value from previous save)
      const serverTrack = createTestTrack({ id: 'track-1', muted: true });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [serverTrack],
        tempo: 120,
        swing: 0,
      });

      // Local muted state should be preserved
      expect(newState.tracks[0].muted).toBe(false);
    });

    it('should use server muted value for NEW tracks (not in local state)', () => {
      // Local state: no tracks
      const localState = createTestState({ tracks: [] });

      // Server sends new track with muted=true
      const serverTrack = createTestTrack({ id: 'new-track', muted: true });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [serverTrack],
        tempo: 120,
        swing: 0,
      });

      // New track should use server's muted value
      expect(newState.tracks[0].muted).toBe(true);
    });
  });

  describe('soloed state preservation', () => {
    it('should preserve soloed=true when server sends soloed=false for existing track', () => {
      // Local state: track is soloed
      const localTrack = createTestTrack({ id: 'track-1', soloed: true });
      const localState = createTestState({ tracks: [localTrack] });

      // Server sends snapshot with soloed=false
      const serverTrack = createTestTrack({ id: 'track-1', soloed: false });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [serverTrack],
        tempo: 120,
        swing: 0,
      });

      // Local soloed state should be preserved
      expect(newState.tracks[0].soloed).toBe(true);
    });

    it('should preserve soloed=false when server sends soloed=true for existing track', () => {
      // Local state: track is NOT soloed
      const localTrack = createTestTrack({ id: 'track-1', soloed: false });
      const localState = createTestState({ tracks: [localTrack] });

      // Server sends snapshot with soloed=true
      const serverTrack = createTestTrack({ id: 'track-1', soloed: true });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [serverTrack],
        tempo: 120,
        swing: 0,
      });

      // Local soloed state should be preserved
      expect(newState.tracks[0].soloed).toBe(false);
    });

    it('should use server soloed value for NEW tracks (not in local state)', () => {
      // Local state: no tracks
      const localState = createTestState({ tracks: [] });

      // Server sends new track with soloed=true
      const serverTrack = createTestTrack({ id: 'new-track', soloed: true });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [serverTrack],
        tempo: 120,
        swing: 0,
      });

      // New track should use server's soloed value
      expect(newState.tracks[0].soloed).toBe(true);
    });
  });

  describe('combined muted and soloed preservation', () => {
    it('should preserve both muted and soloed for multiple existing tracks', () => {
      // Local state: track-1 muted, track-2 soloed
      const localTracks = [
        createTestTrack({ id: 'track-1', muted: true, soloed: false }),
        createTestTrack({ id: 'track-2', muted: false, soloed: true }),
      ];
      const localState = createTestState({ tracks: localTracks });

      // Server sends both tracks with opposite values
      const serverTracks = [
        createTestTrack({ id: 'track-1', muted: false, soloed: true }),
        createTestTrack({ id: 'track-2', muted: true, soloed: false }),
      ];

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: serverTracks,
        tempo: 120,
        swing: 0,
      });

      // Local muted/soloed state should be preserved
      expect(newState.tracks[0].muted).toBe(true);
      expect(newState.tracks[0].soloed).toBe(false);
      expect(newState.tracks[1].muted).toBe(false);
      expect(newState.tracks[1].soloed).toBe(true);
    });

    it('should handle mix of existing and new tracks correctly', () => {
      // Local state: one track that's muted
      const localTrack = createTestTrack({ id: 'existing-track', muted: true, soloed: true });
      const localState = createTestState({ tracks: [localTrack] });

      // Server sends existing track (different mute/solo) + new track
      const serverTracks = [
        createTestTrack({ id: 'existing-track', muted: false, soloed: false }),
        createTestTrack({ id: 'new-track', muted: true, soloed: true }),
      ];

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: serverTracks,
        tempo: 120,
        swing: 0,
      });

      // Existing track: preserve local muted/soloed
      expect(newState.tracks[0].muted).toBe(true);
      expect(newState.tracks[0].soloed).toBe(true);

      // New track: use server's muted/soloed
      expect(newState.tracks[1].muted).toBe(true);
      expect(newState.tracks[1].soloed).toBe(true);
    });
  });

  describe('other state should still update from server', () => {
    it('should update tempo from server', () => {
      const localState = createTestState({ tempo: 100 });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [],
        tempo: 140,
        swing: 0,
      });

      expect(newState.tempo).toBe(140);
    });

    it('should update swing from server', () => {
      const localState = createTestState({ swing: 0 });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [],
        tempo: 120,
        swing: 50,
      });

      expect(newState.swing).toBe(50);
    });

    it('should update track steps from server (steps SHOULD sync)', () => {
      // Local has step 0 on
      const localTrack = createTestTrack({ id: 'track-1' });
      localTrack.steps[0] = true;
      const localState = createTestState({ tracks: [localTrack] });

      // Server has step 0 off, step 5 on
      const serverTrack = createTestTrack({ id: 'track-1' });
      serverTrack.steps[0] = false;
      serverTrack.steps[5] = true;

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [serverTrack],
        tempo: 120,
        swing: 0,
      });

      // Steps SHOULD be updated from server
      expect(newState.tracks[0].steps[0]).toBe(false);
      expect(newState.tracks[0].steps[5]).toBe(true);
    });

    it('should update track volume from server (volume SHOULD sync)', () => {
      const localTrack = createTestTrack({ id: 'track-1', volume: 0.5 });
      const localState = createTestState({ tracks: [localTrack] });

      const serverTrack = createTestTrack({ id: 'track-1', volume: 0.8 });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [serverTrack],
        tempo: 120,
        swing: 0,
      });

      // Volume SHOULD be updated from server
      expect(newState.tracks[0].volume).toBe(0.8);
    });
  });

  describe('preserves other local-only state', () => {
    it('should preserve isPlaying (local only)', () => {
      const localState = createTestState({ isPlaying: true });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [],
        tempo: 120,
        swing: 0,
      });

      expect(newState.isPlaying).toBe(true);
    });

    it('should preserve currentStep (local only)', () => {
      const localState = createTestState({ currentStep: 42 });

      const newState = gridReducer(localState, {
        type: 'LOAD_STATE',
        tracks: [],
        tempo: 120,
        swing: 0,
      });

      expect(newState.currentStep).toBe(42);
    });
  });
});
