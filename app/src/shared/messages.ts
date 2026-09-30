/**
 * Shared Message Constants
 *
 * Canonical definitions for message type sets, shared between
 * frontend (sync/multiplayer.ts) and worker (worker/types.ts).
 *
 * ARCHITECTURAL PRINCIPLE: Single source of truth for what requires write access.
 * - All mutation checks reference this set (not hardcoded lists)
 * - Adding a new mutation type? Add it here -> automatically blocked on published sessions
 * - Type checking requires every client message to be classified exactly once
 *
 * IMPORTANT: Changes here affect both client and server. Run full test suite.
 */

import type { ClientMessageBase, ServerMessageBase } from './message-types';

type ClientMessageType = ClientMessageBase['type'];
type ServerMessageType = ServerMessageBase['type'];

/**
 * Message types that mutate session state.
 * Used for:
 * - Blocking mutations on published (immutable) sessions
 * - Tracking mutations for delivery confirmation
 * - Adding sequence numbers to broadcasts
 *
 * NOTE: mute_track and solo_track are intentionally EXCLUDED.
 * Mute/solo are local-only per "My Ears, My Control" philosophy.
 * Each user controls their own mix - these are never synced to shared state.
 * See: src/sync/sync-classification.ts for full sync classification.
 */
export const MESSAGE_TO_STATE_BROADCAST = {
  toggle_step: 'step_toggled',
  set_tempo: 'tempo_changed',
  set_swing: 'swing_changed',
  set_parameter_lock: 'parameter_lock_set',
  add_track: 'track_added',
  delete_track: 'track_deleted',
  clear_track: 'track_cleared',
  set_track_instrument: 'track_sample_set',
  set_track_sample: 'track_sample_set',
  set_track_volume: 'track_volume_set',
  set_track_pan: 'track_pan_set',
  set_track_transpose: 'track_transpose_set',
  set_track_step_count: 'track_step_count_set',
  set_track_swing: 'track_swing_set',
  set_effects: 'effects_changed',
  set_scale: 'scale_changed',
  set_fm_params: 'fm_params_changed',
  set_track_envelope: 'track_envelope_set',
  set_track_envelope_time_unit: 'track_envelope_time_unit_set',
  set_track_gate: 'track_gate_set',
  set_track_envelope_v2: 'track_envelope_v2_set',
  convert_track_envelope_units_v2: 'track_envelope_units_v2_converted',
  set_track_sample_playback_mode_v2: 'track_sample_playback_mode_v2_set',
  set_track_gate_v2: 'track_gate_v2_set',
  set_envelope_lock_v2: 'envelope_lock_v2_set',
  copy_sequence: 'sequence_copied',
  move_sequence: 'sequence_moved',
  set_session_name: 'session_name_changed',
  batch_clear_steps: 'steps_cleared',
  batch_set_parameter_locks: 'parameter_locks_batch_set',
  set_loop_region: 'loop_region_changed',
  reorder_tracks: 'tracks_reordered',
  rotate_pattern: 'pattern_rotated',
  invert_pattern: 'pattern_inverted',
  reverse_pattern: 'pattern_reversed',
  mirror_pattern: 'pattern_mirrored',
  euclidean_fill: 'euclidean_filled',
  set_track_name: 'track_name_set',
} as const satisfies Partial<Record<ClientMessageType, ServerMessageType>>;

export type MutatingMessageType = keyof typeof MESSAGE_TO_STATE_BROADCAST;
export type StateMutatingBroadcastType =
  | (typeof MESSAGE_TO_STATE_BROADCAST)[MutatingMessageType]
  | 'track_instrument_set';

export const MUTATING_MESSAGE_TYPES = new Set<MutatingMessageType>(
  Object.keys(MESSAGE_TO_STATE_BROADCAST) as MutatingMessageType[],
);

/**
 * Read-only message types (allowed on published sessions).
 * These don't mutate shared session state.
 *
 * NOTE: mute_track and solo_track are included here because they only
 * affect the sender's local mix, not shared state. Each user can control
 * their own listening experience even on published sessions.
 */
const READONLY_MESSAGE_TYPE_LIST = [
  'play',
  'stop',
  'state_hash',
  'request_snapshot',
  'clock_sync_request',
  'cursor_move',
  'mute_track',   // Local only - "My Ears, My Control"
  'solo_track',   // Local only - "My Ears, My Control"
] as const satisfies readonly ClientMessageType[];

export type ReadonlyMessageType = typeof READONLY_MESSAGE_TYPE_LIST[number];

export const READONLY_MESSAGE_TYPES = new Set<ReadonlyMessageType>(READONLY_MESSAGE_TYPE_LIST);

// Keep the protocol fail-closed: every client message must be classified
// exactly once. Adding a new message without choosing mutating or read-only,
// or putting it in both sets, fails type-checking here.
type MissingClassification = Exclude<
  ClientMessageType,
  MutatingMessageType | ReadonlyMessageType
>;
type ConflictingClassification = Extract<MutatingMessageType, ReadonlyMessageType>;
const _allClientMessagesClassified: Record<MissingClassification, never> = {};
const _classificationsAreDisjoint: Record<ConflictingClassification, never> = {};
void _allClientMessagesClassified;
void _classificationsAreDisjoint;

/**
 * Server broadcast message types that mutate session state.
 * Only these should have sequence numbers for ordering detection.
 * Non-mutating broadcasts (cursor_moved, player_joined, etc.) don't need
 * sequence numbers because missing them doesn't cause state drift.
 *
 * NOTE: track_muted and track_soloed are intentionally EXCLUDED.
 * These are broadcast for informational purposes only (e.g., showing remote
 * player activity in a debug view), but don't affect shared state.
 * Each client maintains its own local mute/solo state.
 */
export const STATE_MUTATING_BROADCASTS = new Set<StateMutatingBroadcastType>(
  [...Object.values(MESSAGE_TO_STATE_BROADCAST), 'track_instrument_set'],
);

/** Check if a message type mutates session state */
export function isStateMutatingMessage(type: string): boolean {
  return MUTATING_MESSAGE_TYPES.has(type as MutatingMessageType);
}

/** Check if a server broadcast type mutates session state */
export function isStateMutatingBroadcast(type: string): boolean {
  return STATE_MUTATING_BROADCASTS.has(type as StateMutatingBroadcastType);
}

/**
 * Exhaustive switch helper - used to ensure all cases are handled.
 *
 * Usage in switch statement default case:
 * ```
 * switch (msg.type) {
 *   case 'foo': ...
 *   case 'bar': ...
 *   default:
 *     assertNever(msg, `Unhandled message type: ${msg.type}`);
 * }
 * ```
 *
 * If a case is missing, TypeScript will error because `msg` won't be `never`.
 * At runtime, this throws if somehow reached (shouldn't happen with complete coverage).
 */
export function assertNever(x: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(x)}`);
}
