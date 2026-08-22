import { describe, expect, it } from 'vitest';
import { createInitialSessionState } from './session-defaults';
import {
  DEFAULT_EFFECTS_STATE,
  LEGACY_MISSING_EFFECTS_STATE,
  NEW_SESSION_EFFECTS_STATE,
  normalizeSessionEffects,
} from './effects-defaults';
import { DEFAULT_NEW_SESSION_SCALE_STATE } from './scale-defaults';

const DEFAULT_STATE = {
  tracks: [],
  tempo: 120,
  swing: 0,
  effects: NEW_SESSION_EFFECTS_STATE,
  scale: DEFAULT_NEW_SESSION_SCALE_STATE,
  version: 1,
};

describe('createInitialSessionState', () => {
  it('constructs a complete default state when no fields are supplied', () => {
    expect(createInitialSessionState()).toEqual(DEFAULT_STATE);
    expect(createInitialSessionState({ tracks: [] })).toEqual(DEFAULT_STATE);
    expect(createInitialSessionState({ tracks: undefined, effects: undefined })).toEqual(DEFAULT_STATE);
  });

  it('preserves complete extended state while enforcing the current version', () => {
    const effects = {
      bypass: false,
      reverb: { decay: 2, wet: 0.2 },
      delay: { time: '8n', feedback: 0.3, wet: 0.1 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0.25 },
      distortion: { amount: 0.4, wet: 0.05 },
    } as const;
    const scale = { root: 'D', scaleId: 'natural-minor', locked: true } as const;

    expect(createInitialSessionState({ tracks: [], tempo: 123, swing: 7, effects, scale, version: 99 })).toEqual({
      tracks: [], tempo: 123, swing: 7, effects, scale, version: 1,
    });
  });

  it('returns detached new-session effects so callers cannot mutate the default', () => {
    const first = createInitialSessionState();
    const second = createInitialSessionState();

    first.effects!.reverb.wet = 0.9;

    expect(second.effects).toEqual(NEW_SESSION_EFFECTS_STATE);
    expect(second.effects).not.toBe(NEW_SESSION_EFFECTS_STATE);
    expect(second.effects!.reverb).not.toBe(NEW_SESSION_EFFECTS_STATE.reverb);
  });
});

describe('missing-effects policies (Phase 44 Change 3)', () => {
  it('gives new sessions the default room while legacy sessions stay exactly dry', () => {
    // The room lives only in the new-session policy: the shared baseline the
    // UI and audio chain initialize from before a session loads stays dry.
    expect(DEFAULT_EFFECTS_STATE.reverb.wet).toBe(0);
    expect(NEW_SESSION_EFFECTS_STATE.reverb.wet).toBe(0.15);
    expect(LEGACY_MISSING_EFFECTS_STATE.reverb.wet).toBe(0);
    expect(normalizeSessionEffects(undefined, 'new-session').reverb.wet).toBe(0.15);
    // The legacy guard: a stored session that never wrote effects must keep
    // rendering dry, or the change reinterprets saved music.
    expect(normalizeSessionEffects(undefined, 'legacy-session')).toEqual(
      LEGACY_MISSING_EFFECTS_STATE,
    );
    // Stored values always win over either fallback.
    const stored = normalizeSessionEffects(
      { ...DEFAULT_EFFECTS_STATE, reverb: { decay: 4, wet: 0.6 } },
      'legacy-session',
    );
    expect(stored.reverb).toEqual({ decay: 4, wet: 0.6 });
  });
});
