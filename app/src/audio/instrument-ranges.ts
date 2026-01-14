/**
 * Instrument Range Definitions
 *
 * Phase 31H: Defines playable MIDI ranges for each instrument
 * Used for range warnings in pitch visualization
 */

/**
 * Instrument range definition
 */
export interface InstrumentRange {
  minMidi: number; // Lowest playable MIDI note
  maxMidi: number; // Highest playable MIDI note
  optimalMin?: number; // Optimal low range (sounds best)
  optimalMax?: number; // Optimal high range (sounds best)
}

/**
 * Default range for instruments without specific definitions
 * Based on general synth/sampler capabilities
 */
export const DEFAULT_RANGE: InstrumentRange = {
  minMidi: 24, // C1
  maxMidi: 96, // C7
  optimalMin: 36, // C2
  optimalMax: 84, // C6
};

/**
 * Instrument ranges by sample ID prefix/name
 * Based on real instrument characteristics and sample availability
 */
export const INSTRUMENT_RANGES: Record<string, InstrumentRange> = {
  // Sampled instruments
  'sampled:piano': {
    minMidi: 21, // A0
    maxMidi: 108, // C8
    optimalMin: 36, // C2
    optimalMax: 96, // C7
  },
  'sampled:rhodes-ep': {
    minMidi: 36, // C2
    maxMidi: 96, // C7
    optimalMin: 48, // C3
    optimalMax: 84, // C6
  },
  'sampled:vibraphone': {
    minMidi: 53, // F3
    maxMidi: 89, // F6
    optimalMin: 60, // C4
    optimalMax: 84, // C6
  },
  'sampled:marimba': {
    minMidi: 45, // A2
    maxMidi: 96, // C7
    optimalMin: 48, // C3
    optimalMax: 84, // C6
  },
  'sampled:string-section': {
    minMidi: 36, // C2 (cello range)
    maxMidi: 96, // C7 (violin range)
    optimalMin: 48, // C3
    optimalMax: 84, // C6
  },
  'sampled:french-horn': {
    minMidi: 34, // Bb1
    maxMidi: 77, // F5
    optimalMin: 41, // F2
    optimalMax: 72, // C5
  },
  'sampled:alto-sax': {
    minMidi: 49, // Db3 (written Bb)
    maxMidi: 80, // Ab5 (written F)
    optimalMin: 53, // F3
    optimalMax: 77, // F5
  },
  'sampled:clean-guitar': {
    minMidi: 40, // E2
    maxMidi: 84, // C6
    optimalMin: 48, // C3
    optimalMax: 76, // E5
  },
  'sampled:acoustic-guitar': {
    minMidi: 40, // E2
    maxMidi: 84, // C6
    optimalMin: 48, // C3
    optimalMax: 76, // E5
  },
  'sampled:finger-bass': {
    minMidi: 28, // E1
    maxMidi: 60, // C4
    optimalMin: 28, // E1
    optimalMax: 55, // G3
  },
  'sampled:hammond-organ': {
    minMidi: 36, // C2
    maxMidi: 84, // C6
    optimalMin: 36, // C2
    optimalMax: 72, // C5
  },

  // Synth presets (generally full range)
  'synth:bass': {
    minMidi: 24, // C1
    maxMidi: 60, // C4
    optimalMin: 28, // E1
    optimalMax: 55, // G3
  },
  'synth:lead': {
    minMidi: 48, // C3
    maxMidi: 96, // C7
    optimalMin: 60, // C4
    optimalMax: 84, // C6
  },
  'synth:pad': {
    minMidi: 36, // C2
    maxMidi: 96, // C7
    optimalMin: 48, // C3
    optimalMax: 84, // C6
  },

  // Advanced synths
  'advanced:sub-bass': {
    minMidi: 24, // C1
    maxMidi: 55, // G3
    optimalMin: 28, // E1
    optimalMax: 48, // C3
  },
  'advanced:wobble-bass': {
    minMidi: 24, // C1
    maxMidi: 60, // C4
    optimalMin: 28, // E1
    optimalMax: 55, // G3
  },
  'advanced:acid-bass': {
    minMidi: 24, // C1
    maxMidi: 72, // C5
    optimalMin: 36, // C2
    optimalMax: 60, // C4
  },
  'advanced:supersaw': {
    minMidi: 36, // C2
    maxMidi: 96, // C7
    optimalMin: 48, // C3
    optimalMax: 84, // C6
  },
  'advanced:thick-lead': {
    minMidi: 48, // C3
    maxMidi: 96, // C7
    optimalMin: 60, // C4
    optimalMax: 84, // C6
  },
  'advanced:warm-pad': {
    minMidi: 36, // C2
    maxMidi: 96, // C7
    optimalMin: 48, // C3
    optimalMax: 84, // C6
  },

  // Tone.js FM/AM synths
  'tone:fm-epiano': {
    minMidi: 36, // C2
    maxMidi: 96, // C7
    optimalMin: 48, // C3
    optimalMax: 84, // C6
  },
  'tone:fm-bass': {
    minMidi: 24, // C1
    maxMidi: 60, // C4
    optimalMin: 28, // E1
    optimalMax: 55, // G3
  },
  'tone:fm-bell': {
    minMidi: 48, // C3
    maxMidi: 96, // C7
    optimalMin: 60, // C4
    optimalMax: 84, // C6
  },

  // Drum synths have no pitch range (single sound)
  'tone:membrane-kick': {
    minMidi: 36, // C2
    maxMidi: 60, // C4
    optimalMin: 36,
    optimalMax: 48,
  },
  'tone:membrane-tom': {
    minMidi: 36, // C2
    maxMidi: 72, // C5
    optimalMin: 48,
    optimalMax: 60,
  },
  'tone:metal-cymbal': {
    minMidi: 48, // C3
    maxMidi: 84, // C6
    optimalMin: 60,
    optimalMax: 72,
  },
  'tone:metal-hihat': {
    minMidi: 48, // C3
    maxMidi: 84, // C6
    optimalMin: 60,
    optimalMax: 72,
  },
};

/**
 * Get instrument range for a sample ID
 */
export function getInstrumentRange(sampleId: string): InstrumentRange {
  // Direct match
  if (INSTRUMENT_RANGES[sampleId]) {
    return INSTRUMENT_RANGES[sampleId];
  }

  // Match by prefix for generic synth types
  const prefix = sampleId.split(':')[0];
  if (prefix === 'synth') {
    // Check for specific synth types in name
    if (sampleId.includes('bass')) {
      return INSTRUMENT_RANGES['synth:bass'];
    }
    if (sampleId.includes('lead')) {
      return INSTRUMENT_RANGES['synth:lead'];
    }
    if (sampleId.includes('pad')) {
      return INSTRUMENT_RANGES['synth:pad'];
    }
  }

  return DEFAULT_RANGE;
}

/**
 * Check if a MIDI note is within instrument range
 */
export function isInRange(midiNote: number, sampleId: string): boolean {
  const range = getInstrumentRange(sampleId);
  return midiNote >= range.minMidi && midiNote <= range.maxMidi;
}

/**
 * Check if a MIDI note is in optimal range
 */
export function isInOptimalRange(midiNote: number, sampleId: string): boolean {
  const range = getInstrumentRange(sampleId);
  const min = range.optimalMin ?? range.minMidi;
  const max = range.optimalMax ?? range.maxMidi;
  return midiNote >= min && midiNote <= max;
}

/**
 * Get range warning for a pitch
 * Returns a warning message if out of range, undefined if OK
 */
export function getRangeWarning(
  pitch: number,
  transpose: number,
  sampleId: string,
  baseMidi: number = 60
): string | undefined {
  const midiNote = baseMidi + transpose + pitch;
  const range = getInstrumentRange(sampleId);

  if (midiNote < range.minMidi) {
    return `Note too low (${midiNote} < ${range.minMidi})`;
  }
  if (midiNote > range.maxMidi) {
    return `Note too high (${midiNote} > ${range.maxMidi})`;
  }
  return undefined;
}

// === Frequency Helpers (Phase 31 - Inaudible Warning) ===

/**
 * Middle C (C4) frequency in Hz
 * Standard concert pitch reference
 */
export const C4_FREQUENCY = 261.625565;

/**
 * Threshold below which frequencies are inaudible on typical laptop speakers
 * Most laptop speakers can't reproduce frequencies below ~100 Hz
 */
export const LAPTOP_SPEAKER_MIN_FREQUENCY = 100;

/**
 * Convert MIDI note to frequency in Hz
 * MIDI note 60 = C4 = 261.63 Hz
 */
export function midiToFrequency(midiNote: number): number {
  return C4_FREQUENCY * Math.pow(2, (midiNote - 60) / 12);
}

/**
 * Check if a MIDI note produces sub-bass frequency (<100 Hz)
 * These frequencies are typically inaudible on laptop speakers
 */
export function isSubBassFrequency(midiNote: number): boolean {
  return midiToFrequency(midiNote) < LAPTOP_SPEAKER_MIN_FREQUENCY;
}

/**
 * Sub-bass instrument prefixes
 * These instruments primarily operate in the sub-bass range
 */
const SUB_BASS_PREFIXES = [
  'advanced:sub-bass',
  'advanced:wobble-bass',
  'tone:fm-bass',
  'tone:membrane-kick',
  'sampled:finger-bass',
];

/**
 * Check if an instrument is primarily a sub-bass instrument
 */
export function isSubBassInstrument(sampleId: string): boolean {
  return SUB_BASS_PREFIXES.some(prefix => sampleId.startsWith(prefix));
}

/**
 * Check if a track configuration might be inaudible on laptop speakers
 * Returns a warning message if the instrument + transpose puts it in sub-bass range
 */
export function getInaudibleWarning(
  sampleId: string,
  transpose: number = 0,
  baseMidi: number = 60
): string | null {
  const effectiveMidi = baseMidi + transpose;
  const frequency = midiToFrequency(effectiveMidi);

  // Check if this is a bass instrument in sub-bass territory
  if (isSubBassInstrument(sampleId) && frequency < LAPTOP_SPEAKER_MIN_FREQUENCY) {
    return `Sub-bass (${Math.round(frequency)} Hz) may be inaudible on laptop speakers`;
  }

  // For any instrument transposed very low
  if (frequency < 65) { // Below C2 (65 Hz)
    return `Very low frequency (${Math.round(frequency)} Hz) - may be inaudible on most speakers`;
  }

  return null;
}

// === Pitch-Shift Quality (Phase 29 - Sample Quality) ===

/**
 * Quality levels for pitch-shifting
 */
export type PitchShiftQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'bad';

/**
 * Sample mappings for instruments to calculate pitch-shift distance
 * AUTO-GENERATED from manifests - do not edit manually!
 * Run: npm run generate:instrument-notes
 */
const SAMPLED_INSTRUMENT_NOTES: Record<string, number[]> = {
  'sampled:808-clap': [39],
  'sampled:808-hihat-closed': [42],
  'sampled:808-hihat-open': [46],
  'sampled:808-kick': [36],
  'sampled:808-snare': [38],
  'sampled:acoustic-crash': [49],
  'sampled:acoustic-guitar': [40, 52, 64, 80],
  'sampled:acoustic-hihat-closed': [42],
  'sampled:acoustic-hihat-open': [46],
  'sampled:acoustic-kick': [36],
  'sampled:acoustic-ride': [51],
  'sampled:acoustic-snare': [38],
  'sampled:alto-sax': [38, 48, 60, 68],
  'sampled:brushes-snare': [38],
  'sampled:clean-guitar': [52, 64, 76, 88],
  'sampled:finger-bass': [24, 36, 42, 48, 54, 60],
  'sampled:french-horn': [24, 41, 48, 62],
  'sampled:hammond-organ': [36, 40, 44, 48, 52, 56, 60, 64, 68, 72],
  'sampled:kalimba': [49, 61, 73, 85],
  'sampled:marimba': [36, 53, 60, 77, 84],
  'sampled:piano': [36, 41, 48, 53, 60, 65, 72],
  'sampled:rhodes-ep': [36, 40, 48, 55, 60, 65, 72],
  'sampled:slap-bass': [40, 48, 57, 60],
  'sampled:steel-drums': [60, 67, 72, 79],
  'sampled:string-section': [36, 43, 48, 53, 60, 67, 72],
  'sampled:vibraphone': [48, 60, 72, 84],
  'sampled:vinyl-crackle': [60],
};

/**
 * Get the pitch-shift amount for a MIDI note on a sampled instrument
 * Returns the number of semitones the note will be shifted from nearest sample
 */
export function getPitchShiftAmount(midiNote: number, sampleId: string): number {
  const sampleNotes = SAMPLED_INSTRUMENT_NOTES[sampleId];
  if (!sampleNotes || sampleNotes.length === 0) {
    return 0; // Non-sampled instruments don't pitch-shift
  }

  let minDistance = Infinity;
  for (const sampleNote of sampleNotes) {
    const distance = Math.abs(midiNote - sampleNote);
    minDistance = Math.min(minDistance, distance);
  }
  return minDistance;
}

/**
 * Get pitch-shift quality for a MIDI note on a sampled instrument
 * Based on how far the note is from the nearest sample
 */
export function getPitchShiftQuality(midiNote: number, sampleId: string): PitchShiftQuality {
  const shift = getPitchShiftAmount(midiNote, sampleId);

  if (shift <= 3) return 'excellent';
  if (shift <= 6) return 'good';
  if (shift <= 9) return 'fair';
  if (shift <= 12) return 'poor';
  return 'bad';
}

/**
 * Get a pitch-shift quality warning message
 * Returns undefined if quality is good or excellent
 */
export function getPitchShiftWarning(
  midiNote: number,
  sampleId: string
): string | undefined {
  // Only applies to sampled instruments
  if (!sampleId.startsWith('sampled:')) {
    return undefined;
  }

  const shift = getPitchShiftAmount(midiNote, sampleId);
  const quality = getPitchShiftQuality(midiNote, sampleId);

  if (quality === 'excellent' || quality === 'good') {
    return undefined;
  }

  if (quality === 'fair') {
    return `${shift} semitone pitch shift - may have subtle artifacts`;
  }
  if (quality === 'poor') {
    return `${shift} semitone pitch shift - noticeable chipmunk effect`;
  }
  return `${shift} semitone pitch shift - significant quality degradation`;
}

/**
 * Check if a sampled instrument would benefit from pitch-shift quality indication
 * Returns true for sampled instruments with sparse sample coverage
 */
export function needsPitchShiftWarning(sampleId: string): boolean {
  return sampleId.startsWith('sampled:') && SAMPLED_INSTRUMENT_NOTES[sampleId] !== undefined;
}
