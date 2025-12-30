/**
 * Constants for sample and synth picker
 * Organized by MUSICAL FUNCTION (not engine type) for intuitive browsing
 */

// Unified instrument organization by musical function
// Users don't care about the engine - they want sounds that fit their track
export const INSTRUMENT_CATEGORIES = {
  drums: {
    label: 'Drums',
    color: '#e67e22', // Orange
    instruments: [
      // 808 Kit (Phase 29A)
      { id: 'sampled:808-kick', name: '808 Kick', type: 'sampled' },
      { id: 'sampled:808-snare', name: '808 Snare', type: 'sampled' },
      { id: 'sampled:808-hihat-closed', name: '808 Hat', type: 'sampled' },
      { id: 'sampled:808-hihat-open', name: '808 Open', type: 'sampled' },
      { id: 'sampled:808-clap', name: '808 Clap', type: 'sampled' },
      // Acoustic Kit (Phase 29A)
      { id: 'sampled:acoustic-kick', name: 'Ac. Kick', type: 'sampled' },
      { id: 'sampled:acoustic-snare', name: 'Ac. Snare', type: 'sampled' },
      { id: 'sampled:acoustic-hihat-closed', name: 'Ac. Hat', type: 'sampled' },
      { id: 'sampled:acoustic-hihat-open', name: 'Ac. Open', type: 'sampled' },
      { id: 'sampled:acoustic-ride', name: 'Ride', type: 'sampled' },
      // Procedural kit (legacy)
      { id: 'kick', name: 'Kick', type: 'sample' },
      { id: 'snare', name: 'Snare', type: 'sample' },
      { id: 'hihat', name: 'Hi-Hat', type: 'sample' },
      { id: 'clap', name: 'Clap', type: 'sample' },
      { id: 'tom', name: 'Tom', type: 'sample' },
      { id: 'rim', name: 'Rim', type: 'sample' },
      { id: 'cowbell', name: 'Cowbell', type: 'sample' },
      { id: 'openhat', name: 'Open Hat', type: 'sample' },
      // World/Latin percussion
      { id: 'shaker', name: 'Shaker', type: 'sample' },
      { id: 'conga', name: 'Conga', type: 'sample' },
      { id: 'tambourine', name: 'Tamb', type: 'sample' },
      { id: 'clave', name: 'Clave', type: 'sample' },
      { id: 'cabasa', name: 'Cabasa', type: 'sample' },
      { id: 'woodblock', name: 'Wood', type: 'sample' },
      // Synthesized drums
      { id: 'tone:membrane-kick', name: 'Synth Kick', type: 'tone' },
      { id: 'tone:membrane-tom', name: 'Synth Tom', type: 'tone' },
      { id: 'tone:metal-cymbal', name: 'Cymbal', type: 'tone' },
      { id: 'tone:metal-hihat', name: 'Metal Hat', type: 'tone' },
    ],
  },
  bass: {
    label: 'Bass',
    color: '#9b59b6', // Purple
    instruments: [
      // Sampled (Phase 29A)
      { id: 'sampled:finger-bass', name: 'Finger', type: 'sampled' },
      // Procedural samples
      { id: 'bass', name: 'Bass', type: 'sample' },
      { id: 'subbass', name: 'Sub', type: 'sample' },
      // Web Audio synths
      { id: 'synth:bass', name: 'Synth', type: 'synth' },
      { id: 'synth:acid', name: 'Acid', type: 'synth' },
      { id: 'synth:sub', name: 'Deep Sub', type: 'synth' },
      { id: 'synth:funkbass', name: 'Funk', type: 'synth' },
      { id: 'synth:discobass', name: 'Disco', type: 'synth' },
      { id: 'synth:reese', name: 'Reese', type: 'synth' },
      { id: 'synth:hoover', name: 'Hoover', type: 'synth' },
      // Tone.js
      { id: 'tone:fm-bass', name: 'FM Bass', type: 'tone' },
      // Advanced
      { id: 'advanced:sub-bass', name: 'Sub Bass', type: 'advanced' },
      { id: 'advanced:wobble-bass', name: 'Wobble', type: 'advanced' },
      { id: 'advanced:acid-bass', name: 'Acid 303', type: 'advanced' },
    ],
  },
  keys: {
    label: 'Keys',
    color: '#3498db', // Blue
    instruments: [
      // Sampled
      { id: 'sampled:piano', name: 'Piano', type: 'sampled' },
      { id: 'sampled:vibraphone', name: 'Vibes', type: 'sampled' },
      { id: 'sampled:marimba', name: 'Marimba', type: 'sampled' },
      { id: 'sampled:rhodes-ep', name: 'Rhodes', type: 'sampled' },
      // Electric pianos
      { id: 'synth:rhodes', name: 'Rhodes', type: 'synth' },
      { id: 'synth:wurlitzer', name: 'Wurli', type: 'synth' },
      { id: 'synth:epiano', name: 'E-Piano', type: 'synth' },
      { id: 'tone:fm-epiano', name: 'FM Piano', type: 'tone' },
      // Organs
      { id: 'synth:organ', name: 'Organ', type: 'synth' },
      { id: 'synth:organphase', name: 'Phaser', type: 'synth' },
      // Other keys
      { id: 'synth:clavinet', name: 'Clav', type: 'synth' },
    ],
  },
  leads: {
    label: 'Leads',
    color: '#e91e63', // Pink
    instruments: [
      // Sampled (Phase 29C/29D)
      { id: 'sampled:alto-sax', name: 'Alto Sax', type: 'sampled' },
      { id: 'sampled:clean-guitar', name: 'Clean Guitar', type: 'sampled' },
      { id: 'sampled:acoustic-guitar', name: 'Acoustic', type: 'sampled' },
      // Sample
      { id: 'lead', name: 'Lead', type: 'sample' },
      { id: 'pluck', name: 'Pluck', type: 'sample' },
      // Synth leads
      { id: 'synth:lead', name: 'Classic', type: 'synth' },
      { id: 'synth:pluck', name: 'Synth Pluck', type: 'synth' },
      { id: 'synth:supersaw', name: 'Supersaw', type: 'synth' },
      { id: 'synth:hypersaw', name: 'Hypersaw', type: 'synth' },
      // Tone.js
      { id: 'tone:pluck-string', name: 'String', type: 'tone' },
      { id: 'tone:duo-lead', name: 'Duo', type: 'tone' },
      // Advanced
      { id: 'advanced:supersaw', name: 'Fat Saw', type: 'advanced' },
      { id: 'advanced:thick-lead', name: 'Thick', type: 'advanced' },
      { id: 'advanced:vibrato-lead', name: 'Vibrato', type: 'advanced' },
    ],
  },
  pads: {
    label: 'Pads',
    color: '#2ecc71', // Green
    instruments: [
      // Sampled (Phase 29C)
      { id: 'sampled:string-section', name: 'Strings', type: 'sampled' },
      { id: 'sampled:french-horn', name: 'Horn', type: 'sampled' },
      // Samples
      { id: 'pad', name: 'Pad', type: 'sample' },
      { id: 'chord', name: 'Chord', type: 'sample' },
      // Synth pads
      { id: 'synth:pad', name: 'Soft', type: 'synth' },
      { id: 'synth:warmpad', name: 'Warm', type: 'synth' },
      { id: 'synth:strings', name: 'Synth Str', type: 'synth' },
      { id: 'synth:shimmer', name: 'Shimmer', type: 'synth' },
      { id: 'synth:dreampop', name: 'Dream', type: 'synth' },
      { id: 'synth:glass', name: 'Glass', type: 'synth' },
      { id: 'synth:jangle', name: 'Jangle', type: 'synth' },
      { id: 'synth:evolving', name: 'Evolve', type: 'synth' },
      { id: 'synth:sweep', name: 'Sweep', type: 'synth' },
      // Advanced
      { id: 'advanced:warm-pad', name: 'Lush', type: 'advanced' },
      { id: 'advanced:tremolo-strings', name: 'Tremolo', type: 'advanced' },
    ],
  },
  fx: {
    label: 'FX',
    color: '#00bcd4', // Cyan
    instruments: [
      // Sampled (Phase 29A)
      { id: 'sampled:vinyl-crackle', name: 'Vinyl', type: 'sampled' },
      // Procedural samples
      { id: 'zap', name: 'Zap', type: 'sample' },
      { id: 'noise', name: 'Noise', type: 'sample' },
      // Synth FX
      { id: 'synth:bell', name: 'Bell', type: 'synth' },
      { id: 'synth:stab', name: 'Stab', type: 'synth' },
      { id: 'synth:brass', name: 'Brass', type: 'synth' },
      { id: 'synth:wobble', name: 'Wobble', type: 'synth' },
      { id: 'synth:growl', name: 'Growl', type: 'synth' },
      // Tone.js bells
      { id: 'tone:fm-bell', name: 'FM Bell', type: 'tone' },
      { id: 'tone:am-bell', name: 'AM Bell', type: 'tone' },
      { id: 'tone:am-tremolo', name: 'Tremolo', type: 'tone' },
    ],
  },
} as const;

// Category order for rendering
export const CATEGORY_ORDER = ['drums', 'bass', 'keys', 'leads', 'pads', 'fx'] as const;

// Type definitions
export type InstrumentCategory = keyof typeof INSTRUMENT_CATEGORIES;
export type Instrument = typeof INSTRUMENT_CATEGORIES[InstrumentCategory]['instruments'][number];

// Helper to get display name for any instrument ID
export function getInstrumentName(id: string): string {
  for (const category of Object.values(INSTRUMENT_CATEGORIES)) {
    const instrument = category.instruments.find(i => i.id === id);
    if (instrument) return instrument.name;
  }
  // Fallback: extract name from ID
  return id.split(':').pop() || id;
}

// Legacy exports for backwards compatibility
// These are still used by other parts of the codebase
export const SAMPLE_NAMES: Record<string, string> = {
  // Core kit
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hi-Hat',
  clap: 'Clap',
  tom: 'Tom',
  rim: 'Rim',
  cowbell: 'Cowbell',
  openhat: 'Open Hat',
  // World/Latin percussion
  shaker: 'Shaker',
  conga: 'Conga',
  tambourine: 'Tambourine',
  clave: 'Clave',
  cabasa: 'Cabasa',
  woodblock: 'Woodblock',
  // Bass
  bass: 'Bass',
  subbass: 'Sub Bass',
  // Synth
  lead: 'Lead',
  pluck: 'Pluck',
  chord: 'Chord',
  pad: 'Pad',
  // FX
  zap: 'Zap',
  noise: 'Noise',
};

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
  'synth:epiano': 'E-Piano',
  'synth:vibes': 'Vibes',
  'synth:organphase': 'Phase',
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
  'synth:evolving': 'Evolving',
  'synth:sweep': 'Sweep',
  'synth:warmpad': 'Warm',
  'synth:glass': 'Glass',
  'synth:supersaw': 'Supersaw',
  'synth:hypersaw': 'Hypersaw',
  'synth:wobble': 'Wobble',
  'synth:growl': 'Growl',
  'synth:reese': 'Reese',
  'synth:hoover': 'Hoover',
};

export const TONE_SYNTH_NAMES: Record<string, string> = {
  'tone:fm-epiano': 'E-Piano',
  'tone:fm-bass': 'FM Bass',
  'tone:fm-bell': 'Bell',
  'tone:membrane-kick': 'Membrane',
  'tone:membrane-tom': 'Tom',
  'tone:metal-cymbal': 'Cymbal',
  'tone:metal-hihat': 'Hi-Hat',
  'tone:pluck-string': 'Pluck',
  'tone:duo-lead': 'Duo Lead',
  'tone:am-bell': 'AM Bell',
  'tone:am-tremolo': 'Tremolo',
};

export const ADVANCED_SYNTH_NAMES: Record<string, string> = {
  'advanced:supersaw': 'Supersaw',
  'advanced:thick-lead': 'Thick',
  'advanced:vibrato-lead': 'Vibrato',
  'advanced:sub-bass': 'Sub',
  'advanced:wobble-bass': 'Wobble',
  'advanced:acid-bass': 'Acid',
  'advanced:warm-pad': 'Warm Pad',
  'advanced:tremolo-strings': 'Strings',
};

export const SAMPLED_NAMES: Record<string, string> = {
  'sampled:piano': 'Piano',
  // Phase 29A: Essential Samples
  'sampled:808-kick': '808 Kick',
  'sampled:808-snare': '808 Snare',
  'sampled:808-hihat-closed': '808 Hat',
  'sampled:808-hihat-open': '808 Open',
  'sampled:808-clap': '808 Clap',
  'sampled:acoustic-kick': 'Ac. Kick',
  'sampled:acoustic-snare': 'Ac. Snare',
  'sampled:acoustic-hihat-closed': 'Ac. Hat',
  'sampled:acoustic-hihat-open': 'Ac. Open',
  'sampled:acoustic-ride': 'Ride',
  'sampled:finger-bass': 'Finger Bass',
  'sampled:vinyl-crackle': 'Vinyl',
  // Phase 29C: Expressive Samples
  'sampled:vibraphone': 'Vibes',
  'sampled:string-section': 'Strings',
  'sampled:rhodes-ep': 'Rhodes',
  'sampled:french-horn': 'Horn',
  'sampled:alto-sax': 'Alto Sax',
  // Phase 29D: Complete Collection
  'sampled:clean-guitar': 'Clean Guitar',
  'sampled:acoustic-guitar': 'Acoustic',
  'sampled:marimba': 'Marimba',
};

// Legacy category exports (for backwards compatibility with tests)
export const SYNTH_CATEGORIES = {
  core: ['synth:bass', 'synth:lead', 'synth:pad', 'synth:pluck', 'synth:acid'],
  keys: ['synth:rhodes', 'synth:organ', 'synth:wurlitzer', 'synth:clavinet', 'synth:epiano', 'synth:vibes', 'synth:organphase'],
  genre: ['synth:funkbass', 'synth:discobass', 'synth:strings', 'synth:brass', 'synth:stab', 'synth:sub'],
  ambient: ['synth:shimmer', 'synth:jangle', 'synth:dreampop', 'synth:bell', 'synth:evolving', 'synth:sweep', 'synth:warmpad', 'synth:glass'],
  electronic: ['synth:supersaw', 'synth:hypersaw', 'synth:wobble', 'synth:growl'],
  bass: ['synth:reese', 'synth:hoover'],
} as const;

export const TONE_SYNTH_CATEGORIES = {
  fm: ['tone:fm-epiano', 'tone:fm-bass', 'tone:fm-bell'],
  drum: ['tone:membrane-kick', 'tone:membrane-tom', 'tone:metal-cymbal', 'tone:metal-hihat'],
  other: ['tone:pluck-string', 'tone:duo-lead', 'tone:am-bell', 'tone:am-tremolo'],
} as const;

export const ADVANCED_SYNTH_CATEGORIES = {
  leads: ['advanced:supersaw', 'advanced:thick-lead', 'advanced:vibrato-lead'],
  bass: ['advanced:sub-bass', 'advanced:wobble-bass', 'advanced:acid-bass'],
  pads: ['advanced:warm-pad', 'advanced:tremolo-strings'],
} as const;

export const SAMPLED_CATEGORIES = {
  keys: ['sampled:piano', 'sampled:vibraphone', 'sampled:marimba', 'sampled:rhodes-ep'],
  // Phase 29A: Essential Samples
  drums: [
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
  ],
  bass: ['sampled:finger-bass'],
  fx: ['sampled:vinyl-crackle'],
  // Phase 29C: Expressive Samples
  pads: ['sampled:string-section', 'sampled:french-horn'],
  leads: ['sampled:alto-sax', 'sampled:clean-guitar', 'sampled:acoustic-guitar'],
} as const;
