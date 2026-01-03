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
