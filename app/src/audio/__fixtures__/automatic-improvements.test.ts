import { describe, expect, it } from 'vitest';
import before from './automatic-improvements-before.json';
import after from './automatic-improvements-after.json';

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe('automatic audio improvements before/after receipt', () => {
  it('shrinks delivered starter-voice loudness spread from >10 dB to <=2 dB', () => {
    const ids = ['kick', 'bass', 'lead', 'pluck', 'pad'] as const;
    const beforeSpread = spread(ids.map(id => before.procedural[id].loudnessKMax));
    const afterSpread = spread(ids.map(id => after.procedural[id].loudnessKMax));
    expect(beforeSpread).toBeGreaterThan(10);
    expect(afterSpread).toBeLessThanOrEqual(2);
    expect(afterSpread).toBeLessThan(beforeSpread / 5);
  });

  it('moves supporting hats below the kick and adds deterministic timbral alternates', () => {
    const kick = after.procedural.kick.loudnessKMax;
    for (const id of ['hihat', 'openhat'] as const) {
      expect(kick - after.procedural[id].loudnessKMax).toBeGreaterThanOrEqual(6);
      expect(after.procedural[id].variationCount).toBe(4);
      expect(after.procedural[id].adjacentVariationCorrelation).toBeLessThan(0.995);
    }
    expect(after.procedural.snare.variationCount).toBe(4);
  });

  it('balances and animates every core synth preset', () => {
    const ids = ['bass', 'lead', 'pad', 'pluck'] as const;
    const beforeSpread = spread(ids.map(id => before.corePresets[id].loudnessKMax));
    const afterSpread = spread(ids.map(id => after.corePresets[id].loudnessKMax));
    expect(beforeSpread).toBeGreaterThan(7);
    expect(afterSpread).toBeLessThanOrEqual(3);
    for (const id of ids) {
      expect(after.corePresets[id].hasFilterEnvelope).toBe(true);
      expect(after.corePresets[id].hasSecondOscillator).toBe(true);
    }
    expect(after.corePresets.bass.earlyToLateCentroidRatio).toBeGreaterThan(1.2);
    expect(after.corePresets.lead.earlyToLateCentroidRatio).toBeGreaterThan(1.1);
    expect(after.corePresets.pad.earlyToLateCentroidRatio).toBeLessThan(0.85);
    expect(after.corePresets.pluck.earlyToLateCentroidRatio).toBeGreaterThan(1.2);
  });

  it('leaves normal programme at unity, catches the capacity canary, and ends releases at zero', () => {
    const afterMaster = after.master.real16TrackBrowser;
    expect(afterMaster.preCompressorPeakDbfs - afterMaster.postMakeupPeakDbfs).toBeGreaterThan(5);
    expect(afterMaster.heardOutputTruePeakDbfs).toBeLessThanOrEqual(0);
    expect(after.master.outputTrimDb).toBeGreaterThan(before.master.outputTrimDb);
    expect(Math.abs(after.master.browserCalibration.throughGainDb)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(after.master.browserCalibration.controlledHatDeltaDb)).toBeLessThan(2);
    expect(after.release.finalGainBeforeHardStop).toBe(0);
    expect(after.release.tailGuardSeconds).toBeGreaterThan(before.release.tailGuardSeconds);
  });
});
