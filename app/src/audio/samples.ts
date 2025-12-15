import type { Sample } from '../types';

// Generate synthesized one-shot sounds using Web Audio API
// Only drums and FX - melodic sounds (bass, lead, pad, etc.) are now synth presets

export async function createSynthesizedSamples(
  audioContext: AudioContext
): Promise<Map<string, Sample>> {
  const samples = new Map<string, Sample>();

  // === DRUMS ===
  samples.set('kick', {
    id: 'kick',
    name: 'Kick',
    buffer: await createKick(audioContext),
    url: '',
  });

  samples.set('snare', {
    id: 'snare',
    name: 'Snare',
    buffer: await createSnare(audioContext),
    url: '',
  });

  samples.set('hihat', {
    id: 'hihat',
    name: 'Hi-Hat',
    buffer: await createHiHat(audioContext),
    url: '',
  });

  samples.set('clap', {
    id: 'clap',
    name: 'Clap',
    buffer: await createClap(audioContext),
    url: '',
  });

  samples.set('tom', {
    id: 'tom',
    name: 'Tom',
    buffer: await createTom(audioContext),
    url: '',
  });

  samples.set('rim', {
    id: 'rim',
    name: 'Rim',
    buffer: await createRim(audioContext),
    url: '',
  });

  samples.set('cowbell', {
    id: 'cowbell',
    name: 'Cowbell',
    buffer: await createCowbell(audioContext),
    url: '',
  });

  samples.set('openhat', {
    id: 'openhat',
    name: 'Open Hat',
    buffer: await createOpenHat(audioContext),
    url: '',
  });

  // === FX ===
  samples.set('zap', {
    id: 'zap',
    name: 'Zap',
    buffer: await createZap(audioContext),
    url: '',
  });

  samples.set('noise', {
    id: 'noise',
    name: 'Noise',
    buffer: await createNoiseHit(audioContext),
    url: '',
  });

  return samples;
}

async function createKick(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.5;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Frequency drops from 150Hz to 40Hz
    const freq = 150 * Math.exp(-t * 10) + 40;
    // Amplitude envelope
    const amp = Math.exp(-t * 8);
    data[i] = Math.sin(2 * Math.PI * freq * t) * amp;
  }

  return buffer;
}

async function createSnare(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.3;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Mix of noise and tone
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 15);
    const tone = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 20);
    data[i] = noise * 0.7 + tone * 0.3;
  }

  return buffer;
}

async function createHiHat(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.1;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // High-frequency noise with fast decay
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 40);
    data[i] = noise * 0.85;
  }

  return buffer;
}

async function createClap(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.3;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Multiple noise bursts
    let amp = 0;
    // Initial burst
    if (t < 0.02) amp = Math.exp(-t * 100);
    // Second burst
    else if (t < 0.04) amp = Math.exp(-(t - 0.02) * 100) * 0.8;
    // Third burst
    else if (t < 0.06) amp = Math.exp(-(t - 0.04) * 100) * 0.6;
    // Tail
    else amp = Math.exp(-(t - 0.06) * 20) * 0.4;

    data[i] = (Math.random() * 2 - 1) * amp;
  }

  return buffer;
}

// === Additional Drums ===

async function createTom(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.4;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Frequency drops from 200Hz to 80Hz
    const freq = 200 * Math.exp(-t * 8) + 80;
    const amp = Math.exp(-t * 6);
    data[i] = Math.sin(2 * Math.PI * freq * t) * amp * 0.95;
  }

  return buffer;
}

async function createRim(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.1;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // High pitched click with fast decay
    const tone1 = Math.sin(2 * Math.PI * 1200 * t);
    const tone2 = Math.sin(2 * Math.PI * 800 * t);
    const amp = Math.exp(-t * 80);
    data[i] = (tone1 * 0.5 + tone2 * 0.5) * amp;
  }

  return buffer;
}

async function createCowbell(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.3;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Two inharmonic frequencies (classic cowbell recipe)
    const tone1 = Math.sin(2 * Math.PI * 562 * t);
    const tone2 = Math.sin(2 * Math.PI * 845 * t);
    const amp = Math.exp(-t * 12);
    data[i] = (tone1 * 0.6 + tone2 * 0.4) * amp * 0.9;
  }

  return buffer;
}

async function createOpenHat(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.4;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Longer noise with slower decay than closed hat
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 8);
    // Add some metallic tones
    const metallic = Math.sin(2 * Math.PI * 4000 * t) * 0.15 * Math.exp(-t * 15);
    data[i] = (noise * 0.7 + metallic);
  }

  return buffer;
}

// === FX ===

async function createZap(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.2;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Frequency sweeps down rapidly
    const freq = 2000 * Math.exp(-t * 30) + 100;
    const amp = Math.exp(-t * 15);
    data[i] = Math.sin(2 * Math.PI * freq * t) * amp * 0.85;
  }

  return buffer;
}

async function createNoiseHit(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.3;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // White noise with envelope
    const amp = Math.exp(-t * 10);
    data[i] = (Math.random() * 2 - 1) * amp * 0.8;
  }

  return buffer;
}
