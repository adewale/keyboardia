const PROCEDURAL_IDS = new Set([
  'kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat',
  'shaker', 'conga', 'tambourine', 'clave', 'cabasa', 'woodblock',
  'bass', 'subbass', 'lead', 'pluck', 'chord', 'pad', 'zap', 'noise',
]);

const LOW_IDS = new Set([
  'kick', 'tom', 'conga', 'bass', 'subbass',
  'membrane-kick', 'membrane-tom', 'fm-bass',
]);

const HIGH_IDS = new Set([
  'hihat', 'openhat', 'shaker', 'tambourine', 'cabasa',
  'metal-cymbal', 'metal-hihat',
]);

/** Reaches about 99% of a new cutoff in 8 ms without blunting the attack. */
export const VELOCITY_FILTER_TIME_CONSTANT_SECONDS = 0.008 / Math.log(100);

function softVelocityLowpassHz(instrumentId: string, midiVelocity: number): number {
  const normalized = Math.max(0, Math.min(1, midiVelocity / 90));
  const floorHz = LOW_IDS.has(instrumentId) ? 800 : HIGH_IDS.has(instrumentId) ? 4_500 : 1_000;
  return floorHz + (20_000 - floorHz) * normalized ** 4;
}

/** Soft generated buffers become darker; canonical and hard notes are bit-for-bit bypassed. */
export function proceduralVelocityLowpassHz(sampleId: string, midiVelocity: number): number | null {
  if (!PROCEDURAL_IDS.has(sampleId) || midiVelocity >= 90) return null;
  return softVelocityLowpassHz(sampleId, midiVelocity);
}

/** Tone voices share a filter node, so canonical notes schedule its neutral 20 kHz cutoff. */
export function toneVelocityLowpassHz(presetId: string, midiVelocity: number): number {
  return midiVelocity >= 90 ? 20_000 : softVelocityLowpassHz(presetId, midiVelocity);
}
