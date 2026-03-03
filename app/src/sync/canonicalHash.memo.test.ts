/**
 * Tests for hashState memoization behavior.
 *
 * Verifies that:
 * 1. Memoization returns the same result for identical input
 * 2. Cache invalidates when input changes
 * 3. Correctness is preserved (same results as non-memoized)
 * 4. _resetHashCache works for test isolation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { hashState, _resetHashCache, canonicalizeForHash } from './canonicalHash';

beforeEach(() => {
  _resetHashCache();
});

describe('hashState memoization', () => {
  it('returns same hash for identical objects called twice', () => {
    const state = { tracks: [], tempo: 120, swing: 0 };
    const hash1 = hashState(state);
    const hash2 = hashState(state);
    expect(hash1).toBe(hash2);
  });

  it('returns different hash when state changes', () => {
    const state1 = { tracks: [], tempo: 120, swing: 0 };
    const state2 = { tracks: [], tempo: 121, swing: 0 };
    const hash1 = hashState(state1);
    const hash2 = hashState(state2);
    expect(hash1).not.toBe(hash2);
  });

  it('returns correct hash after cache is invalidated by different input', () => {
    const state1 = { tracks: [], tempo: 120, swing: 0 };
    const state2 = { tracks: [], tempo: 121, swing: 0 };

    const hash1a = hashState(state1);
    hashState(state2); // Invalidates cache for state1
    const hash1b = hashState(state1); // Should recompute correctly

    expect(hash1a).toBe(hash1b);
  });

  it('_resetHashCache clears the memoization', () => {
    const state = { tracks: [], tempo: 120, swing: 0 };
    const hash1 = hashState(state);
    _resetHashCache();
    const hash2 = hashState(state);
    // Results should be the same (correctness) even after reset
    expect(hash1).toBe(hash2);
  });

  it('produces correct hashes with canonicalized state (integration)', () => {
    const state = {
      tracks: [{
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false],
        parameterLocks: [null, null, null, null],
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 16,
      }],
      tempo: 120,
      swing: 0,
    };

    const canonical = canonicalizeForHash(state);
    const hash1 = hashState(canonical);

    // Same state, fresh canonicalization
    const canonical2 = canonicalizeForHash(state);
    const hash2 = hashState(canonical2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('memoized hash matches non-memoized computation', () => {
    // Manually compute the hash without memoization
    const state = { foo: 'bar', num: 42 };
    const str = JSON.stringify(state);
    let expected = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      expected = ((expected << 5) - expected) + char;
      expected = expected & expected;
    }
    const expectedHex = (expected >>> 0).toString(16).padStart(8, '0');

    expect(hashState(state)).toBe(expectedHex);
  });
});
