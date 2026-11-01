import { createSynthesizedSamples, selectSampleBuffer } from '../audio/samples';
import { getStepDuration } from '../audio/timing-calculations';
import { mulberry32 } from './seeded-random';

export interface ProceduralHit {
  sampleId: string;
  step: number;
  gain?: number;
  /** Canonical normalized pan used only when native panning is requested. */
  pan?: number;
  /** Stable key selecting a procedural timbral alternate. */
  variationKey?: string;
}

export interface RenderedPcm {
  sampleRate: number;
  channels: Float32Array[];
  length: number;
  duration: number;
}

type OfflineAudioModule = typeof import('node-web-audio-api');

/** Explicit capability check: callers fail instead of silently skipping. */
export async function requireOfflineAudio(): Promise<OfflineAudioModule> {
  try {
    return await import('node-web-audio-api');
  } catch (error) {
    throw new Error(
      'The required offline audio lane could not load node-web-audio-api. '
      + 'Install the pinned dependency and run with Node 22 or newer.',
      { cause: error },
    );
  }
}

export function copyRenderedChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) => {
    const copy = new Float32Array(buffer.length);
    buffer.copyFromChannel(copy, channel);
    return copy;
  });
}

/**
 * Deterministic, Tone-free procedural component renderer.
 * Timing uses the production step-duration calculation.
 */
export async function renderProceduralPattern(options: {
  hits: readonly ProceduralHit[];
  tempo?: number;
  seconds?: number;
  sampleRate?: number;
  seed?: number;
  channels?: number;
  /** Route each hit through a real native StereoPannerNode. */
  useNativePanner?: boolean;
  /** Duplicate mono fixtures to stereo so a center panner has a true pre-pan reference. */
  stereoizeMonoSources?: boolean;
}): Promise<RenderedPcm> {
  const webAudio = await requireOfflineAudio();
  const sampleRate = options.sampleRate ?? 44_100;
  const tempo = options.tempo ?? 120;
  const channels = options.channels ?? 2;
  const stepDuration = getStepDuration(tempo);
  const lastStep = Math.max(0, ...options.hits.map(hit => hit.step));
  const seconds = options.seconds ?? (lastStep + 1) * stepDuration + 1;
  const length = Math.ceil(seconds * sampleRate);
  const context = new webAudio.OfflineAudioContext(channels, length, sampleRate);
  const input = context.createGain();
  input.connect(context.destination);
  const samples = await createSynthesizedSamples(
    context as unknown as AudioContext,
    mulberry32(options.seed ?? 0x43_0001),
  );

  for (const hit of options.hits) {
    const sample = samples.get(hit.sampleId);
    if (!sample?.buffer) {
      throw new Error(`Unknown or unloaded procedural sample in render fixture: ${hit.sampleId}`);
    }
    const buffer = selectSampleBuffer(sample, hit.variationKey);
    if (!buffer) throw new Error(`Procedural sample has no decoded buffer: ${hit.sampleId}`);
    const source = context.createBufferSource();
    const gain = context.createGain();
    if (options.stereoizeMonoSources && buffer.numberOfChannels === 1) {
      const stereo = context.createBuffer(2, buffer.length, buffer.sampleRate);
      const mono = buffer.getChannelData(0);
      stereo.copyToChannel(mono, 0);
      stereo.copyToChannel(mono, 1);
      source.buffer = stereo;
    } else {
      source.buffer = buffer;
    }
    gain.gain.value = (hit.gain ?? 1) * (sample.playbackGain ?? 1);
    source.connect(gain);
    if (options.useNativePanner) {
      const panner = context.createStereoPanner();
      panner.pan.setValueAtTime(hit.pan ?? 0, 0);
      gain.connect(panner);
      panner.connect(input);
    } else {
      gain.connect(input);
    }
    source.start(hit.step * stepDuration);
  }

  const rendered = await context.startRendering();
  return {
    sampleRate,
    channels: copyRenderedChannels(rendered as unknown as AudioBuffer),
    length: rendered.length,
    duration: rendered.duration,
  };
}
