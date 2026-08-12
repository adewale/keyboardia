import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isInScale } from '../music/music-theory';
import { canEnterPitchWithScaleLock } from '../music/scale-entry';
import {
  DEFAULT_NEW_SESSION_SCALE_STATE,
  LEGACY_MISSING_SCALE_STATE,
  normalizeSessionScale,
} from './scale-defaults';

describe('session scale defaults', () => {
  it('separates fresh locked state from legacy missing unlocked state', () => {
    expect(DEFAULT_NEW_SESSION_SCALE_STATE).toEqual({
      root: 'C', scaleId: 'minor-pentatonic', locked: true,
    });
    expect(LEGACY_MISSING_SCALE_STATE).toEqual({
      root: 'C', scaleId: 'minor-pentatonic', locked: false,
    });
  });

  it('preserves an explicitly persisted lock value under either policy', () => {
    const scale = { root: 'D', scaleId: 'dorian', locked: false };
    expect(normalizeSessionScale(scale, 'new-session')).toEqual(scale);
    expect(normalizeSessionScale(scale, 'legacy-session')).toEqual(scale);
  });

  it('returns detached values so callers cannot mutate global defaults', () => {
    const first = normalizeSessionScale(undefined, 'new-session');
    const second = normalizeSessionScale(undefined, 'new-session');
    expect(first).not.toBe(second);
  });

  it('property: every pitch accepted under the fresh lock is in scale', () => {
    fc.assert(fc.property(fc.integer({ min: -24, max: 24 }), (pitch) => {
      const allowed = canEnterPitchWithScaleLock(pitch, DEFAULT_NEW_SESSION_SCALE_STATE);
      expect(allowed).toBe(isInScale(pitch, 'C', 'minor-pentatonic'));
    }), { numRuns: 256 });
  });

  it('keeps note entry unrestricted after an explicit unlock', () => {
    for (let pitch = -24; pitch <= 24; pitch++) {
      expect(canEnterPitchWithScaleLock(pitch, LEGACY_MISSING_SCALE_STATE)).toBe(true);
    }
  });
});
