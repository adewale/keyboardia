import type { Sample } from '../types';

// Generate synthesized sounds using Web Audio API
// Covers drums, bass, synths, and FX - all procedurally generated

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

  // === WORLD/LATIN PERCUSSION ===
  samples.set('shaker', {
    id: 'shaker',
    name: 'Shaker',
    buffer: await createShaker(audioContext),
    url: '',
  });

  samples.set('conga', {
    id: 'conga',
    name: 'Conga',
    buffer: await createConga(audioContext),
    url: '',
  });

  samples.set('tambourine', {
    id: 'tambourine',
    name: 'Tambourine',
    buffer: await createTambourine(audioContext),
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
    buffer: await createCabasa(audioContext),
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

// === World/Latin Percussion ===

async function createShaker(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.15;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // High-frequency noise with fast attack/decay
    const noise = Math.random() * 2 - 1;
    const envelope = Math.exp(-t * 25) * (1 - Math.exp(-t * 500));
    // Simple highpass approximation
    const filtered = noise * 0.7 + (Math.random() * 0.6 - 0.3);
    data[i] = filtered * envelope * 0.6;
  }

  return buffer;
}

async function createConga(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.4;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Pitched membrane sound with slight pitch drop
    const freq = 200 * Math.exp(-t * 3);
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    // Add harmonics for wood/skin character
    const harmonic2 = Math.sin(2 * Math.PI * freq * 2.3 * t) * 0.3;
    const harmonic3 = Math.sin(2 * Math.PI * freq * 3.1 * t) * 0.15;
    // Attack transient (slap)
    const slap = (Math.random() * 2 - 1) * Math.exp(-t * 100) * 0.4;
    // Envelope
    const envelope = Math.exp(-t * 6);
    data[i] = (fundamental + harmonic2 + harmonic3 + slap) * envelope * 0.7;
  }

  return buffer;
}

async function createTambourine(ctx: AudioContext): Promise<AudioBuffer> {
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
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 50);
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

async function createCabasa(ctx: AudioContext): Promise<AudioBuffer> {
  const duration = 0.08;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Very high frequency noise burst
    const noise = Math.random() * 2 - 1;
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
    const harmonic = Math.sin(2 * Math.PI * freq * 2.7 * t) * 0.4;
    // Sharp attack, medium decay with resonance
    const envelope = Math.exp(-t * 20);
    const attack = Math.exp(-t * 200);
    data[i] = (fundamental + harmonic) * envelope * (0.7 + attack * 0.3);
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
    data[i] = sample * amp * 0.8;
  }

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
    data[i] = sample * attack * release * 0.75;
  }

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
    data[i] = sample * 0.8;
  }

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
    data[i] = sample * attack * release * 0.65;
  }

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
