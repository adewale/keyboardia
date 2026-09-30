/**
 * Executable policy for state-hash coverage.
 *
 * The policy objects use `satisfies Record<keyof ...>`, so adding a field to
 * SessionTrack or SessionState fails type checking until its hash behavior is
 * classified here. Each case then mutates the production state and observes
 * the real canonical hash. This prevents a copied field inventory from
 * claiming completeness while silently omitting a new shared field.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalizeForHash,
  hashState,
  projectCanonicalStateForClientHashCapability,
  projectCanonicalStateForServerHashCapability,
} from './canonical-hash';
import { LEGACY_MISSING_EFFECTS_STATE } from './effects-defaults';
import { LEGACY_MISSING_SCALE_STATE } from './scale-defaults';
import type { SessionState, SessionTrack } from './state';

type HashExpectation = 'changes' | 'unchanged';
type HashContract<T> = {
  expectation: HashExpectation;
  mutate: (value: T) => T;
};

const changes = <T>(mutate: (value: T) => T): HashContract<T> => ({
  expectation: 'changes',
  mutate,
});

const unchanged = <T>(mutate: (value: T) => T): HashContract<T> => ({
  expectation: 'unchanged',
  mutate,
});

function createBaseTrack(overrides: Partial<SessionTrack> = {}): SessionTrack {
  return {
    id: 'test-track-1',
    name: 'Test Track',
    sampleId: 'kick',
    steps: [true, false, false, false, true, false, false, false],
    parameterLocks: [null, null, null, null, { volume: 0.5 }, null, null, null],
    volume: 0.8,
    pan: 0,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 8,
    swing: 0,
    ...overrides,
  };
}

function createBaseState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    tracks: [createBaseTrack()],
    tempo: 120,
    swing: 0,
    effects: LEGACY_MISSING_EFFECTS_STATE,
    scale: LEGACY_MISSING_SCALE_STATE,
    loopRegion: null,
    version: 1,
    ...overrides,
  };
}

function computeHash(state: SessionState): string {
  return hashState(canonicalizeForHash(state));
}

const TRACK_HASH_POLICY = {
  id: changes(track => ({ ...track, id: 'different-id' })),
  name: changes(track => ({ ...track, name: 'Different Name' })),
  sampleId: changes(track => ({ ...track, sampleId: 'snare' })),
  steps: changes(track => ({
    ...track,
    steps: track.steps.map((step, index) => index === 1 ? !step : step),
  })),
  parameterLocks: changes(track => ({
    ...track,
    parameterLocks: track.parameterLocks.map((lock, index) => (
      index === 0 ? { volume: 0.3 } : lock
    )),
  })),
  volume: changes(track => ({ ...track, volume: 0.5 })),
  pan: changes(track => ({ ...track, pan: -0.35 })),
  muted: unchanged(track => ({ ...track, muted: !track.muted })),
  soloed: unchanged(track => ({ ...track, soloed: !track.soloed })),
  playbackMode: unchanged(track => ({ ...track, playbackMode: 'legacy-loop' })),
  transpose: changes(track => ({ ...track, transpose: 5 })),
  stepCount: changes(track => ({
    ...track,
    stepCount: 16,
    steps: [...track.steps, ...Array<boolean>(8).fill(false)],
    parameterLocks: [...track.parameterLocks, ...Array<null>(8).fill(null)],
  })),
  fmParams: changes(track => ({
    ...track,
    fmParams: { harmonicity: 2, modulationIndex: 4 },
  })),
  envelope: changes(track => ({
    ...track,
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
  })),
  envelopeTimeUnit: changes(track => ({ ...track, envelopeTimeUnit: 'steps' })),
  envelopeV2: changes(track => ({
    ...track,
    envelopeV2: {
      model: 'ar',
      attack: { value: 0.1, unit: 'seconds' },
      release: { value: 2, unit: 'steps' },
    },
  })),
  samplePlaybackMode: changes(track => ({ ...track, samplePlaybackMode: 'loop' })),
  gate: changes(track => ({ ...track, gate: 45 })),
  swing: changes(track => ({ ...track, swing: 50 })),
} satisfies Record<keyof SessionTrack, HashContract<SessionTrack>>;

const SESSION_HASH_POLICY = {
  tracks: changes(state => ({
    ...state,
    tracks: [...state.tracks, createBaseTrack({ id: 'test-track-2' })],
  })),
  tempo: changes(state => ({ ...state, tempo: 140 })),
  swing: changes(state => ({ ...state, swing: 50 })),
  effects: changes(state => ({
    ...state,
    effects: {
      ...LEGACY_MISSING_EFFECTS_STATE,
      reverb: { ...LEGACY_MISSING_EFFECTS_STATE.reverb, wet: 0.4 },
    },
  })),
  scale: changes(state => ({
    ...state,
    scale: { ...LEGACY_MISSING_SCALE_STATE, root: 'D' },
  })),
  loopRegion: changes(state => ({ ...state, loopRegion: { start: 2, end: 6 } })),
  version: unchanged(state => ({ ...state, version: state.version + 1 })),
} satisfies Record<keyof SessionState, HashContract<SessionState>>;

describe('canonical hash field policy', () => {
  for (const field of Object.keys(TRACK_HASH_POLICY) as (keyof typeof TRACK_HASH_POLICY)[]) {
    const contract = TRACK_HASH_POLICY[field];
    it(`track.${field} ${contract.expectation} the hash`, () => {
      const base = createBaseState();
      const mutated = {
        ...base,
        tracks: [contract.mutate(base.tracks[0]), ...base.tracks.slice(1)],
      };

      if (contract.expectation === 'changes') {
        expect(computeHash(mutated)).not.toBe(computeHash(base));
      } else {
        expect(computeHash(mutated)).toBe(computeHash(base));
      }
    });
  }

  for (const field of Object.keys(SESSION_HASH_POLICY) as (keyof typeof SESSION_HASH_POLICY)[]) {
    const contract = SESSION_HASH_POLICY[field];
    it(`session.${field} ${contract.expectation} the hash`, () => {
      const base = createBaseState();
      const mutated = contract.mutate(base);

      if (contract.expectation === 'changes') {
        expect(computeHash(mutated)).not.toBe(computeHash(base));
      } else {
        expect(computeHash(mutated)).toBe(computeHash(base));
      }
    });
  }

  it('normalizes missing legacy session fields to their explicit migration values', () => {
    const missing = createBaseState({
      effects: undefined,
      scale: undefined,
      loopRegion: undefined,
    });
    const explicit = createBaseState({
      effects: LEGACY_MISSING_EFFECTS_STATE,
      scale: LEGACY_MISSING_SCALE_STATE,
      loopRegion: null,
    });

    expect(computeHash(missing)).toBe(computeHash(explicit));
  });

  it.each([
    ['root', { ...LEGACY_MISSING_SCALE_STATE, root: 'D' }],
    ['scaleId', { ...LEGACY_MISSING_SCALE_STATE, scaleId: 'major' }],
    ['locked', { ...LEGACY_MISSING_SCALE_STATE, locked: true }],
  ] as const)('hashes scale.%s independently', (_field, scale) => {
    expect(computeHash(createBaseState({ scale }))).not.toBe(computeHash(createBaseState()));
  });

  it('projects asymmetric legacy browser and Worker hash shapes', () => {
    const canonical = canonicalizeForHash(createBaseState({
      scale: { root: 'D', scaleId: 'major', locked: true },
    }));

    expect(projectCanonicalStateForClientHashCapability(canonical, false)).toEqual({
      tracks: canonical.tracks,
      tempo: canonical.tempo,
      swing: canonical.swing,
      scale: canonical.scale,
    });
    expect(projectCanonicalStateForServerHashCapability(canonical, false)).toEqual({
      tracks: canonical.tracks,
      tempo: canonical.tempo,
      swing: canonical.swing,
      scale: LEGACY_MISSING_SCALE_STATE,
    });
    expect(projectCanonicalStateForClientHashCapability(canonical, true)).toBe(canonical);
    expect(projectCanonicalStateForServerHashCapability(canonical, true)).toBe(canonical);
  });
});
