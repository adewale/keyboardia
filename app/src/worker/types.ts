/**
 * Session types for KV storage
 *
 * Types are now consolidated in src/shared/ for single source of truth.
 * This file re-exports them for backwards compatibility.
 */

// ============================================================================
// Cloudflare Worker Type Stubs
// ============================================================================
// These are minimal type stubs for Cloudflare Workers types that are used
// in this file. They are needed because this file is imported by test files
// that run in Node.js context (not Cloudflare Workers context).
// In actual Cloudflare Workers, the real types from @cloudflare/workers-types
// will be used via global ambient declarations.
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface KVNamespace {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Fetcher {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface DurableObjectNamespace {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface R2Bucket {}

// Import and re-export shared sync types (canonical definitions)
export type { PlaybackMode, ParameterLock, FMParams, EffectsState } from '../shared/sync-types';
import type { ParameterLock, EffectsState, FMParams } from '../shared/sync-types';

// Import and re-export shared state types (canonical definitions)
export type { SessionState, SessionTrack, Session } from '../shared/state';
import type { SessionState, SessionTrack } from '../shared/state';

// Import and re-export shared player types (canonical definitions)
export type { PlayerInfo, CursorPosition } from '../shared/player';
import type { PlayerInfo, CursorPosition } from '../shared/player';

export interface Env {
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
  LIVE_SESSIONS: DurableObjectNamespace;
  SAMPLES: R2Bucket;
}

// Import and re-export shared message constants (canonical definitions)
export {
  MUTATING_MESSAGE_TYPES,
  READONLY_MESSAGE_TYPES,
  STATE_MUTATING_BROADCASTS,
  isStateMutatingMessage,
  isStateMutatingBroadcast,
} from '../shared/messages';

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
  | { type: 'set_fm_params'; trackId: string; fmParams: FMParams }  // Phase 24: FM synth params
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
  | { type: 'snapshot'; state: SessionState; players: PlayerInfo[]; playerId: string; immutable?: boolean; snapshotTimestamp?: number; playingPlayerIds?: string[] }
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
  | { type: 'fm_params_changed'; trackId: string; fmParams: FMParams; playerId: string }  // Phase 24: FM synth params
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
