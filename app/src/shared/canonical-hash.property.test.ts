import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbSessionStateForHash } from '../test/arbitraries';
import { canonicalizeForHash, hashState } from './canonical-hash';

const hash = (state: Parameters<typeof canonicalizeForHash>[0]) => (
  hashState(canonicalizeForHash(state))
);

describe('canonical hash properties', () => {
  it('is deterministic and keeps the wire hash format for arbitrary session state', () => {
    fc.assert(fc.property(arbSessionStateForHash, state => {
      const first = hash(state);
      const second = hash(state);

      expect(second).toBe(first);
      expect(first).toMatch(/^[0-9a-f]{8}$/);
    }), { numRuns: 500 });
  });

  it('is invariant to listener-local track state and server bookkeeping', () => {
    fc.assert(fc.property(
      arbSessionStateForHash,
      fc.array(fc.boolean(), { minLength: 0, maxLength: 16 }),
      fc.array(fc.boolean(), { minLength: 0, maxLength: 16 }),
      fc.nat(),
      (state, muted, soloed, version) => {
        const localVariant = {
          ...state,
          version,
          tracks: state.tracks.map((track, index) => ({
            ...track,
            muted: muted[index] ?? !track.muted,
            soloed: soloed[index] ?? !track.soloed,
            playbackMode: `legacy-${index}`,
          })),
        };

        expect(hash(localVariant)).toBe(hash(state));
      },
    ), { numRuns: 300 });
  });

  it('ignores stored array entries beyond a track loop', () => {
    fc.assert(fc.property(arbSessionStateForHash, state => {
      const normalizedStorage = {
        ...state,
        tracks: state.tracks.map(track => {
          const stepCount = track.stepCount ?? 16;
          return {
            ...track,
            steps: track.steps.slice(0, stepCount),
            parameterLocks: track.parameterLocks.slice(0, stepCount),
          };
        }),
      };

      expect(hash(normalizedStorage)).toBe(hash(state));
    }), { numRuns: 300 });
  });

  it('detects a changed playable step across arbitrary session state', () => {
    fc.assert(fc.property(arbSessionStateForHash, state => {
      fc.pre(state.tracks.length > 0);
      const track = state.tracks[0];
      const stepCount = track.stepCount ?? 16;
      const changed = {
        ...state,
        tracks: state.tracks.map((candidate, trackIndex) => (
          trackIndex === 0
            ? {
                ...candidate,
                steps: candidate.steps.map((active, stepIndex) => (
                  stepIndex === stepCount - 1 ? !active : active
                )),
              }
            : candidate
        )),
      };

      expect(hash(changed)).not.toBe(hash(state));
    }), { numRuns: 300 });
  });
});
