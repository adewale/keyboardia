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
  forkedFrom: string | null;
  state: SessionState;
}

export interface Env {
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
}

// API response types
export interface CreateSessionResponse {
  id: string;
  url: string;
}

export interface SessionResponse extends Session {}

export interface ForkSessionResponse {
  id: string;
  forkedFrom: string;
  url: string;
}

export interface ErrorResponse {
  error: string;
}
