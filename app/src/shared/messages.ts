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
 *
 * NOTE: mute_track and solo_track are intentionally EXCLUDED.
 * Mute/solo are local-only per "My Ears, My Control" philosophy.
 * Each user controls their own mix - these are never synced to shared state.
 * See: src/shared/sync-classification.ts for full sync classification.
 */
export const MUTATING_MESSAGE_TYPES = new Set([
  'toggle_step',
  'set_tempo',
  'set_swing',
  // mute_track - LOCAL ONLY (My Ears, My Control)
  // solo_track - LOCAL ONLY (My Ears, My Control)
  'set_parameter_lock',
  'add_track',
  'delete_track',
  'clear_track',
  'set_track_sample',
  'set_track_volume',
  'set_track_transpose',
  'set_track_step_count',
  'set_track_swing',   // Phase 31D: Per-track swing
  'set_effects',       // Phase 25: Audio effects sync
  'set_scale',         // Phase 29E: Key Assistant scale sync
  'set_fm_params',     // Phase 24: FM synth parameters
  'copy_sequence',     // Phase 26: Copy steps between tracks
  'move_sequence',     // Phase 26: Move steps between tracks
  'set_session_name',  // Session metadata sync (title visible to all players)
  // Phase 31F: Batch operations for multi-select
  'batch_clear_steps',          // Clear multiple steps at once
  'batch_set_parameter_locks',  // Set multiple p-locks at once
  // Phase 31G: Loop selection
  'set_loop_region',            // Set loop playback region
] as const);

/**
 * Read-only message types (allowed on published sessions).
 * These don't mutate shared session state.
 *
 * NOTE: mute_track and solo_track are included here because they only
 * affect the sender's local mix, not shared state. Each user can control
 * their own listening experience even on published sessions.
 */
export const READONLY_MESSAGE_TYPES = new Set([
  'play',
  'stop',
  'state_hash',
  'request_snapshot',
  'clock_sync_request',
  'cursor_move',
  'mute_track',   // Local only - "My Ears, My Control"
  'solo_track',   // Local only - "My Ears, My Control"
] as const);

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
export const STATE_MUTATING_BROADCASTS = new Set([
  'step_toggled',
  'tempo_changed',
  'swing_changed',
  // track_muted - informational only (local state per client)
  // track_soloed - informational only (local state per client)
  'parameter_lock_set',
  'track_added',
  'track_deleted',
  'track_cleared',
  'track_sample_set',
  'track_volume_set',
  'track_transpose_set',
  'track_step_count_set',
  'track_swing_set',   // Phase 31D: Per-track swing
  'effects_changed',
  'scale_changed',     // Phase 29E: Key Assistant scale sync
  'fm_params_changed',
  'sequence_copied',   // Phase 26: Steps copied between tracks
  'sequence_moved',    // Phase 26: Steps moved between tracks
  'session_name_changed',  // Session metadata sync
  // Phase 31F: Batch operation broadcasts
  'steps_cleared',             // Multiple steps cleared
  'parameter_locks_batch_set', // Multiple p-locks set
  // Phase 31G: Loop selection
  'loop_region_changed',       // Loop region updated
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
