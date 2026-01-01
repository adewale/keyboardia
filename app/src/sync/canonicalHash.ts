/**
 * Canonical State Hashing for Client-Server Sync
 *
 * This module provides functions to canonicalize session state before hashing,
 * ensuring that client and server produce identical hashes even when they have
 * minor structural differences (e.g., undefined vs explicit false, array lengths).
 *
 * Normalization rules:
 * - stepCount: undefined -> 16 (DEFAULT_STEP_COUNT)
 * - steps/parameterLocks arrays: normalized to exactly stepCount length
 *   - Truncated if longer than stepCount
 *   - Padded with defaults (false/null) if shorter
 *
 * Excluded from hash (local-only state per "My Ears, My Control" philosophy):
 * - muted: Each user controls their own mix
 * - soloed: Each user controls their own focus
 * - version: Internal bookkeeping
 * - effects: Audio routing is local
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
  transpose: number;
  stepCount?: number;
  swing?: number;  // Phase 31D: Per-track swing (0-100)
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
  // NOTE: muted and soloed are EXCLUDED from hash
  // They are local-only state ("My Ears, My Control" philosophy)
  transpose: number;
  stepCount: number;
  swing: number;  // Phase 31D: Per-track swing, defaults to 0
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
 *
 * NOTE: muted and soloed are EXCLUDED from the canonical track.
 * These are local-only state per the "My Ears, My Control" philosophy.
 * Each user controls their own mix, so these values don't need to match
 * across clients for the session to be "in sync".
 */
function canonicalizeTrack(track: TrackForHash): CanonicalTrack {
  // Normalize optional fields to explicit defaults
  const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
  const swing = track.swing ?? 0;  // Phase 31D: Default to 0 (uses global swing)

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
    // muted: EXCLUDED - local-only
    // soloed: EXCLUDED - local-only
    transpose: track.transpose,
    stepCount,
    swing,  // Phase 31D: Per-track swing
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
