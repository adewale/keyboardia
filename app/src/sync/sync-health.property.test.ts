// @vitest-environment jsdom
/**
 * Model-based properties for SyncHealth sequence tracking (issue #97 T5).
 *
 * The reference model restates the class's documented contract in the most
 * obvious form: first seq is accepted as-is; a gap advances the high-water
 * mark, adds to missed, and arms recovery when it reaches gapThreshold; a
 * regressed seq counts out-of-order WITHOUT advancing the mark (the epoch
 * behavior Lesson 66 hinges on); resetRecoveryFlags clears the gap flag and
 * the out-of-order count but keeps the mark. Any op sequence must leave the
 * real class and the model in agreement after every single op.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SyncHealth } from './sync-health';

const GAP_THRESHOLD = 3;
const OOO_THRESHOLD = 10;

class SyncHealthModel {
  lastSeq = -1;

  /** Public view: the class documents "returns 0 if no messages received yet". */
  get observedSeq(): number {
    return this.lastSeq === -1 ? 0 : this.lastSeq;
  }

  outOfOrder = 0;
  largeGapArmed = false;

  record(seq: number): void {
    if (this.lastSeq === -1) {
      this.lastSeq = seq;
      return;
    }
    const expected = this.lastSeq + 1;
    if (seq > expected) {
      if (seq - expected >= GAP_THRESHOLD) this.largeGapArmed = true;
      this.lastSeq = seq;
    } else if (seq < expected) {
      this.outOfOrder++;
    } else {
      this.lastSeq = seq;
    }
  }

  resetFlags(): void {
    this.largeGapArmed = false;
    this.outOfOrder = 0;
  }

  needsRecovery(): boolean {
    return this.largeGapArmed || this.outOfOrder > OOO_THRESHOLD;
  }
}

type Op = { kind: 'seq'; seq: number } | { kind: 'resetFlags' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 9, arbitrary: fc.record({ kind: fc.constant<'seq'>('seq'), seq: fc.nat(60) }) },
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'resetFlags' }) },
);

describe('SyncHealth model-based property', () => {
  it('MB-003: any sequence of seq records and flag resets matches the reference model', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 60 }), (ops) => {
        const real = new SyncHealth({ gapThreshold: GAP_THRESHOLD, outOfOrderThreshold: OOO_THRESHOLD });
        const model = new SyncHealthModel();

        for (const op of ops) {
          if (op.kind === 'seq') {
            real.recordServerSeq(op.seq);
            model.record(op.seq);
          } else {
            real.resetRecoveryFlags();
            model.resetFlags();
          }
          expect(real.getLastServerSeq(), 'high-water mark').toBe(model.observedSeq);
          expect(real.getOutOfOrderCount(), 'out-of-order count').toBe(model.outOfOrder);
          expect(real.needsRecovery().needed, 'recovery decision').toBe(model.needsRecovery());
        }
        // The per-op asserts are the oracle; generator weights guarantee
        // gap/regression coverage across runs. (The first draft returned a
        // "witness" boolean that failed legitimate reset-only runs — a
        // Lesson 68 harness bug found by this property's own first run.)
      }),
      { numRuns: 200 },
    );
  });
});
