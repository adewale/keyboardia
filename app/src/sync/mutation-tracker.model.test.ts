/**
 * Model-Based Property Tests for Mutation Tracker
 *
 * Tests MB-001 from the Property-Based Testing specification.
 * Uses fast-check's model-based testing to verify the mutation tracker
 * matches a simple reference model across any sequence of operations.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { MutationTracker } from './mutation-tracker';

// =============================================================================
// Simple Reference Model
// =============================================================================

/**
 * A drastically simplified model of the mutation tracker.
 * This should be "obviously correct" even if less efficient.
 */
class MutationTrackerModel {
  private mutations = new Map<number, 'pending' | 'confirmed'>();
  private supersededCount = 0;
  private lostCount = 0;

  track(seq: number): void {
    if (!this.mutations.has(seq)) {
      this.mutations.set(seq, 'pending');
    }
  }

  confirm(seq: number): boolean {
    if (this.mutations.get(seq) === 'pending') {
      this.mutations.set(seq, 'confirmed');
      return true;
    }
    return false;
  }

  markSuperseded(seq: number): boolean {
    if (this.mutations.get(seq) === 'pending') {
      this.mutations.delete(seq);
      this.supersededCount++;
      return true;
    }
    return false;
  }

  markLost(seq: number): boolean {
    if (this.mutations.get(seq) === 'pending') {
      this.mutations.delete(seq);
      this.lostCount++;
      return true;
    }
    return false;
  }

  getPendingCount(): number {
    return [...this.mutations.values()].filter((s) => s === 'pending').length;
  }

  getConfirmedCount(): number {
    return [...this.mutations.values()].filter((s) => s === 'confirmed').length;
  }

  getSupersededCount(): number {
    return this.supersededCount;
  }

  getLostCount(): number {
    return this.lostCount;
  }

  hasMutation(seq: number): boolean {
    return this.mutations.has(seq);
  }

  getState(seq: number): 'pending' | 'confirmed' | undefined {
    return this.mutations.get(seq);
  }
}

// =============================================================================
// Commands
// =============================================================================

class TrackCommand implements fc.Command<MutationTrackerModel, MutationTracker> {
  seq: number;
  constructor(seq: number) {
    this.seq = seq;
  }

  check(_model: Readonly<MutationTrackerModel>): boolean {
    return true; // Always valid to attempt tracking
  }

  run(model: MutationTrackerModel, real: MutationTracker): void {
    const input = {
      seq: this.seq,
      type: 'toggle_step' as const,
      trackId: 'test-track',
      sentAt: Date.now(),
      sentAtServerTime: Date.now(),
    };

    model.track(this.seq);
    real.trackMutation(input);

    // Invariant: pending counts match
    expect(real.getPendingCount()).toBe(model.getPendingCount());
  }

  toString(): string {
    return `track(${this.seq})`;
  }
}

class ConfirmCommand implements fc.Command<MutationTrackerModel, MutationTracker> {
  seq: number;
  serverSeq: number;
  constructor(seq: number, serverSeq: number) {
    this.seq = seq;
    this.serverSeq = serverSeq;
  }

  check(_model: Readonly<MutationTrackerModel>): boolean {
    return true; // Always valid to attempt confirmation
  }

  run(model: MutationTrackerModel, real: MutationTracker): void {
    const modelResult = model.confirm(this.seq);
    const realResult = real.confirmMutation(this.seq, this.serverSeq);

    // Results should match
    expect(realResult).toBe(modelResult);

    // Counts should match
    expect(real.getPendingCount()).toBe(model.getPendingCount());
    expect(real.getConfirmedCount()).toBe(model.getConfirmedCount());
  }

  toString(): string {
    return `confirm(${this.seq}, serverSeq=${this.serverSeq})`;
  }
}

class SupersedeCommand implements fc.Command<MutationTrackerModel, MutationTracker> {
  seq: number;
  constructor(seq: number) {
    this.seq = seq;
  }

  check(_model: Readonly<MutationTrackerModel>): boolean {
    return true;
  }

  run(model: MutationTrackerModel, real: MutationTracker): void {
    const modelResult = model.markSuperseded(this.seq);
    const realResult = real.markSuperseded(this.seq);

    expect(realResult).toBe(modelResult);
    expect(real.getPendingCount()).toBe(model.getPendingCount());
    expect(real.getStats().superseded).toBe(model.getSupersededCount());
  }

  toString(): string {
    return `supersede(${this.seq})`;
  }
}

class MarkLostCommand implements fc.Command<MutationTrackerModel, MutationTracker> {
  seq: number;
  constructor(seq: number) {
    this.seq = seq;
  }

  check(_model: Readonly<MutationTrackerModel>): boolean {
    return true;
  }

  run(model: MutationTrackerModel, real: MutationTracker): void {
    const modelResult = model.markLost(this.seq);
    const realResult = real.markLost(this.seq);

    expect(realResult).toBe(modelResult);
    expect(real.getPendingCount()).toBe(model.getPendingCount());
    expect(real.getStats().lost).toBe(model.getLostCount());
  }

  toString(): string {
    return `markLost(${this.seq})`;
  }
}

// =============================================================================
// Model-Based Tests
// =============================================================================

describe('Model-Based Mutation Tracker Tests', () => {
  const allCommands = [
    fc.nat({ max: 50 }).map((seq) => new TrackCommand(seq)),
    fc
      .tuple(fc.nat({ max: 50 }), fc.nat({ max: 1000 }))
      .map(([seq, serverSeq]) => new ConfirmCommand(seq, serverSeq)),
    fc.nat({ max: 50 }).map((seq) => new SupersedeCommand(seq)),
    fc.nat({ max: 50 }).map((seq) => new MarkLostCommand(seq)),
  ];

  it('MB-001: mutation tracker matches model for any command sequence', () => {
    fc.assert(
      fc.property(fc.commands(allCommands, { maxCommands: 100 }), (commands) => {
        const setup = () => ({
          model: new MutationTrackerModel(),
          real: new MutationTracker({ enableLogging: false }),
        });

        fc.modelRun(setup, commands);
      }),
      { numRuns: 300 }
    );
  });

  it('MB-002: track then confirm sequence always works', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 100 }), { minLength: 1, maxLength: 20 }),
        (seqs) => {
          const model = new MutationTrackerModel();
          const real = new MutationTracker({ enableLogging: false });

          // Track all
          for (const seq of seqs) {
            const input = {
              seq,
              type: 'toggle_step' as const,
              trackId: 'test',
              sentAt: Date.now(),
              sentAtServerTime: Date.now(),
            };
            model.track(seq);
            real.trackMutation(input);
          }

          // Confirm all (unique)
          const uniqueSeqs = [...new Set(seqs)];
          for (let i = 0; i < uniqueSeqs.length; i++) {
            const seq = uniqueSeqs[i];
            model.confirm(seq);
            real.confirmMutation(seq, i);
          }

          // All should be confirmed
          expect(real.getPendingCount()).toBe(0);
          expect(real.getConfirmedCount()).toBe(uniqueSeqs.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('MB-003: supersede and lost are mutually exclusive outcomes', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100 }),
        fc.constantFrom('supersede', 'lost') as fc.Arbitrary<'supersede' | 'lost'>,
        (seq, outcome) => {
          const model = new MutationTrackerModel();
          const real = new MutationTracker({ enableLogging: false });

          // Track
          const input = {
            seq,
            type: 'toggle_step' as const,
            trackId: 'test',
            sentAt: Date.now(),
            sentAtServerTime: Date.now(),
          };
          model.track(seq);
          real.trackMutation(input);

          // Apply one outcome
          if (outcome === 'supersede') {
            model.markSuperseded(seq);
            real.markSuperseded(seq);
          } else {
            model.markLost(seq);
            real.markLost(seq);
          }

          // Try to apply the other (should fail)
          if (outcome === 'supersede') {
            expect(real.markLost(seq)).toBe(false);
          } else {
            expect(real.markSuperseded(seq)).toBe(false);
          }

          // Counts match
          expect(real.getStats().superseded).toBe(model.getSupersededCount());
          expect(real.getStats().lost).toBe(model.getLostCount());
        }
      ),
      { numRuns: 200 }
    );
  });

  it('MB-004: double-tracking same seq is idempotent on pending count', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100 }), fc.integer({ min: 2, max: 10 }), (seq, repeatCount) => {
        const real = new MutationTracker({ enableLogging: false });

        for (let i = 0; i < repeatCount; i++) {
          const input = {
            seq,
            type: 'toggle_step' as const,
            trackId: 'test',
            sentAt: Date.now(),
            sentAtServerTime: Date.now(),
          };
          real.trackMutation(input);
        }

        // Should only count as one pending mutation
        expect(real.getPendingCount()).toBe(1);
      }),
      { numRuns: 200 }
    );
  });

  it('MB-005: state transitions are valid', () => {
    fc.assert(
      fc.property(fc.commands(allCommands, { maxCommands: 50 }), (commands) => {
        const model = new MutationTrackerModel();
        const real = new MutationTracker({ enableLogging: false });

        const setup = () => ({ model, real });

        // Run commands
        fc.modelRun(setup, commands);

        // After any sequence, all mutations in map are in valid states
        for (const mutation of real.getAllMutations()) {
          expect(['pending', 'confirmed', 'superseded', 'lost']).toContain(mutation.state);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// Stats Invariant Tests
// =============================================================================

describe('Stats Invariant Tests', () => {
  it('MB-006: stats are always consistent with map state (derived stats fix)', () => {
    fc.assert(
      fc.property(
        fc.commands(
          [
            fc.nat({ max: 30 }).map((seq) => new TrackCommand(seq)),
            fc
              .tuple(fc.nat({ max: 30 }), fc.nat({ max: 100 }))
              .map(([seq, serverSeq]) => new ConfirmCommand(seq, serverSeq)),
            fc.nat({ max: 30 }).map((seq) => new SupersedeCommand(seq)),
            fc.nat({ max: 30 }).map((seq) => new MarkLostCommand(seq)),
          ],
          { maxCommands: 100 }
        ),
        (commands) => {
          const model = new MutationTrackerModel();
          const real = new MutationTracker({ enableLogging: false });

          const setup = () => ({ model, real });

          fc.modelRun(setup, commands);

          // Core invariant: stats are DERIVED from map, so they're always consistent
          // This was fixed by making pending/confirmed counts derived, not cached
          const inMap = real.getTotalInMap();
          const stats = real.getStats();

          // All stats should match model exactly
          expect(stats.pending).toBe(model.getPendingCount());
          expect(stats.confirmed).toBe(model.getConfirmedCount());
          expect(stats.superseded).toBe(model.getSupersededCount());
          expect(stats.lost).toBe(model.getLostCount());

          // In-map count equals pending + confirmed
          expect(inMap).toBe(stats.pending + stats.confirmed);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('MB-007: mutations only exist in one state at a time', () => {
    fc.assert(
      fc.property(
        fc.commands(
          [
            fc.nat({ max: 30 }).map((seq) => new TrackCommand(seq)),
            fc
              .tuple(fc.nat({ max: 30 }), fc.nat({ max: 100 }))
              .map(([seq, serverSeq]) => new ConfirmCommand(seq, serverSeq)),
            fc.nat({ max: 30 }).map((seq) => new SupersedeCommand(seq)),
            fc.nat({ max: 30 }).map((seq) => new MarkLostCommand(seq)),
          ],
          { maxCommands: 50 }
        ),
        (commands) => {
          const model = new MutationTrackerModel();
          const real = new MutationTracker({ enableLogging: false });

          const setup = () => ({ model, real });

          fc.modelRun(setup, commands);

          // Each mutation in the map is in exactly one state
          for (const mutation of real.getAllMutations()) {
            const validStates = ['pending', 'confirmed', 'superseded', 'lost'];
            const matchingStates = validStates.filter((s) => mutation.state === s);
            expect(matchingStates.length).toBe(1);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
