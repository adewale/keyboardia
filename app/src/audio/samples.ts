import type { Sample } from '../types';
import { PROCEDURAL_SOURCE_GAIN_DB } from './source-calibration';

const PROCEDURAL_VARIATION_COUNT = 4;

/**
 * Source-side balance for the legacy procedural palette. Track faders remain
 * at unity so session state keeps its existing meaning; these values make the
 * voices arrive at that fader in a deliberate mix rather than at arbitrary
 * generator amplitudes.
 */
export const PROCEDURAL_SAMPLE_GAIN_DB: Readonly<Record<string, number>> = PROCEDURAL_SOURCE_GAIN_DB;

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

function stableVariationHash(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Select the same alternate for the same scheduled note on every replay. */
export function selectSampleBuffer(sample: Sample, variationKey?: string): AudioBuffer | null {
  const variations = sample.variations;
  if (!variationKey || !variations || variations.length === 0) return sample.buffer;
  return variations[stableVariationHash(variationKey) % variations.length] ?? sample.buffer;
}

async function createVariations(
  factory: () => Promise<AudioBuffer>,
): Promise<readonly AudioBuffer[]> {
  const variations: AudioBuffer[] = [];
  for (let index = 0; index < PROCEDURAL_VARIATION_COUNT; index++) {
    variations.push(await factory());
  }
  return variations;
}

/** Preserve the voice's designed balance, reducing gain only when it clips. */
function limitMeasuredPeak(data: Float32Array): void {
  let peak = 0;
  for (const sample of data) peak = Math.max(peak, Math.abs(sample));
  if (peak <= 1) return;
  const gain = 1 / peak;
  for (let index = 0; index < data.length; index++) data[index] *= gain;
}

// Generate synthesized sounds using Web Audio API
// Covers drums, bass, synths, and FX - all procedurally generated

export async function createSynthesizedSamples(
  audioContext: AudioContext,
  rng: () => number = Math.random,
): Promise<Map<string, Sample>> {
  const samples = new Map<string, Sample>();

  const snareVariations = await createVariations(() => createSnare(audioContext, rng));
  const hihatVariations = await createVariations(() => createHiHat(audioContext, rng));
  const openHatVariations = await createVariations(() => createOpenHat(audioContext, rng));

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
    buffer: snareVariations[0],
    variations: snareVariations,
    url: '',
  });

  samples.set('hihat', {
    id: 'hihat',
    name: 'Hi-Hat',
    buffer: hihatVariations[0],
    variations: hihatVariations,
    url: '',
  });

  samples.set('clap', {
    id: 'clap',
    name: 'Clap',
    buffer: await createClap(audioContext, rng),
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
    buffer: openHatVariations[0],
    variations: openHatVariations,
    url: '',
  });

  // === WORLD/LATIN PERCUSSION ===
  samples.set('shaker', {
    id: 'shaker',
    name: 'Shaker',
    buffer: await createShaker(audioContext, rng),
    url: '',
  });

  samples.set('conga', {
    id: 'conga',
    name: 'Conga',
    buffer: await createConga(audioContext, rng),
    url: '',
  });

  samples.set('tambourine', {
    id: 'tambourine',
    name: 'Tambourine',
    buffer: await createTambourine(audioContext, rng),
    url: '',
  });

  samples.set('clave', {
    id: 'clave',
    name: 'Clave',
    buffer: await createClave(audioContext),
    url: '',
  });

  samples.set('cabasa', {
    id: 'cabasa',
    name: 'Cabasa',
    buffer: await createCabasa(audioContext, rng),
    url: '',
  });

  samples.set('woodblock', {
    id: 'woodblock',
    name: 'Woodblock',
    buffer: await createWoodblock(audioContext),
    url: '',
  });

  // === BASS ===
  samples.set('bass', {
    id: 'bass',
    name: 'Bass',
    buffer: await createBass(audioContext),
    url: '',
  });

  samples.set('subbass', {
    id: 'subbass',
    name: 'Sub Bass',
    buffer: await createSubBass(audioContext),
    url: '',
  });

  // === SYNTHS ===
  samples.set('lead', {
    id: 'lead',
    name: 'Lead',
    buffer: await createLead(audioContext),
    url: '',
  });

  samples.set('pluck', {
    id: 'pluck',
    name: 'Pluck',
    buffer: await createPluck(audioContext),
    url: '',
  });

  samples.set('chord', {
    id: 'chord',
    name: 'Chord',
    buffer: await createChord(audioContext),
    url: '',
  });

  samples.set('pad', {
    id: 'pad',
    name: 'Pad',
    buffer: await createPad(audioContext),
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
    buffer: await createNoiseHit(audioContext, rng),
    url: '',
  });

  for (const [sampleId, sample] of samples) {
    sample.playbackGain = dbToLinear(PROCEDURAL_SAMPLE_GAIN_DB[sampleId] ?? 0);
  }

  return samples;
}

async function createKick(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.5;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Exponential 150 -> 40 Hz sweep. Integrating frequency is essential:
    // sin(2π*f(t)*t) differentiates to f(t)+t*f'(t), which can reverse pitch.
    const freq = 40 + 110 * Math.exp(-10 * t);
    phase += (2 * Math.PI * freq) / sampleRate;
    // Amplitude envelope
    const amp = Math.exp(-t * 8);
    const click = Math.sin(2 * Math.PI * 3000 * t) * Math.exp(-180 * t) * 0.18;
    data[i] = Math.sin(phase) * amp * 0.9 + click;
  }
  limitMeasuredPeak(data);

  return buffer;
}

async function createSnare(ctx: AudioContext, rng: () => number): Promise<AudioBuffer> {
  const duration = 0.3;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  // Two one-pole stages form a stable 1.2-9 kHz noise band.
  let previousNoise = 0;
  let highpass = 0;
  let lowpass = 0;
  const hpAlpha = (1 / (2 * Math.PI * 1200)) / ((1 / (2 * Math.PI * 1200)) + 1 / sampleRate);
  const lpAlpha = (1 / sampleRate) / ((1 / (2 * Math.PI * 9000)) + 1 / sampleRate);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const white = rng() * 2 - 1;
    highpass = hpAlpha * (highpass + white - previousNoise);
    previousNoise = white;
    lowpass += lpAlpha * (highpass - lowpass);
    const noise = lowpass * Math.exp(-t * 15);
    const body = Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 22);
    data[i] = noise * 0.78 + body * 0.38;
  }
  limitMeasuredPeak(data);

  return buffer;
}

async function createHiHat(ctx: AudioContext, rng: () => number): Promise<AudioBuffer> {
  return createMetalHat(ctx, rng, {
    duration: 0.1,
    decayRate: 40,
    highpassHz: 7_000,
    fundamentalHz: 6_100,
  });
}

interface MetalHatRecipe {
  duration: number;
  decayRate: number;
  highpassHz: number;
  fundamentalHz: number;
}

async function createMetalHat(
  ctx: AudioContext,
  rng: () => number,
  recipe: MetalHatRecipe,
): Promise<AudioBuffer> {
  const { duration, decayRate, highpassHz, fundamentalHz } = recipe;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  const partials = [1, 1.342, 1.523, 1.759, 2.081, 2.437];
  const phases = partials.map(() => 0);
  let previousMetal = 0;
  let highpass = 0;
  const hpAlpha = (1 / (2 * Math.PI * highpassHz))
    / ((1 / (2 * Math.PI * highpassHz)) + 1 / sampleRate);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let metal = 0;
    for (let partial = 0; partial < partials.length; partial++) {
      phases[partial] += (2 * Math.PI * fundamentalHz * partials[partial]) / sampleRate;
      metal += Math.sign(Math.sin(phases[partial]));
    }
    metal = metal / partials.length + (rng() * 2 - 1) * 0.12;
    highpass = hpAlpha * (highpass + metal - previousMetal);
    previousMetal = metal;
    const attack = 1 - Math.exp(-t * 2_000);
    data[i] = highpass * attack * Math.exp(-t * decayRate) * 0.92;
  }
  limitMeasuredPeak(data);

  return buffer;
}

async function createClap(ctx: AudioContext, rng: () => number): Promise<AudioBuffer> {
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

    data[i] = (rng() * 2 - 1) * amp;
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

  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Frequency drops from 200Hz to 80Hz
    const freq = 80 + 120 * Math.exp(-t * 8);
    phase += (2 * Math.PI * freq) / sampleRate;
    const amp = Math.exp(-t * 6);
    data[i] = Math.sin(phase) * amp * 0.95;
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

async function createOpenHat(ctx: AudioContext, rng: () => number): Promise<AudioBuffer> {
  return createMetalHat(ctx, rng, {
    duration: 0.4,
    decayRate: 9,
    highpassHz: 6_500,
    fundamentalHz: 5_700,
  });
}

// === World/Latin Percussion ===

async function createShaker(ctx: AudioContext, rng: () => number): Promise<AudioBuffer> {
  const duration = 0.15;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // High-frequency noise with fast attack/decay
    const noise = rng() * 2 - 1;
    const envelope = Math.exp(-t * 25) * (1 - Math.exp(-t * 500));
    // Simple highpass approximation
    const filtered = noise * 0.7 + (rng() * 0.6 - 0.3);
    data[i] = filtered * envelope * 0.6;
  }

  return buffer;
}

async function createConga(ctx: AudioContext, rng: () => number): Promise<AudioBuffer> {
  const duration = 0.4;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const maximumComponentSum = 1 + 0.3 + 0.15 + 0.4;

  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Pitched membrane sound with slight pitch drop
    const freq = 140 + 80 * Math.exp(-t * 8);
    phase += (2 * Math.PI * freq) / sampleRate;
    const fundamental = Math.sin(phase);
    // Add harmonics for wood/skin character
    const harmonic2 = Math.sin(phase * 2.3) * 0.3;
    const harmonic3 = Math.sin(phase * 3.1) * 0.15;
    // Attack transient (slap)
    const slap = (rng() * 2 - 1) * Math.exp(-t * 100) * 0.4;
    // Envelope
    const envelope = Math.exp(-t * 6);
    data[i] = (fundamental + harmonic2 + harmonic3 + slap)
      / maximumComponentSum * envelope * 0.9;
  }

  return buffer;
}

async function createTambourine(ctx: AudioContext, rng: () => number): Promise<AudioBuffer> {
  const duration = 0.25;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Metallic jingles (multiple inharmonic frequencies)
    const jingle1 = Math.sin(2 * Math.PI * 2100 * t);
    const jingle2 = Math.sin(2 * Math.PI * 3400 * t);
    const jingle3 = Math.sin(2 * Math.PI * 4800 * t);
    const jingle4 = Math.sin(2 * Math.PI * 6200 * t);
    // Noise component for stick hit
    const noise = (rng() * 2 - 1) * Math.exp(-t * 50);
    // Envelope with sustain for jingles
    const envelope = Math.exp(-t * 8);
    const jingles = (jingle1 + jingle2 * 0.7 + jingle3 * 0.5 + jingle4 * 0.3) * 0.15;
    data[i] = (jingles + noise * 0.3) * envelope;
  }

  return buffer;
}

async function createClave(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.12;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Two-tone wooden click (like two sticks hitting)
    const freq1 = 2500;
    const freq2 = 3200;
    const tone1 = Math.sin(2 * Math.PI * freq1 * t);
    const tone2 = Math.sin(2 * Math.PI * freq2 * t) * 0.6;
    // Very fast decay
    const envelope = Math.exp(-t * 40);
    data[i] = (tone1 + tone2) * envelope * 0.6;
  }

  return buffer;
}

async function createCabasa(ctx: AudioContext, rng: () => number): Promise<AudioBuffer> {
  const duration = 0.08;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Very high frequency noise burst
    const noise = rng() * 2 - 1;
    // Very fast attack and decay
    const envelope = Math.exp(-t * 60) * (1 - Math.exp(-t * 2000));
    data[i] = noise * envelope * 0.5;
  }

  return buffer;
}

async function createWoodblock(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.15;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Resonant filtered click
    const freq = 800;
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    const harmonic = Math.sin(2 * Math.PI * freq * 2.7 * t);
    // Sharp attack, medium decay with resonance
    const envelope = Math.exp(-t * 20);
    const attack = Math.exp(-t * 200);
    // Keep the weighted oscillator sum within [-1, 1] before the envelope.
    data[i] = (fundamental * 0.7 + harmonic * 0.3) * envelope * (0.7 + attack * 0.3);
  }

  return buffer;
}

// === Bass ===

async function createBass(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.5;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const freq = 55; // A1
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Sawtooth-ish bass with harmonics
    let sample = 0;
    for (let h = 1; h <= 8; h++) {
      sample += Math.sin(2 * Math.PI * freq * h * t) / h;
    }
    // Plucky envelope
    const amp = Math.exp(-t * 4) * 0.9;
    data[i] = sample * amp;
  }
  limitMeasuredPeak(data);

  return buffer;
}

async function createSubBass(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.6;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const freq = 40; // Low E

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Pure sine sub with slight attack
    const attack = Math.min(t * 50, 1);
    const decay = Math.exp(-t * 2);
    data[i] = Math.sin(2 * Math.PI * freq * t) * attack * decay * 0.9;
  }

  return buffer;
}

// === Synths ===

async function createLead(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.6;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const freq = 440; // A4
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Square-ish wave (odd harmonics)
    let sample = 0;
    for (let h = 1; h <= 7; h += 2) {
      sample += Math.sin(2 * Math.PI * freq * h * t) / h;
    }
    // Synthy envelope with sustain
    const attack = Math.min(t * 100, 1);
    const release = t > 0.4 ? Math.exp(-(t - 0.4) * 10) : 1;
    data[i] = sample * attack * release * 0.9;
  }
  limitMeasuredPeak(data);

  return buffer;
}

async function createPluck(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.4;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const freq = 330; // E4
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Karplus-Strong-ish pluck (harmonics that decay at different rates)
    let sample = 0;
    for (let h = 1; h <= 12; h++) {
      const harmonicDecay = Math.exp(-t * (5 + h * 3));
      sample += Math.sin(2 * Math.PI * freq * h * t) * harmonicDecay / h;
    }
    data[i] = sample * 0.9;
  }
  limitMeasuredPeak(data);

  return buffer;
}

async function createChord(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.8;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  // Minor chord: root, minor third, fifth
  const freqs = [220, 261.63, 330]; // A3, C4, E4
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (const freq of freqs) {
      // Soft saw per voice
      for (let h = 1; h <= 4; h++) {
        sample += Math.sin(2 * Math.PI * freq * h * t) / (h * 3);
      }
    }
    // Soft envelope
    const attack = Math.min(t * 20, 1);
    const release = t > 0.5 ? Math.exp(-(t - 0.5) * 5) : 1;
    data[i] = sample * attack * release * 0.9;
  }
  limitMeasuredPeak(data);

  return buffer;
}

async function createPad(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 1.5;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const freq = 220; // A3

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Soft detuned oscillators
    const osc1 = Math.sin(2 * Math.PI * freq * t);
    const osc2 = Math.sin(2 * Math.PI * freq * 1.005 * t); // Slight detune
    const osc3 = Math.sin(2 * Math.PI * freq * 0.995 * t);
    // Slow attack, long release
    const attack = Math.min(t * 3, 1);
    const release = t > 1.0 ? Math.exp(-(t - 1.0) * 3) : 1;
    data[i] = (osc1 + osc2 + osc3) / 3 * attack * release * 0.8;
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

  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Frequency sweeps down rapidly
    const freq = 100 + 1900 * Math.exp(-t * 30);
    phase += (2 * Math.PI * freq) / sampleRate;
    const amp = Math.exp(-t * 15);
    data[i] = Math.sin(phase) * amp * 0.85;
  }

  return buffer;
}

async function createNoiseHit(ctx: AudioContext, rng: () => number): Promise<AudioBuffer> {
  const duration = 0.3;
  const sampleRate = ctx.sampleRate;
  const length = duration * sampleRate;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // White noise with envelope
    const amp = Math.exp(-t * 10);
    data[i] = (rng() * 2 - 1) * amp * 0.8;
  }

  return buffer;
}
