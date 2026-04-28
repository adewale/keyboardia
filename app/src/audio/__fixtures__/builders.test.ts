/**
 * Sanity tests for the test data builders. The real fidelity guard is
 * the structural type — TypeScript will reject `aTrack` / `aState`
 * results that don't satisfy `Track` / `GridState`.
 *
 * These tests verify the convenience helpers produce the documented
 * shape (active-step toggling, p-lock placement, auto-id uniqueness).
 */
import { describe, it, expect } from 'vitest';
import {
  aTrack,
  aState,
  aTrackWithSteps,
  aTrackWithPLock,
  INVALID_PITCH_SEMITONES,
  BOUNDARY_PITCH_SEMITONES,
  SAMPLE_IDS_BY_TYPE,
} from './builders';

describe('aTrack', () => {
  it('returns a structurally valid Track with defaults', () => {
    const t = aTrack();
    expect(t.id).toMatch(/^track-/);
    expect(t.sampleId).toBe('808-kick');
    expect(t.steps).toHaveLength(16);
    expect(t.steps.every((s) => s === false)).toBe(true);
    expect(t.parameterLocks).toHaveLength(16);
    expect(t.volume).toBe(1);
    expect(t.transpose).toBe(0);
  });

  it('overrides win over defaults', () => {
    const t = aTrack({ id: 'A', sampleId: 'tone:fm-bass', volume: 0.5 });
    expect(t.id).toBe('A');
    expect(t.sampleId).toBe('tone:fm-bass');
    expect(t.volume).toBe(0.5);
  });

  it('auto-generates unique ids on successive calls', () => {
    const a = aTrack();
    const b = aTrack();
    expect(a.id).not.toBe(b.id);
  });
});

describe('aState', () => {
  it('returns a structurally valid GridState with empty tracks default', () => {
    const s = aState();
    expect(s.tracks).toEqual([]);
    expect(s.tempo).toBe(120);
    expect(s.isPlaying).toBe(false);
  });

  it('accepts tracks override', () => {
    const s = aState({ tracks: [aTrack({ id: 'A' })] });
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].id).toBe('A');
  });
});

describe('aTrackWithSteps', () => {
  it('turns on the requested step indices and leaves others off', () => {
    const t = aTrackWithSteps({ id: 'A', sampleId: '808-kick', activeSteps: [0, 4, 8, 12] });
    expect(t.steps[0]).toBe(true);
    expect(t.steps[1]).toBe(false);
    expect(t.steps[4]).toBe(true);
    expect(t.steps[12]).toBe(true);
  });

  it('ignores indices >= stepCount', () => {
    const t = aTrackWithSteps({ stepCount: 8, activeSteps: [0, 7, 100] });
    expect(t.steps).toHaveLength(8);
    expect(t.steps[0]).toBe(true);
    expect(t.steps[7]).toBe(true);
  });
});

describe('aTrackWithPLock', () => {
  it('places the p-lock at the requested step and leaves others null', () => {
    const t = aTrackWithPLock({ step: 3, pLock: { volume: 0.4 } });
    expect(t.parameterLocks[0]).toBeNull();
    expect(t.parameterLocks[3]).toEqual({ volume: 0.4 });
    expect(t.parameterLocks[15]).toBeNull();
  });
});

describe('invalid/boundary collections', () => {
  it('INVALID_PITCH_SEMITONES contains values outside [-24, 24]', () => {
    for (const v of INVALID_PITCH_SEMITONES) {
      if (Number.isFinite(v)) expect(Math.abs(v)).toBeGreaterThan(24);
    }
  });

  it('BOUNDARY_PITCH_SEMITONES brackets ±24 exactly', () => {
    expect(BOUNDARY_PITCH_SEMITONES).toContain(24);
    expect(BOUNDARY_PITCH_SEMITONES).toContain(-24);
    expect(BOUNDARY_PITCH_SEMITONES).toContain(25);
    expect(BOUNDARY_PITCH_SEMITONES).toContain(-25);
  });

  it('SAMPLE_IDS_BY_TYPE has one id per routing branch', () => {
    expect(Object.keys(SAMPLE_IDS_BY_TYPE).sort()).toEqual(
      ['advanced', 'sample', 'sampled', 'synth', 'tone'],
    );
  });
});
