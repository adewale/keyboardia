import * as Tone from 'tone';
import { ToneSynthManager } from '../src/audio/toneSynths';
import { resolveEnvelopeV2 } from '../src/shared/envelope-contract-v2';
import { resolvedEnvelopeV2ToToneSchedule } from '../src/audio/envelope-translate';

export interface ToneEnvelopeRenderMetrics {
  heldRms: number;
  earlyTailRms: number;
  afterReleaseRms: number;
}

function rms(pcm: Float32Array, sampleRate: number, from: number, to: number): number {
  const start = Math.floor(from * sampleRate);
  const end = Math.floor(to * sampleRate);
  let sum = 0;
  for (let index = start; index < end; index++) sum += pcm[index]! ** 2;
  return Math.sqrt(sum / Math.max(1, end - start));
}

/** Browser-only harness: real Tone adapter plus native OfflineAudioContext. */
export async function renderToneEnvelopeRelease(
  releaseSeconds: number,
): Promise<ToneEnvelopeRenderMetrics> {
  const sampleRate = 48_000;
  const raw = new OfflineAudioContext(1, sampleRate * 0.6, sampleRate);
  Tone.setContext(raw);
  const manager = new ToneSynthManager();
  await manager.initialize();
  manager.getOutput()?.toDestination();
  const resolved = resolveEnvelopeV2({
    model: 'adsr',
    attack: { value: 0.01, unit: 'seconds' },
    decay: { value: 0.02, unit: 'seconds' },
    sustain: 0.7,
    release: { value: releaseSeconds, unit: 'seconds' },
  }, 120);
  const schedule = resolvedEnvelopeV2ToToneSchedule(resolved, 0.1);
  manager.playNote('fm-bass', 'C4', schedule.duration, 0, 1, schedule.envelope);
  const rendered = await raw.startRendering();
  manager.dispose();
  const pcm = rendered.getChannelData(0);
  return {
    heldRms: rms(pcm, sampleRate, 0.06, 0.095),
    earlyTailRms: rms(pcm, sampleRate, 0.14, 0.22),
    afterReleaseRms: rms(
      pcm,
      sampleRate,
      releaseSeconds === 0 ? 0.14 : 0.44,
      releaseSeconds === 0 ? 0.22 : 0.52,
    ),
  };
}
