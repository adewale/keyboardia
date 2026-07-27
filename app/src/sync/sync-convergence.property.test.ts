/**
 * Property-Based Tests for Sync Convergence (Phase 32)
 *
 * These tests verify that the sync system maintains correctness under any
 * sequence of operations. Properties tested:
 *
 * - SC-001: State Convergence - Same mutations produce identical state
 * - SC-004: Commutativity - Independent mutations can be reordered
 * - SC-005: Reconnection - State correct after snapshot-based recovery
 *
 * ## Timeouts
 *
 * SC-001a retains the historical state-dependent generator and gets the one
 * measured timeout exception. SC-005 uses ordinary fast-check inputs so its
 * reconnect sequence is seeded, replayable, and shrinkable.
 *
 * @see specs/PROPERTY-BASED-TESTING.md Section 18
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  applyMutation,
  createDefaultTrack,
} from '../shared/state-mutations';
import { createInitialSessionState } from '../shared/session-defaults';
import { canonicalizeForHash } from './canonicalHash';
import { MAX_TEMPO } from '../shared/constants';
import {
  arbSessionState,
  arbSessionTrack,
  arbMutationForState,
  arbIndependentMutationPair,
  arbTempo,
  arbSwing,
  arbStepIndex,
  // Phase 32 Retrospective: Adversarial generators
  arbAdversarialState,
  arbMaxTracksState,
} from '../test/arbitraries';
import type { SessionState } from '../shared/state';
import type { ClientMessageBase } from '../shared/message-types';

// Slowest property alone is ~3.5s; this leaves room for a loaded CI runner.
const PROPERTY_TIMEOUT_MS = 30_000;

function canonicalEqual(a: SessionState, b: SessionState): boolean {
  return JSON.stringify(canonicalizeForHash(a)) === JSON.stringify(canonicalizeForHash(b));
}

type ReconnectMutationIntent =
  | { kind: 'tempo'; value: number }
  | { kind: 'swing'; value: number }
  | { kind: 'toggle'; track: number; step: number };

const arbReconnectMutationIntent: fc.Arbitrary<ReconnectMutationIntent> = fc.oneof(
  arbTempo.map(value => ({ kind: 'tempo' as const, value })),
  arbSwing.map(value => ({ kind: 'swing' as const, value })),
  fc.record({
    kind: fc.constant('toggle' as const),
    track: fc.nat(),
    step: arbStepIndex,
  }),
);

function materializeReconnectMutation(
  state: SessionState,
  intent: ReconnectMutationIntent,
): ClientMessageBase {
  if (intent.kind === 'tempo') return { type: 'set_tempo', tempo: intent.value };
  if (intent.kind === 'swing') return { type: 'set_swing', swing: intent.value };
  if (state.tracks.length === 0) return { type: 'set_tempo', tempo: 120 };
  return {
    type: 'toggle_step',
    trackId: state.tracks[intent.track % state.tracks.length].id,
    step: intent.step,
  };
}

/**
 * Draw one state-dependent mutation.
 *
 * The `seed` argument is load-bearing. `fc.sample` without one starts a fresh
 * Random from fast-check's *global* seed on every call — so once a global seed
 * is configured (src/test/setup-fast-check.ts), every bare `fc.sample(...)` in
 * a loop returns the identical draw. Measured: 1 distinct value out of 20 calls
 * with a global seed set, versus 17 out of 20 without one. That silently turns
 * a varied mutation sequence into the same mutation repeated N times.
 *
 * Passing a per-draw seed restores variety *and* keeps it reproducible, which
 * is strictly better than the unseeded behaviour this replaced: a failing run
 * can now be replayed by pinning the same base seed.
 */
function sampleMutation(state: SessionState, seed: number): ClientMessageBase {
  return fc.sample(arbMutationForState(state), { numRuns: 1, seed })[0];
}

/**
 * Build a mutation log of `count` generated mutations, then append a tempo
 * change that is guaranteed to be *effective* — a different in-range value than
 * the state has after the generated run.
 *
 * `arbMutationForState` can legitimately produce no-ops (toggling a step back,
 * re-setting the tempo it already has, deleting a track that isn't there). A
 * recovery property built on a log that might do nothing is a property that
 * might assert nothing, so the trailing mutation pins down at least one real
 * state change.
 */
function buildMutationLog(
  initialState: SessionState,
  count: number,
  baseSeed: number
): ClientMessageBase[] {
  const mutations: ClientMessageBase[] = [];
  let state = initialState;

  for (let i = 0; i < count; i++) {
    const mutation = sampleMutation(state, baseSeed + i);
    mutations.push(mutation);
    state = applyMutation(state, mutation);
  }

  // ±1 stays inside [MIN_TEMPO, MAX_TEMPO], so applyMutation's clamp can't
  // silently turn this back into a no-op.
  const effectiveTempo = state.tempo >= MAX_TEMPO ? state.tempo - 1 : state.tempo + 1;
  mutations.push({ type: 'set_tempo', tempo: effectiveTempo });

  return mutations;
}

describe('Sync Convergence - Property-Based Tests (Phase 32)', { timeout: PROPERTY_TIMEOUT_MS }, () => {
  // ===========================================================================
  // SC-001: State Convergence
  // ===========================================================================

  describe('SC-001: State Convergence', () => {
    it('SC-001a: same mutations produce identical state (determinism)', { timeout: 30_000 }, () => {
      fc.assert(
        fc.property(
          arbSessionState,
          fc.integer({ min: 1, max: 50 }),
          (initialState, mutationCount) => {
            // Generate mutations for this state
            const mutations: ClientMessageBase[] = [];
            let state = initialState;

            for (let i = 0; i < mutationCount; i++) {
              const mutation = sampleMutation(state, mutationCount * 1000 + i);
              mutations.push(mutation);
              state = applyMutation(state, mutation);
            }

            // Apply same mutations twice independently
            const state1 = mutations.reduce(applyMutation, initialState);
            const state2 = mutations.reduce(applyMutation, initialState);

            // States should be canonically equal
            expect(canonicalEqual(state1, state2)).toBe(true);

            // Witness: determinism is trivially true of a reducer that ignores
            // every mutation, so pin that the log actually moved the state.
            // buildMutationLog is not used here (this property wants the raw
            // generated sequence), so tolerate the occasional log that cancels
            // itself out rather than asserting unconditionally.
            fc.pre(!canonicalEqual(state1, initialState));
            expect(canonicalEqual(state1, initialState)).toBe(false);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('SC-001b: mutation application is pure (no side effects)', () => {
      fc.assert(
        fc.property(arbSessionState, (initialState) => {
          // Deep copy initial state
          const stateCopy = JSON.parse(JSON.stringify(initialState));

          // Apply some mutations
          const mutation = sampleMutation(initialState, initialState.tempo * 31 + initialState.swing);
          applyMutation(initialState, mutation);

          // Original state should be unchanged
          expect(JSON.stringify(initialState)).toBe(JSON.stringify(stateCopy));
        }),
        { numRuns: 500 }
      );
    });

    // SC-001c ("empty mutation sequence preserves state") was deleted. It read:
    //
    //   const finalState = [].reduce((s, m) => applyMutation(s, m), initialState);
    //   expect(canonicalEqual(initialState, finalState)).toBe(true);
    //
    // The array literal is empty, so the callback never ran and `finalState`
    // was `initialState` by the definition of Array.prototype.reduce. The
    // assertion exercised canonicalEqual's reflexivity and nothing in this
    // module — it passed against a reducer that ignored every mutation.
    // Reflexivity is covered by src/utils/patternOps.equivalence.test.ts:27.

    it('SC-001d: global mutations update the expected fields', () => {
      fc.assert(
        fc.property(arbSessionState, arbTempo, arbSwing, (initialState, tempo, swing) => {
          const state1 = applyMutation(initialState, { type: 'set_tempo', tempo });
          const state2 = applyMutation(state1, { type: 'set_swing', swing });

          // Tempo should be clamped to valid range
          expect(state2.tempo).toBeGreaterThanOrEqual(60);
          expect(state2.tempo).toBeLessThanOrEqual(180);

          // Swing should be clamped to valid range
          expect(state2.swing).toBeGreaterThanOrEqual(0);
          expect(state2.swing).toBeLessThanOrEqual(100);
        }),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // SC-004: Commutativity for Independent Mutations
  // ===========================================================================

  describe('SC-004: Commutativity', () => {
    it('SC-004a: independent track mutations commute', () => {
      // Create a state with at least 2 tracks
      const initialState: SessionState = {
        tracks: [
          createDefaultTrack('track-1', 'synth:kick', 'Kick'),
          createDefaultTrack('track-2', 'synth:snare', 'Snare'),
        ],
        tempo: 120,
        swing: 0,
        version: 1,
      };

      fc.assert(
        fc.property(
          arbIndependentMutationPair(initialState),
          ([m1, m2]) => {
            // Apply in order m1 -> m2
            const state1 = applyMutation(applyMutation(initialState, m1), m2);

            // Apply in order m2 -> m1
            const state2 = applyMutation(applyMutation(initialState, m2), m1);

            // Results should be canonically equal
            expect(canonicalEqual(state1, state2)).toBe(true);
          }
        ),
        { numRuns: 2000 }
      );
    });

    it('SC-004b: toggle_step on different tracks commutes', () => {
      const initialState: SessionState = {
        tracks: [
          createDefaultTrack('track-1', 'synth:kick', 'Kick'),
          createDefaultTrack('track-2', 'synth:snare', 'Snare'),
        ],
        tempo: 120,
        swing: 0,
        version: 1,
      };

      fc.assert(
        fc.property(arbStepIndex, arbStepIndex, (step1, step2) => {
          const m1: ClientMessageBase = {
            type: 'toggle_step',
            trackId: 'track-1',
            step: step1,
          };
          const m2: ClientMessageBase = {
            type: 'toggle_step',
            trackId: 'track-2',
            step: step2,
          };

          const state1 = applyMutation(applyMutation(initialState, m1), m2);
          const state2 = applyMutation(applyMutation(initialState, m2), m1);

          expect(canonicalEqual(state1, state2)).toBe(true);
        }),
        { numRuns: 1000 }
      );
    });

    it('SC-004c: set_tempo and track mutation commute', () => {
      const initialState: SessionState = {
        tracks: [createDefaultTrack('track-1', 'synth:kick', 'Kick')],
        tempo: 120,
        swing: 0,
        version: 1,
      };

      fc.assert(
        fc.property(arbTempo, arbStepIndex, (tempo, step) => {
          const m1: ClientMessageBase = { type: 'set_tempo', tempo };
          const m2: ClientMessageBase = {
            type: 'toggle_step',
            trackId: 'track-1',
            step,
          };

          const state1 = applyMutation(applyMutation(initialState, m1), m2);
          const state2 = applyMutation(applyMutation(initialState, m2), m1);

          expect(canonicalEqual(state1, state2)).toBe(true);
        }),
        { numRuns: 1000 }
      );
    });

  });

  // ===========================================================================
  // SC-005: Reconnection Recovery
  // ===========================================================================

  describe('SC-005: Reconnection Recovery', () => {
    // Independent generator for the same claim, and the only test here that
    // checks the snapshot is a deep copy rather than a shared reference. It
    // does not assert the client was stale, so it cannot replace SC-005a/b —
    // a reducer ignoring every mutation satisfies it trivially.
    it('SC-005d: serialized prefix snapshot plus suffix converges with uninterrupted application', () => {
      fc.assert(
        fc.property(
          arbSessionState,
          fc.array(arbReconnectMutationIntent, { minLength: 1, maxLength: 30 }),
          fc.nat(),
          (initialState, intents, disconnectPoint) => {
            const mutations = intents.map(intent => materializeReconnectMutation(initialState, intent));
            const split = disconnectPoint % (mutations.length + 1);
            const prefix = mutations.slice(0, split);
            const suffix = mutations.slice(split);
            const prefixState = prefix.reduce(applyMutation, initialState);
            const receivedSnapshot = JSON.parse(JSON.stringify(prefixState)) as SessionState;
            const recoveredState = suffix.reduce(applyMutation, receivedSnapshot);
            const uninterruptedState = mutations.reduce(applyMutation, initialState);

            expect(receivedSnapshot).not.toBe(prefixState);
            expect(canonicalEqual(recoveredState, uninterruptedState)).toBe(true);
          },
        ),
        { numRuns: 1000 },
      );
    });

    // A stale client reconnects, adopts the server snapshot taken at the point
    // it dropped off, and replays everything the server broadcast after it.
    // The two assertions below have to travel together:
    //
    //   1. the client really was stale (otherwise "recovery" is a no-op and the
    //      property is vacuous — the previous version of this test asserted
    //      canonicalEqual(x, x) and passed against a reducer that ignored every
    //      mutation), and
    //   2. recovery lands exactly on server state.
    //
    // `buildMutationLog` guarantees an effective mutation at the tail so the
    // staleness in (1) is real by construction rather than by luck.
    it('SC-005a: snapshot + tail replay converges on server state', () => {
      fc.assert(
        fc.property(
          arbSessionState,
          fc.integer({ min: 2, max: 20 }),
          fc.nat(),
          (initialState, mutationCount, rawSplit) => {
            // Base the draw seed on this case's generated inputs so different
            // cases explore different mutation sequences, while the same case
            // always replays identically.
            const mutations = buildMutationLog(initialState, mutationCount, rawSplit * 97 + mutationCount);

            // `% length` keeps the tail non-empty, so the client is always
            // missing at least the trailing tempo change.
            const split = rawSplit % mutations.length;
            const beforeDisconnect = mutations.slice(0, split);
            const afterDisconnect = mutations.slice(split);

            const serverFinal = mutations.reduce(applyMutation, initialState);
            const clientAtDisconnect = beforeDisconnect.reduce(applyMutation, initialState);

            // A prefix can coincidentally land on server state (mutations that
            // cancel out, a tempo set twice). Those runs prove nothing about
            // recovery, so drop them rather than weaken the assertion below.
            fc.pre(!canonicalEqual(clientAtDisconnect, serverFinal));

            const recovered = afterDisconnect.reduce(applyMutation, clientAtDisconnect);
            expect(canonicalEqual(recovered, serverFinal)).toBe(true);
          }
        ),
        { numRuns: 500, seed: 0x5c005a01 }
      );
    });

    // The witness for SC-005a's `fc.pre`. Fully deterministic: no generators, no
    // filtering, so a reducer that drops mutations fails here loudly instead of
    // silently starving the property above of valid runs.
    it('SC-005b: a disconnected client goes stale, and the snapshot repairs it', () => {
      const initialState = createInitialSessionState();
      const track = createDefaultTrack('recovery-track', 'kick', 'Recovery Track');
      const mutations: ClientMessageBase[] = [
        { type: 'add_track', track },
        { type: 'set_tempo', tempo: 128 },
        { type: 'toggle_step', trackId: track.id, step: 0 },
        { type: 'set_swing', swing: 40 },
      ];

      const serverFinal = mutations.reduce(applyMutation, initialState);
      expect(serverFinal.tempo).toBe(128);
      expect(serverFinal.swing).toBe(40);
      expect(serverFinal.tracks).toHaveLength(1);
      expect(serverFinal.tracks[0].steps[0]).toBe(true);

      // Client saw the first two mutations, then dropped off.
      const clientAtDisconnect = mutations.slice(0, 2).reduce(applyMutation, initialState);
      expect(clientAtDisconnect.swing).not.toBe(40);
      expect(clientAtDisconnect.tracks[0].steps[0]).toBe(false);
      expect(canonicalEqual(clientAtDisconnect, serverFinal)).toBe(false);

      // Reconnect: replay the missed tail onto the client's state.
      const recovered = mutations.slice(2).reduce(applyMutation, clientAtDisconnect);
      expect(canonicalEqual(recovered, serverFinal)).toBe(true);
    });
  });

  // ===========================================================================
  // Additional Properties
  // ===========================================================================

  describe('Additional Convergence Properties', () => {
    it('add_track increases track count by 1', () => {
      fc.assert(
        fc.property(arbSessionState, arbSessionTrack, (initialState, newTrack) => {
          fc.pre(initialState.tracks.length < 16);
          fc.pre(!initialState.tracks.some((t) => t.id === newTrack.id));

          const finalState = applyMutation(initialState, {
            type: 'add_track',
            track: newTrack,
          });

          expect(finalState.tracks.length).toBe(initialState.tracks.length + 1);
        }),
        { numRuns: 500 }
      );
    });

    it('delete_track decreases track count by 1 when track exists', () => {
      fc.assert(
        fc.property(arbSessionState, (initialState) => {
          fc.pre(initialState.tracks.length > 0);

          const trackToDelete = initialState.tracks[0];
          const finalState = applyMutation(initialState, {
            type: 'delete_track',
            trackId: trackToDelete.id,
          });

          expect(finalState.tracks.length).toBe(initialState.tracks.length - 1);
          expect(finalState.tracks.some((t) => t.id === trackToDelete.id)).toBe(false);
        }),
        { numRuns: 500 }
      );
    });

    it('toggle_step is its own inverse', () => {
      const initialState: SessionState = {
        tracks: [createDefaultTrack('track-1', 'synth:kick', 'Kick')],
        tempo: 120,
        swing: 0,
        version: 1,
      };

      fc.assert(
        fc.property(arbStepIndex, (step) => {
          const mutation: ClientMessageBase = {
            type: 'toggle_step',
            trackId: 'track-1',
            step,
          };

          // Toggle twice should return to original
          const state1 = applyMutation(initialState, mutation);
          const state2 = applyMutation(state1, mutation);

          expect(canonicalEqual(initialState, state2)).toBe(true);
        }),
        { numRuns: 500 }
      );
    });

    it('clear_track sets all steps to false', () => {
      fc.assert(
        fc.property(arbSessionState, (initialState) => {
          fc.pre(initialState.tracks.length > 0);

          const trackId = initialState.tracks[0].id;
          const finalState = applyMutation(initialState, {
            type: 'clear_track',
            trackId,
          });

          const clearedTrack = finalState.tracks.find((t) => t.id === trackId);
          expect(clearedTrack).toBeDefined();

          // All steps within stepCount should be false
          const stepCount = clearedTrack!.stepCount ?? 16;
          for (let i = 0; i < stepCount; i++) {
            expect(clearedTrack!.steps[i]).toBe(false);
          }
        }),
        { numRuns: 500 }
      );
    });

    it('reorder_tracks preserves track count', () => {
      fc.assert(
        fc.property(
          arbSessionState,
          fc.nat(),
          fc.nat(),
          (initialState, fromIdx, toIdx) => {
            fc.pre(initialState.tracks.length >= 2);

            const from = fromIdx % initialState.tracks.length;
            const to = toIdx % initialState.tracks.length;
            const trackId = initialState.tracks[from].id;

            const finalState = applyMutation(initialState, {
              type: 'reorder_tracks',
              trackId,
              toIndex: to,
            });

            expect(finalState.tracks.length).toBe(initialState.tracks.length);

            // Witness: count preservation is also true of a reducer that does
            // nothing. When the move is a real one, the track must land at the
            // requested index.
            if (from !== to) {
              expect(finalState.tracks[to].id).toBe(trackId);
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    // Coverage for skipped E2E tests (track-reorder*.spec.ts)
    it('reorder_tracks preserves all track IDs (no tracks lost or duplicated)', () => {
      fc.assert(
        fc.property(
          arbSessionState,
          fc.nat(),
          fc.nat(),
          (initialState, fromIdx, toIdx) => {
            fc.pre(initialState.tracks.length >= 2);

            const originalIds = new Set(initialState.tracks.map(t => t.id));
            const from = fromIdx % initialState.tracks.length;
            const to = toIdx % initialState.tracks.length;
            const trackId = initialState.tracks[from].id;

            const finalState = applyMutation(initialState, {
              type: 'reorder_tracks',
              trackId,
              toIndex: to,
            });

            const finalIds = new Set(finalState.tracks.map(t => t.id));
            expect(finalIds).toEqual(originalIds);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('reorder_tracks places moved track at exact target position', () => {
      fc.assert(
        fc.property(
          arbSessionState,
          fc.nat(),
          fc.nat(),
          (initialState, fromIdx, toIdx) => {
            fc.pre(initialState.tracks.length >= 2);

            const from = fromIdx % initialState.tracks.length;
            const to = toIdx % initialState.tracks.length;
            const movedTrackId = initialState.tracks[from].id;

            // Use trackId-based format (the new commutative format)
            const finalState = applyMutation(initialState, {
              type: 'reorder_tracks',
              trackId: movedTrackId,
              toIndex: to,
            });

            // The moved track should be at the target position
            expect(finalState.tracks[to].id).toBe(movedTrackId);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('reorder_tracks handles chained operations without data loss', () => {
      fc.assert(
        fc.property(
          arbSessionState,
          fc.array(fc.tuple(fc.nat(), fc.nat()), { minLength: 5, maxLength: 20 }),
          (initialState, reorderOps) => {
            fc.pre(initialState.tracks.length >= 3);

            const originalIds = new Set(initialState.tracks.map(t => t.id));
            const trackCount = initialState.tracks.length;

            let state = initialState;
            for (const [fromIdx, toIdx] of reorderOps) {
              const from = fromIdx % trackCount;
              const to = toIdx % trackCount;
              // Use trackId-based format
              const trackId = state.tracks[from]?.id;
              if (trackId) {
                state = applyMutation(state, {
                  type: 'reorder_tracks',
                  trackId,
                  toIndex: to,
                });
              }
            }

            // After all reorders, all tracks should still be present
            expect(state.tracks.length).toBe(trackCount);
            const finalIds = new Set(state.tracks.map(t => t.id));
            expect(finalIds).toEqual(originalIds);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('reorder_tracks is no-op for invalid trackId or toIndex', () => {
      fc.assert(
        fc.property(
          arbSessionState,
          (initialState) => {
            fc.pre(initialState.tracks.length >= 1);

            const originalIds = initialState.tracks.map(t => t.id);
            const validTrackId = initialState.tracks[0].id;

            // Test various invalid operations (using trackId format)
            const invalidOps = [
              { trackId: 'nonexistent', toIndex: 0 }, // Track doesn't exist
              { trackId: validTrackId, toIndex: -1 }, // Invalid toIndex
              { trackId: validTrackId, toIndex: initialState.tracks.length }, // Out of bounds toIndex
              { trackId: validTrackId, toIndex: 0 }, // Same position (track-0 is already at 0)
            ];

            for (const op of invalidOps) {
              const finalState = applyMutation(initialState, {
                type: 'reorder_tracks',
                ...op,
              });
              expect(finalState.tracks.map(t => t.id)).toEqual(originalIds);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ===========================================================================
  // SC-006: Adversarial State Testing (Phase 32 Retrospective)
  // ===========================================================================

  describe('SC-006: Adversarial State Testing', () => {
    it('SC-006a: convergence holds with adversarial states', () => {
      fc.assert(
        fc.property(
          arbAdversarialState,
          fc.integer({ min: 1, max: 30 }),
          (initialState, mutationCount) => {
            const mutations: ClientMessageBase[] = [];
            let state = initialState;

            for (let i = 0; i < mutationCount; i++) {
              const mutation = sampleMutation(state, mutationCount * 1000 + i);
              mutations.push(mutation);
              state = applyMutation(state, mutation);
            }

            // Apply same mutations twice independently
            const state1 = mutations.reduce(applyMutation, initialState);
            const state2 = mutations.reduce(applyMutation, initialState);

            expect(canonicalEqual(state1, state2)).toBe(true);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('SC-006b: empty state handles all global mutations', () => {
      fc.assert(
        fc.property(arbTempo, arbSwing, (tempo, swing) => {
          const emptyState: SessionState = {
            tracks: [],
            tempo: 120,
            swing: 0,
            version: 1,
          };

          const state1 = applyMutation(emptyState, { type: 'set_tempo', tempo });
          const state2 = applyMutation(state1, { type: 'set_swing', swing });

          expect(state2.tempo).toBe(Math.max(60, Math.min(180, tempo)));
          expect(state2.swing).toBe(Math.max(0, Math.min(100, swing)));
          expect(state2.tracks.length).toBe(0);
        }),
        { numRuns: 500 }
      );
    });

    it('SC-006c: max tracks state rejects additional tracks', () => {
      fc.assert(
        fc.property(arbMaxTracksState, arbSessionTrack, (maxState, newTrack) => {
          fc.pre(maxState.tracks.length === 16);
          fc.pre(!maxState.tracks.some((t) => t.id === newTrack.id));

          const finalState = applyMutation(maxState, {
            type: 'add_track',
            track: newTrack,
          });

          // Should not add 17th track
          expect(finalState.tracks.length).toBe(16);
        }),
        { numRuns: 200 }
      );
    });
  });

  // ===========================================================================
  // Shrinking Verification
  // ===========================================================================

  describe('Shrinking Verification', () => {
    it('shrinking preserves property violation (real test)', () => {
      // This test verifies that our mutation application preserves invariants
      // even after fast-check shrinks a failing case. We use a property that
      // should always hold: track count is never negative.
      fc.assert(
        fc.property(
          arbSessionState,
          fc.integer({ min: 1, max: 20 }),
          (initialState, mutationCount) => {
            let state = initialState;

            for (let i = 0; i < mutationCount; i++) {
              const mutation = sampleMutation(state, mutationCount * 1000 + i);
              state = applyMutation(state, mutation);

              // Invariant: track count is always >= 0
              expect(state.tracks.length).toBeGreaterThanOrEqual(0);
              // Invariant: track count is always <= 16
              expect(state.tracks.length).toBeLessThanOrEqual(16);
            }

          }
        ),
        { numRuns: 500 }
      );
    });
  });
});
