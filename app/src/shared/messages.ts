/**
 * Shared Message Constants
 *
 * Canonical definitions for message type sets, shared between
 * frontend (sync/multiplayer.ts) and worker (worker/types.ts).
 *
 * ARCHITECTURAL PRINCIPLE: Single source of truth for what requires write access.
 * - All mutation checks reference this set (not hardcoded lists)
 * - Adding a new mutation type? Add it here -> automatically blocked on published sessions
 * - Tests verify ALL types in this set are properly blocked
 *
 * IMPORTANT: Changes here affect both client and server. Run full test suite.
 */

/**
 * Message types that mutate session state.
 * Used for:
 * - Blocking mutations on published (immutable) sessions
 * - Tracking mutations for delivery confirmation
 * - Adding sequence numbers to broadcasts
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
  'set_effects',       // Phase 25: Audio effects sync
  'set_fm_params',     // Phase 24: FM synth parameters
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

/**
 * Server broadcast message types that mutate session state.
 * Only these should have sequence numbers for ordering detection.
 * Non-mutating broadcasts (cursor_moved, player_joined, etc.) don't need
 * sequence numbers because missing them doesn't cause state drift.
 */
export const STATE_MUTATING_BROADCASTS = new Set([
  'step_toggled',
  'tempo_changed',
  'swing_changed',
  'track_muted',
  'track_soloed',
  'parameter_lock_set',
  'track_added',
  'track_deleted',
  'track_cleared',
  'track_sample_set',
  'track_volume_set',
  'track_transpose_set',
  'track_step_count_set',
  'effects_changed',
  'fm_params_changed',
] as const);

/** Type for mutating message type strings */
export type MutatingMessageType = typeof MUTATING_MESSAGE_TYPES extends Set<infer T> ? T : never;

/** Type for readonly message type strings */
export type ReadonlyMessageType = typeof READONLY_MESSAGE_TYPES extends Set<infer T> ? T : never;

/** Type for state-mutating broadcast type strings */
export type StateMutatingBroadcastType = typeof STATE_MUTATING_BROADCASTS extends Set<infer T> ? T : never;

/** Check if a message type mutates session state */
export function isStateMutatingMessage(type: string): boolean {
  return MUTATING_MESSAGE_TYPES.has(type as MutatingMessageType);
}

/** Check if a server broadcast type mutates session state */
export function isStateMutatingBroadcast(type: string): boolean {
  return STATE_MUTATING_BROADCASTS.has(type as StateMutatingBroadcastType);
}
