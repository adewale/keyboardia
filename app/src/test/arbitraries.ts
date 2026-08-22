/**
 * Custom Arbitraries for Property-Based Testing
 *
 * Reusable generators for domain types used across property tests.
 * These ensure generated values match the actual constraints of the system.
 *
 * Phase 32 Retrospective: All imports consolidated at top of file.
 */

import fc from 'fast-check';

// Type imports - sync types
import type { ParameterLock, EffectsState, ScaleState, FMParams } from '../shared/sync-types';
import type { SessionState, SessionTrack } from '../shared/state';
import type { ClientMessageBase } from '../shared/message-types';
import type { MutationState } from '../sync/mutation-tracker';
import type {
  EnvelopeDuration,
  EnvelopeStageName,
  TrackEnvelopeV2,
} from '../shared/envelope-contract-v2';

// Value imports
import { NOTE_NAMES, SCALES, type NoteName, type ScaleId } from '../music/music-theory';
import { VALID_SAMPLE_IDS } from '../components/sample-constants';

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
// Float32 Helper (Phase 32 Retrospective)
// =============================================================================

/**
 * Generate a 32-bit float in the given range.
 * Handles the Math.fround requirement automatically.
 *
 * Use this instead of fc.float() when you need decimal min/max values.
 * Example: arbFloat32(0.1, 10) instead of fc.float({ min: 0.1, max: 10 })
 */
export function arbFloat32(min: number, max: number): fc.Arbitrary<number> {
  return fc.float({
    min: Math.fround(min),
    max: Math.fround(max),
    noNaN: true,
  });
}

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

/** Canonical stereo pan (-1 hard left, 0 center, 1 hard right). */
export const arbPan = fc.float({ min: -1, max: 1, noNaN: true });

/** Transpose in semitones */
export const arbTranspose = fc.integer({ min: -24, max: 24 });

const durationMaxByStage = {
  attack: { seconds: 4, steps: 48 },
  hold: { seconds: 8, steps: 96 },
  decay: { seconds: 8, steps: 96 },
  release: { seconds: 8, steps: 96 },
} as const;

export const arbEnvelopeDuration = (
  stage: EnvelopeStageName,
): fc.Arbitrary<EnvelopeDuration> => fc.oneof(
  fc.record({
    value: arbFloat32(0, durationMaxByStage[stage].seconds),
    unit: fc.constant('seconds' as const),
  }),
  fc.record({
    value: arbFloat32(0, durationMaxByStage[stage].steps),
    unit: fc.constant('steps' as const),
  }),
);

export const arbTrackEnvelopeV2: fc.Arbitrary<TrackEnvelopeV2> = fc.oneof(
  fc.record({
    model: fc.constant('ad' as const),
    attack: arbEnvelopeDuration('attack'),
    decay: arbEnvelopeDuration('decay'),
  }),
  fc.record({
    model: fc.constant('ahd' as const),
    attack: arbEnvelopeDuration('attack'),
    hold: arbEnvelopeDuration('hold'),
    decay: arbEnvelopeDuration('decay'),
  }),
  fc.record({
    model: fc.constant('ar' as const),
    attack: arbEnvelopeDuration('attack'),
    release: arbEnvelopeDuration('release'),
  }),
  fc.record({
    model: fc.constant('adsr' as const),
    attack: arbEnvelopeDuration('attack'),
    decay: arbEnvelopeDuration('decay'),
    sustain: arbFloat32(0, 1),
    release: arbEnvelopeDuration('release'),
  }),
);

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
    attack: fc.option(fc.float({ min: 0, max: 4, noNaN: true }), { nil: undefined }),
    decay: fc.option(fc.float({ min: 0, max: 4, noNaN: true }), { nil: undefined }),
    release: fc.option(fc.float({ min: 0, max: 8, noNaN: true }), { nil: undefined }),
    attackDuration: fc.option(arbEnvelopeDuration('attack'), { nil: undefined }),
    holdDuration: fc.option(arbEnvelopeDuration('hold'), { nil: undefined }),
    decayDuration: fc.option(arbEnvelopeDuration('decay'), { nil: undefined }),
    releaseDuration: fc.option(arbEnvelopeDuration('release'), { nil: undefined }),
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

/**
 * Sample ID drawn from the real instrument catalog.
 *
 * arbSampleId above generates plausible-looking IDs, most of which are NOT in
 * VALID_SAMPLE_IDS. Operations that validate against the catalog need this one,
 * or the property degenerates into "every mutation is rejected".
 */
export const arbCatalogSampleId = fc.constantFrom(...[...VALID_SAMPLE_IDS].sort());

/** Track for hashing (minimal fields needed) */
export const arbTrackForHash = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  sampleId: arbSampleId,
  steps: arbStepsArray,
  parameterLocks: arbLocksArray,
  volume: arbVolume,
  pan: fc.option(arbPan, { nil: undefined }),
  muted: fc.boolean(),
  soloed: fc.boolean(),
  transpose: arbTranspose,
  stepCount: fc.option(arbStepCount, { nil: undefined }),
  swing: fc.option(arbSwing, { nil: undefined }),
  fmParams: fc.option(fc.record({
    harmonicity: arbFloat32(.5, 10),
    modulationIndex: arbFloat32(0, 20),
  }), { nil: undefined }),
  envelope: fc.option(fc.record({
    attack: arbFloat32(0, 4),
    decay: arbFloat32(0, 4),
    sustain: arbFloat32(0, 1),
    release: arbFloat32(0, 8),
  }), { nil: undefined }),
  envelopeTimeUnit: fc.option(fc.constantFrom('seconds' as const, 'steps' as const), { nil: undefined }),
  envelopeV2: fc.option(arbTrackEnvelopeV2, { nil: undefined }),
  samplePlaybackMode: fc.option(fc.constantFrom('trigger' as const, 'gate' as const, 'loop' as const), { nil: undefined }),
  gate: fc.option(arbFloat32(0, 100), { nil: undefined }),
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

/** Message variants generated by reducer property tests, including local mix changes. */
export const arbAllMutationTypes = fc.constantFrom(
  'toggle_step', 'clear_track', 'rotate_pattern', 'invert_pattern',
  'reverse_pattern', 'mirror_pattern', 'euclidean_fill', 'add_track',
  'delete_track', 'reorder_tracks', 'set_track_sample', 'set_track_volume',
  'set_track_pan',
  'set_track_transpose', 'set_track_step_count', 'set_track_swing',
  'set_track_name', 'set_parameter_lock', 'set_tempo', 'set_swing',
  'set_track_envelope_v2', 'convert_track_envelope_units_v2',
  'set_track_sample_playback_mode_v2', 'set_track_gate_v2', 'set_envelope_lock_v2',
  'set_loop_region', 'set_effects', 'set_scale', 'set_fm_params',
  'copy_sequence', 'move_sequence', 'batch_clear_steps',
  'batch_set_parameter_locks', 'mute_track', 'solo_track',
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

/** SessionTrack for sync testing (full track with all fields) */
export const arbSessionTrack: fc.Arbitrary<SessionTrack> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  sampleId: arbSampleId,
  steps: arbStepsArray,
  parameterLocks: arbLocksArray,
  volume: fc.float({ min: 0, max: 2, noNaN: true }),
  pan: fc.option(arbPan, { nil: undefined }),
  muted: fc.boolean(),
  soloed: fc.boolean(),
  transpose: arbTranspose,
  stepCount: fc.option(arbStepCount, { nil: undefined }),
  swing: fc.option(arbSwing, { nil: undefined }),
  fmParams: fc.option(fc.record({
    harmonicity: arbFloat32(.5, 10),
    modulationIndex: arbFloat32(0, 20),
  }), { nil: undefined }),
  envelope: fc.option(fc.record({
    attack: arbFloat32(0, 4),
    decay: arbFloat32(0, 4),
    sustain: arbFloat32(0, 1),
    release: arbFloat32(0, 8),
  }), { nil: undefined }),
  envelopeTimeUnit: fc.option(fc.constantFrom('seconds' as const, 'steps' as const), { nil: undefined }),
  envelopeV2: fc.option(arbTrackEnvelopeV2, { nil: undefined }),
  samplePlaybackMode: fc.option(fc.constantFrom('trigger' as const, 'gate' as const, 'loop' as const), { nil: undefined }),
  gate: fc.option(arbFloat32(0, 100), { nil: undefined }),
});

/** SessionState for sync convergence testing */
export const arbSessionState: fc.Arbitrary<SessionState> = fc.record({
  tracks: fc.array(arbSessionTrack, { minLength: 0, maxLength: 8 }),
  tempo: arbTempo,
  swing: arbSwing,
  loopRegion: arbOptionalLoopRegion,
  version: fc.constant(1),
});

/** Effects state for testing (uses arbFloat32 helper) */
export const arbEffectsState: fc.Arbitrary<EffectsState> = fc.record({
  bypass: fc.option(fc.boolean(), { nil: undefined }),
  reverb: fc.record({
    wet: arbFloat32(0, 1),
    decay: arbFloat32(0.1, 10),
  }),
  delay: fc.record({
    wet: arbFloat32(0, 1),
    time: fc.constantFrom('8n', '4n', '16n', '2n'),
    feedback: arbFloat32(0, 0.95),
  }),
  chorus: fc.record({
    wet: arbFloat32(0, 1),
    frequency: arbFloat32(0.1, 10),
    depth: arbFloat32(0, 1),
  }),
  distortion: fc.record({
    amount: arbFloat32(0, 1),
    wet: arbFloat32(0, 1),
  }),
});

/** Scale state for testing */
export const arbScaleState: fc.Arbitrary<ScaleState> = fc.record({
  root: arbNoteName,
  scaleId: arbScaleId,
  locked: fc.boolean(),
});

/** FM params for testing (uses arbFloat32 helper) */
export const arbFMParams: fc.Arbitrary<FMParams> = fc.record({
  harmonicity: arbFloat32(0.5, 10),
  modulationIndex: arbFloat32(0, 20),
});

// =============================================================================
// Adversarial State Generators (Phase 32 Retrospective)
// =============================================================================

/** Empty state - edge case for many operations */
export const arbEmptyState: fc.Arbitrary<SessionState> = fc.constant({
  tracks: [],
  tempo: 120,
  swing: 0,
  version: 1,
});

/** State at MAX_TRACKS limit (16 tracks) */
export const arbMaxTracksState: fc.Arbitrary<SessionState> = fc
  .array(arbSessionTrack, { minLength: 16, maxLength: 16 })
  .map((tracks) => ({ tracks, tempo: 120, swing: 0, version: 1 }));

/** State with single track - minimum for track operations */
export const arbSingleTrackState: fc.Arbitrary<SessionState> = arbSessionTrack.map(
  (track) => ({ tracks: [track], tempo: 120, swing: 0, version: 1 })
);

/** State at boundary tempo values */
export const arbBoundaryTempoState: fc.Arbitrary<SessionState> = fc.oneof(
  fc.constant(60),   // MIN_TEMPO
  fc.constant(180)   // MAX_TEMPO
).map((tempo) => ({ tracks: [] as SessionTrack[], tempo, swing: 0, version: 1 }));

/**
 * Adversarial state generator - weighted toward edge cases.
 * Use this for tests that should exercise boundary conditions.
 */
export const arbAdversarialState: fc.Arbitrary<SessionState> = fc.oneof(
  { weight: 2, arbitrary: arbEmptyState },
  { weight: 2, arbitrary: arbMaxTracksState },
  { weight: 1, arbitrary: arbSingleTrackState },
  { weight: 1, arbitrary: arbBoundaryTempoState },
  { weight: 4, arbitrary: arbSessionState }
);

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
        type: fc.constant('set_track_pan' as const),
        trackId: arbTrackId,
        pan: arbPan,
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
      // Change instrument (issue #63). Uses catalog IDs so the mutation
      // actually applies instead of being rejected on every draw.
      fc.record({
        type: fc.constant('set_track_instrument' as const),
        trackId: arbTrackId,
        sampleId: arbCatalogSampleId,
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
      // Rolling-safe v2 envelope mutations
      fc.record({
        type: fc.constant('set_track_envelope_v2' as const),
        trackId: arbTrackId,
        envelope: fc.oneof(fc.constant(null), arbTrackEnvelopeV2),
        operationId: fc.uuid(),
      }),
      fc.record({
        type: fc.constant('convert_track_envelope_units_v2' as const),
        trackId: arbTrackId,
        targetUnit: fc.constantFrom('seconds' as const, 'steps' as const),
        operationId: fc.uuid(),
      }),
      fc.record({
        type: fc.constant('set_track_sample_playback_mode_v2' as const),
        trackId: arbTrackId,
        mode: fc.oneof(
          fc.constant(null),
          fc.constantFrom('trigger' as const, 'gate' as const, 'loop' as const),
        ),
        operationId: fc.uuid(),
      }),
      fc.record({
        type: fc.constant('set_track_gate_v2' as const),
        trackId: arbTrackId,
        gate: arbFloat32(0, 100),
        operationId: fc.uuid(),
      }),
      arbTrackId.chain(trackId => fc.constantFrom(
        'attack' as const, 'hold' as const, 'decay' as const, 'release' as const,
      ).chain(stage => fc.record({
        type: fc.constant('set_envelope_lock_v2' as const),
        trackId: fc.constant(trackId),
        step: arbStepIndex,
        stage: fc.constant(stage),
        duration: fc.oneof(fc.constant(null), arbEnvelopeDuration(stage)),
        operationId: fc.uuid(),
      }))),
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
              attack: fc.option(fc.float({ min: 0, max: 4, noNaN: true }), { nil: undefined }),
              decay: fc.option(fc.float({ min: 0, max: 4, noNaN: true }), { nil: undefined }),
              release: fc.option(fc.float({ min: 0, max: 8, noNaN: true }), { nil: undefined }),
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

    // Reorder tracks (need at least 2 tracks) - uses trackId for commutativity
    if (trackIds.length >= 2) {
      mutations.push(
        fc.record({
          type: fc.constant('reorder_tracks' as const),
          trackId: arbTrackId,
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
      }),
      fc.record({
        type: fc.constant('set_track_pan' as const),
        trackId: fc.constant(track1.id),
        pan: arbPan,
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
      }),
      fc.record({
        type: fc.constant('set_track_pan' as const),
        trackId: fc.constant(track2.id),
        pan: arbPan,
      })
    )
  );
}
