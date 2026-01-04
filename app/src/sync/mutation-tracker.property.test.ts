/**
 * Property-Based Tests for Mutation Tracker
 *
 * Tests state machine invariants, transition validity, and stats consistency
 * for the mutation tracking system used in multiplayer synchronization.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { MutationTracker, type MutationState } from './mutation-tracker';
import { arbTrackedMutationInput } from '../test/arbitraries';

describe('mutation-tracker - Property-Based Tests', () => {
  // ===========================================================================
  // State Invariants
  // ===========================================================================

  describe('state invariants', () => {
    it('SY-003: mutations are in exactly one state', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackedMutationInput, { minLength: 1, maxLength: 50 }),
          fc.array(fc.nat({ max: 50 }), { minLength: 0, maxLength: 25 }),
          (mutations, confirmSeqs) => {
            const tracker = new MutationTracker({ enableLogging: false });

            // Track mutations with unique seqs
            const uniqueMutations = mutations.filter(
              (m, i, arr) => arr.findIndex((x) => x.seq === m.seq) === i
            );
            uniqueMutations.forEach((m) => tracker.trackMutation(m));

            // Confirm some
            confirmSeqs.forEach((seq) => tracker.confirmMutation(seq));

            // Check each mutation is in exactly one state
            const allMutations = tracker.getAllMutations();
            for (const mutation of allMutations) {
              const states: MutationState[] = ['pending', 'confirmed', 'superseded', 'lost'];
              const matchingStates = states.filter((s) => mutation.state === s);
              expect(matchingStates.length).toBe(1);
            }
          }
        ),
        { numRuns: 300 }
      );
    });

    it('new mutations start in pending state', () => {
      fc.assert(
        fc.property(arbTrackedMutationInput, (mutationInput) => {
          const tracker = new MutationTracker({ enableLogging: false });

          tracker.trackMutation(mutationInput);
          const mutation = tracker.getMutation(mutationInput.seq);

          expect(mutation?.state).toBe('pending');
        }),
        { numRuns: 500 }
      );
    });

    it('tracked mutation contains all input fields', () => {
      fc.assert(
        fc.property(arbTrackedMutationInput, (input) => {
          const tracker = new MutationTracker({ enableLogging: false });

          tracker.trackMutation(input);
          const mutation = tracker.getMutation(input.seq);

          expect(mutation?.seq).toBe(input.seq);
          expect(mutation?.type).toBe(input.type);
          expect(mutation?.trackId).toBe(input.trackId);
          expect(mutation?.step).toBe(input.step);
          expect(mutation?.sentAt).toBe(input.sentAt);
        }),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // State Transitions
  // ===========================================================================

  describe('state transitions', () => {
    it('confirmMutation transitions pending to confirmed', () => {
      fc.assert(
        fc.property(arbTrackedMutationInput, fc.nat(), (input, serverSeq) => {
          const tracker = new MutationTracker({ enableLogging: false });

          tracker.trackMutation(input);
          const result = tracker.confirmMutation(input.seq, serverSeq);

          expect(result).toBe(true);
          expect(tracker.getMutation(input.seq)?.state).toBe('confirmed');
          expect(tracker.getMutation(input.seq)?.confirmedAtServerSeq).toBe(serverSeq);
        }),
        { numRuns: 500 }
      );
    });

    it('confirmMutation fails for non-existent seq', () => {
      fc.assert(
        fc.property(arbTrackedMutationInput, fc.nat({ max: 1000000 }), (input, otherSeq) => {
          fc.pre(input.seq !== otherSeq);

          const tracker = new MutationTracker({ enableLogging: false });

          tracker.trackMutation(input);
          const result = tracker.confirmMutation(otherSeq);

          expect(result).toBe(false);
        }),
        { numRuns: 300 }
      );
    });

    it('confirmMutation fails for already confirmed mutation', () => {
      fc.assert(
        fc.property(arbTrackedMutationInput, (input) => {
          const tracker = new MutationTracker({ enableLogging: false });

          tracker.trackMutation(input);
          tracker.confirmMutation(input.seq);

          // Second confirmation should fail
          const result = tracker.confirmMutation(input.seq);
          expect(result).toBe(false);
        }),
        { numRuns: 300 }
      );
    });

    it('markSuperseded transitions pending to superseded and removes from map', () => {
      fc.assert(
        fc.property(arbTrackedMutationInput, (input) => {
          const tracker = new MutationTracker({ enableLogging: false });

          tracker.trackMutation(input);
          const result = tracker.markSuperseded(input.seq, 'other-player');

          expect(result).toBe(true);
          expect(tracker.getMutation(input.seq)).toBeUndefined();
          expect(tracker.getStats().superseded).toBe(1);
        }),
        { numRuns: 300 }
      );
    });

    it('markLost transitions pending to lost and removes from map', () => {
      fc.assert(
        fc.property(arbTrackedMutationInput, (input) => {
          const tracker = new MutationTracker({ enableLogging: false });

          tracker.trackMutation(input);
          const result = tracker.markLost(input.seq);

          expect(result).toBe(true);
          expect(tracker.getMutation(input.seq)).toBeUndefined();
          expect(tracker.getStats().lost).toBe(1);
        }),
        { numRuns: 300 }
      );
    });
  });

  // ===========================================================================
  // Stats Consistency
  // ===========================================================================

  describe('stats consistency', () => {
    it('SY-004: stats match actual mutation counts', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackedMutationInput, { minLength: 0, maxLength: 30 }),
          fc.array(fc.nat({ max: 30 }), { minLength: 0, maxLength: 15 }),
          fc.array(fc.nat({ max: 30 }), { minLength: 0, maxLength: 5 }),
          fc.array(fc.nat({ max: 30 }), { minLength: 0, maxLength: 5 }),
          (mutations, confirmSeqs, supersededSeqs, lostSeqs) => {
            const tracker = new MutationTracker({ enableLogging: false });

            // Use unique seqs
            const uniqueMutations = mutations.filter(
              (m, i, arr) => arr.findIndex((x) => x.seq === m.seq) === i
            );
            uniqueMutations.forEach((m) => tracker.trackMutation(m));

            // Apply operations
            confirmSeqs.forEach((seq) => tracker.confirmMutation(seq));
            supersededSeqs.forEach((seq) => tracker.markSuperseded(seq));
            lostSeqs.forEach((seq) => tracker.markLost(seq));

            // Verify stats
            const stats = tracker.getStats();
            const actualPending = tracker.getPendingCount();
            const actualConfirmed = tracker.getConfirmedCount();

            expect(stats.pending).toBe(actualPending);
            expect(stats.confirmed).toBe(actualConfirmed);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('pending count decreases on confirm/supersede/lost', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackedMutationInput, { minLength: 3, maxLength: 10 }),
          (mutations) => {
            const tracker = new MutationTracker({ enableLogging: false });

            // Use unique seqs
            const uniqueMutations = mutations
              .filter((m, i, arr) => arr.findIndex((x) => x.seq === m.seq) === i)
              .slice(0, 3);

            if (uniqueMutations.length < 3) return;

            uniqueMutations.forEach((m) => tracker.trackMutation(m));
            const initialPending = tracker.getStats().pending;

            tracker.confirmMutation(uniqueMutations[0].seq);
            expect(tracker.getStats().pending).toBe(initialPending - 1);

            tracker.markSuperseded(uniqueMutations[1].seq);
            expect(tracker.getStats().pending).toBe(initialPending - 2);

            tracker.markLost(uniqueMutations[2].seq);
            expect(tracker.getStats().pending).toBe(initialPending - 3);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ===========================================================================
  // SY-005: Sequence Monotonicity
  // ===========================================================================

  describe('sequence monotonicity', () => {
    it('SY-005: serverSeq values are monotonically increasing for ordered confirmations', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackedMutationInput, { minLength: 5, maxLength: 20 }),
          fc
            .array(fc.nat({ max: 1000 }), { minLength: 5, maxLength: 20 })
            .map((arr) => [...arr].sort((a, b) => a - b)), // Sorted ascending
          (mutations, serverSeqs) => {
            const tracker = new MutationTracker({ enableLogging: false });

            // Use unique mutations
            const uniqueMutations = mutations
              .filter((m, i, arr) => arr.findIndex((x) => x.seq === m.seq) === i)
              .slice(0, serverSeqs.length);

            uniqueMutations.forEach((m) => tracker.trackMutation(m));

            // Confirm in order with increasing serverSeq
            const confirmedServerSeqs: number[] = [];
            uniqueMutations.forEach((m, i) => {
              if (i < serverSeqs.length) {
                tracker.confirmMutation(m.seq, serverSeqs[i]);
                const mutation = tracker.getMutation(m.seq);
                if (mutation?.confirmedAtServerSeq !== undefined) {
                  confirmedServerSeqs.push(mutation.confirmedAtServerSeq);
                }
              }
            });

            // Verify monotonicity: each serverSeq >= previous
            for (let i = 1; i < confirmedServerSeqs.length; i++) {
              expect(confirmedServerSeqs[i]).toBeGreaterThanOrEqual(
                confirmedServerSeqs[i - 1]
              );
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('SY-005b: confirmedAtServerSeq is set on confirmation', () => {
      fc.assert(
        fc.property(arbTrackedMutationInput, fc.nat({ max: 10000 }), (input, serverSeq) => {
          const tracker = new MutationTracker({ enableLogging: false });

          tracker.trackMutation(input);

          // Before confirmation, no serverSeq
          const before = tracker.getMutation(input.seq);
          expect(before?.confirmedAtServerSeq).toBeUndefined();

          // After confirmation, serverSeq is set
          tracker.confirmMutation(input.seq, serverSeq);
          const after = tracker.getMutation(input.seq);
          expect(after?.confirmedAtServerSeq).toBe(serverSeq);
        }),
        { numRuns: 300 }
      );
    });

    it('SY-005c: clearOnSnapshot respects sequence ordering', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackedMutationInput, { minLength: 10, maxLength: 30 }),
          fc.nat({ max: 50 }),
          (mutations, snapshotSeq) => {
            const tracker = new MutationTracker({ enableLogging: false });

            const uniqueMutations = mutations.filter(
              (m, i, arr) => arr.findIndex((x) => x.seq === m.seq) === i
            );

            uniqueMutations.forEach((m) => tracker.trackMutation(m));

            // Confirm with various serverSeqs
            uniqueMutations.forEach((m, i) => {
              tracker.confirmMutation(m.seq, i); // serverSeq = index
            });

            // Clear with snapshotSeq
            tracker.clearOnSnapshot(snapshotSeq);

            // All remaining confirmed mutations should have serverSeq > snapshotSeq
            const remaining = tracker.getAllMutations().filter((m) => m.state === 'confirmed');
            for (const m of remaining) {
              if (m.confirmedAtServerSeq !== undefined) {
                expect(m.confirmedAtServerSeq).toBeGreaterThan(snapshotSeq);
              }
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ===========================================================================
  // clearOnSnapshot (Option C)
  // ===========================================================================

  describe('clearOnSnapshot', () => {
    it('only clears confirmed mutations with confirmedAtServerSeq <= snapshotServerSeq', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackedMutationInput, { minLength: 5, maxLength: 20 }),
          fc.nat({ max: 100 }),
          (mutations, snapshotSeq) => {
            const tracker = new MutationTracker({ enableLogging: false });

            // Use unique seqs
            const uniqueMutations = mutations.filter(
              (m, i, arr) => arr.findIndex((x) => x.seq === m.seq) === i
            );

            uniqueMutations.forEach((m) => tracker.trackMutation(m));

            // Confirm half with serverSeq values
            const toConfirm = uniqueMutations.slice(0, Math.floor(uniqueMutations.length / 2));
            toConfirm.forEach((m, i) => {
              const serverSeq = i < toConfirm.length / 2 ? snapshotSeq - 5 : snapshotSeq + 5;
              tracker.confirmMutation(m.seq, Math.max(0, serverSeq));
            });

            const beforeClear = tracker.getConfirmedCount();
            tracker.clearOnSnapshot(snapshotSeq);
            const afterClear = tracker.getConfirmedCount();

            // Should have cleared some confirmed mutations
            expect(afterClear).toBeLessThanOrEqual(beforeClear);

            // Remaining confirmed should have confirmedAtServerSeq > snapshotSeq
            const remaining = tracker.getAllMutations().filter((m) => m.state === 'confirmed');
            for (const m of remaining) {
              if (m.confirmedAtServerSeq !== undefined) {
                expect(m.confirmedAtServerSeq).toBeGreaterThan(snapshotSeq);
              }
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('pending mutations are not cleared by snapshot', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackedMutationInput, { minLength: 5, maxLength: 20 }),
          fc.nat({ max: 100 }),
          (mutations, snapshotSeq) => {
            const tracker = new MutationTracker({ enableLogging: false });

            // Use unique seqs
            const uniqueMutations = mutations.filter(
              (m, i, arr) => arr.findIndex((x) => x.seq === m.seq) === i
            );

            uniqueMutations.forEach((m) => tracker.trackMutation(m));

            const pendingBefore = tracker.getPendingCount();
            tracker.clearOnSnapshot(snapshotSeq);
            const pendingAfter = tracker.getPendingCount();

            // Pending count should be unchanged
            expect(pendingAfter).toBe(pendingBefore);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('returns count of cleared mutations', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackedMutationInput, { minLength: 1, maxLength: 10 }),
          fc.nat({ max: 100 }),
          (mutations, snapshotSeq) => {
            const tracker = new MutationTracker({ enableLogging: false });

            const uniqueMutations = mutations.filter(
              (m, i, arr) => arr.findIndex((x) => x.seq === m.seq) === i
            );

            uniqueMutations.forEach((m) => tracker.trackMutation(m));
            uniqueMutations.forEach((m) => tracker.confirmMutation(m.seq, snapshotSeq - 1));

            const confirmedBefore = tracker.getConfirmedCount();
            const cleared = tracker.clearOnSnapshot(snapshotSeq);
            const confirmedAfter = tracker.getConfirmedCount();

            expect(cleared).toBe(confirmedBefore - confirmedAfter);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ===========================================================================
  // pruneOldMutations
  // ===========================================================================

  describe('pruneOldMutations', () => {
    it('marks old pending mutations as lost', () => {
      const tracker = new MutationTracker({
        mutationTimeoutMs: 1000,
        enableLogging: false,
      });

      // Create mutation that's "old"
      const oldMutation = {
        seq: 1,
        type: 'toggle_step',
        trackId: 'test',
        sentAt: Date.now() - 2000, // 2 seconds ago
        sentAtServerTime: Date.now() - 2000,
      };

      tracker.trackMutation(oldMutation);
      expect(tracker.getPendingCount()).toBe(1);

      // Prune should mark it as lost
      const pruned = tracker.pruneOldMutations();
      expect(pruned).toBe(1);
      expect(tracker.getPendingCount()).toBe(0);
      expect(tracker.getStats().lost).toBe(1);
    });

    it('does not prune recent mutations', () => {
      const tracker = new MutationTracker({
        mutationTimeoutMs: 30000,
        enableLogging: false,
      });

      const recentMutation = {
        seq: 1,
        type: 'toggle_step',
        trackId: 'test',
        sentAt: Date.now(), // Just now
        sentAtServerTime: Date.now(),
      };

      tracker.trackMutation(recentMutation);
      const pruned = tracker.pruneOldMutations();

      expect(pruned).toBe(0);
      expect(tracker.getPendingCount()).toBe(1);
    });

    it('does not prune confirmed mutations', () => {
      const tracker = new MutationTracker({
        mutationTimeoutMs: 1000,
        enableLogging: false,
      });

      const mutation = {
        seq: 1,
        type: 'toggle_step',
        trackId: 'test',
        sentAt: Date.now() - 2000,
        sentAtServerTime: Date.now() - 2000,
      };

      tracker.trackMutation(mutation);
      tracker.confirmMutation(1);

      const pruned = tracker.pruneOldMutations();
      expect(pruned).toBe(0);
      expect(tracker.getConfirmedCount()).toBe(1);
    });
  });

  // ===========================================================================
  // findMutationsForStep
  // ===========================================================================

  describe('findMutationsForStep', () => {
    it('finds mutations matching trackId and step', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.integer({ min: 0, max: 127 }),
          fc.array(arbTrackedMutationInput, { minLength: 1, maxLength: 10 }),
          (targetTrackId, targetStep, otherMutations) => {
            const tracker = new MutationTracker({ enableLogging: false });

            // Add target mutation
            const targetMutation = {
              seq: 999,
              type: 'toggle_step',
              trackId: targetTrackId,
              step: targetStep,
              sentAt: Date.now(),
              sentAtServerTime: Date.now(),
            };
            tracker.trackMutation(targetMutation);

            // Add other mutations with different trackId/step
            otherMutations.forEach((m) => {
              const modified = {
                ...m,
                trackId: m.trackId === targetTrackId ? 'different-' + m.trackId : m.trackId,
              };
              tracker.trackMutation(modified);
            });

            const found = tracker.findMutationsForStep(targetTrackId, targetStep);
            expect(found.length).toBeGreaterThanOrEqual(1);
            expect(found.some((m) => m.seq === 999)).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('only finds pending mutations', () => {
      const tracker = new MutationTracker({ enableLogging: false });

      const mutation = {
        seq: 1,
        type: 'toggle_step',
        trackId: 'track1',
        step: 5,
        sentAt: Date.now(),
        sentAtServerTime: Date.now(),
      };

      tracker.trackMutation(mutation);
      expect(tracker.findMutationsForStep('track1', 5).length).toBe(1);

      tracker.confirmMutation(1);
      expect(tracker.findMutationsForStep('track1', 5).length).toBe(0);
    });
  });

  // ===========================================================================
  // clear
  // ===========================================================================

  describe('clear', () => {
    it('resets all state', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackedMutationInput, { minLength: 1, maxLength: 20 }),
          (mutations) => {
            const tracker = new MutationTracker({ enableLogging: false });

            const uniqueMutations = mutations.filter(
              (m, i, arr) => arr.findIndex((x) => x.seq === m.seq) === i
            );
            uniqueMutations.forEach((m) => tracker.trackMutation(m));

            // Confirm some, mark some as lost
            if (uniqueMutations.length > 0) {
              tracker.confirmMutation(uniqueMutations[0].seq);
            }
            if (uniqueMutations.length > 1) {
              tracker.markLost(uniqueMutations[1].seq);
            }

            tracker.clear();

            expect(tracker.getTotalInMap()).toBe(0);
            expect(tracker.getStats()).toEqual({
              pending: 0,
              confirmed: 0,
              superseded: 0,
              lost: 0,
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
