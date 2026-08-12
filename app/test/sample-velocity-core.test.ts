import { describe, expect, it } from 'vitest';
import { findVelocityRmsInversions } from '../scripts/sample-velocity-core';

describe('velocity-layer RMS comparison', () => {
  it('averages round robins within a velocity range instead of treating takes as layers', () => {
    const inversions = findVelocityRmsInversions([
      { file: 'soft-a', note: 60, velocityMin: 0, velocityMax: 63, activeRmsDb: -30 },
      { file: 'soft-b', note: 60, velocityMin: 0, velocityMax: 63, activeRmsDb: -24 },
      { file: 'loud-a', note: 60, velocityMin: 64, velocityMax: 127, activeRmsDb: -20 },
      { file: 'loud-b', note: 60, velocityMin: 64, velocityMax: 127, activeRmsDb: -22 },
    ], 1);

    expect(inversions).toEqual([]);
  });

  it('reports one inversion between distinct aggregated velocity ranges', () => {
    const inversions = findVelocityRmsInversions([
      { file: 'soft-a', note: 60, velocityMin: 0, velocityMax: 63, activeRmsDb: -20 },
      { file: 'soft-b', note: 60, velocityMin: 0, velocityMax: 63, activeRmsDb: -22 },
      { file: 'loud-a', note: 60, velocityMin: 64, velocityMax: 127, activeRmsDb: -25 },
      { file: 'loud-b', note: 60, velocityMin: 64, velocityMax: 127, activeRmsDb: -27 },
    ], 1);

    expect(inversions).toHaveLength(1);
    expect(inversions[0]).toMatchObject({ deltaDb: -5, lower: { meanActiveRmsDb: -21 }, higher: { meanActiveRmsDb: -26 } });
  });
});
