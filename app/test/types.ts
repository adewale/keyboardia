/**
 * Test Types - Centralized Re-exports from Canonical Sources
 *
 * This file provides a single import point for all types used in tests.
 * By importing from here instead of defining types locally, tests stay
 * in sync with the canonical definitions in src/shared/.
 *
 * NEVER define types locally in test files. Import from here instead.
 *
 * @example
 * // In a test file:
 * import type { SessionTrack, SessionState, PlayerInfo, ServerMessage } from '../types';
 * import { createTestTrack, createDefaultEffects } from '../types';
 */

// =============================================================================
// Core State Types (from src/shared/state.ts)
// =============================================================================
export type { SessionState, SessionTrack, Session } from '../src/shared/state';

// =============================================================================
// Sync Types (from src/shared/sync-types.ts)
// =============================================================================
export type { ParameterLock, FMParams, EffectsState, ScaleState } from '../src/shared/sync-types';
export { VALID_STEP_COUNTS, VALID_STEP_COUNTS_SET } from '../src/shared/sync-types';
export type { ValidStepCount } from '../src/shared/sync-types';

// =============================================================================
// Player Types (from src/shared/player.ts)
// =============================================================================
export type { PlayerInfo, CursorPosition, RemoteCursor } from '../src/shared/player';

// =============================================================================
// Message Types (from src/shared/message-types.ts)
// =============================================================================
export type {
  ClientMessageBase,
  ClientMessage,
  ServerMessageBase,
  ServerMessage,
  MessageSequence,
  ServerMessageSequence,
  MutationType,
} from '../src/shared/message-types';
export { MUTATION_TYPES } from '../src/shared/message-types';

// =============================================================================
// Message Sets (from src/shared/messages.ts)
// =============================================================================
export {
  MUTATING_MESSAGE_TYPES,
  READONLY_MESSAGE_TYPES,
  STATE_MUTATING_BROADCASTS,
  isStateMutatingMessage,
  isStateMutatingBroadcast,
  assertNever,
} from '../src/shared/messages';
export type {
  MutatingMessageType,
  ReadonlyMessageType,
  StateMutatingBroadcastType,
} from '../src/shared/messages';

// =============================================================================
// Test Helpers - Factory Functions
// =============================================================================

import type { SessionTrack, EffectsState, FMParams, ParameterLock } from '../src/shared/sync-types';
import type { SessionState } from '../src/shared/state';

/**
 * Creates a test track with reasonable defaults.
 * Use this in tests instead of manually constructing track objects.
 */
export function createTestTrack(id: string, options?: Partial<SessionTrack>): SessionTrack {
  return {
    id,
    name: `Track ${id}`,
    sampleId: 'kick',
    steps: Array(16).fill(false),
    parameterLocks: Array(16).fill(null),
    volume: 1,
    muted: false,
    transpose: 0,
    stepCount: 16,
    ...options,
  };
}

/**
 * Creates default effects state with bypass=false and all wet=0.
 * Use this in tests when you need an effects object.
 */
export function createDefaultEffects(): EffectsState {
  return {
    bypass: false,
    reverb: { decay: 2.0, wet: 0 },
    delay: { time: '8n', feedback: 0.3, wet: 0 },
    chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
    distortion: { amount: 0.4, wet: 0 },
  };
}

/**
 * Creates default FM synth params.
 * Use this in tests when you need FMParams.
 */
export function createDefaultFMParams(): FMParams {
  return {
    harmonicity: 3,
    modulationIndex: 10,
  };
}

/**
 * Creates a test parameter lock.
 */
export function createParameterLock(pitch?: number, volume?: number): ParameterLock {
  const lock: ParameterLock = {};
  if (pitch !== undefined) lock.pitch = pitch;
  if (volume !== undefined) lock.volume = volume;
  return lock;
}

/**
 * Creates an empty session state with optional overrides.
 */
export function createSessionState(options?: Partial<SessionState>): SessionState {
  return {
    tracks: [],
    tempo: 120,
    swing: 0,
    version: 1,
    ...options,
  };
}

// =============================================================================
// Debug/Introspection Types (Test-specific)
// =============================================================================

/**
 * Debug endpoint response type.
 * This matches the shape returned by /api/debug/durable-object/:id
 */
export interface DebugInfo {
  sessionId: string | null;
  connectedPlayers: number;
  players: import('../src/shared/player').PlayerInfo[];
  playingPlayerIds: string[];
  playingCount: number;
  trackCount: number;
  tempo: number;
  swing: number;
  pendingKVSave: boolean;
  invariants: {
    valid: boolean;
    violations: string[];
    warnings?: string[];
  };
  state?: SessionState;
}
