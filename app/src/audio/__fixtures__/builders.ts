/**
 * Test data builders / fixtures for Track and GridState.
 *
 * Replaces the ad-hoc `makeTrack` / `makeState` / `makeBlankState`
 * factories duplicated across 9+ test files. From the testing-best-
 * practices skill:
 *
 *   "Test setup should express intent, not structure. Use factory
 *    functions or builders so tests only specify the fields they
 *    care about."
 *
 * Pattern: each builder accepts a Partial<...> override. Specify only
 * what your test cares about; everything else gets sensible defaults.
 *
 * Example:
 *   aTrack({ id: 'A', sampleId: 'tone:fm-bass', volume: 0.5 })
 *   aState({ tracks: [aTrack({ id: 'A' })], tempo: 140 })
 */

import type { GridState, Track, ParameterLock } from '../../types';

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
export function aTrack(overrides: Partial<Track> = {}): Track {
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

/**
 * Build a Track with a parameter lock at a given step.
 *
 *   aTrackWithPLock({ id: 'A', step: 0, pLock: { volume: 0.5 } })
 */
export function aTrackWithPLock(overrides: Partial<Track> & { step: number; pLock: ParameterLock }): Track {
  const stepCount = overrides.stepCount ?? 16;
  const parameterLocks = Array(stepCount).fill(null);
  parameterLocks[overrides.step] = overrides.pLock;
  const { step: _s, pLock: _p, ...rest } = overrides;
  void _s; void _p;
  return aTrack({ ...rest, parameterLocks });
}

// ─── Pre-built invalid/boundary input collections ────────────────────────
//
// "For every feature: test valid input, invalid input, boundary values,
//  empty/null, error conditions" (testing-best-practices skill).
// Pre-defining these collections keeps tests focused on the behaviour
// being asserted, not on inventing input data.

export const VALID_PITCH_SEMITONES = [-24, -12, -6, -1, 0, 1, 6, 12, 24] as const;
export const INVALID_PITCH_SEMITONES = [-100, -25, 25, 48, 100, NaN, Infinity, -Infinity] as const;
export const BOUNDARY_PITCH_SEMITONES = [-25, -24, -23, 23, 24, 25] as const;

export const VALID_TRACK_VOLUMES = [0, 0.001, 0.25, 0.5, 0.75, 1] as const;
export const BOUNDARY_TRACK_VOLUMES = [0, 1] as const;

export const VALID_TEMPOS = [30, 60, 120, 180, 240] as const;
export const VALID_STEP_COUNTS = [1, 4, 8, 16, 32, 64, 128] as const;

/** Audio-time inputs that exercise the eventTime/currentTime boundary. */
export const TIME_PAIRS_AT_BOUNDARY = [
  { eventTime: 5.0, currentTime: 4.999, label: 'event just after current' },
  { eventTime: 5.0, currentTime: 5.0, label: 'exact equality' },
  { eventTime: 5.0, currentTime: 5.001, label: 'event just before current (late note)' },
] as const;

/** Sample-id strings that route through different play paths. */
export const SAMPLE_IDS_BY_TYPE = {
  sample: '808-kick',
  synth: 'synth:bass',
  tone: 'tone:fm-bass',
  advanced: 'advanced:supersaw',
  sampled: 'sampled:piano',
} as const;
