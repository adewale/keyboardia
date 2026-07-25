/**
 * Browser presentation metadata for the runtime-neutral instrument catalogue.
 * Canonical IDs and names live in shared/instrument-catalog.ts.
 */
import {
  INSTRUMENT_GROUPS,
  INSTRUMENT_CATEGORY_ORDER,
  VALID_SAMPLE_IDS as CATALOG_SAMPLE_IDS,
  LEGACY_UNAVAILABLE_SAMPLE_IDS as CATALOG_LEGACY_SAMPLE_IDS,
  getInstrumentName as getCatalogInstrumentName,
  isValidSampleId as isCatalogSampleId,
  getCanonicalSampleId as getCatalogSampleId,
} from '../shared/instrument-catalog';

export const INSTRUMENT_CATEGORIES = {
  drums: {
    ...INSTRUMENT_GROUPS.drums,
    color: '#e67e22',
    cssVar: '--color-drums',
  },
  bass: {
    ...INSTRUMENT_GROUPS.bass,
    color: '#9b59b6',
    cssVar: '--color-bass',
  },
  keys: {
    ...INSTRUMENT_GROUPS.keys,
    color: '#3498db',
    cssVar: '--color-keys',
  },
  leads: {
    ...INSTRUMENT_GROUPS.leads,
    color: '#e91e63',
    cssVar: '--color-leads',
  },
  pads: {
    ...INSTRUMENT_GROUPS.pads,
    color: '#2ecc71',
    cssVar: '--color-pads',
  },
  fx: {
    ...INSTRUMENT_GROUPS.fx,
    color: '#00bcd4',
    cssVar: '--color-fx',
  },
} as const;

// Category order for rendering
export const CATEGORY_ORDER = INSTRUMENT_CATEGORY_ORDER;

// Type definitions
export type InstrumentCategory = keyof typeof INSTRUMENT_CATEGORIES;
export type Instrument = typeof INSTRUMENT_CATEGORIES[InstrumentCategory]['instruments'][number];

// Helper to get display name for any instrument ID
export const getInstrumentName = getCatalogInstrumentName;

// Phase 31C: Helper to get category key for an instrument ID
export function getInstrumentCategory(id: string): InstrumentCategory | null {
  for (const [categoryKey, category] of Object.entries(INSTRUMENT_CATEGORIES)) {
    if (category.instruments.some(i => i.id === id)) {
      return categoryKey as InstrumentCategory;
    }
  }
  return null;
}

/**
 * Set of all valid sample/instrument IDs for validation
 * Used to validate session data before upload
 */
export const VALID_SAMPLE_IDS: Set<string> = CATALOG_SAMPLE_IDS;

/** Persisted-only IDs: accepted by session validation, never by the picker. */
export const LEGACY_UNAVAILABLE_SAMPLE_IDS: ReadonlySet<string> = CATALOG_LEGACY_SAMPLE_IDS;

/**
 * Check if a sampleId is valid (exists in the instrument catalog)
 * @param sampleId - The ID to validate (e.g., 'kick', 'sampled:808-kick', 'synth:bass')
 * @returns true if the sampleId is a known instrument
 */
export const isValidSampleId = isCatalogSampleId;

/**
 * Get the canonical ID for debugging/tooltips
 * This is the same as the input ID - just validates and returns it
 */
export const getCanonicalSampleId = getCatalogSampleId;

// Phase 31C: Get category color CSS variable for an instrument ID
export function getInstrumentCategoryColor(id: string): string {
  const category = getInstrumentCategory(id);
  if (!category) return 'var(--color-text-muted)';
  return `var(${INSTRUMENT_CATEGORIES[category].cssVar})`;
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
  'advanced:wobble-bass': 'Wobble Bass',
  'advanced:acid-bass': 'Acid',
  'advanced:warm-pad': 'Warm Pad',
  'advanced:tremolo-strings': 'Trem Str',
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
  'sampled:acoustic-crash': 'Crash',
  'sampled:brushes-snare': 'Brush Snare',
  'sampled:finger-bass': 'Finger Bass',
  'sampled:vinyl-crackle': 'Vinyl',
  // Phase 29C: Expressive Samples
  'sampled:vibraphone': 'Vibes',
  'sampled:string-section': 'Strings',
  'sampled:rhodes-ep': 'Rhodes EP (Unavailable — choose synth:rhodes)',
  'synth:rhodes-ep': 'Rhodes EP (Unavailable — choose synth:rhodes)',
  'sampled:french-horn': 'Horn',
  'sampled:alto-sax': 'Alto Sax',
  // Phase 29D: Complete Collection
  'sampled:clean-guitar': 'Clean Guitar',
  'sampled:acoustic-guitar': 'Acoustic',
  'sampled:marimba': 'Marimba',
  // Phase 29E: New instruments
  'sampled:kalimba': 'Kalimba',
  'sampled:slap-bass': 'Slap Bass',
  'sampled:steel-drums': 'Steel Pan',
  'sampled:hammond-organ': 'Hammond',
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
  keys: ['sampled:piano', 'sampled:vibraphone', 'sampled:marimba', 'sampled:kalimba', 'sampled:steel-drums', 'sampled:hammond-organ'],
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
    'sampled:acoustic-crash',
    'sampled:brushes-snare',
  ],
  bass: ['sampled:finger-bass', 'sampled:slap-bass'],
  fx: ['sampled:vinyl-crackle'],
  // Phase 29C: Expressive Samples
  pads: ['sampled:string-section', 'sampled:french-horn'],
  leads: ['sampled:alto-sax', 'sampled:clean-guitar', 'sampled:acoustic-guitar'],
} as const;


/**
 * Is this instrument melodic (pitched) rather than percussive?
 *
 * Lives here rather than in TrackRow.tsx because it is pure logic over the
 * category tables above, and TrackRow.tsx cannot be imported from a node-env
 * test — it pulls in src/audio/engine.ts, which reads `window` at module load.
 * That import barrier is why TrackRow.test.ts previously kept its own drifted
 * copy of this function ('sampled:' -> always melodic, dropping the drums
 * check entirely).
 */
export function isMelodicInstrument(sampleId: string): boolean {
  // All synth: prefixed instruments are melodic
  if (sampleId.startsWith('synth:')) return true;
  // All advanced: prefixed instruments are melodic
  if (sampleId.startsWith('advanced:')) return true;
  // Sampled instruments - melodic unless in drums category
  if (sampleId.startsWith('sampled:')) {
    // Use shared drum list from sample-constants
    return !SAMPLED_CATEGORIES.drums.includes(sampleId as typeof SAMPLED_CATEGORIES.drums[number]);
  }
  // Tone.js synths - some are melodic, some are drums
  if (sampleId.startsWith('tone:')) {
    // Use shared drum synth list from sample-constants
    // TONE_SYNTH_CATEGORIES.drum already holds fully-prefixed ids
    // ('tone:membrane-kick'), so do NOT prepend 'tone:' again. Doing so compared
    // against 'tone:tone:membrane-kick', never matched, and classified every
    // Tone.js drum synth as melodic — they showed the pitched keyboard view in
    // the UI. TrackRow.test.ts hid this for as long as it existed by testing its
    // own inline copy of both the list and the logic, which were correct.
    return !TONE_SYNTH_CATEGORIES.drum.includes(
      sampleId as typeof TONE_SYNTH_CATEGORIES.drum[number]
    );
  }
  // Regular samples (kick, snare, etc.) are percussive, not melodic
  return false;
}
