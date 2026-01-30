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
 * 2. TypeScript will error at the bottom of this file if you miss this step!
 * 3. If SYNCED: add case to actionToMessage(), add message type to MUTATING_MESSAGE_TYPES
 *
 * COMPILE-TIME SAFETY: The exhaustiveness check at the bottom ensures ALL
 * GridAction types are classified. If you add a new action to types.ts without
 * classifying it here, TypeScript will fail to compile.
 */

import type { GridActionType } from '../types';

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
  'SET_TRACK_SWING',       // Track parameter - shared (Phase 31D: Per-track swing)
  'SET_TRACK_NAME',        // Track parameter - shared (Phase 31D)
  'SET_EFFECTS',           // Global effects - shared (Phase 25)
  'SET_SCALE',             // Global setting - shared (Phase 29E: Key Assistant)
  'SET_FM_PARAMS',         // Track parameter - shared (Phase 24)
  'COPY_SEQUENCE',         // Grid edit - shared (Phase 26)
  'MOVE_SEQUENCE',         // Grid edit - shared (Phase 26)
  'SET_SESSION_NAME',      // Session metadata - shared (all players see same title)
  // Phase 31B: Pattern manipulation - all modify shared grid state
  'ROTATE_PATTERN',        // Grid edit - shared
  'INVERT_PATTERN',        // Grid edit - shared
  'REVERSE_PATTERN',       // Grid edit - shared
  'MIRROR_PATTERN',        // Grid edit - shared
  'EUCLIDEAN_FILL',        // Grid edit - shared
  // Phase 31G: Workflow features
  'REORDER_TRACKS',        // Structure change - shared (local dispatch, uses handleTrackReorder)
  'SET_LOOP_REGION',       // Loop playback region - shared
  // Phase 31F: Batch operations for multi-select (selection is local, but results sync)
  'DELETE_SELECTED_STEPS', // Batch delete - syncs which steps were cleared
  'APPLY_TO_SELECTION',    // Batch apply - syncs which p-locks were set
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
  'UNMUTE_ALL',            // Personal mix control (Phase 31D)
  'SET_PLAYING',           // Playback is independent per user (broadcasts for clock sync)
  'SET_CURRENT_STEP',      // Local playhead position
  // Phase 31F: Multi-select actions (selection UI is per-user)
  'SELECT_STEP',           // Selection state is local
  'CLEAR_SELECTION',       // Selection state is local
  // Note: DELETE_SELECTED_STEPS and APPLY_TO_SELECTION are in SYNCED_ACTIONS
  // because while selection is local, the RESULTS (step/plock changes) must sync
  // Phase 36: Keyboard focus actions (focus UI is per-user)
  'FOCUS_TRACK',           // Focus state is local
  'FOCUS_STEP',            // Focus state is local
  'BLUR_FOCUS',            // Focus state is local
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
  'REORDER_TRACK_BY_ID',   // Remote dispatch for track reorder (uses trackId for commutativity)
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

// =============================================================================
// COMPILE-TIME EXHAUSTIVENESS CHECK
// =============================================================================
//
// This section ensures that ALL GridAction types from types.ts are classified.
// If you add a new action to GridAction but forget to add it to one of the
// sets above (SYNCED, LOCAL_ONLY, or INTERNAL), TypeScript will fail to compile
// with an error pointing to _unclassifiedCheck below.
//
// HOW IT WORKS:
// 1. GridActionType is extracted from the GridAction union in types.ts
// 2. ClassifiedAction is the union of all types in our three sets
// 3. UnclassifiedAction = GridActionType - ClassifiedAction (any types not classified)
// 4. If UnclassifiedAction is 'never', all types are classified (good!)
// 5. If UnclassifiedAction has any types, the assignment below fails to compile
//
// WHEN YOU SEE AN ERROR HERE:
// The error message will show which action type(s) are not classified.
// Add them to the appropriate set: SYNCED_ACTIONS, LOCAL_ONLY_ACTIONS, or INTERNAL_ACTIONS.
// =============================================================================

/**
 * Compile-time check: All GridAction types must be classified.
 *
 * If this line has a TypeScript error, it means there are action types in
 * GridAction (from types.ts) that are not in SYNCED_ACTIONS, LOCAL_ONLY_ACTIONS,
 * or INTERNAL_ACTIONS. The error message will show which types are missing.
 */
type UnclassifiedAction = Exclude<GridActionType, ClassifiedAction>;

// This assignment will fail to compile if UnclassifiedAction is not 'never'.
// The error will show which action type(s) need to be classified.
 
const _unclassifiedCheck: UnclassifiedAction extends never
  ? true
  : { error: 'UNCLASSIFIED_ACTIONS_DETECTED'; missing: UnclassifiedAction } = true;
void _unclassifiedCheck; // Suppress unused variable warning
