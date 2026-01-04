/**
 * Property-Based Tests for Validators and Invariants
 *
 * Tests VA-001 through VA-004 from the Property-Based Testing specification.
 * These cover value clamping, validation idempotence, array length invariants,
 * and parameter lock validation behavior.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  clamp,
  validateParameterLock,
  validateStateInvariants,
  repairStateInvariants,
  validateCursorPosition,
  isValidNumber,
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
  MIN_PLOCK_PITCH,
  MAX_PLOCK_PITCH,
  MIN_PLOCK_VOLUME,
  MAX_PLOCK_VOLUME,
  MIN_CURSOR_POSITION,
  MAX_CURSOR_POSITION,
} from './invariants';
import { validators } from './validators';
import type { SessionState, SessionTrack } from './types';
import { arbTempo, arbSwing, arbVolume, arbTranspose, arbStepIndex } from '../test/arbitraries';

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
});

/** Minimal valid track for state testing */
const arbMinimalTrack = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  sampleId: fc.constantFrom('kick', 'snare', 'hihat'),
  steps: fc.constant(new Array(MAX_STEPS).fill(false)),
  parameterLocks: fc.constant(new Array(MAX_STEPS).fill(null)),
  volume: fc.float({ min: Math.fround(MIN_VOLUME), max: Math.fround(MAX_VOLUME), noNaN: true }),
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

  it('VA-002e: setTempo validator is idempotent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (tempo) => {
        const msg = { tempo };
        const once = validators.setTempo(msg);

        if (once.valid && once.sanitized) {
          const twice = validators.setTempo(once.sanitized);
          expect(twice.valid).toBe(true);
          expect(twice.sanitized).toEqual(once.sanitized);
        }
      }),
      { numRuns: 200 }
    );
  });
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
// VA-004: Parameter Lock Partial Failure
// =============================================================================

describe('VA-004: Parameter Lock Partial Failure', () => {
  it('VA-004a: BUG DETECTION - invalid pitch causes entire lock rejection', () => {
    // This test documents the current behavior where one invalid field
    // causes the entire lock to be rejected

    const lockWithInvalidPitch = {
      pitch: NaN, // Invalid
      volume: 0.5, // Valid
    };

    const result = validateParameterLock(lockWithInvalidPitch);

    // Current behavior: entire lock is rejected
    // This is the BUG described in VA-004
    expect(result).toBe(null);

    // The valid volume field is lost
    // IDEALLY: result should have { volume: 0.5 } preserved
  });

  it('VA-004b: BUG DETECTION - invalid volume causes entire lock rejection', () => {
    const lockWithInvalidVolume = {
      pitch: 5, // Valid
      volume: NaN, // Invalid
    };

    const result = validateParameterLock(lockWithInvalidVolume);

    // Current behavior: entire lock is rejected
    expect(result).toBe(null);

    // The valid pitch field is lost
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
  it('isValidNumber correctly identifies valid numbers', () => {
    fc.assert(
      fc.property(
        fc.float({ noNaN: true }),
        fc.float({ noNaN: true }),
        fc.float({ noNaN: true }),
        (value, min, max) => {
          const realMin = Math.min(min, max);
          const realMax = Math.max(min, max);

          const result = isValidNumber(value, realMin, realMax);

          if (result) {
            expect(value).toBeGreaterThanOrEqual(realMin);
            expect(value).toBeLessThanOrEqual(realMax);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('isValidNumber rejects NaN and Infinity', () => {
    expect(isValidNumber(NaN, 0, 100)).toBe(false);
    expect(isValidNumber(Infinity, 0, 100)).toBe(false);
    expect(isValidNumber(-Infinity, 0, 100)).toBe(false);
  });

  it('isValidNumber rejects non-numbers', () => {
    expect(isValidNumber('string', 0, 100)).toBe(false);
    expect(isValidNumber(null, 0, 100)).toBe(false);
    expect(isValidNumber(undefined, 0, 100)).toBe(false);
    expect(isValidNumber({}, 0, 100)).toBe(false);
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
