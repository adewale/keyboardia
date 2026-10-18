import { describe, expect, it } from 'vitest';
import { MAX_STEPS } from '../shared/constants';
import type { ParameterLock, Track } from '../types';
import {
  DEFAULT_VELOCITY,
  MIDI_MAX,
  MIDI_MIN,
  ROW_COUNT,
  ROW_H,
  computeBars,
  ghostBars,
  keyGeometry,
  noteName,
  rowClasses,
  snapToScale,
  velocityColor,
} from './piano-roll-bars';

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

describe('computeBars', () => {
  it('merges tied steps into one bar and starts a new bar on an untied step', () => {
    const track = makeTrack([
      [0, { pitch: 4 }],
      [1, { pitch: 4, tie: true }],
      [2, { pitch: 4, tie: true }],
      [3, { pitch: 4 }],
    ]);
    expect(computeBars(track)).toEqual([
      { start: 0, len: 3, midi: 64, vel: DEFAULT_VELOCITY },
      { start: 3, len: 1, midi: 64, vel: DEFAULT_VELOCITY },
    ]);
  });

  it('does not tie across a silent step', () => {
    const track = makeTrack([[0, null], [2, { tie: true }]]);
    expect(computeBars(track).map(b => [b.start, b.len])).toEqual([[0, 1], [2, 1]]);
  });

  it('combines transpose and pitch locks into the sounding MIDI note', () => {
    const track = makeTrack([[0, { pitch: 7 }], [4, null]], { transpose: -12 });
    expect(computeBars(track).map(b => b.midi)).toEqual([55, 48]);
  });

  it('takes velocity from the first step volume lock, defaulting to 0.8', () => {
    const track = makeTrack([[0, { volume: 0.3 }], [1, { volume: 1, tie: true }], [4, null]]);
    expect(computeBars(track).map(b => b.vel)).toEqual([0.3, 0.8]);
  });

  it('only reads steps inside the track length', () => {
    const track = makeTrack([[0, null], [20, null]], { stepCount: 16 });
    expect(computeBars(track)).toHaveLength(1);
  });
});

describe('ghostBars', () => {
  it('repeats a shorter track modulo its own length, clipping at the end', () => {
    const ghost = makeTrack([[0, null], [6, null], [7, { tie: true }]], { stepCount: 8 });
    const bars = ghostBars(ghost, 20);
    expect(bars.map(b => [b.start, b.len, b.pass])).toEqual([
      [0, 1, 0], [6, 2, 0],
      [8, 1, 1], [14, 2, 1],
      [16, 1, 2],
    ]);
  });
});

describe('scale and rows', () => {
  const cMajor = { root: 'C' as const, scaleId: 'major' as const, locked: true };

  it('snaps an out-of-scale pitch to the nearest in-scale pitch below first', () => {
    expect(snapToScale(61, cMajor)).toBe(60); // C# -> C
    expect(snapToScale(62, cMajor)).toBe(62);
    expect(snapToScale(61, { ...cMajor, locked: false })).toBe(61);
  });

  it('marks out-of-scale rows only while the scale is locked', () => {
    expect(rowClasses(61, 'synth:lead', cMajor)).toContain('scale-out');
    expect(rowClasses(61, 'synth:lead', { ...cMajor, locked: false })).not.toContain('scale-out');
    expect(rowClasses(60, 'synth:lead', cMajor)).toEqual(expect.arrayContaining(['white', 'c', 'root']));
    expect(rowClasses(67, 'synth:lead', cMajor)).toContain('fifth');
  });

  it('names notes with octaves', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(MIDI_MIN)).toBe('C2');
    expect(noteName(MIDI_MAX)).toBe('C6');
    expect(noteName(67)).toBe('G4');
  });

  it('mixes velocity between the dark base and the accent', () => {
    expect(velocityColor(0)).toBe('rgb(96, 40, 26)');
    expect(velocityColor(1)).toBe('rgb(232, 90, 48)');
    expect(velocityColor(2)).toBe('rgb(232, 90, 48)');
  });
});

describe('keyGeometry', () => {
  it('draws black keys one row tall on their own row', () => {
    expect(keyGeometry(61)).toEqual({ top: (MIDI_MAX - 61) * ROW_H, height: ROW_H });
  });

  it('draws C and E short (1.5 rows) and D long (2 rows)', () => {
    expect(keyGeometry(60).height).toBe(1.5 * ROW_H);
    expect(keyGeometry(64).height).toBe(1.5 * ROW_H);
    expect(keyGeometry(62).height).toBe(2 * ROW_H);
  });

  it('keeps every key inside the keyboard column', () => {
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      const { top, height } = keyGeometry(m);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + height).toBeLessThanOrEqual(ROW_COUNT * ROW_H);
    }
  });
});
