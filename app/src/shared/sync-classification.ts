/**
 * Sync Classification Manifest
 *
 * This is the SINGLE SOURCE OF TRUTH for what should sync in multiplayer.
 * Tests verify that actual code behavior matches this manifest.
 *
 * ARCHITECTURAL PRINCIPLE: "My Ears, My Control"
 * - Session state (grid, tempo, structure) = synced to all players
 * - Personal mix (mute, solo) = local only, each player controls their own
 * - Playback = broadcasts for clock sync, but each user's playhead is independent
 *
 * When adding a new action:
 * 1. Add it to ONE of these sets (SYNCED, LOCAL_ONLY, or INTERNAL)
 * 2. Tests will fail if implementation doesn't match
 * 3. If SYNCED: add case to actionToMessage(), add message type to MUTATING_MESSAGE_TYPES
 */

/**
 * Actions that MUST sync to other clients (shared session state).
 * These modify the canonical session state that all players see.
 * Each must have a corresponding case in actionToMessage() that returns non-null.
 */
export const SYNCED_ACTIONS = new Set([
  'TOGGLE_STEP',           // Grid state - shared
  'SET_TEMPO',             // Global setting - shared
  'SET_SWING',             // Global setting - shared
  'SET_PARAMETER_LOCK',    // Grid automation - shared
  'ADD_TRACK',             // Structure change - shared
  'DELETE_TRACK',          // Structure change - shared
  'CLEAR_TRACK',           // Grid state - shared
  'SET_TRACK_SAMPLE',      // Track setting - shared
  'SET_TRACK_VOLUME',      // Track parameter - shared
  'SET_TRACK_TRANSPOSE',   // Track parameter - shared
  'SET_TRACK_STEP_COUNT',  // Track setting - shared
  'SET_TRACK_PLAYBACK_MODE', // Track setting - shared (Phase 26)
  'SET_EFFECTS',           // Global effects - shared (Phase 25)
  'SET_FM_PARAMS',         // Track parameter - shared (Phase 24)
  'COPY_SEQUENCE',         // Grid edit - shared (Phase 26)
  'MOVE_SEQUENCE',         // Grid edit - shared (Phase 26)
  'SET_SESSION_NAME',      // Session metadata - shared (all players see same title)
] as const);

/**
 * Actions that MUST NOT sync ("My Ears, My Control" philosophy).
 * Each player controls their own listening experience.
 * These must return null from actionToMessage().
 */
export const LOCAL_ONLY_ACTIONS = new Set([
  'TOGGLE_MUTE',           // Personal mix control
  'TOGGLE_SOLO',           // Personal focus control
  'EXCLUSIVE_SOLO',        // Personal focus control
  'CLEAR_ALL_SOLOS',       // Personal focus control
  'SET_PLAYING',           // Playback is independent per user (broadcasts for clock sync)
  'SET_CURRENT_STEP',      // Local playhead position
] as const);

/**
 * Actions that are internal/server-driven (not user-initiated sync).
 * These are either:
 * - Received from server (LOAD_STATE)
 * - Echo prevention markers (REMOTE_*)
 * - Internal implementation details (SET_TRACK_STEPS)
 */
export const INTERNAL_ACTIONS = new Set([
  'LOAD_STATE',            // Server snapshot - received, not sent
  'RESET_STATE',           // Local reset
  'REMOTE_STEP_SET',       // Echo prevention marker
  'REMOTE_MUTE_SET',       // Echo prevention marker
  'REMOTE_SOLO_SET',       // Echo prevention marker
  'SET_TRACK_STEPS',       // Internal for copy/move sync (server broadcasts steps directly)
] as const);

// Type helpers for strict typing
export type SyncedAction = typeof SYNCED_ACTIONS extends Set<infer T> ? T : never;
export type LocalOnlyAction = typeof LOCAL_ONLY_ACTIONS extends Set<infer T> ? T : never;
export type InternalAction = typeof INTERNAL_ACTIONS extends Set<infer T> ? T : never;

// All classified action types (for exhaustiveness checking)
export type ClassifiedAction = SyncedAction | LocalOnlyAction | InternalAction;

/**
 * Check if an action type is classified as synced.
 * Useful for runtime checks when you have a string action type.
 */
export function isSyncedAction(type: string): boolean {
  return SYNCED_ACTIONS.has(type as SyncedAction);
}

/**
 * Check if an action type is classified as local-only.
 */
export function isLocalOnlyAction(type: string): boolean {
  return LOCAL_ONLY_ACTIONS.has(type as LocalOnlyAction);
}

/**
 * Check if an action type is classified as internal.
 */
export function isInternalAction(type: string): boolean {
  return INTERNAL_ACTIONS.has(type as InternalAction);
}
