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
    'playbackMode',
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
    'playbackMode',
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
    expect(TRACK_FIELDS.length).toBe(11);  // Updated from 10 to 11 (added soloed)
    expect(SESSION_TRACK_FIELDS.length).toBe(11);
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
        playbackMode: 'oneshot' as const,
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
        // soloed and stepCount missing
        playbackMode: 'oneshot' as const,
        transpose: 0,
      }],
      tempo: 120,
      swing: 0,
    };

    const canonical = canonicalizeForHash(stateWithMissingFields);

    // Optional fields should have explicit defaults
    expect(canonical.tracks[0].soloed).toBe(false);
    expect(canonical.tracks[0].stepCount).toBe(16);
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
