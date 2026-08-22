import { describe, expect, it } from 'vitest';
import { ENVELOPE_PCM_TOLERANCES } from '../test/envelope-pcm-manifest';
import { comparePcmMetrics, measurePcm } from '../test/pcm-metrics';

function sine(frequency: number, gain = 0.5): Float32Array {
  return Float32Array.from({ length: 4096 }, (_, index) => (
    Math.sin(2 * Math.PI * frequency * index / 48_000) * gain
  ));
}

describe('PCM migration metrics', () => {
  it('reports identical deterministic renders as zero delta', () => {
    const samples = sine(440);
    const metrics = measurePcm(samples, 48_000, 0.04);
    expect(comparePcmMetrics(metrics, metrics)).toEqual({
      peakDeltaDb: 0,
      rmsDeltaDb: 0,
      tailDeltaDb: 0,
      spectralCentroidRatio: 0,
      newClippingSamples: 0,
    });
  });

  it('detects a deliberately perturbed renderer beyond the approval tolerances', () => {
    const baseline = measurePcm(sine(440, 0.4), 48_000, 0.04);
    const candidate = measurePcm(sine(880, 0.8), 48_000, 0.04);
    const delta = comparePcmMetrics(baseline, candidate);
    expect(delta.peakDeltaDb).toBeGreaterThan(ENVELOPE_PCM_TOLERANCES.peakDeltaDb);
    expect(delta.rmsDeltaDb).toBeGreaterThan(ENVELOPE_PCM_TOLERANCES.rmsDeltaDb);
    expect(delta.spectralCentroidRatio).toBeGreaterThan(
      ENVELOPE_PCM_TOLERANCES.medianSpectralCentroidRatio,
    );
  });

  it('counts only samples above full scale as clipping', () => {
    expect(measurePcm(new Float32Array([0, 1, -1, 1.01, -1.2]), 48_000, 0).clippingSamples)
      .toBe(2);
  });
});
