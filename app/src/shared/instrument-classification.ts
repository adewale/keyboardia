/**
 * Instrument roles shared by audio, MIDI, analysis, and UI code.
 *
 * Engine prefixes are implementation details: a sampled kick and a Tone.js
 * kick are still drums. Keeping the catalogue IDs here prevents each consumer
 * from guessing a role from `sampled:`, `tone:`, or another namespace.
 */

export const DRUM_INSTRUMENT_IDS = new Set([
  'kick',
  'snare',
  'hihat',
  'openhat',
  'clap',
  'tom',
  'rim',
  'cowbell',
  'shaker',
  'conga',
  'tambourine',
  'clave',
  'cabasa',
  'woodblock',
  'sampled:808-kick',
  'sampled:808-snare',
  'sampled:808-hihat-closed',
  'sampled:808-hihat-open',
  'sampled:808-clap',
  'sampled:acoustic-kick',
  'sampled:acoustic-snare',
  'sampled:acoustic-hihat-closed',
  'sampled:acoustic-hihat-open',
  'sampled:acoustic-ride',
  'sampled:acoustic-crash',
  'sampled:brushes-snare',
  'tone:membrane-kick',
  'tone:membrane-tom',
  'tone:metal-cymbal',
  'tone:metal-hihat',
]);

/** Microphone recordings are one-shot, unpitched samples in MIDI exports. */
export function isDrumInstrument(sampleId: string): boolean {
  const normalized = sampleId.trim().toLowerCase();
  return normalized.startsWith('mic:') || DRUM_INSTRUMENT_IDS.has(normalized);
}

/** Pure preset extraction that does not import any browser audio engine. */
export function instrumentPresetId(sampleId: string): string {
  const normalized = sampleId.trim().toLowerCase();
  const separator = normalized.indexOf(':');
  return separator === -1 ? normalized : normalized.slice(separator + 1);
}
