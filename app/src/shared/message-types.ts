/**
 * Shared Message Type Definitions
 *
 * SINGLE SOURCE OF TRUTH for WebSocket message types.
 * Used by both frontend (sync/multiplayer.ts) and worker (worker/types.ts).
 *
 * IMPORTANT: Changes here affect both client and server. Run full test suite.
 *
 * Design decisions:
 * - Wire format uses SessionTrack (permissive, optional fields) not Track (strict)
 * - Client converts SessionTrack -> Track when receiving, applying defaults
 * - This allows backwards compatibility when adding new track fields
 */

import type { ParameterLock, EffectsState, FMParams, ScaleState } from './sync-types';
import type { SessionState, SessionTrack } from './state';
import type { PlayerInfo, CursorPosition } from './player';

// ============================================================================
// Sequence Number Support (Phase 13B)
// ============================================================================

/**
 * Client message sequence tracking.
 * - `seq`: Client-side incrementing counter per session
 * - `ack`: Last server seq acknowledged (for detecting missed messages)
 */
export interface MessageSequence {
  seq?: number;    // Message sequence number (client-incremented)
  ack?: number;    // Last acknowledged server sequence
}

/**
 * Server message sequence tracking.
 * - `seq`: Server-side incrementing counter (per session)
 * - `clientSeq`: Echo of client seq for request-response correlation
 */
export interface ServerMessageSequence {
  seq?: number;       // Server broadcast sequence number
  clientSeq?: number; // Client message seq being responded to (if applicable)
}

// ============================================================================
// Client -> Server Messages
// ============================================================================

/**
 * Base client message types (without sequence numbers).
 * Note: `add_track` uses SessionTrack for wire format compatibility.
 */
export type ClientMessageBase =
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
  | { type: 'set_track_swing'; trackId: string; swing: number }  // Phase 31D: Per-track swing
  | { type: 'set_effects'; effects: EffectsState }
  | { type: 'set_scale'; scale: ScaleState }
  | { type: 'set_fm_params'; trackId: string; fmParams: FMParams }
  | { type: 'copy_sequence'; fromTrackId: string; toTrackId: string }
  | { type: 'move_sequence'; fromTrackId: string; toTrackId: string }
  | { type: 'set_session_name'; name: string }
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'state_hash'; hash: string }
  | { type: 'request_snapshot' }
  | { type: 'clock_sync_request'; clientTime: number }
  | { type: 'cursor_move'; position: CursorPosition };

/** Client -> Server messages with sequence numbers */
export type ClientMessage = ClientMessageBase & MessageSequence;

// ============================================================================
// Server -> Client Messages
// ============================================================================

/**
 * Base server message types (without sequence numbers).
 * Note: `track_added` uses SessionTrack for wire format compatibility.
 */
export type ServerMessageBase =
  | { type: 'snapshot'; state: SessionState; players: PlayerInfo[]; playerId: string; immutable?: boolean; snapshotTimestamp?: number; serverSeq?: number; playingPlayerIds?: string[] }
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
  | { type: 'track_swing_set'; trackId: string; swing: number; playerId: string }  // Phase 31D
  | { type: 'effects_changed'; effects: EffectsState; playerId: string }
  | { type: 'scale_changed'; scale: ScaleState; playerId: string }
  | { type: 'fm_params_changed'; trackId: string; fmParams: FMParams; playerId: string }
  | { type: 'sequence_copied'; fromTrackId: string; toTrackId: string; steps: boolean[]; parameterLocks: (ParameterLock | null)[]; stepCount: number; playerId: string }
  | { type: 'sequence_moved'; fromTrackId: string; toTrackId: string; steps: boolean[]; parameterLocks: (ParameterLock | null)[]; stepCount: number; playerId: string }
  | { type: 'session_name_changed'; name: string; playerId: string }
  | { type: 'playback_started'; playerId: string; startTime: number; tempo: number }
  | { type: 'playback_stopped'; playerId: string }
  | { type: 'player_joined'; player: PlayerInfo }
  | { type: 'player_left'; playerId: string }
  | { type: 'state_mismatch'; serverHash: string }
  | { type: 'state_hash_match' }
  | { type: 'clock_sync_response'; clientTime: number; serverTime: number }
  | { type: 'cursor_moved'; playerId: string; position: CursorPosition; color: string; name: string }
  | { type: 'error'; message: string; code?: string };

/** Server -> Client messages with sequence numbers */
export type ServerMessage = ServerMessageBase & ServerMessageSequence;
