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

/** Low-frequency anchors stay centered so equal-power panning cannot thin them. */
export const KICK_INSTRUMENT_IDS = new Set([
  'kick',
  'sampled:808-kick',
  'sampled:acoustic-kick',
  'tone:membrane-kick',
]);

export const BASS_INSTRUMENT_IDS = new Set([
  'bass',
  'subbass',
  'synth:bass',
  'synth:sub',
  'advanced:mono-bass',
  'advanced:sub-bass',
  'tone:fm-bass',
  'sampled:finger-bass',
  'sampled:slap-bass',
]);

/**
 * Prefixes for audio the user supplied, which has no known pitch mapping.
 *
 * `mic:` was here alone, and nothing produces it. Recorder.tsx mints
 * `recording-${Date.now()}` for a whole take and `slice-${Date.now()}-${i}`
 * for each auto-slice, so every real user recording fell past this check and
 * was classified as a pitched instrument — which put it on a melodic MIDI
 * channel with a GM program instead of channel 10, and left it out of the
 * recording count that mcp-lifecycle reports.
 *
 * `mic:` stays because midiExport and mcp-lifecycle both still branch on it;
 * removing it belongs with removing those branches.
 */
const USER_AUDIO_PREFIXES = ['mic:', 'recording-', 'slice-'];

/** Drums and user recordings alike are one-shot, unpitched samples. */
export function isDrumInstrument(sampleId: string): boolean {
  const normalized = sampleId.trim().toLowerCase();
  return USER_AUDIO_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    DRUM_INSTRUMENT_IDS.has(normalized);
}

/** Pure preset extraction that does not import any browser audio engine. */
export function instrumentPresetId(sampleId: string): string {
  const normalized = sampleId.trim().toLowerCase();
  const separator = normalized.indexOf(':');
  return separator === -1 ? normalized : normalized.slice(separator + 1);
}

function normalizedInstrumentId(sampleId: string): string {
  return sampleId.trim().toLowerCase();
}

export function isKickInstrument(sampleId: string): boolean {
  return KICK_INSTRUMENT_IDS.has(normalizedInstrumentId(sampleId));
}

export function isBassInstrument(sampleId: string): boolean {
  return BASS_INSTRUMENT_IDS.has(normalizedInstrumentId(sampleId));
}

export function shouldKeepInstrumentCentered(sampleId: string): boolean {
  return isKickInstrument(sampleId) || isBassInstrument(sampleId);
}

/**
 * Sampled instruments a user expects to hold a note for as long as a tied
 * step lasts. Only mappings with a LoopSpec repeat, so for everything else
 * recorded length is a hard ceiling on note length;
 * `scripts/validate-sustain-ceiling.ts` asserts each of these keeps at least
 * the longest tied note in a 16-step bar at 120 BPM (2 s) above -60 dBFS.
 *
 * Deliberately excluded: `sampled:acoustic-guitar` and `sampled:slap-bass`
 * are plucked — decaying to silence is correct there, and classifying them
 * as sustaining would be the error
 * (specs/PHASE-44-SOUND-CHANGES.md §4).
 */
export const SUSTAINING_INSTRUMENT_IDS = new Set([
  'sampled:alto-sax',
  'sampled:clean-guitar',
  'sampled:finger-bass',
  'sampled:french-horn',
  'sampled:hammond-organ',
  'sampled:piano',
  'sampled:string-section',
  'sampled:vibraphone',
]);

export function isSustainingInstrument(sampleId: string): boolean {
  return SUSTAINING_INSTRUMENT_IDS.has(normalizedInstrumentId(sampleId));
}
