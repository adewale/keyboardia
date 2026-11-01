/**
 * Scale-lock closure properties for canEnterPitchWithScaleLock.
 *
 * Oracles are spec-level facts checked against the SCALES interval tables,
 * not a restatement of the implementation:
 *   - locked entry admits exactly |intervals| pitch classes per octave
 *   - the root is always admissible
 *   - admissibility is octave-invariant (p admitted ⇔ p±12 admitted)
 *   - unlocked (or absent) scale admits everything
 *   - the chromatic scale admits everything even when locked
 */
import { describe, expect, it } from 'vitest';
import { canEnterPitchWithScaleLock } from './scale-entry';
import { NOTE_NAMES, SCALES, getRootIndex, type ScaleId } from './music-theory';
import type { ScaleState } from '../shared/sync-types';

const PITCH_RANGE = { lo: -24, hi: 24 }; // chromatic grid "All" view range

const locked = (root: string, scaleId: string): ScaleState =>
  ({ locked: true, root, scaleId } as ScaleState);

describe('scale-lock closure', () => {
  it('admits exactly the scale-interval pitch classes, for every scale and root', () => {
    for (const [scaleId, def] of Object.entries(SCALES)) {
      for (const root of NOTE_NAMES) {
        const rootIndex = getRootIndex(root);
        const scale = locked(root, scaleId);
        const admittedClasses = new Set<number>();
        for (let p = PITCH_RANGE.lo; p <= PITCH_RANGE.hi; p++) {
          if (canEnterPitchWithScaleLock(p, scale)) {
            admittedClasses.add(((p % 12) + 12) % 12);
          }
        }
        const expectedClasses = new Set(
          def.intervals.map((i: number) => (rootIndex + i) % 12),
        );
        expect(admittedClasses, `${scaleId} root=${root}`).toEqual(expectedClasses);
      }
    }
  });

  it('always admits the root and is octave-invariant', () => {
    for (const scaleId of Object.keys(SCALES) as ScaleId[]) {
      for (const root of NOTE_NAMES) {
        const scale = locked(root, scaleId);
        const rootIndex = getRootIndex(root);
        expect(canEnterPitchWithScaleLock(rootIndex, scale), `${scaleId} root=${root} admits root`).toBe(true);
        for (let p = PITCH_RANGE.lo; p <= PITCH_RANGE.hi - 12; p++) {
          expect(
            canEnterPitchWithScaleLock(p, scale),
            `${scaleId} root=${root} octave invariance at ${p}`,
          ).toBe(canEnterPitchWithScaleLock(p + 12, scale));
        }
      }
    }
  });

  it('admits everything when unlocked, absent, or chromatic', () => {
    for (let p = PITCH_RANGE.lo; p <= PITCH_RANGE.hi; p++) {
      expect(canEnterPitchWithScaleLock(p, null)).toBe(true);
      expect(canEnterPitchWithScaleLock(p, undefined)).toBe(true);
      expect(canEnterPitchWithScaleLock(p, { locked: false, root: 'C', scaleId: 'major' } as ScaleState)).toBe(true);
      if ('chromatic' in SCALES) {
        expect(canEnterPitchWithScaleLock(p, locked('C', 'chromatic'))).toBe(true);
      }
    }
  });
});
