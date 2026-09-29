import { describe, expect, it } from 'vitest';
import {
  canonicalizeForHash as canonicalizeClient,
  hashState,
} from './canonical-hash';

const base = { tracks: [], tempo: 120, swing: 0 };

describe('scale canonical hashing', () => {
  it('normalizes missing legacy scale to the explicit unlocked migration state', () => {
    expect(canonicalizeClient(base).scale).toEqual({
      root: 'C', scaleId: 'minor-pentatonic', locked: false,
    });
    expect(hashState(canonicalizeClient(base))).toBe(hashState(canonicalizeClient({
      ...base,
      scale: { root: 'C', scaleId: 'minor-pentatonic', locked: false },
    })));
  });

  it('makes root, scale, and lock changes hash-significant', () => {
    const variants = [
      { root: 'C', scaleId: 'minor-pentatonic', locked: false },
      { root: 'C', scaleId: 'minor-pentatonic', locked: true },
      { root: 'D', scaleId: 'minor-pentatonic', locked: true },
      { root: 'D', scaleId: 'major', locked: true },
    ];
    const hashes = variants.map(scale => hashState(canonicalizeClient({ ...base, scale })));
    expect(new Set(hashes).size).toBe(variants.length);
  });

});
