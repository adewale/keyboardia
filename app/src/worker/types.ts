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

// Re-export shared sync types (canonical definitions)
export type { PlaybackMode, ParameterLock, FMParams, EffectsState, ScaleState } from '../shared/sync-types';
export { VALID_STEP_COUNTS, VALID_STEP_COUNTS_SET } from '../shared/sync-types';
export type { ValidStepCount } from '../shared/sync-types';

// Re-export shared state types (canonical definitions)
export type { SessionState, SessionTrack, Session } from '../shared/state';
import type { Session } from '../shared/state';

// Re-export shared player types (canonical definitions)
export type { PlayerInfo, CursorPosition } from '../shared/player';

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
  assertNever,
} from '../shared/messages';

// Import and re-export shared message types (canonical definitions)
// These are now the SINGLE SOURCE OF TRUTH for message types
export type {
  MessageSequence,
  ServerMessageSequence,
  ClientMessageBase,
  ServerMessageBase,
  ClientMessage,
  ServerMessage,
} from '../shared/message-types';

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

// Backwards compatibility: Keep isStateMutatingMessage and isStateMutatingBroadcast available
// They are re-exported from '../shared/messages' above

// NOTE: The following type definitions have been REMOVED and consolidated into
// src/shared/message-types.ts:
// - MessageSequence
// - ServerMessageSequence
// - ClientMessageBase
// - ServerMessageBase
// - ClientMessage
// - ServerMessage
//
// If you see a type error after this refactor, import from '../shared/message-types'
// or from this file (which re-exports them).

