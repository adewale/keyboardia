/**
 * Custom Arbitraries for Property-Based Testing
 *
 * Reusable generators for domain types used across property tests.
 * These ensure generated values match the actual constraints of the system.
 */

import fc from 'fast-check';
import type { ParameterLock } from '../shared/sync-types';
import { NOTE_NAMES, SCALES, type NoteName, type ScaleId } from '../music/music-theory';
import type { MutationState } from '../sync/mutation-tracker';

// =============================================================================
// Constants
// =============================================================================

export const MAX_STEPS = 128;
export const STEPS_PER_PAGE = 16;

/**
 * Valid step counts for polyrhythmic patterns
 * Must match VALID_STEP_COUNTS in shared/sync-types.ts
 */
export const VALID_STEP_COUNTS = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
  48, 64, 96, 128,
] as const;

// =============================================================================
// Primitive Arbitraries
// =============================================================================

/** Valid step count from the allowed set */
export const arbStepCount = fc.constantFrom(...VALID_STEP_COUNTS);

/** Step index (0-127) */
export const arbStepIndex = fc.integer({ min: 0, max: MAX_STEPS - 1 });

/** Note name (C, C#, D, etc.) */
export const arbNoteName = fc.constantFrom(...NOTE_NAMES) as fc.Arbitrary<NoteName>;

/** Scale ID (minor-pentatonic, major, etc.) */
export const arbScaleId = fc.constantFrom(...Object.keys(SCALES)) as fc.Arbitrary<ScaleId>;

/** Pitch in semitones (wide range including negatives for octave testing) */
export const arbPitch = fc.integer({ min: -60, max: 72 });

/** Pitch in the typical playable range */
export const arbPlayablePitch = fc.integer({ min: -24, max: 24 });

/** Tempo in BPM */
export const arbTempo = fc.integer({ min: 60, max: 180 });

/** Swing amount (0-100) */
export const arbSwing = fc.integer({ min: 0, max: 100 });

/** Volume (0-2, where 1 is default) */
export const arbVolume = fc.float({ min: 0, max: 2, noNaN: true });

/** Transpose in semitones */
export const arbTranspose = fc.integer({ min: -24, max: 24 });

// =============================================================================
// Pattern Arbitraries
// =============================================================================

/** Boolean step pattern of exactly MAX_STEPS length */
export const arbStepsArray = fc.array(fc.boolean(), {
  minLength: MAX_STEPS,
  maxLength: MAX_STEPS,
});

/** Boolean step pattern with variable length (for testing algorithms) */
export const arbVariableLengthPattern = (minLen = 1, maxLen = 128) =>
  fc.array(fc.boolean(), { minLength: minLen, maxLength: maxLen });

/** Parameter lock for a step */
export const arbParameterLock: fc.Arbitrary<ParameterLock | null> = fc.oneof(
  fc.constant(null),
  fc.record({
    pitch: fc.option(fc.integer({ min: -24, max: 24 }), { nil: undefined }),
    volume: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    tie: fc.option(fc.boolean(), { nil: undefined }),
  })
);

/** Array of parameter locks of exactly MAX_STEPS length */
export const arbLocksArray = fc.array(arbParameterLock, {
  minLength: MAX_STEPS,
  maxLength: MAX_STEPS,
});

// =============================================================================
// Track Arbitraries
// =============================================================================

/** Sample ID in various formats */
export const arbSampleId = fc.oneof(
  fc.constantFrom(
    'synth:kick',
    'synth:snare',
    'synth:hihat',
    'synth:clap',
    'sampled:piano',
    'sampled:strings',
    'tone:sine',
    'tone:square',
    'advanced:fm'
  )
);

/** Track for hashing (minimal fields needed) */
export const arbTrackForHash = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  sampleId: arbSampleId,
  steps: arbStepsArray,
  parameterLocks: arbLocksArray,
  volume: arbVolume,
  muted: fc.boolean(),
  soloed: fc.boolean(),
  transpose: arbTranspose,
  stepCount: fc.option(arbStepCount, { nil: undefined }),
  swing: fc.option(arbSwing, { nil: undefined }),
});

// =============================================================================
// Session State Arbitraries
// =============================================================================

/** Loop region (start and end step) */
export const arbLoopRegion = fc
  .tuple(fc.integer({ min: 0, max: 126 }), fc.integer({ min: 1, max: 127 }))
  .map(([a, b]) => (a < b ? { start: a, end: b } : { start: b, end: a }));

/** Optional loop region */
export const arbOptionalLoopRegion = fc.option(arbLoopRegion, { nil: null });

/** Session state for hashing */
export const arbSessionStateForHash = fc.record({
  tracks: fc.array(arbTrackForHash, { minLength: 0, maxLength: 16 }),
  tempo: arbTempo,
  swing: arbSwing,
  loopRegion: arbOptionalLoopRegion,
  version: fc.option(fc.nat(), { nil: undefined }),
});

// =============================================================================
// Mutation Tracker Arbitraries
// =============================================================================

export const arbMutationType = fc.constantFrom(
  'toggle_step',
  'add_track',
  'delete_track',
  'set_tempo',
  'set_volume'
);

export const arbMutationState: fc.Arbitrary<MutationState> = fc.constantFrom(
  'pending',
  'confirmed',
  'superseded',
  'lost'
);

export const arbTrackedMutationInput = fc.record({
  seq: fc.nat({ max: 100000 }),
  type: arbMutationType,
  trackId: fc.uuid(),
  step: fc.option(arbStepIndex, { nil: undefined }),
  intendedValue: fc.option(fc.boolean(), { nil: undefined }),
  sentAt: fc.integer({ min: 0, max: Date.now() + 1000000 }),
  sentAtServerTime: fc.integer({ min: 0, max: Date.now() + 1000000 }),
});

// =============================================================================
// Euclidean Rhythm Arbitraries
// =============================================================================

/** Euclidean rhythm parameters (steps, hits) where hits <= steps */
export const arbEuclideanParams = fc
  .tuple(fc.integer({ min: 1, max: 128 }), fc.integer({ min: 0, max: 128 }))
  .map(([steps, hits]) => ({ steps, hits: Math.min(hits, steps) }));

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a pattern with specific step count for testing
 */
export function createPatternWithStepCount(
  steps: boolean[],
  stepCount: number
): boolean[] {
  const result = new Array(MAX_STEPS).fill(false);
  for (let i = 0; i < Math.min(stepCount, steps.length); i++) {
    result[i] = steps[i];
  }
  return result;
}

/**
 * Create a track with tied notes starting at a specific step
 */
export function createTrackWithTies(
  startStep: number,
  tieLength: number,
  stepCount: number
): { steps: boolean[]; parameterLocks: (ParameterLock | null)[] } {
  const steps = new Array(MAX_STEPS).fill(false);
  const locks: (ParameterLock | null)[] = new Array(MAX_STEPS).fill(null);

  // Set the start step as active
  const wrappedStart = startStep % stepCount;
  steps[wrappedStart] = true;

  // Set tied steps
  for (let i = 1; i < tieLength; i++) {
    const tiedStep = (wrappedStart + i) % stepCount;
    steps[tiedStep] = true;
    locks[tiedStep] = { tie: true };
  }

  return { steps, parameterLocks: locks };
}
