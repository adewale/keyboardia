import { describe, expect, it } from 'vitest';
import { createInitialSessionState } from './session-defaults';

describe('createInitialSessionState', () => {
  it('constructs a complete default state when no fields are supplied', () => {
    expect(createInitialSessionState()).toEqual({ tracks: [], tempo: 120, swing: 0, version: 1 });
    expect(createInitialSessionState({ tracks: [] })).toEqual({ tracks: [], tempo: 120, swing: 0, version: 1 });
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
});
