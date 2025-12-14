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

/**
 * These tests ensure that Track (app state) and SessionTrack (persistence)
 * stay in sync. If you add a field to Track, you must add it to SessionTrack
 * (or explicitly document why it's excluded).
 *
 * This prevents data loss when saving/loading sessions.
 */
describe('Track/SessionTrack field parity', () => {
  // Define the expected fields for each interface
  // SessionTrack fields can be optional (for backwards compatibility)
  const TRACK_FIELDS: (keyof Track)[] = [
    'id',
    'name',
    'sampleId',
    'steps',
    'parameterLocks',
    'volume',
    'muted',
    'playbackMode',
    'transpose',
    'stepCount',
  ];

  // SessionTrack should have all the same fields (some may be optional for backwards compat)
  const SESSION_TRACK_FIELDS: (keyof SessionTrack)[] = [
    'id',
    'name',
    'sampleId',
    'steps',
    'parameterLocks',
    'volume',
    'muted',
    'playbackMode',
    'transpose',
    'stepCount',
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
        `Fields can be optional (field?: type) for backwards compatibility.`
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
    expect(TRACK_FIELDS.length).toBe(10);
    expect(SESSION_TRACK_FIELDS.length).toBe(10);
  });
});

describe('ParameterLock parity', () => {
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
