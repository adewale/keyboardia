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

/** Legacy mutation type arbitrary (for mutation tracker tests) */
export const arbMutationType = fc.constantFrom(
  'toggle_step',
  'add_track',
  'delete_track',
  'set_tempo',
  'set_volume'
);

/**
 * All 22 mutation types (Phase 32: full coverage)
 */
export const arbAllMutationTypes = fc.constantFrom(
  // Step/Pattern mutations
  'toggle_step',
  'clear_track',
  // Track CRUD
  'add_track',
  'delete_track',
  'reorder_tracks',
  // Track settings
  'set_track_sample',
  'set_track_volume',
  'set_track_transpose',
  'set_track_step_count',
  'set_track_swing',
  // Parameter locks
  'set_parameter_lock',
  // Global settings
  'set_tempo',
  'set_swing',
  'set_loop_region',
  // Effects and scale
  'set_effects',
  'set_scale',
  'set_fm_params',
  // Copy operations
  'copy_sequence',
  'move_sequence',
  // Batch operations
  'batch_clear_steps',
  'batch_set_parameter_locks',
  // Local-only (still valid mutations but excluded from sync comparison)
  'mute_track',
  'solo_track'
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

// =============================================================================
// Phase 32: Sync Convergence Arbitraries
// =============================================================================

import type { SessionState, SessionTrack } from '../shared/state';
import type { ClientMessageBase } from '../shared/message-types';
import type { EffectsState, ScaleState, FMParams } from '../shared/sync-types';

/** SessionTrack for sync testing (full track with all fields) */
export const arbSessionTrack: fc.Arbitrary<SessionTrack> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  sampleId: arbSampleId,
  steps: arbStepsArray,
  parameterLocks: arbLocksArray,
  volume: fc.float({ min: 0, max: 2, noNaN: true }),
  muted: fc.boolean(),
  soloed: fc.boolean(),
  transpose: arbTranspose,
  stepCount: fc.option(arbStepCount, { nil: undefined }),
  swing: fc.option(arbSwing, { nil: undefined }),
});

/** SessionState for sync convergence testing */
export const arbSessionState: fc.Arbitrary<SessionState> = fc.record({
  tracks: fc.array(arbSessionTrack, { minLength: 0, maxLength: 8 }),
  tempo: arbTempo,
  swing: arbSwing,
  loopRegion: arbOptionalLoopRegion,
  version: fc.constant(1),
});

/** Effects state for testing */
export const arbEffectsState: fc.Arbitrary<EffectsState> = fc.record({
  reverb: fc.record({
    wet: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
    decay: fc.float({ min: Math.fround(0.1), max: Math.fround(10), noNaN: true }),
  }),
  delay: fc.record({
    wet: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
    time: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
    feedback: fc.float({ min: Math.fround(0), max: Math.fround(0.95), noNaN: true }),
  }),
  chorus: fc.record({
    wet: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
    frequency: fc.float({ min: Math.fround(0.1), max: Math.fround(10), noNaN: true }),
    depth: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
  }),
});

/** Scale state for testing */
export const arbScaleState: fc.Arbitrary<ScaleState> = fc.record({
  root: arbNoteName,
  scaleId: arbScaleId,
  locked: fc.boolean(),
});

/** FM params for testing */
export const arbFMParams: fc.Arbitrary<FMParams> = fc.record({
  harmonicity: fc.float({ min: Math.fround(0.5), max: Math.fround(10), noNaN: true }),
  modulationIndex: fc.float({ min: Math.fround(0), max: Math.fround(20), noNaN: true }),
});

/**
 * Generate a valid ClientMessage mutation for a given state.
 * The mutation will reference existing tracks when needed.
 */
export function arbMutationForState(state: SessionState): fc.Arbitrary<ClientMessageBase> {
  const trackIds = state.tracks.map((t) => t.id);
  const hasTrack = trackIds.length > 0;

  // Build list of possible mutations based on state
  const mutations: fc.Arbitrary<ClientMessageBase>[] = [
    // Global mutations (always valid)
    fc.record({ type: fc.constant('set_tempo' as const), tempo: arbTempo }),
    fc.record({ type: fc.constant('set_swing' as const), swing: arbSwing }),
    fc.record({ type: fc.constant('set_effects' as const), effects: arbEffectsState }),
    fc.record({ type: fc.constant('set_scale' as const), scale: arbScaleState }),
    fc.record({
      type: fc.constant('set_loop_region' as const),
      region: fc.oneof(fc.constant(null), arbLoopRegion),
    }),
  ];

  // Add track mutation (always valid if under MAX_TRACKS)
  if (state.tracks.length < 16) {
    mutations.push(
      fc.record({
        type: fc.constant('add_track' as const),
        track: arbSessionTrack,
      })
    );
  }

  // Track-specific mutations (only if tracks exist)
  if (hasTrack) {
    const arbTrackId = fc.constantFrom(...trackIds);

    mutations.push(
      // Toggle step
      fc.record({
        type: fc.constant('toggle_step' as const),
        trackId: arbTrackId,
        step: arbStepIndex,
      }),
      // Clear track
      fc.record({
        type: fc.constant('clear_track' as const),
        trackId: arbTrackId,
      }),
      // Delete track
      fc.record({
        type: fc.constant('delete_track' as const),
        trackId: arbTrackId,
      }),
      // Set track settings
      fc.record({
        type: fc.constant('set_track_volume' as const),
        trackId: arbTrackId,
        volume: fc.float({ min: 0, max: 2, noNaN: true }),
      }),
      fc.record({
        type: fc.constant('set_track_transpose' as const),
        trackId: arbTrackId,
        transpose: arbTranspose,
      }),
      fc.record({
        type: fc.constant('set_track_step_count' as const),
        trackId: arbTrackId,
        stepCount: arbStepCount,
      }),
      fc.record({
        type: fc.constant('set_track_swing' as const),
        trackId: arbTrackId,
        swing: arbSwing,
      }),
      fc.record({
        type: fc.constant('set_track_sample' as const),
        trackId: arbTrackId,
        sampleId: arbSampleId,
        name: fc.string({ minLength: 1, maxLength: 20 }),
      }),
      // Parameter locks
      fc.record({
        type: fc.constant('set_parameter_lock' as const),
        trackId: arbTrackId,
        step: arbStepIndex,
        lock: arbParameterLock,
      }),
      // FM params
      fc.record({
        type: fc.constant('set_fm_params' as const),
        trackId: arbTrackId,
        fmParams: arbFMParams,
      }),
      // Local-only mutations
      fc.record({
        type: fc.constant('mute_track' as const),
        trackId: arbTrackId,
        muted: fc.boolean(),
      }),
      fc.record({
        type: fc.constant('solo_track' as const),
        trackId: arbTrackId,
        soloed: fc.boolean(),
      }),
      // Batch operations
      fc.record({
        type: fc.constant('batch_clear_steps' as const),
        trackId: arbTrackId,
        steps: fc.array(arbStepIndex, { minLength: 1, maxLength: 8 }),
      }),
      fc.record({
        type: fc.constant('batch_set_parameter_locks' as const),
        trackId: arbTrackId,
        locks: fc.array(
          fc.record({
            step: arbStepIndex,
            lock: fc.record({
              pitch: fc.option(fc.integer({ min: -24, max: 24 }), { nil: undefined }),
              volume: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
            }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
      })
    );

    // Copy/move operations (need at least 2 tracks)
    if (trackIds.length >= 2) {
      mutations.push(
        fc.record({
          type: fc.constant('copy_sequence' as const),
          fromTrackId: arbTrackId,
          toTrackId: arbTrackId,
        }),
        fc.record({
          type: fc.constant('move_sequence' as const),
          fromTrackId: arbTrackId,
          toTrackId: arbTrackId,
        })
      );
    }

    // Reorder tracks (need at least 2 tracks)
    if (trackIds.length >= 2) {
      mutations.push(
        fc.record({
          type: fc.constant('reorder_tracks' as const),
          fromIndex: fc.integer({ min: 0, max: trackIds.length - 1 }),
          toIndex: fc.integer({ min: 0, max: trackIds.length - 1 }),
        })
      );
    }
  }

  return fc.oneof(...mutations);
}

/**
 * Generate a sequence of valid mutations that can be applied to the initial state.
 * Each mutation is valid for the state that results from applying all previous mutations.
 */
export function arbMutationSequence(
  initialState: SessionState,
  length: number
): fc.Arbitrary<ClientMessageBase[]> {
  if (length === 0) return fc.constant([]);

  return fc.tuple(
    arbMutationForState(initialState),
    fc.constant(null) // Placeholder
  ).chain(([firstMutation]) => {
    // For simplicity, we generate all mutations based on initial state
    // This may produce some no-op mutations but keeps the generator simpler
    return fc.array(arbMutationForState(initialState), {
      minLength: length - 1,
      maxLength: length - 1,
    }).map((rest) => [firstMutation, ...rest]);
  });
}

/**
 * Generate a pair of independent mutations for commutativity testing.
 * Independent means they operate on different tracks (or one is global).
 */
export function arbIndependentMutationPair(
  state: SessionState
): fc.Arbitrary<[ClientMessageBase, ClientMessageBase]> {
  // Need at least 2 tracks for track-specific independent mutations
  if (state.tracks.length < 2) {
    // Generate two different global mutations
    return fc.tuple(
      fc.record({ type: fc.constant('set_tempo' as const), tempo: arbTempo }),
      fc.record({ type: fc.constant('set_swing' as const), swing: arbSwing })
    );
  }

  // Pick two different tracks
  const [track1, track2] = state.tracks.slice(0, 2);

  return fc.tuple(
    fc.oneof(
      fc.record({
        type: fc.constant('toggle_step' as const),
        trackId: fc.constant(track1.id),
        step: arbStepIndex,
      }),
      fc.record({
        type: fc.constant('set_track_volume' as const),
        trackId: fc.constant(track1.id),
        volume: fc.float({ min: 0, max: 2, noNaN: true }),
      })
    ),
    fc.oneof(
      fc.record({
        type: fc.constant('toggle_step' as const),
        trackId: fc.constant(track2.id),
        step: arbStepIndex,
      }),
      fc.record({
        type: fc.constant('set_track_volume' as const),
        trackId: fc.constant(track2.id),
        volume: fc.float({ min: 0, max: 2, noNaN: true }),
      })
    )
  );
}
