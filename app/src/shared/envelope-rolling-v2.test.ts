import { describe, expect, it } from 'vitest';
import { canonicalizeForHash, hashState } from '../sync/canonicalHash';
import { validateParameterLock, validateStateInvariants, repairStateInvariants } from '../worker/invariants';
import { validateSessionState } from '../worker/validation';
import { applyMutation } from './state-mutations';
import {
  mergeRollingEnvelopeStateV2,
  projectCanonicalStateForEnvelopeV2Capability,
} from './rolling-envelope-state-v2';
import type { SessionState, SessionTrack } from './state';

const STEPS = 128;

function track(overrides: Partial<SessionTrack> = {}): SessionTrack {
  return {
    id: 'track-1',
    name: 'Kick',
    sampleId: 'kick',
    steps: Array(STEPS).fill(false),
    parameterLocks: Array(STEPS).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

function state(sessionTrack = track()): SessionState {
  return { tracks: [sessionTrack], tempo: 120, swing: 0, version: 1 };
}

const ahdEnvelope = {
  model: 'ahd' as const,
  attack: { value: 1, unit: 'steps' as const },
  hold: { value: 2, unit: 'steps' as const },
  decay: { value: 0.25, unit: 'seconds' as const },
};

describe('rolling-safe envelope v2 state', () => {
  it('preserves fields an old full-state writer cannot represent', () => {
    const previousTrack = track({
      envelopeV2: ahdEnvelope,
      samplePlaybackMode: 'loop',
      parameterLocks: [
        { attackDuration: { value: 2, unit: 'steps' }, holdDuration: { value: 1, unit: 'steps' } },
        ...Array(STEPS - 1).fill(null),
      ],
    });
    const oldReplacement = state(track({
      name: 'Renamed by old client',
      parameterLocks: [{ pitch: 7 }, ...Array(STEPS - 1).fill(null)],
    }));

    const merged = mergeRollingEnvelopeStateV2(state(previousTrack), oldReplacement);

    expect(merged.tracks[0]).toMatchObject({
      name: 'Renamed by old client',
      envelopeV2: ahdEnvelope,
      samplePlaybackMode: 'loop',
    });
    expect(merged.tracks[0].parameterLocks[0]).toEqual({
      pitch: 7,
      attackDuration: { value: 2, unit: 'steps' },
      holdDuration: { value: 1, unit: 'steps' },
    });
  });

  it('lets explicit v2 replacement values win and keeps deletions authoritative', () => {
    const previous = state(track({ envelopeV2: ahdEnvelope, samplePlaybackMode: 'loop' }));
    const replacementEnvelope = {
      model: 'ar' as const,
      attack: { value: 0, unit: 'seconds' as const },
      release: { value: 4, unit: 'steps' as const },
    };
    const merged = mergeRollingEnvelopeStateV2(previous, state(track({
      envelopeV2: replacementEnvelope,
      samplePlaybackMode: 'gate',
    })));
    expect(merged.tracks[0].envelopeV2).toEqual(replacementEnvelope);
    expect(merged.tracks[0].samplePlaybackMode).toBe('gate');
    expect(mergeRollingEnvelopeStateV2(previous, { ...previous, tracks: [] }).tracks).toEqual([]);
  });

  it('applies canonical granular mutations and typed stage locks', () => {
    let current = applyMutation(state(), {
      type: 'set_track_envelope_v2',
      trackId: 'track-1',
      envelope: ahdEnvelope,
      operationId: 'operation-1',
    });
    current = applyMutation(current, {
      type: 'set_track_sample_playback_mode_v2',
      trackId: 'track-1',
      mode: 'gate',
      operationId: 'operation-2',
    });
    current = applyMutation(current, {
      type: 'set_envelope_lock_v2',
      trackId: 'track-1',
      step: 3,
      stage: 'hold',
      duration: { value: 3, unit: 'steps' },
      operationId: 'operation-3',
    });

    expect(current.tracks[0].envelopeV2).toEqual(ahdEnvelope);
    expect(current.tracks[0].samplePlaybackMode).toBe('gate');
    expect(current.tracks[0].parameterLocks[3]).toEqual({
      holdDuration: { value: 3, unit: 'steps' },
    });
  });

  it('makes v2 set and clear authoritative over legacy A/D/R lock values', () => {
    const initial = state(track({
      parameterLocks: [{
        volume: .5,
        attack: .8,
        attackDuration: { value: 1, unit: 'steps' },
        decay: .4,
      }, ...Array(STEPS - 1).fill(null)],
    }));
    const set = applyMutation(initial, {
      type: 'set_envelope_lock_v2',
      trackId: 'track-1',
      step: 0,
      stage: 'attack',
      duration: { value: 3, unit: 'steps' },
      operationId: 'operation-set',
    });
    expect(set.tracks[0].parameterLocks[0]).toEqual({
      volume: .5,
      attackDuration: { value: 3, unit: 'steps' },
      decay: .4,
    });

    const cleared = applyMutation(set, {
      type: 'set_envelope_lock_v2',
      trackId: 'track-1',
      step: 0,
      stage: 'attack',
      duration: null,
      operationId: 'operation-clear',
    });
    expect(cleared.tracks[0].parameterLocks[0]).toEqual({ volume: .5, decay: .4 });

    const legacyOnly = state(track({
      parameterLocks: [{ release: 2 }, ...Array(STEPS - 1).fill(null)],
    }));
    expect(applyMutation(legacyOnly, {
      type: 'set_envelope_lock_v2',
      trackId: 'track-1',
      step: 0,
      stage: 'release',
      duration: null,
      operationId: 'operation-clear-legacy',
    }).tracks[0].parameterLocks[0]).toBeNull();
  });

  it('validates typed locks deeply and deterministically repairs persisted v2 values', () => {
    expect(validateParameterLock({
      pitch: 4,
      attackDuration: { value: 999, unit: 'steps' },
    })).toEqual({
      pitch: 4,
      attackDuration: { value: 48, unit: 'steps' },
    });

    const malformed = state(track({
      envelopeV2: {
        model: 'adsr',
        attack: { value: 99, unit: 'seconds' },
        decay: { value: 0.1, unit: 'seconds' },
        sustain: 3,
        release: { value: 0.2, unit: 'seconds' },
      },
      samplePlaybackMode: 'invalid',
    } as unknown as Partial<SessionTrack>));
    expect(validateSessionState(malformed).valid).toBe(false);
    expect(validateStateInvariants(malformed).valid).toBe(false);

    const repaired = repairStateInvariants(malformed).repairedState.tracks[0];
    expect(repaired.envelopeV2).toMatchObject({
      attack: { value: 4, unit: 'seconds' },
      sustain: 1,
    });
    expect(repaired.samplePlaybackMode).toBeUndefined();
    expect(validateStateInvariants(repairStateInvariants(malformed).repairedState).valid).toBe(true);
  });

  it('includes v2 authoring fields in canonical convergence hashes', () => {
    const base = state();
    const authored = state(track({ envelopeV2: ahdEnvelope, samplePlaybackMode: 'loop' }));
    const baseCanonical = canonicalizeForHash(base);
    const authoredCanonical = canonicalizeForHash(authored);

    expect(baseCanonical.tracks[0]).toMatchObject({ envelopeV2: null, samplePlaybackMode: null });
    expect(hashState(baseCanonical)).not.toBe(hashState(authoredCanonical));
  });

  it('projects the exact pre-v2 hash shape for rolling clients', () => {
    const canonical = canonicalizeForHash(state(track({
      envelopeV2: ahdEnvelope,
      samplePlaybackMode: 'loop',
      parameterLocks: [
        { attackDuration: { value: 2, unit: 'steps' } },
        ...Array(STEPS - 1).fill(null),
      ],
    })));
    const projected = projectCanonicalStateForEnvelopeV2Capability(canonical, false) as {
      tracks: Array<Record<string, unknown>>;
    };

    expect(projected.tracks[0]).not.toHaveProperty('envelopeV2');
    expect(projected.tracks[0]).not.toHaveProperty('samplePlaybackMode');
    expect((projected.tracks[0].parameterLocks as Array<object>)[0]).toEqual({
      attackDuration: { value: 2, unit: 'steps' },
    });
    expect(projectCanonicalStateForEnvelopeV2Capability(canonical, true)).toBe(canonical);
  });
});
