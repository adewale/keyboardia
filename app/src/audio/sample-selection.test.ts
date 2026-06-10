import { describe, it, expect } from 'vitest';
import {
  nearestSampleNote,
  selectVelocityLayer,
  validatedLoop,
  dbToGain,
} from './sample-selection';

describe('nearestSampleNote', () => {
  it('returns the exact note when sampled', () => {
    expect(nearestSampleNote([36, 48, 60, 72], 60)).toBe(60);
  });

  it('returns the closest note otherwise', () => {
    expect(nearestSampleNote([36, 48, 60, 72], 62)).toBe(60);
    expect(nearestSampleNote([36, 48, 60, 72], 67)).toBe(72);
  });

  it('prefers the HIGHER sample on ties (downward shifts sound better)', () => {
    // 54 is exactly 6 semitones from both 48 and 60.
    expect(nearestSampleNote([48, 60], 54)).toBe(60);
    // 60 is exactly 12 from both 48 and 72.
    expect(nearestSampleNote([48, 72], 60)).toBe(72);
  });

  it('returns undefined for an empty list', () => {
    expect(nearestSampleNote([], 60)).toBeUndefined();
  });
});

describe('selectVelocityLayer', () => {
  const layers = [
    { velocityMin: 0, velocityMax: 50, file: 'pp' },
    { velocityMin: 51, velocityMax: 100, file: 'mf' },
    { velocityMin: 101, velocityMax: 127, file: 'ff' },
  ];

  it('selects the layer whose range contains the velocity', () => {
    expect(selectVelocityLayer(layers, 30)?.file).toBe('pp');
    expect(selectVelocityLayer(layers, 51)?.file).toBe('mf');
    expect(selectVelocityLayer(layers, 100)?.file).toBe('mf');
    expect(selectVelocityLayer(layers, 127)?.file).toBe('ff');
  });

  it('falls back to the nearest layer midpoint when no range matches', () => {
    const gappy = [
      { velocityMin: 0, velocityMax: 30, file: 'low' },
      { velocityMin: 90, velocityMax: 127, file: 'high' },
    ];
    expect(selectVelocityLayer(gappy, 40)?.file).toBe('low');
    expect(selectVelocityLayer(gappy, 80)?.file).toBe('high');
  });

  it('returns the single layer regardless of velocity', () => {
    const single = [{ velocityMin: 0, velocityMax: 127, file: 'only' }];
    expect(selectVelocityLayer(single, 0)?.file).toBe('only');
    expect(selectVelocityLayer(single, 127)?.file).toBe('only');
  });

  it('returns undefined for an empty list', () => {
    expect(selectVelocityLayer([], 64)).toBeUndefined();
  });
});

describe('validatedLoop', () => {
  it('returns null when looping is not requested', () => {
    expect(validatedLoop({})).toBeNull();
    expect(validatedLoop({ loopStart: 1 })).toBeNull();
  });

  it('returns a loop spec when loop: true', () => {
    expect(validatedLoop({ loop: true, loopStart: 0.8, loopEnd: 3.2 })).toEqual({
      start: 0.8,
      end: 3.2,
    });
  });

  it('defaults start to 0 and leaves end open (= buffer end)', () => {
    expect(validatedLoop({ loop: true })).toEqual({ start: 0 });
  });

  it('rejects inverted or degenerate regions', () => {
    expect(validatedLoop({ loop: true, loopStart: 2, loopEnd: 1 })).toBeNull();
    expect(validatedLoop({ loop: true, loopStart: 2, loopEnd: 2 })).toBeNull();
  });

  it('rejects non-finite or negative bounds', () => {
    expect(validatedLoop({ loop: true, loopStart: -1 })).toBeNull();
    expect(validatedLoop({ loop: true, loopStart: NaN })).toBeNull();
    expect(validatedLoop({ loop: true, loopEnd: Infinity })).toBeNull();
  });
});

describe('dbToGain', () => {
  it('is identity at 0 dB', () => {
    expect(dbToGain(0)).toBe(1);
  });

  it('matches the 20·log10 convention', () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
    expect(dbToGain(6)).toBeCloseTo(1.995, 2);
  });

  it('is total: non-finite input is treated as 0 dB', () => {
    expect(dbToGain(NaN)).toBe(1);
    expect(dbToGain(Infinity)).toBe(1);
  });
});
