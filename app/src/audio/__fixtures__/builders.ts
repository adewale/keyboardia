/**
 * Test data builders / fixtures for Track and GridState.
 *
 * Shared by the scheduler routing tests. Each builder accepts a
 * Partial<...> override so those tests specify only relevant fields.
 *
 * Example:
 *   aTrack({ id: 'A', sampleId: 'tone:fm-bass', volume: 0.5 })
 *   aState({ tracks: [aTrack({ id: 'A' })], tempo: 140 })
 */

import type { GridState, Track } from '../../types';

/**
 * Default Track that satisfies the structural type. Steps are all off
 * unless overridden. Parameter locks are all null. No FM params, no
 * per-track swing — pure baseline.
 */
const TRACK_DEFAULTS: Omit<Track, 'id' | 'sampleId'> = {
  name: 'test-track',
  steps: Array(16).fill(false),
  parameterLocks: Array(16).fill(null),
  volume: 1,
  muted: false,
  soloed: false,
  transpose: 0,
  stepCount: 16,
};

const STATE_DEFAULTS: Omit<GridState, 'tracks'> = {
  tempo: 120,
  swing: 0,
  isPlaying: false,
  currentStep: 0,
  loopRegion: null,
};

let _autoId = 0;

/**
 * Build a Track. Anything not in `overrides` gets a sensible default.
 * `id` auto-generates if omitted. `sampleId` defaults to '808-kick'.
 */
function aTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: overrides.id ?? `track-${++_autoId}`,
    sampleId: overrides.sampleId ?? '808-kick',
    ...TRACK_DEFAULTS,
    ...overrides,
  };
}

/**
 * Build a GridState. Tracks default to empty array.
 */
export function aState(overrides: Partial<GridState> = {}): GridState {
  return {
    tracks: [],
    ...STATE_DEFAULTS,
    ...overrides,
  };
}

/**
 * Build a Track with a specific step pattern. Indices in `activeSteps`
 * are turned on; everything else is off. Convenience over passing the
 * full boolean array.
 *
 *   aTrackWithSteps({ id: 'A', activeSteps: [0, 4, 8, 12] })
 */
export function aTrackWithSteps(overrides: Partial<Track> & { activeSteps: number[] }): Track {
  const stepCount = overrides.stepCount ?? 16;
  const steps = Array(stepCount).fill(false);
  for (const i of overrides.activeSteps) {
    if (i >= 0 && i < stepCount) steps[i] = true;
  }
  const { activeSteps: _drop, ...rest } = overrides;
  void _drop;
  return aTrack({ ...rest, steps });
}
