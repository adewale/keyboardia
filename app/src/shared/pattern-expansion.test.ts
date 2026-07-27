import { describe, expect, it } from 'vitest';
import {
  PatternExpansionError,
  activeStepCount,
  boundedPatternLength,
  hasActiveSteps,
  planPatternExpansion,
} from './pattern-expansion';

describe('pattern expansion invariants', () => {
  it('ignores stored steps beyond the active loop', () => {
    const track = { stepCount: 4, steps: [false, false, false, false, true] };
    expect(hasActiveSteps(track)).toBe(false);
    expect(activeStepCount(track)).toBe(0);
  });

  it('computes ordinary polyrhythms exactly', () => {
    expect(boundedPatternLength([12, 16])).toBe(48);
  });

  it('rejects a pathological LCM before expanding it', () => {
    expect(() => boundedPatternLength([128, 27, 5, 7, 11, 13]))
      .toThrow(PatternExpansionError);
  });

  it('rejects excessive event counts independently of pattern length', () => {
    const dense = { stepCount: 16, steps: Array(16).fill(true) };
    expect(() => planPatternExpansion([dense, dense], { maxNoteEvents: 31 }))
      .toThrow(/31 note events/);
  });
});
