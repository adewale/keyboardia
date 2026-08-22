/**
 * Property-Based Tests for Invariants
 *
 * Tests VA-001 through VA-004 from the Property-Based Testing specification:
 * value clamping, validation idempotence, array length invariants, and
 * parameter lock validation behaviour.
 *
 * Renamed from validators.property.test.ts (invariants.property.test.ts was
 * already taken by the EF/SN/LR debug-invariant properties). Despite the old name, 27 of its 28
 * tests exercised ./invariants — clamp, validateParameterLock,
 * validateStateInvariants, repairStateInvariants, validateCursorPosition — all
 * of which are live code reached from live-session.ts. Only one test touched
 * src/worker/validators.ts, which was deleted as unreachable, so that one test
 * went with it and the rest stayed.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  clamp,
  validateParameterLock,
  validateStateInvariants,
  repairStateInvariants,
  validateCursorPosition,
  isValidIntegerInRange,
  isValidNumberInRange,
  MAX_STEPS,
  MAX_TRACKS,
  MIN_TEMPO,
  MAX_TEMPO,
  MIN_SWING,
  MAX_SWING,
  MIN_VOLUME,
  MAX_VOLUME,
  MIN_TRANSPOSE,
  MAX_TRANSPOSE,
} from './invariants';
import {
  MIN_PLOCK_PITCH,
  MAX_PLOCK_PITCH,
  MIN_PLOCK_VOLUME,
  MAX_PLOCK_VOLUME,
  MIN_CURSOR_POSITION,
  MAX_CURSOR_POSITION,
  MIN_PAN,
  MAX_PAN,
} from '../shared/constants';
import { validateSessionState } from './validation';
import { SCALES } from '../music/music-theory';
import type { SessionState, SessionTrack } from './types';
import {
  arbTempo as _arbTempo,
  arbSwing as _arbSwing,
  arbVolume as _arbVolume,
  arbTranspose as _arbTranspose,
  arbStepIndex as _arbStepIndex,
} from '../test/arbitraries';

// =============================================================================
// Helper Arbitraries
// =============================================================================

/** Parameter lock pitch (extended range to test clamping) */
const arbPlockPitch = fc.integer({ min: -50, max: 50 });

/** Parameter lock volume (extended range to test clamping) */
const arbPlockVolume = fc.float({
  min: Math.fround(-0.5),
  max: Math.fround(1.5),
  noNaN: true,
});

/** Valid parameter lock */
const arbValidParameterLock = fc.record({
  pitch: fc.option(fc.integer({ min: MIN_PLOCK_PITCH, max: MAX_PLOCK_PITCH }), {
    nil: undefined,
  }),
  volume: fc.option(
    fc.float({
      min: Math.fround(MIN_PLOCK_VOLUME),
      max: Math.fround(MAX_PLOCK_VOLUME),
      noNaN: true,
    }),
    { nil: undefined }
  ),
  tie: fc.option(fc.boolean(), { nil: undefined }),
  attack: fc.option(fc.float({ min: 0, max: 4, noNaN: true }), { nil: undefined }),
  decay: fc.option(fc.float({ min: 0, max: 4, noNaN: true }), { nil: undefined }),
  release: fc.option(fc.float({ min: 0, max: 8, noNaN: true }), { nil: undefined }),
});

/** Minimal valid track for state testing */
const arbMinimalTrack = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  sampleId: fc.constantFrom('kick', 'snare', 'hihat'),
  steps: fc.constant(new Array(MAX_STEPS).fill(false)),
  parameterLocks: fc.constant(new Array(MAX_STEPS).fill(null)),
  volume: fc.float({ min: Math.fround(MIN_VOLUME), max: Math.fround(MAX_VOLUME), noNaN: true }),
  pan: fc.float({ min: Math.fround(MIN_PAN), max: Math.fround(MAX_PAN), noNaN: true }),
  muted: fc.boolean(),
  soloed: fc.boolean(),
  transpose: fc.integer({ min: MIN_TRANSPOSE, max: MAX_TRANSPOSE }),
  stepCount: fc.constantFrom(8, 16, 32, 64),
});

/** Minimal valid session state */
const arbMinimalSessionState = fc.record({
  tracks: fc.array(arbMinimalTrack, { minLength: 0, maxLength: MAX_TRACKS }),
  tempo: fc.integer({ min: MIN_TEMPO, max: MAX_TEMPO }),
  swing: fc.integer({ min: MIN_SWING, max: MAX_SWING }),
  loopRegion: fc.constant(null),
  effects: fc.constant({
    bypass: false,
    reverb: { decay: 2, wet: 0.3 },
    delay: { time: '8n', feedback: 0.3, wet: 0.2 },
    chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
    distortion: { amount: 0.2, wet: 0.1 },
  }),
}) as fc.Arbitrary<SessionState>;

// =============================================================================
// VA-001: Clamp Within Bounds
// =============================================================================

describe('VA-001: Clamp Within Bounds', () => {
  it('VA-001a: clamp always returns value within [min, max]', () => {
    fc.assert(
      fc.property(
        fc.float({ noNaN: true }),
        fc.float({ noNaN: true }),
        fc.float({ noNaN: true }),
        (value, bound1, bound2) => {
          const min = Math.min(bound1, bound2);
          const max = Math.max(bound1, bound2);
          fc.pre(min <= max); // Ensure valid range

          const result = clamp(value, min, max);
          expect(result).toBeGreaterThanOrEqual(min);
          expect(result).toBeLessThanOrEqual(max);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('VA-001b: clamp preserves values already within bounds', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-100), max: Math.fround(100), noNaN: true }),
        fc.float({ min: Math.fround(-200), max: Math.fround(-100), noNaN: true }),
        fc.float({ min: Math.fround(100), max: Math.fround(200), noNaN: true }),
        (value, minBound, maxBound) => {
          const result = clamp(value, minBound, maxBound);
          if (value >= minBound && value <= maxBound) {
            expect(result).toBe(value);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('VA-001c: tempo clamping uses correct bounds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (tempo) => {
        const clamped = clamp(tempo, MIN_TEMPO, MAX_TEMPO);
        expect(clamped).toBeGreaterThanOrEqual(MIN_TEMPO);
        expect(clamped).toBeLessThanOrEqual(MAX_TEMPO);
      }),
      { numRuns: 200 }
    );
  });

  it('VA-001d: swing clamping uses correct bounds', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 200 }), (swing) => {
        const clamped = clamp(swing, MIN_SWING, MAX_SWING);
        expect(clamped).toBeGreaterThanOrEqual(MIN_SWING);
        expect(clamped).toBeLessThanOrEqual(MAX_SWING);
      }),
      { numRuns: 200 }
    );
  });

  it('VA-001e: volume clamping uses correct bounds', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-1), max: Math.fround(3), noNaN: true }),
        (volume) => {
          const clamped = clamp(volume, MIN_VOLUME, MAX_VOLUME);
          expect(clamped).toBeGreaterThanOrEqual(MIN_VOLUME);
          expect(clamped).toBeLessThanOrEqual(MAX_VOLUME);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('VA-001f: parameter lock pitch clamping uses correct bounds', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (pitch) => {
        const clamped = clamp(pitch, MIN_PLOCK_PITCH, MAX_PLOCK_PITCH);
        expect(clamped).toBeGreaterThanOrEqual(MIN_PLOCK_PITCH);
        expect(clamped).toBeLessThanOrEqual(MAX_PLOCK_PITCH);
      }),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// VA-002: Validation Idempotence
// =============================================================================

describe('VA-002: Validation Idempotence', () => {
  it('VA-002a: validateParameterLock is idempotent', () => {
    fc.assert(
      fc.property(arbValidParameterLock, (lock) => {
        const once = validateParameterLock(lock);
        const twice = validateParameterLock(once);

        // If first validation returned null, second should too
        if (once === null) {
          expect(twice).toBe(null);
        } else {
          // Otherwise, results should be equal
          expect(twice).toEqual(once);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('VA-002b: validateParameterLock with out-of-range values is idempotent', () => {
    fc.assert(
      fc.property(arbPlockPitch, arbPlockVolume, fc.boolean(), (pitch, volume, tie) => {
        const lock = { pitch, volume, tie };
        const once = validateParameterLock(lock);
        const twice = validateParameterLock(once);

        if (once === null) {
          expect(twice).toBe(null);
        } else {
          expect(twice).toEqual(once);
          // After first validation, values should be within bounds
          if (once.pitch !== undefined) {
            expect(once.pitch).toBeGreaterThanOrEqual(MIN_PLOCK_PITCH);
            expect(once.pitch).toBeLessThanOrEqual(MAX_PLOCK_PITCH);
          }
          if (once.volume !== undefined) {
            expect(once.volume).toBeGreaterThanOrEqual(MIN_PLOCK_VOLUME);
            expect(once.volume).toBeLessThanOrEqual(MAX_PLOCK_VOLUME);
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it('VA-002c: validateCursorPosition is idempotent', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-50), max: Math.fround(150), noNaN: true }),
        fc.float({ min: Math.fround(-50), max: Math.fround(150), noNaN: true }),
        (x, y) => {
          const position = { x, y };
          const once = validateCursorPosition(position);
          const twice = validateCursorPosition(once);

          if (once === null) {
            expect(twice).toBe(null);
          } else {
            expect(twice).toEqual(once);
            // After first validation, values should be within bounds
            expect(once.x).toBeGreaterThanOrEqual(MIN_CURSOR_POSITION);
            expect(once.x).toBeLessThanOrEqual(MAX_CURSOR_POSITION);
            expect(once.y).toBeGreaterThanOrEqual(MIN_CURSOR_POSITION);
            expect(once.y).toBeLessThanOrEqual(MAX_CURSOR_POSITION);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('VA-002d: repairStateInvariants is idempotent', () => {
    fc.assert(
      fc.property(arbMinimalSessionState, (state) => {
        const { repairedState: once } = repairStateInvariants(state);
        const { repairedState: twice, repairs } = repairStateInvariants(once);

        // After first repair, second repair should make no changes
        expect(repairs.length).toBe(0);
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 }
    );
  });

  // VA-002e ("setTempo validator is idempotent") was deleted with
  // src/worker/validators.ts — see the note at the top of this file. Clamp
  // idempotence itself is still covered above against `clamp` directly, which
  // is the function the live handlers actually use.
});

// =============================================================================
// VA-003: Array Length Invariant
// =============================================================================

describe('VA-003: Array Length Invariant', () => {
  it('VA-003a: valid tracks have steps array of exactly MAX_STEPS length', () => {
    fc.assert(
      fc.property(arbMinimalSessionState, (state) => {
        const result = validateStateInvariants(state);

        // If valid, all tracks should have correct array lengths
        if (result.valid) {
          for (const track of state.tracks) {
            expect(track.steps.length).toBe(MAX_STEPS);
            expect(track.parameterLocks.length).toBe(MAX_STEPS);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it('VA-003b: repairStateInvariants fixes incorrect array lengths', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 200 }),
        (id, steps) => {
          // Create state with potentially wrong array length
          const track = {
            id,
            name: 'Test',
            sampleId: 'kick',
            steps,
            parameterLocks: new Array(steps.length).fill(null),
            volume: 0.8,
            muted: false,
            soloed: false,
            transpose: 0,
            stepCount: 16,
          } as SessionTrack;

          const state = {
            tracks: [track],
            tempo: 120,
            swing: 0,
            loopRegion: null,
            effects: {
              bypass: false,
              reverb: { decay: 2, wet: 0.3 },
              delay: { time: '8n', feedback: 0.3, wet: 0.2 },
              chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
              distortion: { amount: 0.2, wet: 0.1 },
            },
          } as SessionState;

          const { repairedState } = repairStateInvariants(state);

          // After repair, arrays should be correct length
          expect(repairedState.tracks[0].steps.length).toBe(MAX_STEPS);
          expect(repairedState.tracks[0].parameterLocks.length).toBe(MAX_STEPS);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('VA-003c: array length violations are detected', () => {
    const wrongLengthTrack = {
      id: 'test-track',
      name: 'Test',
      sampleId: 'kick',
      steps: new Array(64).fill(false), // Wrong length
      parameterLocks: new Array(64).fill(null), // Wrong length
      volume: 0.8,
      muted: false,
      soloed: false,
      transpose: 0,
      stepCount: 16,
    } as SessionTrack;

    const state = {
      tracks: [wrongLengthTrack],
      tempo: 120,
      swing: 0,
      loopRegion: null,
      effects: {
        bypass: false,
        reverb: { decay: 2, wet: 0.3 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
        distortion: { amount: 0.2, wet: 0.1 },
      },
    } as SessionState;

    const result = validateStateInvariants(state);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('steps length'))).toBe(true);
  });

  it('VA-003d: track count respects MAX_TRACKS', () => {
    fc.assert(
      fc.property(fc.integer({ min: MAX_TRACKS + 1, max: MAX_TRACKS + 10 }), (trackCount) => {
        const tracks = Array.from({ length: trackCount }, (_, i) => ({
          id: `track-${i}`,
          name: `Track ${i}`,
          sampleId: 'kick',
          steps: new Array(MAX_STEPS).fill(false),
          parameterLocks: new Array(MAX_STEPS).fill(null),
          volume: 0.8,
          muted: false,
          soloed: false,
          transpose: 0,
          stepCount: 16,
        })) as SessionTrack[];

        const state = {
          tracks,
          tempo: 120,
          swing: 0,
          loopRegion: null,
          effects: {
            bypass: false,
            reverb: { decay: 2, wet: 0.3 },
            delay: { time: '8n', feedback: 0.3, wet: 0.2 },
            chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
            distortion: { amount: 0.2, wet: 0.1 },
          },
        } as SessionState;

        const result = validateStateInvariants(state);
        expect(result.valid).toBe(false);
        expect(result.violations.some((v) => v.includes('Track count'))).toBe(true);
      }),
      { numRuns: 20 }
    );
  });
});

// =============================================================================
// VA-004: Parameter Lock Partial Preservation (FIXED)
// =============================================================================

describe('VA-004: Parameter Lock Partial Preservation', () => {
  it('VA-004a: invalid pitch preserves valid volume (FIX VERIFIED)', () => {
    // Previously, invalid pitch caused entire lock rejection
    // Now, invalid pitch is dropped but valid volume is preserved

    const lockWithInvalidPitch = {
      pitch: NaN, // Invalid - will be dropped
      volume: 0.5, // Valid - will be preserved
    };

    const result = validateParameterLock(lockWithInvalidPitch);

    // FIX: Valid volume is preserved, invalid pitch is dropped
    expect(result).not.toBe(null);
    expect(result?.volume).toBe(0.5);
    expect(result?.pitch).toBeUndefined();
  });

  it('VA-004b: invalid volume preserves valid pitch (FIX VERIFIED)', () => {
    const lockWithInvalidVolume = {
      pitch: 5, // Valid - will be preserved
      volume: NaN, // Invalid - will be dropped
    };

    const result = validateParameterLock(lockWithInvalidVolume);

    // FIX: Valid pitch is preserved, invalid volume is dropped
    expect(result).not.toBe(null);
    expect(result?.pitch).toBe(5);
    expect(result?.volume).toBeUndefined();
  });

  it('VA-004c: all-valid locks are preserved', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_PLOCK_PITCH, max: MAX_PLOCK_PITCH }),
        fc.float({
          min: Math.fround(MIN_PLOCK_VOLUME),
          max: Math.fround(MAX_PLOCK_VOLUME),
          noNaN: true,
        }),
        fc.boolean(),
        (pitch, volume, tie) => {
          const lock = { pitch, volume, tie };
          const result = validateParameterLock(lock);

          expect(result).not.toBe(null);
          expect(result?.pitch).toBe(pitch);
          expect(result?.tie).toBe(tie);
          // Volume might be slightly different due to clamping
          if (result?.volume !== undefined) {
            expect(result.volume).toBeGreaterThanOrEqual(MIN_PLOCK_VOLUME);
            expect(result.volume).toBeLessThanOrEqual(MAX_PLOCK_VOLUME);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('VA-004d: out-of-range values are clamped, not rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.float({ min: Math.fround(-1), max: Math.fround(2), noNaN: true }),
        (pitch, volume) => {
          const lock = { pitch, volume };
          const result = validateParameterLock(lock);

          // Should not be null - values are clamped, not rejected
          expect(result).not.toBe(null);

          if (result) {
            // Pitch should be clamped
            expect(result.pitch).toBeGreaterThanOrEqual(MIN_PLOCK_PITCH);
            expect(result.pitch).toBeLessThanOrEqual(MAX_PLOCK_PITCH);

            // Volume should be clamped
            expect(result.volume).toBeGreaterThanOrEqual(MIN_PLOCK_VOLUME);
            expect(result.volume).toBeLessThanOrEqual(MAX_PLOCK_VOLUME);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('VA-004e: null and undefined inputs return null', () => {
    expect(validateParameterLock(null)).toBe(null);
    expect(validateParameterLock(undefined)).toBe(null);
  });

  it('VA-004f: empty object returns null', () => {
    expect(validateParameterLock({})).toBe(null);
  });

  it('VA-004g: arrays are rejected', () => {
    expect(validateParameterLock([1, 2, 3])).toBe(null);
    expect(validateParameterLock([])).toBe(null);
  });

  it('VA-004h: non-object types are rejected', () => {
    expect(validateParameterLock('string')).toBe(null);
    expect(validateParameterLock(123)).toBe(null);
    expect(validateParameterLock(true)).toBe(null);
  });
});

// =============================================================================
// Additional Validation Properties
// =============================================================================

describe('Additional Validation Properties', () => {
  it('isValidNumberInRange correctly identifies valid numbers', () => {
    fc.assert(
      fc.property(
        fc.float({ noNaN: true }),
        fc.float({ noNaN: true }),
        fc.float({ noNaN: true }),
        (value, min, max) => {
          const realMin = Math.min(min, max);
          const realMax = Math.max(min, max);

          const result = isValidNumberInRange(value, realMin, realMax);

          if (result) {
            expect(value).toBeGreaterThanOrEqual(realMin);
            expect(value).toBeLessThanOrEqual(realMax);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('isValidNumberInRange rejects NaN and Infinity', () => {
    expect(isValidNumberInRange(NaN, 0, 100)).toBe(false);
    expect(isValidNumberInRange(Infinity, 0, 100)).toBe(false);
    expect(isValidNumberInRange(-Infinity, 0, 100)).toBe(false);
  });

  it('isValidNumberInRange rejects non-numbers', () => {
    expect(isValidNumberInRange('string', 0, 100)).toBe(false);
    expect(isValidNumberInRange(null, 0, 100)).toBe(false);
    expect(isValidNumberInRange(undefined, 0, 100)).toBe(false);
    expect(isValidNumberInRange({}, 0, 100)).toBe(false);
  });

  it('isValidIntegerInRange accepts only discrete bounded indices', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_STEPS - 1 }), value => {
        expect(isValidIntegerInRange(value, 0, MAX_STEPS - 1)).toBe(true);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_STEPS - 2 }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        (whole, fraction) => {
          expect(isValidIntegerInRange(whole + fraction, 0, MAX_STEPS - 1)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('duplicate track IDs are detected', () => {
    const tracks = [
      {
        id: 'same-id',
        name: 'Track 1',
        sampleId: 'kick',
        steps: new Array(MAX_STEPS).fill(false),
        parameterLocks: new Array(MAX_STEPS).fill(null),
        volume: 0.8,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'same-id', // Duplicate!
        name: 'Track 2',
        sampleId: 'snare',
        steps: new Array(MAX_STEPS).fill(false),
        parameterLocks: new Array(MAX_STEPS).fill(null),
        volume: 0.8,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
    ] as SessionTrack[];

    const state = {
      tracks,
      tempo: 120,
      swing: 0,
      loopRegion: null,
      effects: {
        bypass: false,
        reverb: { decay: 2, wet: 0.3 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
        distortion: { amount: 0.2, wet: 0.1 },
      },
    } as SessionState;

    const result = validateStateInvariants(state);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('Duplicate track ID'))).toBe(true);
  });

  it('repairStateInvariants removes duplicate tracks', () => {
    const tracks = [
      {
        id: 'dup-id',
        name: 'First',
        sampleId: 'kick',
        steps: new Array(MAX_STEPS).fill(false),
        parameterLocks: new Array(MAX_STEPS).fill(null),
        volume: 0.8,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'dup-id', // Duplicate
        name: 'Second',
        sampleId: 'snare',
        steps: new Array(MAX_STEPS).fill(false),
        parameterLocks: new Array(MAX_STEPS).fill(null),
        volume: 0.5,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
    ] as SessionTrack[];

    const state = {
      tracks,
      tempo: 120,
      swing: 0,
      loopRegion: null,
      effects: {
        bypass: false,
        reverb: { decay: 2, wet: 0.3 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
        distortion: { amount: 0.2, wet: 0.1 },
      },
    } as SessionState;

    const { repairedState, repairs } = repairStateInvariants(state);

    expect(repairedState.tracks.length).toBe(1);
    expect(repairedState.tracks[0].name).toBe('First'); // First one kept
    expect(repairs.some((r) => r.includes('Removed duplicate'))).toBe(true);
  });
});

// =============================================================================
// VA-005: Untrusted persisted metadata must match its model
// =============================================================================

describe('VA-005: persisted metadata boundary validation', () => {
  const validateMetadata = (metadata: Record<string, unknown>) => validateSessionState({
    tracks: [], tempo: 120, swing: 0, version: 1, ...metadata,
  });

  it('accepts exactly the scale registry own keys, never prototype-chain names', () => {
    const inheritedNames = fc.constantFrom('toString', 'constructor', '__proto__');

    fc.assert(
      fc.property(fc.oneof(fc.string(), inheritedNames), (scaleId) => {
        const result = validateMetadata({
          scale: { root: 'C', scaleId, locked: false },
        });

        expect(result.valid).toBe(Object.hasOwn(SCALES, scaleId));
      }),
      { numRuns: 300 },
    );
  });

  it('agrees with the loop-region boundary model for arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (loopRegion) => {
        const result = validateMetadata({ loopRegion });
        const isRecord = loopRegion !== null &&
          typeof loopRegion === 'object' &&
          !Array.isArray(loopRegion);
        const value = isRecord ? loopRegion as Record<string, unknown> : null;
        const start = value?.start;
        const end = value?.end;
        const expected = loopRegion === null || (
          typeof start === 'number' && Number.isFinite(start) && start >= 0 && start < MAX_STEPS &&
          typeof end === 'number' && Number.isFinite(end) && end >= 0 && end < MAX_STEPS &&
          start <= end
        );

        expect(result.valid).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });
});

// =============================================================================
// VA-005: Non-finite values (the NaN-blind comparison family)
//
// `v < MIN || v > MAX` is FALSE for NaN, so a bounds check written with
// comparison operators reports a non-finite value as *valid* — and a repair
// written the same way leaves it in place. Both were true here, in the module
// that exists to be the storage boundary's last line of defence, while
// isValidNumberInRange sat correctly implemented a hundred lines above.
//
// These tests use NaN and ±Infinity rather than out-of-range numbers, because
// out-of-range numbers were always handled. The whole failure was that the one
// class of bad value the comparisons could not see is the one that reaches
// state when an upstream clamp() is fed a string.
// =============================================================================

describe('VA-005: non-finite values are detected and repaired', () => {
  const NON_FINITE = [NaN, Infinity, -Infinity];

  const stateWith = (overrides: Partial<SessionState>): SessionState => ({
    tracks: [],
    tempo: 120,
    swing: 0,
    version: 1,
    ...overrides,
  }) as SessionState;

  const trackWith = (overrides: Record<string, unknown>) => ({
    id: 't1',
    name: 'Track',
    sampleId: 'kick',
    steps: Array(MAX_STEPS).fill(false),
    parameterLocks: Array(MAX_STEPS).fill(null),
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    ...overrides,
  }) as unknown as SessionTrack;

  it.each(NON_FINITE)('reports a tempo of %p as a violation', (tempo) => {
    const result = validateStateInvariants(stateWith({ tempo }));
    expect(result.valid, `tempo ${tempo} was accepted as valid`).toBe(false);
    expect(result.violations.join(' ')).toMatch(/[Tt]empo/);
  });

  it.each(NON_FINITE)('repairs a tempo of %p to a finite value', (tempo) => {
    const { repairedState, repairs } = repairStateInvariants(stateWith({ tempo }));
    expect(Number.isFinite(repairedState.tempo), `tempo stayed ${repairedState.tempo}`).toBe(true);
    expect(repairedState.tempo).toBeGreaterThanOrEqual(MIN_TEMPO);
    expect(repairedState.tempo).toBeLessThanOrEqual(MAX_TEMPO);
    expect(repairs.length, 'a repair happened but was not reported').toBeGreaterThan(0);
    // The repaired state must satisfy the checker — otherwise the two halves of
    // this module disagree and callers cannot trust either.
    expect(validateStateInvariants(repairedState).valid).toBe(true);
  });

  it.each(NON_FINITE)('reports a swing of %p as a violation and repairs it', (swing) => {
    expect(validateStateInvariants(stateWith({ swing })).valid).toBe(false);
    const { repairedState } = repairStateInvariants(stateWith({ swing }));
    expect(Number.isFinite(repairedState.swing)).toBe(true);
    expect(validateStateInvariants(repairedState).valid).toBe(true);
  });

  it.each(NON_FINITE)('reports a track volume of %p as a violation and repairs it', (volume) => {
    const state = stateWith({ tracks: [trackWith({ volume })] });
    expect(validateStateInvariants(state).valid, `volume ${volume} accepted`).toBe(false);

    const { repairedState } = repairStateInvariants(state);
    expect(Number.isFinite(repairedState.tracks[0].volume)).toBe(true);
    expect(validateStateInvariants(repairedState).valid).toBe(true);
  });

  it.each(NON_FINITE)('reports a track pan of %p as a violation and repairs it to center', (pan) => {
    const state = stateWith({ tracks: [trackWith({ pan })] });
    expect(validateStateInvariants(state).valid, `pan ${pan} accepted`).toBe(false);

    const { repairedState } = repairStateInvariants(state);
    expect(repairedState.tracks[0].pan).toBe(0);
    expect(validateStateInvariants(repairedState).valid).toBe(true);
  });

  it.each([MIN_PAN - 0.25, MAX_PAN + 0.25])(
    'clamps corrupted stored pan %p while public mutations remain strict',
    (pan) => {
      const state = stateWith({ tracks: [trackWith({ pan })] });
      const { repairedState } = repairStateInvariants(state);
      expect(repairedState.tracks[0].pan).toBe(pan < MIN_PAN ? MIN_PAN : MAX_PAN);
      expect(validateStateInvariants(repairedState).valid).toBe(true);
    },
  );

  it.each(NON_FINITE)('reports a stepCount of %p as a violation and repairs it', (stepCount) => {
    const state = stateWith({ tracks: [trackWith({ stepCount })] });
    expect(validateStateInvariants(state).valid, `stepCount ${stepCount} accepted`).toBe(false);

    const { repairedState } = repairStateInvariants(state);
    const repaired = repairedState.tracks[0].stepCount;
    expect(Number.isFinite(repaired), `stepCount stayed ${repaired}`).toBe(true);
    expect(repaired).toBeGreaterThanOrEqual(1);
    expect(repaired).toBeLessThanOrEqual(MAX_STEPS);
    expect(validateStateInvariants(repairedState).valid).toBe(true);
  });

  // The case the comparisons actually missed on the repair path. NaN never
  // reaches those comparisons — repairStateInvariants clones through JSON
  // first, which turns NaN into null, and `null < MIN` coerces to `0 < 60` and
  // repairs. A *missing* key is what survived: JSON.stringify drops it, and
  // `undefined < 60` and `undefined > 180` are both false.
  it.each(['tempo', 'swing'] as const)('repairs a state with no %s at all', (field) => {
    const state = stateWith({});
    delete (state as unknown as Record<string, unknown>)[field];

    const { repairedState, repairs } = repairStateInvariants(state);
    expect(
      Number.isFinite(repairedState[field]),
      `${field} came out of the repair as ${repairedState[field]}`
    ).toBe(true);
    expect(repairs.length).toBeGreaterThan(0);
    expect(validateStateInvariants(repairedState).valid).toBe(true);
  });

  it('repairs a track with no volume at all', () => {
    const track = trackWith({});
    delete (track as unknown as Record<string, unknown>).volume;
    const { repairedState } = repairStateInvariants(stateWith({ tracks: [track] }));

    expect(Number.isFinite(repairedState.tracks[0].volume)).toBe(true);
    expect(validateStateInvariants(repairedState).valid).toBe(true);
  });

  it('repairs a legacy track with no pan to center', () => {
    const track = trackWith({});
    delete (track as unknown as Record<string, unknown>).pan;
    const { repairedState } = repairStateInvariants(stateWith({ tracks: [track] }));

    expect(repairedState.tracks[0].pan).toBe(0);
    expect(validateStateInvariants(repairedState).valid).toBe(true);
  });

  it('still accepts a fully valid state (the fix is not just "reject everything")', () => {
    const state = stateWith({ tempo: 120, swing: 25, tracks: [trackWith({})] });
    const result = validateStateInvariants(state);
    expect(result.violations).toEqual([]);
    expect(result.valid).toBe(true);
    expect(repairStateInvariants(state).repairs).toEqual([]);
  });

  it('still reports plain out-of-range values, which always worked', () => {
    // Regression guard for the fix itself: replacing the comparisons with
    // isValidNumberInRange must not lose the case they did handle.
    expect(validateStateInvariants(stateWith({ tempo: MAX_TEMPO + 1 })).valid).toBe(false);
    expect(validateStateInvariants(stateWith({ tempo: MIN_TEMPO - 1 })).valid).toBe(false);
    expect(validateStateInvariants(stateWith({ swing: 101 })).valid).toBe(false);
  });
});
