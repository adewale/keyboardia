/**
 * Session types for KV storage
 */

import type { PlaybackMode } from '../types';

export interface SessionState {
  tracks: SessionTrack[];
  tempo: number;
  swing: number;
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
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;      // For orphan detection
  remixedFrom: string | null;
  remixedFromName: string | null;  // Cached parent name for display
  remixCount: number;          // How many times this was remixed
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
}

// Client → Server messages
export type ClientMessage =
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
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'state_hash'; hash: string }
  | { type: 'clock_sync_request'; clientTime: number };

// Server → Client messages
export type ServerMessage =
  | { type: 'snapshot'; state: SessionState; players: PlayerInfo[]; playerId: string }
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
  | { type: 'playback_started'; playerId: string; startTime: number; tempo: number }
  | { type: 'playback_stopped'; playerId: string }
  | { type: 'player_joined'; player: PlayerInfo }
  | { type: 'player_left'; playerId: string }
  | { type: 'state_mismatch'; serverHash: string }
  | { type: 'clock_sync_response'; clientTime: number; serverTime: number }
  | { type: 'error'; message: string }

// API response types
export interface CreateSessionResponse {
  id: string;
  url: string;
}

export interface SessionResponse extends Session {}

export interface RemixSessionResponse {
  id: string;
  remixedFrom: string;
  url: string;
}

export interface ErrorResponse {
  error: string;
}
