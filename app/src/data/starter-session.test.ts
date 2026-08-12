import { describe, expect, it } from 'vitest';
import { VALID_SAMPLE_IDS } from '../shared/instrument-catalog';
import { createInitialSessionState } from '../shared/session-defaults';
import { createStarterSessionState } from './starter-session';

describe('starter session', () => {
  it('is explicit, replayable, catalogue-valid, and does not change empty-session defaults', () => {
    const starter = createStarterSessionState();
    expect(starter.tempo).toBe(96);
    expect(starter.swing).toBe(16);
    expect(starter.effects).toEqual(createInitialSessionState().effects);
    expect(starter.tracks).toHaveLength(5);
    expect(starter.tracks.every(track => VALID_SAMPLE_IDS.has(track.sampleId))).toBe(true);
    expect(starter.tracks.every(track => track.steps.length === 16 && track.parameterLocks.length === 16)).toBe(true);
    expect(createInitialSessionState()).toMatchObject({ tracks: [], tempo: 120, swing: 0 });
  });

  it('returns independent state rather than a mutable singleton', () => {
    const first = createStarterSessionState();
    const second = createStarterSessionState();
    first.tracks[0].steps[0] = false;
    expect(second.tracks[0].steps[0]).toBe(true);
  });
});
