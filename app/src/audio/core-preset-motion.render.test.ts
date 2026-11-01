import { describe, expect, it } from 'vitest';
import { loudnessKMax, peakDbfs, spectralCentroidHz } from '../test/audio-measures';
import { requireOfflineAudio } from '../test/session-render';
import { SynthEngine, SYNTH_PRESETS } from './synth';

const SAMPLE_RATE = 44_100;
const PRESETS = ['bass', 'lead', 'pad', 'pluck'] as const;

async function renderPreset(presetId: typeof PRESETS[number]): Promise<Float32Array> {
  const { OfflineAudioContext } = await requireOfflineAudio();
  const context = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * 1.5), SAMPLE_RATE);
  const output = context.createGain();
  output.connect(context.destination);
  const engine = new SynthEngine();
  engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);
  engine.playNote(
    `motion-${presetId}`,
    261.625565,
    SYNTH_PRESETS[presetId],
    0.05,
    0.65,
    1,
    undefined,
    90,
  );
  const rendered = await context.startRendering();
  const pcm = new Float32Array(rendered.length);
  rendered.copyFromChannel(pcm, 0);
  return pcm;
}

function centroid(pcm: Float32Array, start: number, end: number): number {
  return spectralCentroidHz(
    pcm.slice(Math.round(start * SAMPLE_RATE), Math.round(end * SAMPLE_RATE)),
    SAMPLE_RATE,
  );
}

describe('core preset movement and balance', () => {
  it('renders deliberate, bounded spectral trajectories from the production presets', async () => {
    const renders = Object.fromEntries(await Promise.all(PRESETS.map(async presetId => [
      presetId,
      await renderPreset(presetId),
    ]))) as Record<typeof PRESETS[number], Float32Array>;

    for (const presetId of PRESETS) {
      expect(SYNTH_PRESETS[presetId].filterEnv, presetId).toBeDefined();
      expect(SYNTH_PRESETS[presetId].osc2, presetId).toBeDefined();
      expect(peakDbfs(renders[presetId]), presetId).toBeLessThanOrEqual(0.05);
    }

    const bassRatio = centroid(renders.bass, 0.06, 0.16) / centroid(renders.bass, 0.5, 0.6);
    const leadRatio = centroid(renders.lead, 0.06, 0.16) / centroid(renders.lead, 0.5, 0.6);
    const padRatio = centroid(renders.pad, 0.06, 0.16) / centroid(renders.pad, 0.5, 0.6);
    const pluckRatio = centroid(renders.pluck, 0.06, 0.16) / centroid(renders.pluck, 0.5, 0.6);
    expect(bassRatio).toBeGreaterThan(1.2);
    expect(leadRatio).toBeGreaterThan(1.1);
    expect(padRatio).toBeLessThan(0.85);
    expect(pluckRatio).toBeGreaterThan(1.2);

    const loudness = PRESETS.map(presetId => loudnessKMax(renders[presetId], SAMPLE_RATE));
    expect(Math.max(...loudness) - Math.min(...loudness)).toBeLessThanOrEqual(3);
  });
});
