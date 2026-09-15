import { describe, expect, it } from 'vitest';
import { loudnessKMax, peakDbfs, rmsDb, spectralCentroidHz } from '../test/audio-measures';
import { requireOfflineAudio } from '../test/session-render';
import { SynthEngine, SYNTH_PRESETS } from './synth';

const SAMPLE_RATE = 44_100;

describe('Growl topology and calibration', () => {
  it('keeps the production canonical note finite, audible, moving, and below -3 dBFS', async () => {
    const { OfflineAudioContext } = await requireOfflineAudio();
    const context = new OfflineAudioContext(1, SAMPLE_RATE * 2, SAMPLE_RATE);
    const output = context.createGain();
    output.connect(context.destination);

    const engine = new SynthEngine();
    engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);
    engine.playNote(
      'growl-headroom',
      261.625565,
      SYNTH_PRESETS.growl,
      0.05,
      0.65,
      1,
      undefined,
      90,
    );

    const rendered = await context.startRendering();
    const pcm = new Float32Array(rendered.length);
    rendered.copyFromChannel(pcm, 0);

    const centroids = [0.1, 0.225, 0.35, 0.475, 0.6].map(start =>
      spectralCentroidHz(
        pcm.slice(Math.round(start * SAMPLE_RATE), Math.round((start + 0.08) * SAMPLE_RATE)),
        SAMPLE_RATE,
      ),
    );
    const sustainedCentroids = centroids.slice(2);
    const sustainedMotionRatio = Math.max(...sustainedCentroids) / Math.min(...sustainedCentroids);

    expect(pcm.every(Number.isFinite)).toBe(true);
    expect(peakDbfs(pcm)).toBeLessThanOrEqual(-3);
    expect(rmsDb(pcm)).toBeGreaterThan(-24);
    expect(loudnessKMax(pcm, SAMPLE_RATE)).toBeGreaterThan(-20);
    expect(centroids.every(Number.isFinite)).toBe(true);
    expect(sustainedMotionRatio).toBeGreaterThan(1.5);
  });
});
