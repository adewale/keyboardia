/**
 * Property-Based Tests for Canonical Hashing
 *
 * Tests determinism, consistency, and field exclusion properties of the
 * canonical hashing system used for client-server sync verification.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { canonicalizeForHash, hashState } from './canonicalHash';
import { arbSessionStateForHash, arbTrackForHash } from '../test/arbitraries';

describe('canonicalHash - Property-Based Tests', () => {
  // ===========================================================================
  // Determinism Properties
  // ===========================================================================

  describe('hashState determinism', () => {
    it('SY-001: same state always produces same hash', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, (state) => {
          const canonical = canonicalizeForHash(state);
          const hash1 = hashState(canonical);
          const hash2 = hashState(canonical);

          expect(hash1).toBe(hash2);
        }),
        { numRuns: 500 }
      );
    });

    it('hash is deterministic across canonicalization calls', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, (state) => {
          const canonical1 = canonicalizeForHash(state);
          const canonical2 = canonicalizeForHash(state);

          expect(hashState(canonical1)).toBe(hashState(canonical2));
        }),
        { numRuns: 500 }
      );
    });

    it('hash is always an 8-character hex string', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, (state) => {
          const canonical = canonicalizeForHash(state);
          const hash = hashState(canonical);

          expect(hash).toMatch(/^[0-9a-f]{8}$/);
        }),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // Local-Only Field Exclusion
  // ===========================================================================

  describe('local-only field exclusion', () => {
    it('SY-002: muted changes do not affect hash', () => {
      fc.assert(
        fc.property(
          arbSessionStateForHash,
          fc.array(fc.boolean(), { minLength: 0, maxLength: 16 }),
          (state, mutedValues) => {
            // Create two states with different muted values
            const state1 = {
              ...state,
              tracks: state.tracks.map((t, i) => ({
                ...t,
                muted: false,
              })),
            };
            const state2 = {
              ...state,
              tracks: state.tracks.map((t, i) => ({
                ...t,
                muted: mutedValues[i] ?? true,
              })),
            };

            const hash1 = hashState(canonicalizeForHash(state1));
            const hash2 = hashState(canonicalizeForHash(state2));

            expect(hash1).toBe(hash2);
          }
        ),
        { numRuns: 300 }
      );
    });

    it('SY-002: soloed changes do not affect hash', () => {
      fc.assert(
        fc.property(
          arbSessionStateForHash,
          fc.array(fc.boolean(), { minLength: 0, maxLength: 16 }),
          (state, soloedValues) => {
            const state1 = {
              ...state,
              tracks: state.tracks.map((t) => ({
                ...t,
                soloed: false,
              })),
            };
            const state2 = {
              ...state,
              tracks: state.tracks.map((t, i) => ({
                ...t,
                soloed: soloedValues[i] ?? true,
              })),
            };

            const hash1 = hashState(canonicalizeForHash(state1));
            const hash2 = hashState(canonicalizeForHash(state2));

            expect(hash1).toBe(hash2);
          }
        ),
        { numRuns: 300 }
      );
    });

    it('version field does not affect hash', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, fc.nat(), fc.nat(), (state, v1, v2) => {
          const state1 = { ...state, version: v1 };
          const state2 = { ...state, version: v2 };

          const hash1 = hashState(canonicalizeForHash(state1));
          const hash2 = hashState(canonicalizeForHash(state2));

          expect(hash1).toBe(hash2);
        }),
        { numRuns: 300 }
      );
    });
  });

  // ===========================================================================
  // Canonical Form Properties
  // ===========================================================================

  describe('canonicalizeForHash', () => {
    it('canonical form has required fields', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, (state) => {
          const canonical = canonicalizeForHash(state);

          expect(canonical).toHaveProperty('tracks');
          expect(canonical).toHaveProperty('tempo');
          expect(canonical).toHaveProperty('swing');
          expect(Array.isArray(canonical.tracks)).toBe(true);
        }),
        { numRuns: 500 }
      );
    });

    it('canonical tracks have stepCount normalized', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, (state) => {
          const canonical = canonicalizeForHash(state);

          for (const track of canonical.tracks) {
            // stepCount should be a number (not undefined)
            expect(typeof track.stepCount).toBe('number');
            expect(track.stepCount).toBeGreaterThanOrEqual(1);
          }
        }),
        { numRuns: 500 }
      );
    });

    it('canonical tracks have swing normalized', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, (state) => {
          const canonical = canonicalizeForHash(state);

          for (const track of canonical.tracks) {
            // swing should be a number (not undefined)
            expect(typeof track.swing).toBe('number');
          }
        }),
        { numRuns: 500 }
      );
    });

    it('canonical tracks exclude muted and soloed', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, (state) => {
          const canonical = canonicalizeForHash(state);

          for (const track of canonical.tracks) {
            expect(track).not.toHaveProperty('muted');
            expect(track).not.toHaveProperty('soloed');
          }
        }),
        { numRuns: 500 }
      );
    });

    it('steps array is normalized to stepCount length', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, (state) => {
          const canonical = canonicalizeForHash(state);

          for (const track of canonical.tracks) {
            expect(track.steps.length).toBe(track.stepCount);
          }
        }),
        { numRuns: 500 }
      );
    });

    it('parameterLocks array is normalized to stepCount length', () => {
      fc.assert(
        fc.property(arbSessionStateForHash, (state) => {
          const canonical = canonicalizeForHash(state);

          for (const track of canonical.tracks) {
            expect(track.parameterLocks.length).toBe(track.stepCount);
          }
        }),
        { numRuns: 500 }
      );
    });
  });

  // ===========================================================================
  // Sensitivity Properties
  // ===========================================================================

  describe('hash sensitivity', () => {
    it('different tempo produces different hash', () => {
      fc.assert(
        fc.property(
          arbSessionStateForHash,
          fc.integer({ min: 60, max: 120 }),
          fc.integer({ min: 121, max: 180 }),
          (state, tempo1, tempo2) => {
            fc.pre(tempo1 !== tempo2);

            const state1 = { ...state, tempo: tempo1 };
            const state2 = { ...state, tempo: tempo2 };

            const hash1 = hashState(canonicalizeForHash(state1));
            const hash2 = hashState(canonicalizeForHash(state2));

            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 300 }
      );
    });

    it('different swing produces different hash', () => {
      fc.assert(
        fc.property(
          arbSessionStateForHash,
          fc.integer({ min: 0, max: 49 }),
          fc.integer({ min: 50, max: 100 }),
          (state, swing1, swing2) => {
            fc.pre(swing1 !== swing2);

            const state1 = { ...state, swing: swing1 };
            const state2 = { ...state, swing: swing2 };

            const hash1 = hashState(canonicalizeForHash(state1));
            const hash2 = hashState(canonicalizeForHash(state2));

            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 300 }
      );
    });

    it('different track count produces different hash', () => {
      fc.assert(
        fc.property(
          arbTrackForHash,
          arbTrackForHash,
          fc.integer({ min: 60, max: 180 }),
          fc.integer({ min: 0, max: 100 }),
          (track1, track2, tempo, swing) => {
            fc.pre(track1.id !== track2.id);

            const state1 = { tracks: [track1], tempo, swing };
            const state2 = { tracks: [track1, track2], tempo, swing };

            const hash1 = hashState(canonicalizeForHash(state1));
            const hash2 = hashState(canonicalizeForHash(state2));

            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 300 }
      );
    });

    it('step change produces different hash', () => {
      fc.assert(
        fc.property(
          arbSessionStateForHash,
          fc.integer({ min: 0, max: 15 }),
          (state) => {
            fc.pre(state.tracks.length > 0);

            const stepToToggle = 0;

            // Clone and toggle a step
            const state2 = {
              ...state,
              tracks: state.tracks.map((t, i) =>
                i === 0
                  ? {
                      ...t,
                      steps: t.steps.map((s, j) => (j === stepToToggle ? !s : s)),
                    }
                  : t
              ),
            };

            const hash1 = hashState(canonicalizeForHash(state));
            const hash2 = hashState(canonicalizeForHash(state2));

            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('empty tracks array produces valid hash', () => {
      const state = { tracks: [], tempo: 120, swing: 0 };
      const hash = hashState(canonicalizeForHash(state));

      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('handles maximum track count', () => {
      fc.assert(
        fc.property(
          fc.array(arbTrackForHash, { minLength: 16, maxLength: 16 }),
          fc.integer({ min: 60, max: 180 }),
          fc.integer({ min: 0, max: 100 }),
          (tracks, tempo, swing) => {
            const state = { tracks, tempo, swing };
            const hash = hashState(canonicalizeForHash(state));

            expect(hash).toMatch(/^[0-9a-f]{8}$/);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('handles extreme tempo values', () => {
      fc.assert(
        fc.property(
          arbSessionStateForHash,
          fc.constantFrom(60, 180),
          (state, tempo) => {
            const boundaryState = { ...state, tempo };
            const hash = hashState(canonicalizeForHash(boundaryState));

            expect(hash).toMatch(/^[0-9a-f]{8}$/);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
