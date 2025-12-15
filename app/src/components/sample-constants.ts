/**
 * Constants for sample and synth picker
 * Separated from SamplePicker.tsx to enable fast refresh
 */

// Friendly display names for samples
// Exported for testing - ensures parity with types.ts
export const SAMPLE_NAMES: Record<string, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hi-Hat',
  clap: 'Clap',
  tom: 'Tom',
  rim: 'Rim',
  cowbell: 'Cowbell',
  openhat: 'Open Hat',
  bass: 'Bass',
  subbass: 'Sub Bass',
  lead: 'Lead',
  pluck: 'Pluck',
  chord: 'Chord',
  pad: 'Pad',
  zap: 'Zap',
  noise: 'Noise',
};

// Real-time synth presets (not sample-based) - organized by genre
// Exported for testing - ensures UI stays in sync with synth.ts
export const SYNTH_CATEGORIES = {
  core: ['synth:bass', 'synth:lead', 'synth:pad', 'synth:pluck', 'synth:acid'],
  keys: ['synth:rhodes', 'synth:organ', 'synth:wurlitzer', 'synth:clavinet'],
  genre: ['synth:funkbass', 'synth:discobass', 'synth:strings', 'synth:brass', 'synth:stab', 'synth:sub'],
  ambient: ['synth:shimmer', 'synth:jangle', 'synth:dreampop', 'synth:bell'],
} as const;

export const SYNTH_NAMES: Record<string, string> = {
  'synth:bass': 'Bass',
  'synth:lead': 'Lead',
  'synth:pad': 'Pad',
  'synth:pluck': 'Pluck',
  'synth:acid': 'Acid',
  'synth:rhodes': 'Rhodes',
  'synth:organ': 'Organ',
  'synth:wurlitzer': 'Wurli',
  'synth:clavinet': 'Clav',
  'synth:funkbass': 'Funk',
  'synth:discobass': 'Disco',
  'synth:strings': 'Strings',
  'synth:brass': 'Brass',
  'synth:stab': 'Stab',
  'synth:sub': 'Sub',
  'synth:shimmer': 'Shimmer',
  'synth:jangle': 'Jangle',
  'synth:dreampop': 'Dream',
  'synth:bell': 'Bell',
};

// Tone.js synth presets - FM, AM, Membrane, Metal synthesis
export const TONE_SYNTH_CATEGORIES = {
  fm: ['tone:fm-epiano', 'tone:fm-bass', 'tone:fm-bell'],
  drum: ['tone:membrane-kick', 'tone:membrane-tom', 'tone:metal-cymbal', 'tone:metal-hihat'],
  modulation: ['tone:am-bell', 'tone:am-tremolo', 'tone:pluck-string', 'tone:duo-lead'],
} as const;

export const TONE_SYNTH_NAMES: Record<string, string> = {
  'tone:fm-epiano': 'E-Piano',
  'tone:fm-bass': 'FM Bass',
  'tone:fm-bell': 'FM Bell',
  'tone:membrane-kick': 'Membrane',
  'tone:membrane-tom': 'Tom',
  'tone:metal-cymbal': 'Cymbal',
  'tone:metal-hihat': 'Metal HH',
  'tone:am-bell': 'AM Bell',
  'tone:am-tremolo': 'Tremolo',
  'tone:pluck-string': 'String',
  'tone:duo-lead': 'Duo',
};

// Advanced dual-oscillator synth presets
export const ADVANCED_SYNTH_CATEGORIES = {
  leads: ['advanced:supersaw', 'advanced:thick-lead', 'advanced:vibrato-lead'],
  bass: ['advanced:sub-bass', 'advanced:wobble-bass', 'advanced:acid-bass'],
  pads: ['advanced:warm-pad', 'advanced:tremolo-strings'],
} as const;

export const ADVANCED_SYNTH_NAMES: Record<string, string> = {
  'advanced:supersaw': 'Supersaw',
  'advanced:thick-lead': 'Thick',
  'advanced:vibrato-lead': 'Vibrato',
  'advanced:sub-bass': 'Deep Sub',
  'advanced:wobble-bass': 'Wobble',
  'advanced:acid-bass': 'Acid 303',
  'advanced:warm-pad': 'Warm Pad',
  'advanced:tremolo-strings': 'Strings',
};

// Combined lookup for all synth display names
export const ALL_SYNTH_NAMES: Record<string, string> = {
  ...SYNTH_NAMES,
  ...TONE_SYNTH_NAMES,
  ...ADVANCED_SYNTH_NAMES,
};
