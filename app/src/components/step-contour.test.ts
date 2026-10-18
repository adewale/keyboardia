import { describe, expect, it } from 'vitest';
import { MAX_STEPS } from '../shared/constants';
import type { ParameterLock, Track } from '../types';
import { computeStepContours } from './step-contour';

function makeTrack(notes: Array<[number, ParameterLock | null]>, overrides: Partial<Track> = {}): Track {
  const steps = Array(MAX_STEPS).fill(false);
  const parameterLocks: (ParameterLock | null)[] = Array(MAX_STEPS).fill(null);
  for (const [step, lock] of notes) {
    steps[step] = true;
    parameterLocks[step] = lock;
  }
  return {
    id: 'lead',
    name: 'Lead',
    sampleId: 'synth:lead',
    steps,
    parameterLocks,
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

describe('computeStepContours', () => {
  it('returns one entry per step of the track length, null for inactive steps', () => {
    const contours = computeStepContours(makeTrack([[2, null]], { stepCount: 32 }));
    expect(contours).toHaveLength(32);
    expect(contours.filter(c => c !== null)).toHaveLength(1);
    expect(contours[0]).toBeNull();
  });

  it('maps each active pitch into the track min..max range', () => {
    const contours = computeStepContours(makeTrack([
      [0, { pitch: -5 }],
      [4, null],
      [8, { pitch: 7 }],
      [12, { pitch: 1 }],
    ]));
    // Range is -5..7 (12 semitones).
    expect(contours[0]).toEqual({ fraction: 0, tied: false });
    expect(contours[4]?.fraction).toBeCloseTo(5 / 12);
    expect(contours[8]).toEqual({ fraction: 1, tied: false });
    expect(contours[12]?.fraction).toBeCloseTo(0.5);
  });

  it('places every step at 0.5 when the track plays one pitch', () => {
    const contours = computeStepContours(makeTrack([[0, null], [3, null], [9, null]], { transpose: 5 }));
    expect([contours[0], contours[3], contours[9]]).toEqual([
      { fraction: 0.5, tied: false },
      { fraction: 0.5, tied: false },
      { fraction: 0.5, tied: false },
    ]);
  });

  it('gives a tied step the held note\'s pitch and flags it tied', () => {
    const contours = computeStepContours(makeTrack([
      [0, { pitch: 12 }],
      // Its own pitch lock is ignored: a tie sustains the note before it.
      [1, { tie: true, pitch: 0 }],
      [2, { tie: true }],
      [4, null],
    ]));
    expect(contours[0]).toEqual({ fraction: 1, tied: false });
    expect(contours[1]).toEqual({ fraction: 1, tied: true });
    expect(contours[2]).toEqual({ fraction: 1, tied: true });
    expect(contours[4]).toEqual({ fraction: 0, tied: false });
  });

  it('does not flag a tie that follows a rest, since it starts a new note', () => {
    const contours = computeStepContours(makeTrack([[0, null], [2, { tie: true, pitch: 3 }]]));
    expect(contours[2]).toEqual({ fraction: 1, tied: false });
  });

  it('ignores steps beyond the track length', () => {
    const contours = computeStepContours(makeTrack([[0, null], [20, { pitch: 24 }]], { stepCount: 16 }));
    expect(contours).toHaveLength(16);
    expect(contours[0]).toEqual({ fraction: 0.5, tied: false });
  });

  it('returns all nulls for an empty track', () => {
    expect(computeStepContours(makeTrack([])).every(c => c === null)).toBe(true);
  });
});
