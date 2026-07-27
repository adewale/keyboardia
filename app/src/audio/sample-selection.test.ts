import { describe, it, expect } from 'vitest';
import {
  nearestSampleNote,
  selectRoundRobinVariant,
  selectVelocityGroupBlend,
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

describe('velocity crossfades and round robins', () => {
  const layers = [
    { velocityMin: 0, velocityMax: 63, file: 'soft' },
    { velocityMin: 64, velocityMax: 127, file: 'loud' },
  ];

  it('returns one layer outside a crossfade and normalized weights inside it', () => {
    expect(selectVelocityGroupBlend(layers, 20, 8)).toEqual([{ layers: [layers[0]], weight: 1 }]);
    const blend = selectVelocityGroupBlend(layers, 64, 8);
    expect(blend.flatMap(item => item.layers.map(layer => layer.file))).toEqual(['soft', 'loud']);
    expect(blend[0].weight + blend[1].weight).toBeCloseTo(1, 12);
    expect(blend[0].weight).toBeGreaterThan(0);
    expect(blend[1].weight).toBeGreaterThan(0);
  });

  it('selects round robins deterministically by declared index', () => {
    const variants = [
      { ...layers[0], file: 'rr2', roundRobinIndex: 2 },
      { ...layers[0], file: 'rr0', roundRobinIndex: 0 },
      { ...layers[0], file: 'rr1', roundRobinIndex: 1 },
    ];
    expect([0, 1, 2, 3].map(cursor => selectRoundRobinVariant(variants, cursor)?.file))
      .toEqual(['rr0', 'rr1', 'rr2', 'rr0']);
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

  it('clamps malformed runtime gain to the manifest ±24 dB contract', () => {
    expect(dbToGain(200)).toBeCloseTo(dbToGain(24), 12);
    expect(dbToGain(-200)).toBeCloseTo(dbToGain(-24), 12);
  });
});
