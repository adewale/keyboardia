import { describe, expect, it } from 'vitest';
import { SynthEngine, SYNTH_PRESETS } from './synth';

const webAudio = await import('node-web-audio-api').catch(() => null);
const SAMPLE_RATE = 44_100;

function rms(data: Float32Array, startSeconds: number, endSeconds: number): number {
  const start = Math.floor(startSeconds * SAMPLE_RATE);
  const end = Math.min(data.length, Math.floor(endSeconds * SAMPLE_RATE));
  let sumSquares = 0;
  for (let i = start; i < end; i++) sumSquares += data[i] * data[i];
  return Math.sqrt(sumSquares / Math.max(1, end - start));
}

describe.skipIf(!webAudio)('native synth envelope — offline PCM regression', () => {
  it('keeps audible energy after note-off and decays through the configured release', async () => {
    const { OfflineAudioContext } = webAudio!;
    const context = new OfflineAudioContext(1, SAMPLE_RATE * 2, SAMPLE_RATE);
    const output = context.createGain();
    output.connect(context.destination);

    const engine = new SynthEngine();
    engine.initialize(context as unknown as AudioContext, output as unknown as GainNode);

    const start = 0.05;
    const duration = 0.1125;
    engine.playNote(
      'release-regression',
      261.625565,
      SYNTH_PRESETS.pad,
      start,
      duration,
      1,
    );

    const rendered = await context.startRendering();
    const channel = rendered.getChannelData(0);
    const earlyTail = rms(channel, 0.20, 0.35);
    const lateTail = rms(channel, 0.75, 0.90);

    // Before the fix, future stop() cancelled the decay ramp and anchored the
    // release from AudioParam.value (near zero), making earlyTail ~0.00005.
    expect(earlyTail).toBeGreaterThan(0.03);
    expect(lateTail).toBeGreaterThan(0.001);
    expect(lateTail).toBeLessThan(earlyTail);
  });
});
