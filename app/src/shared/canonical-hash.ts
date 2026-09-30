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
 * Excluded from hash:
 * - muted: Each user controls their own mix
 * - soloed: Each user controls their own focus
 * - playbackMode: Deprecated compatibility field; playback uses samplePlaybackMode
 * - version: Internal bookkeeping
 */

import { DEFAULT_STEP_COUNT } from './constants';
import type {
  EffectsState,
  ScaleState,
  TrackEnvelope,
  EnvelopeTimeUnit,
  FMParams,
} from './sync-types';
import type { SessionState, SessionTrack } from './state';
import { normalizeSessionEffects } from './effects-defaults';
import { LEGACY_MISSING_SCALE_STATE, normalizeSessionScale } from './scale-defaults';
import type { SamplePlaybackMode, TrackEnvelopeV2 } from './envelope-contract-v2';

// Keep the hash input tied to the shared session schema. Parameter locks stay
// deliberately permissive because canonical hashing preserves unknown fields
// sent by clients from a newer rolling deployment.
type TrackForHash = Omit<SessionTrack, 'parameterLocks'> & {
  parameterLocks: (unknown | null)[];
};

export type StateForHash = Omit<SessionState, 'tracks' | 'version'> & {
  tracks: TrackForHash[];
  version?: number;
};

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
  fmParams: FMParams | null;
  envelope: TrackEnvelope | null;
  envelopeTimeUnit: EnvelopeTimeUnit;
  envelopeV2: TrackEnvelopeV2 | null;
  samplePlaybackMode: SamplePlaybackMode | null;
  gate: number;
}

interface CanonicalState {
  tracks: CanonicalTrack[];
  tempo: number;
  swing: number;
  effects: EffectsState;
  scale: ScaleState;
  loopRegion: { start: number; end: number } | null;
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
    fmParams: track.fmParams ?? null,
    envelope: track.envelope ?? null,
    envelopeTimeUnit: track.envelopeTimeUnit ?? 'seconds',
    envelopeV2: track.envelopeV2 ?? null,
    samplePlaybackMode: track.samplePlaybackMode ?? null,
    gate: track.gate ?? 90,
  };
}

/**
 * Canonicalize session state for consistent hashing.
 *
 * This ensures that client and server produce identical hashes by:
 * 1. Setting explicit defaults for optional authored fields
 * 2. Normalizing array lengths to stepCount
 * 3. Excluding local or bookkeeping fields (mute, solo, deprecated
 *    playbackMode, and version)
 */
export function canonicalizeForHash(state: StateForHash): CanonicalState {
  return {
    tracks: state.tracks.map(canonicalizeTrack),
    tempo: state.tempo,
    swing: state.swing,
    effects: normalizeSessionEffects(state.effects, 'legacy-session'),
    scale: normalizeSessionScale(state.scale, 'legacy-session'),
    loopRegion: state.loopRegion ?? null,
  };
}

type LegacyHashState<T> = Omit<T, 'effects' | 'loopRegion'>;

function projectLegacyHashState<T extends object>(canonicalState: T): LegacyHashState<T> {
  const legacyState = { ...canonicalState } as Record<string, unknown>;
  delete legacyState.effects;
  delete legacyState.loopRegion;
  return legacyState as LegacyHashState<T>;
}

/**
 * Match the hash shape a pre-v2 Worker expects from a current browser.
 *
 * Old Workers already hashed scale when clients supplied it, so the browser
 * retains the authored scale while omitting fields added in hash v2.
 */
export function projectCanonicalStateForClientHashCapability<T extends object>(
  canonicalState: T,
  supportsStateHashV2: boolean,
): T | LegacyHashState<T> {
  return supportsStateHashV2 ? canonicalState : projectLegacyHashState(canonicalState);
}

/**
 * Match the hash shape a pre-v2 browser sends to a current Worker.
 *
 * Old browsers omitted scale from their live-state projection. Canonicalizing
 * that missing field produced LEGACY_MISSING_SCALE_STATE, so the Worker must
 * substitute that value when the client has not negotiated hash v2.
 */
export function projectCanonicalStateForServerHashCapability<T extends { scale: ScaleState }>(
  canonicalState: T,
  supportsStateHashV2: boolean,
): T | LegacyHashState<T> {
  if (supportsStateHashV2) return canonicalState;
  return {
    ...projectLegacyHashState(canonicalState),
    scale: { ...LEGACY_MISSING_SCALE_STATE },
  };
}

/**
 * Hash a state object for comparison.
 * Uses a simple string hash that's fast and deterministic.
 *
 * Memoized: caches the last (input JSON, hash) pair to avoid redundant
 * serialization when called repeatedly with unchanged state (common during
 * multiplayer sync). See docs/LESSONS-LEARNED.md Lesson 20.
 */
let _lastHashInput: string | null = null;
let _lastHashResult: string | null = null;

export function hashState(state: unknown): string {
  const str = JSON.stringify(state);

  // Fast path: return cached hash if input unchanged
  if (str === _lastHashInput && _lastHashResult !== null) {
    return _lastHashResult;
  }

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const result = (hash >>> 0).toString(16).padStart(8, '0');

  _lastHashInput = str;
  _lastHashResult = result;

  return result;
}
