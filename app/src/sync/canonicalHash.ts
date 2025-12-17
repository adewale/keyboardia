/**
 * Canonical State Hashing for Client-Server Sync
 *
 * This module provides functions to canonicalize session state before hashing,
 * ensuring that client and server produce identical hashes even when they have
 * minor structural differences (e.g., undefined vs explicit false, array lengths).
 *
 * Normalization rules:
 * - soloed: undefined -> false
 * - stepCount: undefined -> 16 (DEFAULT_STEP_COUNT)
 * - steps/parameterLocks arrays: normalized to exactly stepCount length
 *   - Truncated if longer than stepCount
 *   - Padded with defaults (false/null) if shorter
 * - version and effects fields: excluded from hash
 */

// Default step count matches the client's STEPS_PER_PAGE constant
const DEFAULT_STEP_COUNT = 16;

// Minimal track type for hash input
interface TrackForHash {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (unknown | null)[];
  volume: number;
  muted: boolean;
  soloed?: boolean;
  playbackMode: string;
  transpose: number;
  stepCount?: number;
}

export interface StateForHash {
  tracks: TrackForHash[];
  tempo: number;
  swing: number;
  version?: number;
  effects?: unknown;
}

interface CanonicalTrack {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (unknown | null)[];
  volume: number;
  muted: boolean;
  soloed: boolean;
  playbackMode: string;
  transpose: number;
  stepCount: number;
}

interface CanonicalState {
  tracks: CanonicalTrack[];
  tempo: number;
  swing: number;
}

/**
 * Normalize an array to exactly the target length.
 * - Truncates if longer than target
 * - Pads with defaultValue if shorter than target
 */
function normalizeArray<T>(arr: T[], targetLength: number, defaultValue: T): T[] {
  if (arr.length === targetLength) {
    return arr;
  }
  if (arr.length > targetLength) {
    return arr.slice(0, targetLength);
  }
  // Pad with default values
  const padding = new Array(targetLength - arr.length).fill(defaultValue);
  return [...arr, ...padding];
}

/**
 * Canonicalize a single track for consistent hashing.
 */
function canonicalizeTrack(track: TrackForHash): CanonicalTrack {
  // Normalize optional fields to explicit defaults
  const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
  const soloed = track.soloed ?? false;

  // Normalize arrays to exactly stepCount length
  const steps = normalizeArray(track.steps, stepCount, false);
  const parameterLocks = normalizeArray(track.parameterLocks, stepCount, null);

  return {
    id: track.id,
    name: track.name,
    sampleId: track.sampleId,
    steps,
    parameterLocks,
    volume: track.volume,
    muted: track.muted,
    soloed,
    playbackMode: track.playbackMode,
    transpose: track.transpose,
    stepCount,
  };
}

/**
 * Canonicalize session state for consistent hashing.
 *
 * This ensures that client and server produce identical hashes by:
 * 1. Setting explicit defaults for optional fields (soloed, stepCount)
 * 2. Normalizing array lengths to stepCount
 * 3. Excluding non-essential fields (version, effects)
 */
export function canonicalizeForHash(state: StateForHash): CanonicalState {
  return {
    tracks: state.tracks.map(canonicalizeTrack),
    tempo: state.tempo,
    swing: state.swing,
  };
}

/**
 * Hash a state object for comparison.
 * Uses a simple string hash that's fast and deterministic.
 */
export function hashState(state: unknown): string {
  const str = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
