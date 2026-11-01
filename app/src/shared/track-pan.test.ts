import { describe, expect, it } from 'vitest';
import {
  formatPanNotation,
  normalizedPanToPercent,
  panPercentToNormalized,
  parsePanNotation,
  recommendedTrackPan,
} from './track-pan';

describe('pan boundary conversions', () => {
  it('round-trips notation percent without sending percent to the engine', () => {
    expect(parsePanNotation('[pan:-20]')).toBe(-0.2);
    expect(panPercentToNormalized(-20)).toBe(-0.2);
    expect(normalizedPanToPercent(-0.2)).toBe(-20);
    expect(formatPanNotation(-0.2)).toBe('[pan:-20]');
    expect(formatPanNotation(0.35)).toBe('[pan:+35]');
  });

  it.each([NaN, Infinity, -101, 101])('rejects invalid public percent %s', (value) => {
    expect(() => panPercentToNormalized(value)).toThrow(RangeError);
  });

  it('spreads known mono sources while keeping anchors and unanalysed audio centered', () => {
    expect([0, 1, 2, 3].map((index) => recommendedTrackPan('snare', index)))
      .toEqual([-0.08, 0.08, -0.12, 0.12]);
    expect(recommendedTrackPan('sampled:acoustic-kick', 3)).toBe(0);
    expect(recommendedTrackPan('sampled:finger-bass', 4)).toBe(0);
    expect(recommendedTrackPan('sampled:acoustic-snare', 5)).toBe(0);
    expect(recommendedTrackPan('recording-123', 6)).toBe(0);
    expect(recommendedTrackPan('slice-123-0', 7)).toBe(0);
    expect(recommendedTrackPan('advanced:sub-bass', 5)).toBe(0);
  });
});
