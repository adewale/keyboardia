/**
 * State hashing utilities for consistency verification
 *
 * Used by debug endpoints and the sync system to verify client/server state matches.
 *
 * Note: HTTP and WebSocket logging has been replaced by Observability 2.0 wide events.
 * See observability.ts for the new event-based logging system.
 */

import { DEFAULT_STEP_COUNT } from '../shared/constants';
import type { ScaleState } from '../shared/sync-types';
import { normalizeSessionScale } from '../shared/scale-defaults';

// =============================================================================
// State Hashing for Consistency Verification (Phase 7)
// =============================================================================

// Minimal track type for hash input
interface TrackForHash {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (unknown | null)[];
  volume: number;
  pan?: number;
  muted: boolean;
  soloed?: boolean;
  transpose: number;
  stepCount?: number;
  swing?: number;  // Phase 31D: Per-track swing (0-100)
}

interface StateForHash {
  tracks: TrackForHash[];
  tempo: number;
  swing: number;
  version?: number;
  effects?: unknown;
  scale?: ScaleState;
}

interface CanonicalTrack {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (unknown | null)[];
  volume: number;
  pan: number;
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
  scale: ScaleState;
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
    pan: track.pan ?? 0,
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
 * 1. Setting explicit defaults for optional fields (stepCount)
 * 2. Normalizing array lengths to stepCount
 * 3. Excluding non-essential fields (version, effects)
 * 4. Excluding local-only fields (muted, soloed) per "My Ears, My Control"
 */
export function canonicalizeForHash(state: StateForHash): CanonicalState {
  return {
    tracks: state.tracks.map(canonicalizeTrack),
    tempo: state.tempo,
    swing: state.swing,
    scale: normalizeSessionScale(state.scale, 'legacy-session'),
  };
}

/**
 * Compute a hash of the session state for consistency checks.
 * Uses a simple string hash since crypto.subtle is async and we need sync for tests.
 *
 * Note: In Cloudflare Workers, we could use crypto.subtle.digest, but this
 * simpler hash works well for detecting state divergence.
 */
export function hashState(state: unknown): string {
  const str = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to hex and pad
  return (hash >>> 0).toString(16).padStart(8, '0');
}
