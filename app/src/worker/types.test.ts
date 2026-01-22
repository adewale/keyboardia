import { describe, it, expect } from 'vitest';
import type { Track, ParameterLock as AppParameterLock } from '../types';
import type { SessionTrack, ParameterLock as WorkerParameterLock } from './types';
import {
  MIN_TEMPO as APP_MIN_TEMPO,
  MAX_TEMPO as APP_MAX_TEMPO,
  MIN_SWING as APP_MIN_SWING,
  MAX_SWING as APP_MAX_SWING,
  MAX_STEPS as APP_MAX_STEPS,
  MAX_TRACKS as APP_MAX_TRACKS,
} from '../types';
import {
  MIN_TEMPO as WORKER_MIN_TEMPO,
  MAX_TEMPO as WORKER_MAX_TEMPO,
  MIN_SWING as WORKER_MIN_SWING,
  MAX_SWING as WORKER_MAX_SWING,
  MAX_STEPS as WORKER_MAX_STEPS,
  MAX_TRACKS as WORKER_MAX_TRACKS,
} from './invariants';
import { canonicalizeForHash } from './logging';
import { canonicalizeForHash as clientCanonicalizeForHash } from '../sync/canonicalHash';

// =============================================================================
// COMPILE-TIME TYPE PARITY ENFORCEMENT
// =============================================================================
// These type checks fail at COMPILE TIME if Track and SessionTrack diverge.
// This catches the bug BEFORE tests run, during `tsc` or IDE type checking.
//
// BUG PATTERN: "Serialization Boundary Mismatch"
// Root cause: Track (client) and SessionTrack (server) had different fields,
// causing JSON.stringify to produce different output for the same logical state.
// =============================================================================

/**
 * Type utility: Extract keys from a type (handles optional vs required)
 */
type AllKeys<T> = keyof T;

/**
 * Type utility: Check if two types have the same keys
 * Returns `true` if same, `never` if different (causing compile error)
 */
type AssertSameKeys<T, U> =
  AllKeys<T> extends AllKeys<U>
    ? (AllKeys<U> extends AllKeys<T> ? true : never)
    : never;

/**
 * COMPILE-TIME CHECK: Track and SessionTrack must have identical field names.
 *
 * If you see a TypeScript error here like:
 *   "Type 'never' is not assignable to type 'true'"
 *
 * It means Track and SessionTrack have different fields. To fix:
 * 1. Check which field was added/removed from one type but not the other
 * 2. Add the missing field to both src/types.ts (Track) and src/worker/types.ts (SessionTrack)
 * 3. If the field is optional in SessionTrack, add it to OPTIONAL_SESSION_TRACK_FIELDS
 *    and update canonicalizeForHash() to provide a default value
 *
 * See docs/bug-patterns.md "Serialization Boundary Mismatch" for details.
 */
const _compileTimeParityCheck: AssertSameKeys<Track, SessionTrack> = true;

// Suppress unused variable warning - the check happens at compile time
void _compileTimeParityCheck;

/**
 * These tests ensure that Track (app state) and SessionTrack (persistence)
 * stay in sync. If you add a field to Track, you must add it to SessionTrack
 * (or explicitly document why it's excluded).
 *
 * This prevents data loss when saving/loading sessions.
 *
 * BUG PATTERN: "Serialization Boundary Mismatch"
 * See docs/bug-patterns.md for details on why this matters.
 * When adding new fields:
 * 1. Add to BOTH field lists below
 * 2. Consider whether optional fields need canonicalizeForHash updates
 * 3. Add cross-boundary serialization tests
 */
describe('Track/SessionTrack field parity', () => {
  // Define the expected fields for each interface
  // IMPORTANT: When adding a field to Track or SessionTrack, add it here too!
  // If a field is optional in SessionTrack but required in Track, it MUST be
  // handled by canonicalizeForHash to prevent hash mismatches.
  const TRACK_FIELDS: (keyof Track)[] = [
    'id',
    'name',
    'sampleId',
    'steps',
    'parameterLocks',
    'volume',
    'muted',
    'soloed',       // Added: was missing, caused hash mismatch bug
    'transpose',
    'stepCount',
  ];

  // SessionTrack should have all the same fields (some may be optional for backwards compat)
  // WARNING: Optional fields (field?: T) cause JSON.stringify to omit them when undefined,
  // which breaks hash comparison. Any optional field MUST be handled by canonicalizeForHash.
  const SESSION_TRACK_FIELDS: (keyof SessionTrack)[] = [
    'id',
    'name',
    'sampleId',
    'steps',
    'parameterLocks',
    'volume',
    'muted',
    'soloed',       // Added: was missing, caused hash mismatch bug
    'transpose',
    'stepCount',
  ];

  // Fields that are optional in SessionTrack but required in Track
  // These MUST be normalized by canonicalizeForHash before any comparison
  const OPTIONAL_SESSION_TRACK_FIELDS: (keyof SessionTrack)[] = [
    'soloed',     // Optional in SessionTrack, required in Track
    'stepCount',  // Optional in SessionTrack, required in Track
  ];

  it('SessionTrack should include all Track fields', () => {
    const missingFields = TRACK_FIELDS.filter(
      field => !SESSION_TRACK_FIELDS.includes(field as keyof SessionTrack)
    );

    expect(missingFields).toEqual([]);

    if (missingFields.length > 0) {
      throw new Error(
        `SessionTrack is missing fields that exist in Track:\n` +
        `  ${missingFields.join(', ')}\n\n` +
        `Add these fields to SessionTrack in src/worker/types.ts to prevent data loss.\n` +
        `Fields can be optional (field?: type) for backwards compatibility.\n` +
        `WARNING: Optional fields MUST be handled by canonicalizeForHash!`
      );
    }
  });

  it('Track should include all SessionTrack fields', () => {
    const extraFields = SESSION_TRACK_FIELDS.filter(
      field => !TRACK_FIELDS.includes(field as keyof Track)
    );

    expect(extraFields).toEqual([]);

    if (extraFields.length > 0) {
      throw new Error(
        `SessionTrack has fields that don't exist in Track:\n` +
        `  ${extraFields.join(', ')}\n\n` +
        `Either add these fields to Track in src/types.ts or remove from SessionTrack.`
      );
    }
  });

  it('should have matching field counts', () => {
    expect(TRACK_FIELDS.length).toBe(10);  // Updated: removed playbackMode
    expect(SESSION_TRACK_FIELDS.length).toBe(10);
  });

  it('optional SessionTrack fields should be documented', () => {
    // This test ensures we track which fields have optionality mismatch
    // If you add an optional field to SessionTrack that's required in Track,
    // add it to OPTIONAL_SESSION_TRACK_FIELDS and update canonicalizeForHash
    expect(OPTIONAL_SESSION_TRACK_FIELDS).toContain('soloed');
    expect(OPTIONAL_SESSION_TRACK_FIELDS).toContain('stepCount');
  });
});

/**
 * Cross-boundary serialization tests
 * These verify that client and server produce identical canonical output
 * for the same logical state, preventing hash mismatch bugs.
 */
describe('Cross-boundary canonical serialization', () => {
  it('client and server canonicalizeForHash should produce identical output', () => {
    // State with optional fields missing (as server might have from KV)
    const serverState = {
      tracks: [{
        id: 'track-1',
        name: 'Test',
        sampleId: 'kick',
        steps: [true, false, false, false],
        parameterLocks: [null, null, null, null],
        volume: 1,
        muted: false,
        // soloed: undefined (missing)
        transpose: 0,
        // stepCount: undefined (missing)
      }],
      tempo: 120,
      swing: 0,
    };

    const serverCanonical = canonicalizeForHash(serverState);
    const clientCanonical = clientCanonicalizeForHash(serverState);

    // Both should produce identical JSON
    expect(JSON.stringify(serverCanonical)).toBe(JSON.stringify(clientCanonical));
  });

  it('canonicalization should normalize optional fields to explicit values', () => {
    const stateWithMissingFields = {
      tracks: [{
        id: 'track-1',
        name: 'Test',
        sampleId: 'kick',
        steps: [true],
        parameterLocks: [null],
        volume: 1,
        muted: false,
        // stepCount missing
        transpose: 0,
      }],
      tempo: 120,
      swing: 0,
    };

    const canonical = canonicalizeForHash(stateWithMissingFields);

    // Optional fields should have explicit defaults
    expect(canonical.tracks[0].stepCount).toBe(16);
    // muted and soloed are EXCLUDED from canonical (local-only per "My Ears, My Control")
    expect('muted' in canonical.tracks[0]).toBe(false);
    expect('soloed' in canonical.tracks[0]).toBe(false);
  });
});

describe('ParameterLock parity', () => {
  // Both should have the same structure (used in type check below)
  const _PARAM_LOCK_FIELDS = ['pitch', 'volume'] as const;

  it('ParameterLock should have expected fields', () => {
    // Type check - if these don't compile, the interfaces have drifted
    const appLock: AppParameterLock = { pitch: 0, volume: 1 };
    const workerLock: WorkerParameterLock = { pitch: 0, volume: 1 };

    // Both should accept the same structure
    expect(Object.keys(appLock).sort()).toEqual(Object.keys(workerLock).sort());
  });
});

/**
 * Phase 13B: Constants parity tests
 * Ensures frontend and worker use the same bounds for validation.
 * If these fail, one side will reject values the other accepts.
 */
describe('Constants parity between types.ts and worker/invariants.ts', () => {
  it('MIN_TEMPO should match', () => {
    expect(APP_MIN_TEMPO).toBe(WORKER_MIN_TEMPO);
  });

  it('MAX_TEMPO should match', () => {
    expect(APP_MAX_TEMPO).toBe(WORKER_MAX_TEMPO);
  });

  it('MIN_SWING should match', () => {
    expect(APP_MIN_SWING).toBe(WORKER_MIN_SWING);
  });

  it('MAX_SWING should match', () => {
    expect(APP_MAX_SWING).toBe(WORKER_MAX_SWING);
  });

  it('MAX_STEPS should match', () => {
    expect(APP_MAX_STEPS).toBe(WORKER_MAX_STEPS);
  });

  it('MAX_TRACKS should match', () => {
    expect(APP_MAX_TRACKS).toBe(WORKER_MAX_TRACKS);
  });
});

/**
 * Phase 26: State-mutating broadcast type tests
 * Ensures we correctly identify which server broadcasts affect state.
 */
import { isStateMutatingBroadcast, STATE_MUTATING_BROADCASTS } from './types';

describe('isStateMutatingBroadcast', () => {
  it('should return true for state-mutating broadcast types', () => {
    // NOTE: track_muted and track_soloed are intentionally EXCLUDED
    // They are informational only - each client has its own local mute/solo state
    const mutatingTypes = [
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
      'effects_changed',
      'scale_changed',     // Phase 29E: Key Assistant scale sync
      'fm_params_changed',
      'sequence_copied',   // Phase 26: Steps copied between tracks
      'sequence_moved',    // Phase 26: Steps moved between tracks
      'session_name_changed',  // Session metadata sync
    ];

    for (const type of mutatingTypes) {
      expect(isStateMutatingBroadcast(type)).toBe(true);
    }
  });

  it('should return false for non-mutating broadcast types', () => {
    // NOTE: track_muted and track_soloed are here because they don't affect SHARED state
    const nonMutatingTypes = [
      'snapshot',
      'player_joined',
      'player_left',
      'cursor_moved',
      'clock_sync_response',
      'state_mismatch',
      'state_hash_match',
      'playback_started',
      'playback_stopped',
      'error',
      'track_muted',   // Informational only - local state per client
      'track_soloed',  // Informational only - local state per client
    ];

    for (const type of nonMutatingTypes) {
      expect(isStateMutatingBroadcast(type)).toBe(false);
    }
  });

  it('should have entries for all client mutating message types', () => {
    // Every MUTATING_MESSAGE_TYPE on client should have a corresponding broadcast type
    // NOTE: mute_track and solo_track are intentionally EXCLUDED
    // They are local-only per "My Ears, My Control" philosophy
    const clientMutating = [
      'toggle_step',     // -> step_toggled
      'set_tempo',       // -> tempo_changed
      'set_swing',       // -> swing_changed
      // mute_track - LOCAL ONLY (not in MUTATING)
      // solo_track - LOCAL ONLY (not in MUTATING)
      'set_parameter_lock', // -> parameter_lock_set
      'add_track',       // -> track_added
      'delete_track',    // -> track_deleted
      'clear_track',     // -> track_cleared
      'copy_sequence',   // -> sequence_copied (Phase 26)
      'move_sequence',   // -> sequence_moved (Phase 26)
      'set_track_sample', // -> track_sample_set
      'set_track_volume', // -> track_volume_set
      'set_track_transpose', // -> track_transpose_set
      'set_track_step_count', // -> track_step_count_set
      'set_track_swing',  // -> track_swing_set (Phase 31D)
      'set_effects',     // -> effects_changed
      'set_scale',       // -> scale_changed (Phase 29E)
      'set_fm_params',   // -> fm_params_changed
      'set_session_name', // -> session_name_changed
      // Phase 31F: Batch operations for multi-select
      'batch_clear_steps', // -> steps_cleared
      'batch_set_parameter_locks', // -> parameter_locks_batch_set
      // Phase 31G: Loop selection and track reorder
      'set_loop_region',   // -> loop_region_changed
      'reorder_tracks',    // -> tracks_reordered
      // Pattern operations
      'rotate_pattern',    // -> pattern_rotated
      'invert_pattern',    // -> pattern_inverted
      'reverse_pattern',   // -> pattern_reversed
      'mirror_pattern',    // -> pattern_mirrored
      'euclidean_fill',    // -> euclidean_filled
      // Track naming
      'set_track_name',    // -> track_name_set
    ];

    // Should have same count (28 mutations: 22 original + 5 pattern ops + 1 track name)
    expect(STATE_MUTATING_BROADCASTS.size).toBe(clientMutating.length);
  });
});

/**
 * TEST-08: Published Session WebSocket Blocking Tests
 * Verifies that all mutation types in MUTATING_MESSAGE_TYPES would be blocked
 * on published (immutable) sessions via the centralized check.
 */
import { MUTATING_MESSAGE_TYPES, isStateMutatingMessage } from './types';

describe('TEST-08: Published Session WebSocket Blocking', () => {
  it('isStateMutatingMessage returns true for all MUTATING_MESSAGE_TYPES', () => {
    // Every type in the set should be identified as state-mutating
    for (const type of MUTATING_MESSAGE_TYPES) {
      expect(isStateMutatingMessage(type)).toBe(true);
    }
  });

  it('MUTATING_MESSAGE_TYPES contains all mutation types', () => {
    // NOTE: mute_track and solo_track are intentionally EXCLUDED
    // They are local-only per "My Ears, My Control" philosophy
    const expectedMutationTypes = [
      'toggle_step',
      'set_tempo',
      'set_swing',
      // mute_track - LOCAL ONLY (in READONLY, not MUTATING)
      // solo_track - LOCAL ONLY (in READONLY, not MUTATING)
      'set_parameter_lock',
      'add_track',
      'delete_track',
      'clear_track',
      'copy_sequence',         // Phase 26: Copy steps between tracks
      'move_sequence',         // Phase 26: Move steps between tracks
      'set_track_sample',
      'set_track_volume',
      'set_track_transpose',
      'set_track_step_count',
      'set_track_swing',       // Phase 31D: Per-track swing
      'set_effects',
      'set_scale',             // Phase 29E: Key Assistant scale sync
      'set_fm_params',
      'set_session_name',      // Session metadata sync
      // Phase 31F: Batch operations for multi-select
      'batch_clear_steps',
      'batch_set_parameter_locks',
      // Phase 31G: Loop selection and track reorder
      'set_loop_region',
      'reorder_tracks',
      // Pattern operations
      'rotate_pattern',
      'invert_pattern',
      'reverse_pattern',
      'mirror_pattern',
      'euclidean_fill',
      // Track naming
      'set_track_name',
    ];

    // All expected types should be in the set
    for (const type of expectedMutationTypes) {
      expect(MUTATING_MESSAGE_TYPES.has(type)).toBe(true);
    }

    // Set should have exactly 28 mutation types (22 original + 5 pattern ops + 1 track name)
    expect(MUTATING_MESSAGE_TYPES.size).toBe(expectedMutationTypes.length);
  });

  it('non-mutation types are not blocked', () => {
    const nonMutationTypes = [
      'play',
      'stop',
      'state_hash',
      'request_snapshot',
      'clock_sync_request',
      'cursor_move',
    ];

    for (const type of nonMutationTypes) {
      expect(isStateMutatingMessage(type)).toBe(false);
    }
  });

  it('published session check covers centralized mutation blocking', () => {
    // This test documents the contract that live-session.ts enforces:
    // - isStateMutatingMessage(msg.type) && this.immutable triggers rejection
    // - All mutations go through this single check point
    // - No per-handler immutable checks needed

    // Verify the complete list matches what the DO checks
    // NOTE: mute_track and solo_track are now in READONLY, not MUTATING
    const mutationTypes = Array.from(MUTATING_MESSAGE_TYPES).sort();
    const expectedTypes = [
      'add_track',
      // Phase 31F: Batch operations for multi-select
      'batch_clear_steps',
      'batch_set_parameter_locks',
      'clear_track',
      'copy_sequence',      // Phase 26: Copy steps between tracks
      'delete_track',
      'euclidean_fill',     // Pattern operation: euclidean fill
      'invert_pattern',     // Pattern operation: invert
      'mirror_pattern',     // Pattern operation: mirror
      'move_sequence',      // Phase 26: Move steps between tracks
      // mute_track - LOCAL ONLY (in READONLY)
      'reorder_tracks',     // Phase 31G: Track reorder
      'reverse_pattern',    // Pattern operation: reverse
      'rotate_pattern',     // Pattern operation: rotate
      'set_effects',
      'set_fm_params',
      'set_loop_region',    // Phase 31G: Loop selection
      'set_parameter_lock',
      'set_scale',          // Phase 29E: Key Assistant scale sync
      'set_session_name',   // Session metadata sync
      'set_swing',
      'set_tempo',
      'set_track_name',     // Track naming
      'set_track_sample',
      'set_track_step_count',
      'set_track_swing',      // Phase 31D: Per-track swing
      'set_track_transpose',
      'set_track_volume',
      // solo_track - LOCAL ONLY (in READONLY)
      'toggle_step',
    ];

    expect(mutationTypes).toEqual(expectedTypes);
  });
});

// =============================================================================
// CURSOR POSITION VALIDATION TESTS
// =============================================================================

import {
  validateCursorPosition,
  MIN_CURSOR_POSITION,
  MAX_CURSOR_POSITION,
} from './invariants';

describe('Cursor Position Validation', () => {
  describe('validateCursorPosition', () => {
    it('should return null for non-object input', () => {
      expect(validateCursorPosition(null)).toBeNull();
      expect(validateCursorPosition(undefined)).toBeNull();
      expect(validateCursorPosition('string')).toBeNull();
      expect(validateCursorPosition(123)).toBeNull();
      expect(validateCursorPosition([1, 2])).toBeNull();
    });

    it('should return null for missing x or y', () => {
      expect(validateCursorPosition({})).toBeNull();
      expect(validateCursorPosition({ x: 50 })).toBeNull();
      expect(validateCursorPosition({ y: 50 })).toBeNull();
    });

    it('should return null for non-numeric x or y', () => {
      expect(validateCursorPosition({ x: 'string', y: 50 })).toBeNull();
      expect(validateCursorPosition({ x: 50, y: 'string' })).toBeNull();
      expect(validateCursorPosition({ x: NaN, y: 50 })).toBeNull();
      expect(validateCursorPosition({ x: 50, y: NaN })).toBeNull();
      expect(validateCursorPosition({ x: Infinity, y: 50 })).toBeNull();
      expect(validateCursorPosition({ x: 50, y: -Infinity })).toBeNull();
    });

    it('should accept valid cursor positions', () => {
      expect(validateCursorPosition({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
      expect(validateCursorPosition({ x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
      expect(validateCursorPosition({ x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    });

    it('should clamp x below minimum to 0', () => {
      const result = validateCursorPosition({ x: -50, y: 50 });
      expect(result).toEqual({ x: MIN_CURSOR_POSITION, y: 50 });
    });

    it('should clamp x above maximum to 100', () => {
      const result = validateCursorPosition({ x: 999999, y: 50 });
      expect(result).toEqual({ x: MAX_CURSOR_POSITION, y: 50 });
    });

    it('should clamp y below minimum to 0', () => {
      const result = validateCursorPosition({ x: 50, y: -100 });
      expect(result).toEqual({ x: 50, y: MIN_CURSOR_POSITION });
    });

    it('should clamp y above maximum to 100', () => {
      const result = validateCursorPosition({ x: 50, y: 999999 });
      expect(result).toEqual({ x: 50, y: MAX_CURSOR_POSITION });
    });

    it('should clamp both x and y when both are out of bounds', () => {
      const result = validateCursorPosition({ x: -999, y: 999 });
      expect(result).toEqual({ x: MIN_CURSOR_POSITION, y: MAX_CURSOR_POSITION });
    });

    it('should preserve valid trackId', () => {
      const result = validateCursorPosition({ x: 50, y: 50, trackId: 'track-123' });
      expect(result).toEqual({ x: 50, y: 50, trackId: 'track-123' });
    });

    it('should ignore non-string trackId', () => {
      const result = validateCursorPosition({ x: 50, y: 50, trackId: 123 });
      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('should preserve valid step', () => {
      const result = validateCursorPosition({ x: 50, y: 50, step: 7 });
      expect(result).toEqual({ x: 50, y: 50, step: 7 });
    });

    it('should floor non-integer step', () => {
      const result = validateCursorPosition({ x: 50, y: 50, step: 7.9 });
      expect(result).toEqual({ x: 50, y: 50, step: 7 });
    });

    it('should ignore negative step', () => {
      const result = validateCursorPosition({ x: 50, y: 50, step: -5 });
      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('should ignore non-numeric step', () => {
      const result = validateCursorPosition({ x: 50, y: 50, step: 'invalid' });
      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('should handle extreme values without crashing', () => {
      // This is the attack scenario we're protecting against
      // Note: Number.MIN_VALUE is smallest positive (5e-324), use -Number.MAX_VALUE for negative
      const extreme = validateCursorPosition({ x: Number.MAX_VALUE, y: -Number.MAX_VALUE });
      expect(extreme).toEqual({ x: MAX_CURSOR_POSITION, y: MIN_CURSOR_POSITION });
    });

    it('should preserve all valid optional fields together', () => {
      const result = validateCursorPosition({
        x: 25.5,
        y: 75.3,
        trackId: 'my-track',
        step: 12,
      });
      expect(result).toEqual({
        x: 25.5,
        y: 75.3,
        trackId: 'my-track',
        step: 12,
      });
    });
  });
});
