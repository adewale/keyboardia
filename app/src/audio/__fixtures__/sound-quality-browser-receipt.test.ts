import { describe, expect, it } from 'vitest';
import receipt from './sound-quality-browser-receipt.json';

describe('browser sound-quality receipt', () => {
  it('records passing PCM evidence rather than configuration assertions', () => {
    const { metrics, budgets } = receipt;
    expect(receipt.lane).toBe('playwright-chromium-real-audio');
    expect(metrics.processorLatencyMs).toBe(6);
    expect(Math.abs(metrics.throughGainDb)).toBeLessThanOrEqual(budgets.throughGainAbsoluteDb);
    expect(metrics.postPileupMaxAttenuationDb)
      .toBeLessThanOrEqual(budgets.postPileupMaxAttenuationDb);
    expect(Math.abs(metrics.controlledHatDeltaDb))
      .toBeLessThanOrEqual(budgets.controlledHatAbsoluteDeltaDb);
    expect(metrics.sameBuildRepeatNullResidualDb)
      .toBeLessThanOrEqual(budgets.sameBuildRepeatNullResidualDb);
    expect(metrics.maxRenderFrameDrift * 1000 / receipt.sampleRate)
      .toBeLessThanOrEqual(budgets.maxRenderFrameDriftMs);
    expect(metrics.capacityTrackCount).toBe(16);
    expect(metrics.capacityHeardOutputPeakDbfs)
      .toBeLessThanOrEqual(budgets.capacityHeardOutputPeakDbfs);
    expect(metrics.capacityHeardOutputTruePeakDbfs)
      .toBeLessThanOrEqual(budgets.capacityHeardOutputTruePeakDbfs);
    expect(metrics.masterOutputTrimDb).toBe(-1);
    expect(metrics.recoveryMonotonic).toBe(true);
  });
});
