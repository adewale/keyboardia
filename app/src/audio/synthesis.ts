/**
 * Pure Synthesis Functions
 *
 * These functions contain the audio synthesis math without AudioContext dependencies.
 * Each function takes a Float32Array and sample rate, filling the array with samples.
 *
 * This separation enables:
 * 1. Unit testing without Web Audio API polyfills
 * 2. Cleaner separation of concerns
 * 3. Potential reuse in Web Workers or other contexts
 */

// =============================================================================
// Types and Constants
// =============================================================================

export interface SynthesisConfig {
  duration: number;
  sampleRate: number;
}

export interface SynthesisResult {
  duration: number;
  maxAmplitude: number;
  attackTimeMs: number; // Time to reach 10% of max amplitude
}

/**
 * Analyze a synthesized buffer for key audio properties
 */
export function analyzeBuffer(data: Float32Array, sampleRate: number): SynthesisResult {
  const duration = data.length / sampleRate;

  // Find max amplitude
  let maxAmplitude = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > maxAmplitude) maxAmplitude = abs;
  }

  // Find attack time (time to reach 10% of max)
  const threshold = maxAmplitude * 0.1;
  let attackTimeMs = 0;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) >= threshold) {
      attackTimeMs = (i / sampleRate) * 1000;
      break;
    }
  }

  return { duration, maxAmplitude, attackTimeMs };
}

// =============================================================================
// Drums - Original 8
// =============================================================================

export function synthesizeKick(data: Float32Array, sampleRate: number): void {
  const length = data.length;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Frequency drops from 150Hz to 40Hz
    const freq = 150 * Math.exp(-t * 10) + 40;
    // Amplitude envelope
    const amp = Math.exp(-t * 8);
    data[i] = Math.sin(2 * Math.PI * freq * t) * amp;
  }
}

export function synthesizeSnare(data: Float32Array, sampleRate: number, seed = 12345): void {
  const length = data.length;
  let rng = seed;
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Mix of noise and tone
    const noise = random() * Math.exp(-t * 15);
    const tone = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 20);
    data[i] = noise * 0.7 + tone * 0.3;
  }
}

export function synthesizeHiHat(data: Float32Array, sampleRate: number, seed = 12345): void {
  const length = data.length;
  let rng = seed;
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // High-frequency noise with fast decay
    const noise = random() * Math.exp(-t * 40);
    data[i] = noise * 0.85;
  }
}

export function synthesizeClap(data: Float32Array, sampleRate: number, seed = 12345): void {
  const length = data.length;
  let rng = seed;
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Multiple noise bursts
    let amp = 0;
    if (t < 0.02) amp = Math.exp(-t * 100);
    else if (t < 0.04) amp = Math.exp(-(t - 0.02) * 100) * 0.8;
    else if (t < 0.06) amp = Math.exp(-(t - 0.04) * 100) * 0.6;
    else amp = Math.exp(-(t - 0.06) * 20) * 0.4;
    data[i] = random() * amp;
  }
}

export function synthesizeTom(data: Float32Array, sampleRate: number): void {
  const length = data.length;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Frequency drops from 200Hz to 80Hz
    const freq = 200 * Math.exp(-t * 8) + 80;
    const amp = Math.exp(-t * 6);
    data[i] = Math.sin(2 * Math.PI * freq * t) * amp * 0.95;
  }
}

export function synthesizeRim(data: Float32Array, sampleRate: number): void {
  const length = data.length;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // High pitched click with fast decay
    const tone1 = Math.sin(2 * Math.PI * 1200 * t);
    const tone2 = Math.sin(2 * Math.PI * 800 * t);
    const amp = Math.exp(-t * 80);
    data[i] = (tone1 * 0.5 + tone2 * 0.5) * amp;
  }
}

export function synthesizeCowbell(data: Float32Array, sampleRate: number): void {
  const length = data.length;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Two inharmonic frequencies (classic cowbell recipe)
    const tone1 = Math.sin(2 * Math.PI * 562 * t);
    const tone2 = Math.sin(2 * Math.PI * 845 * t);
    const amp = Math.exp(-t * 12);
    data[i] = (tone1 * 0.6 + tone2 * 0.4) * amp * 0.9;
  }
}

export function synthesizeOpenHat(data: Float32Array, sampleRate: number, seed = 12345): void {
  const length = data.length;
  let rng = seed;
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Longer noise with slower decay than closed hat
    const noise = random() * Math.exp(-t * 8);
    // Add some metallic tones
    const metallic = Math.sin(2 * Math.PI * 4000 * t) * 0.15 * Math.exp(-t * 15);
    data[i] = noise * 0.7 + metallic;
  }
}

// =============================================================================
// World/Latin Percussion - Phase 23
// =============================================================================

export function synthesizeShaker(data: Float32Array, sampleRate: number, seed = 12345): void {
  const length = data.length;
  let rng = seed;
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // High-frequency noise with fast attack/decay
    const noise = random();
    const envelope = Math.exp(-t * 25) * (1 - Math.exp(-t * 500));
    // Simple highpass approximation
    const filtered = noise * 0.7 + (random() * 0.6 - 0.3);
    data[i] = filtered * envelope * 0.6;
  }
}

export function synthesizeConga(data: Float32Array, sampleRate: number, seed = 12345): void {
  const length = data.length;
  let rng = seed;
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Pitched membrane sound with slight pitch drop
    const freq = 200 * Math.exp(-t * 3);
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    // Add harmonics for wood/skin character
    const harmonic2 = Math.sin(2 * Math.PI * freq * 2.3 * t) * 0.3;
    const harmonic3 = Math.sin(2 * Math.PI * freq * 3.1 * t) * 0.15;
    // Attack transient (slap)
    const slap = random() * Math.exp(-t * 100) * 0.4;
    // Envelope
    const envelope = Math.exp(-t * 6);
    data[i] = (fundamental + harmonic2 + harmonic3 + slap) * envelope * 0.7;
  }
}

export function synthesizeTambourine(data: Float32Array, sampleRate: number, seed = 12345): void {
  const length = data.length;
  let rng = seed;
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Metallic jingles (multiple inharmonic frequencies)
    const jingle1 = Math.sin(2 * Math.PI * 2100 * t);
    const jingle2 = Math.sin(2 * Math.PI * 3400 * t);
    const jingle3 = Math.sin(2 * Math.PI * 4800 * t);
    const jingle4 = Math.sin(2 * Math.PI * 6200 * t);
    // Noise component for stick hit
    const noise = random() * Math.exp(-t * 50);
    // Envelope with sustain for jingles
    const envelope = Math.exp(-t * 8);
    const jingles = (jingle1 + jingle2 * 0.7 + jingle3 * 0.5 + jingle4 * 0.3) * 0.15;
    data[i] = (jingles + noise * 0.3) * envelope;
  }
}

export function synthesizeClave(data: Float32Array, sampleRate: number): void {
  const length = data.length;
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
}

export function synthesizeCabasa(data: Float32Array, sampleRate: number, seed = 12345): void {
  const length = data.length;
  let rng = seed;
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Very high frequency noise burst
    const noise = random();
    // Very fast attack and decay
    const envelope = Math.exp(-t * 60) * (1 - Math.exp(-t * 2000));
    data[i] = noise * envelope * 0.5;
  }
}

export function synthesizeWoodblock(data: Float32Array, sampleRate: number): void {
  const length = data.length;
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
}

// =============================================================================
// Bass
// =============================================================================

export function synthesizeBass(data: Float32Array, sampleRate: number): void {
  const length = data.length;
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
}

export function synthesizeSubBass(data: Float32Array, sampleRate: number): void {
  const length = data.length;
  const freq = 40; // Low E

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Pure sine sub with slight attack
    const attack = Math.min(t * 50, 1);
    const decay = Math.exp(-t * 2);
    data[i] = Math.sin(2 * Math.PI * freq * t) * attack * decay * 0.9;
  }
}

// =============================================================================
// Synths
// =============================================================================

export function synthesizeLead(data: Float32Array, sampleRate: number): void {
  const length = data.length;
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
}

export function synthesizePluck(data: Float32Array, sampleRate: number): void {
  const length = data.length;
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
}

export function synthesizeChord(data: Float32Array, sampleRate: number): void {
  const length = data.length;
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
}

export function synthesizePad(data: Float32Array, sampleRate: number): void {
  const length = data.length;
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
}

// =============================================================================
// FX
// =============================================================================

export function synthesizeZap(data: Float32Array, sampleRate: number): void {
  const length = data.length;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Frequency sweeps down rapidly
    const freq = 2000 * Math.exp(-t * 30) + 100;
    const amp = Math.exp(-t * 15);
    data[i] = Math.sin(2 * Math.PI * freq * t) * amp * 0.85;
  }
}

export function synthesizeNoise(data: Float32Array, sampleRate: number, seed = 12345): void {
  const length = data.length;
  let rng = seed;
  const random = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // White noise with envelope
    const amp = Math.exp(-t * 10);
    data[i] = random() * amp * 0.8;
  }
}

// =============================================================================
// Instrument Configurations (durations for each instrument)
// =============================================================================

export const INSTRUMENT_CONFIGS: Record<string, { duration: number; category: string }> = {
  // Drums
  kick: { duration: 0.5, category: 'drums' },
  snare: { duration: 0.3, category: 'drums' },
  hihat: { duration: 0.1, category: 'drums' },
  clap: { duration: 0.3, category: 'drums' },
  tom: { duration: 0.4, category: 'drums' },
  rim: { duration: 0.1, category: 'drums' },
  cowbell: { duration: 0.3, category: 'drums' },
  openhat: { duration: 0.4, category: 'drums' },
  // World/Latin Percussion
  shaker: { duration: 0.15, category: 'percussion' },
  conga: { duration: 0.4, category: 'percussion' },
  tambourine: { duration: 0.25, category: 'percussion' },
  clave: { duration: 0.12, category: 'percussion' },
  cabasa: { duration: 0.08, category: 'percussion' },
  woodblock: { duration: 0.15, category: 'percussion' },
  // Bass
  bass: { duration: 0.5, category: 'bass' },
  subbass: { duration: 0.6, category: 'bass' },
  // Synths
  lead: { duration: 0.6, category: 'synth' },
  pluck: { duration: 0.4, category: 'synth' },
  chord: { duration: 0.8, category: 'synth' },
  pad: { duration: 1.5, category: 'synth' },
  // FX
  zap: { duration: 0.2, category: 'fx' },
  noise: { duration: 0.3, category: 'fx' },
};

// =============================================================================
// Synthesis Function Map
// =============================================================================

type SynthesisFunction = (data: Float32Array, sampleRate: number, seed?: number) => void;

export const SYNTHESIS_FUNCTIONS: Record<string, SynthesisFunction> = {
  kick: synthesizeKick,
  snare: synthesizeSnare,
  hihat: synthesizeHiHat,
  clap: synthesizeClap,
  tom: synthesizeTom,
  rim: synthesizeRim,
  cowbell: synthesizeCowbell,
  openhat: synthesizeOpenHat,
  shaker: synthesizeShaker,
  conga: synthesizeConga,
  tambourine: synthesizeTambourine,
  clave: synthesizeClave,
  cabasa: synthesizeCabasa,
  woodblock: synthesizeWoodblock,
  bass: synthesizeBass,
  subbass: synthesizeSubBass,
  lead: synthesizeLead,
  pluck: synthesizePluck,
  chord: synthesizeChord,
  pad: synthesizePad,
  zap: synthesizeZap,
  noise: synthesizeNoise,
};

/**
 * Synthesize an instrument into a Float32Array
 */
export function synthesizeInstrument(
  instrumentId: string,
  sampleRate: number = 44100,
  seed: number = 12345
): { data: Float32Array; duration: number } {
  const config = INSTRUMENT_CONFIGS[instrumentId];
  if (!config) {
    throw new Error(`Unknown instrument: ${instrumentId}`);
  }

  const synthFn = SYNTHESIS_FUNCTIONS[instrumentId];
  if (!synthFn) {
    throw new Error(`No synthesis function for: ${instrumentId}`);
  }

  const length = Math.floor(config.duration * sampleRate);
  const data = new Float32Array(length);
  synthFn(data, sampleRate, seed);

  return { data, duration: config.duration };
}
