/**
 * Session types for KV storage
 */

import type { PlaybackMode } from '../types';

/**
 * Effects state for audio processing
 * Synced across multiplayer clients for consistent sound
 */
export interface EffectsState {
  reverb: {
    decay: number;  // 0.1 to 10 seconds
    wet: number;    // 0 to 1
  };
  delay: {
    time: string;      // Musical notation: "8n", "4n", "16n", etc.
    feedback: number;  // 0 to 0.95
    wet: number;       // 0 to 1
  };
  chorus: {
    frequency: number;  // 0.1 to 10 Hz
    depth: number;      // 0 to 1
    wet: number;        // 0 to 1
  };
  distortion: {
    amount: number;     // 0 to 1 (waveshaping intensity)
    wet: number;        // 0 to 1
  };
}

export interface SessionState {
  tracks: SessionTrack[];
  tempo: number;
  swing: number;
  effects?: EffectsState;  // Phase 25: Audio effects (optional for backwards compat)
  version: number; // Schema version for migrations
}

export interface SessionTrack {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (ParameterLock | null)[];
  volume: number;
  muted: boolean;
  soloed?: boolean; // When any track is soloed, only soloed tracks play. Defaults to false.
  playbackMode: PlaybackMode;
  transpose: number;
  stepCount?: number; // Per-track loop length (1-64), defaults to 16 if missing (backwards compat)
}

export interface ParameterLock {
  pitch?: number;
  volume?: number;
}

export interface Session {
  id: string;
  name: string | null;         // Optional session name for tab/display
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;      // For orphan detection
  remixedFrom: string | null;
  remixedFromName: string | null;  // Cached parent name for display
  remixCount: number;          // How many times this was remixed
  immutable: boolean;          // Phase 24: true = published (frozen forever)
  state: SessionState;
}

export interface Env {
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
  LIVE_SESSIONS: DurableObjectNamespace;
  SAMPLES: R2Bucket;
}

// Player info for multiplayer sessions
export interface PlayerInfo {
  id: string;
  connectedAt: number;
  lastMessageAt: number;
  messageCount: number;
  // Phase 11: Identity
  color: string;       // Hex color like '#E53935'
  colorIndex: number;  // Index into color array for consistent styling
  animal: string;      // Animal name like 'Fox'
  name: string;        // Full name like 'Red Fox'
}

// Phase 11: Cursor position for presence
export interface CursorPosition {
  x: number;       // Percentage (0-100) relative to grid container
  y: number;       // Percentage (0-100) relative to grid container
  trackId?: string;  // Optional: which track the cursor is over
  step?: number;     // Optional: which step the cursor is over
}

/**
 * Phase 13B: Message sequence number wrapper
 *
 * Optional sequence numbers for ordering and conflict detection.
 * - `seq`: Client-side incrementing counter per session
 * - `ack`: Last server seq acknowledged (for detecting missed messages)
 */
interface MessageSequence {
  seq?: number;    // Message sequence number (client-incremented)
  ack?: number;    // Last acknowledged server sequence
}

/**
 * Phase 24: Centralized definition of message types that mutate session state.
 *
 * ARCHITECTURAL PRINCIPLE: Single source of truth for what requires write access.
 * - All mutation checks reference this set (not hardcoded lists)
 * - Adding a new mutation type? Add it here → automatically blocked on published sessions
 * - Tests verify ALL types in this set are properly blocked
 */
export const MUTATING_MESSAGE_TYPES = new Set([
  'toggle_step',
  'set_tempo',
  'set_swing',
  'mute_track',
  'solo_track',
  'set_parameter_lock',
  'add_track',
  'delete_track',
  'clear_track',
  'set_track_sample',
  'set_track_volume',
  'set_track_transpose',
  'set_track_step_count',
  'set_effects',  // Phase 25: Audio effects sync
] as const);

/** Read-only message types (allowed on published sessions) */
export const READONLY_MESSAGE_TYPES = new Set([
  'play',
  'stop',
  'state_hash',
  'request_snapshot',
  'clock_sync_request',
  'cursor_move',
] as const);

/** Check if a message type mutates session state */
export function isStateMutatingMessage(type: string): boolean {
  return MUTATING_MESSAGE_TYPES.has(type as typeof MUTATING_MESSAGE_TYPES extends Set<infer T> ? T : never);
}

// Client → Server messages (base types)
type ClientMessageBase =
  | { type: 'toggle_step'; trackId: string; step: number }
  | { type: 'set_tempo'; tempo: number }
  | { type: 'set_swing'; swing: number }
  | { type: 'mute_track'; trackId: string; muted: boolean }
  | { type: 'solo_track'; trackId: string; soloed: boolean }
  | { type: 'set_parameter_lock'; trackId: string; step: number; lock: ParameterLock | null }
  | { type: 'add_track'; track: SessionTrack }
  | { type: 'delete_track'; trackId: string }
  | { type: 'clear_track'; trackId: string }
  | { type: 'set_track_sample'; trackId: string; sampleId: string; name: string }
  | { type: 'set_track_volume'; trackId: string; volume: number }
  | { type: 'set_track_transpose'; trackId: string; transpose: number }
  | { type: 'set_track_step_count'; trackId: string; stepCount: number }
  | { type: 'set_effects'; effects: EffectsState }  // Phase 25: Audio effects sync
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'state_hash'; hash: string }
  | { type: 'request_snapshot' }
  | { type: 'clock_sync_request'; clientTime: number }
  | { type: 'cursor_move'; position: CursorPosition };

// Client → Server messages with optional sequence numbers
export type ClientMessage = ClientMessageBase & MessageSequence;

// Server → Client messages (base types)
type ServerMessageBase =
  | { type: 'snapshot'; state: SessionState; players: PlayerInfo[]; playerId: string; immutable?: boolean; snapshotTimestamp?: number }
  | { type: 'step_toggled'; trackId: string; step: number; value: boolean; playerId: string }
  | { type: 'tempo_changed'; tempo: number; playerId: string }
  | { type: 'swing_changed'; swing: number; playerId: string }
  | { type: 'track_muted'; trackId: string; muted: boolean; playerId: string }
  | { type: 'track_soloed'; trackId: string; soloed: boolean; playerId: string }
  | { type: 'parameter_lock_set'; trackId: string; step: number; lock: ParameterLock | null; playerId: string }
  | { type: 'track_added'; track: SessionTrack; playerId: string }
  | { type: 'track_deleted'; trackId: string; playerId: string }
  | { type: 'track_cleared'; trackId: string; playerId: string }
  | { type: 'track_sample_set'; trackId: string; sampleId: string; name: string; playerId: string }
  | { type: 'track_volume_set'; trackId: string; volume: number; playerId: string }
  | { type: 'track_transpose_set'; trackId: string; transpose: number; playerId: string }
  | { type: 'track_step_count_set'; trackId: string; stepCount: number; playerId: string }
  | { type: 'effects_changed'; effects: EffectsState; playerId: string }  // Phase 25: Audio effects sync
  | { type: 'playback_started'; playerId: string; startTime: number; tempo: number }
  | { type: 'playback_stopped'; playerId: string }
  | { type: 'player_joined'; player: PlayerInfo }
  | { type: 'player_left'; playerId: string }
  | { type: 'state_mismatch'; serverHash: string }
  | { type: 'state_hash_match' }
  | { type: 'clock_sync_response'; clientTime: number; serverTime: number }
  | { type: 'cursor_moved'; playerId: string; position: CursorPosition; color: string; name: string }
  | { type: 'error'; message: string };

/**
 * Phase 13B: Server message sequence wrapper
 * - `seq`: Server-side incrementing counter (per session)
 * - `clientSeq`: Echo of client seq for request-response correlation
 */
interface ServerMessageSequence {
  seq?: number;       // Server broadcast sequence number
  clientSeq?: number; // Client message seq being responded to (if applicable)
}

// Server → Client messages with optional sequence numbers
export type ServerMessage = ServerMessageBase & ServerMessageSequence

// API response types
export interface CreateSessionResponse {
  id: string;
  url: string;
}

export type SessionResponse = Session;

export interface RemixSessionResponse {
  id: string;
  remixedFrom: string;
  url: string;
}

export interface ErrorResponse {
  error: string;
}
