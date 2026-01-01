/**
 * Shared State Types
 *
 * Canonical definitions for session and track state, shared between
 * frontend (sync/multiplayer.ts) and worker (worker/types.ts).
 *
 * IMPORTANT: Changes here affect both client and server. Run full test suite.
 */

import type { ParameterLock, FMParams, EffectsState, ScaleState } from './sync-types';

/**
 * Session state - the core data model for a Keyboardia session.
 * Contains all tracks, tempo, swing, and effects.
 */
export interface SessionState {
  tracks: SessionTrack[];
  tempo: number;
  swing: number;
  effects?: EffectsState;  // Optional for backwards compat
  scale?: ScaleState;      // Phase 29E: Key Assistant scale state (optional for backwards compat)
  version: number;         // Schema version for migrations
}

/**
 * A single track in a session.
 * Contains step pattern, sample reference, and playback settings.
 */
export interface SessionTrack {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (ParameterLock | null)[];
  volume: number;
  muted: boolean;
  soloed?: boolean;        // When any track is soloed, only soloed tracks play
  playbackMode?: string;   // DEPRECATED: Ignored on load, kept for backwards compatibility
  transpose: number;
  stepCount?: number;      // Per-track loop length (1-128), defaults to 16
  fmParams?: FMParams;     // Optional FM synth params (only for tone:fm-* presets)
  swing?: number;          // Phase 31D: Per-track swing (0-100), 0 = uses global swing only
}

/**
 * Full session metadata + state.
 * Used for session storage and API responses.
 */
export interface Session {
  id: string;
  name: string | null;           // Optional session name for tab/display
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;        // For orphan detection
  remixedFrom: string | null;
  remixedFromName: string | null;  // Cached parent name for display
  remixCount: number;            // How many times this was remixed
  immutable: boolean;            // Phase 21: true = published (frozen forever)
  state: SessionState;
}
