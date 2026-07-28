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

interface KVNamespace {
  get(key: string): Promise<string | null>;
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface R2Bucket {}

// Re-export shared sync types (canonical definitions)
export type { ParameterLock, FMParams, EffectsState, ScaleState } from '../shared/sync-types';
export { VALID_STEP_COUNTS, VALID_STEP_COUNTS_SET } from '../shared/sync-types';
export type { ValidStepCount } from '../shared/sync-types';

// Re-export shared state types (canonical definitions)
export type { SessionState, SessionTrack, Session } from '../shared/state';
import type { Session } from '../shared/state';

// Re-export shared player types (canonical definitions)
export type { PlayerInfo, CursorPosition } from '../shared/player';

/**
 * Cloudflare Version Metadata binding
 * @see https://developers.cloudflare.com/workers/configuration/versions-and-deployments/
 */
export interface VersionMetadata {
  /** Unique deployment/version ID */
  id: string;
  /** Optional tag set via `wrangler deploy --tag` */
  tag?: string;
  /** ISO 8601 timestamp when this version was deployed */
  timestamp: string;
}

export interface Env {
  // Bindings
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
  LIVE_SESSIONS: DurableObjectNamespace;
  SESSION_ALLOCATOR: DurableObjectNamespace;
  SAMPLES: R2Bucket;

  // Observability 2.0: Version metadata for deployment tracking
  CF_VERSION_METADATA: VersionMetadata;

  // Environment variables
  ENVIRONMENT?: string;   // "production" | "staging"
  SERVICE_NAME?: string;  // "keyboardia" | "keyboardia-staging"
  // Wide events default on. Integration/miniflare runs turn them off because
  // forwarding thousands of console events through Vitest's worker RPC can
  // outlive the test environment and fail teardown after all assertions pass.
  OBSERVABILITY_LOGS_ENABLED?: string;
  /** Local full-stack runner nonce; omitted in deployed environments. */
  E2E_RUN_ID?: string;

  // Per-minute, per-IP rate limit overrides. Unset means the production
  // default in worker/index.ts. Raise these for load and integration testing
  // instead of editing the defaults.
  SESSION_CREATE_RATE_LIMIT_PER_MINUTE?: string;
  MCP_RATE_LIMIT_PER_MINUTE?: string;
  OG_IMAGE_RATE_LIMIT_PER_MINUTE?: string;
}

// Import and re-export shared message constants (canonical definitions)
export {
  READONLY_MESSAGE_TYPES,
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
