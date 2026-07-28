/** Canonical runtime-neutral instrument vocabulary. */

export const INSTRUMENT_GROUPS = {
  drums: {
    label: "Drums",
    instruments: [
      { id: "sampled:808-kick", name: "808 Kick", type: "sampled" },
      { id: "sampled:808-snare", name: "808 Snare", type: "sampled" },
      { id: "sampled:808-hihat-closed", name: "808 Hat", type: "sampled" },
      { id: "sampled:808-hihat-open", name: "808 Open", type: "sampled" },
      { id: "sampled:808-clap", name: "808 Clap", type: "sampled" },
      { id: "sampled:acoustic-kick", name: "Ac. Kick", type: "sampled" },
      { id: "sampled:acoustic-snare", name: "Ac. Snare", type: "sampled" },
      { id: "sampled:acoustic-hihat-closed", name: "Ac. Hat", type: "sampled" },
      { id: "sampled:acoustic-hihat-open", name: "Ac. Open", type: "sampled" },
      { id: "sampled:acoustic-ride", name: "Ride", type: "sampled" },
      { id: "sampled:acoustic-crash", name: "Crash", type: "sampled" },
      { id: "sampled:brushes-snare", name: "Brush Snare", type: "sampled" },
      { id: "kick", name: "Kick", type: "sample" },
      { id: "snare", name: "Snare", type: "sample" },
      { id: "hihat", name: "Hi-Hat", type: "sample" },
      { id: "clap", name: "Clap", type: "sample" },
      { id: "tom", name: "Tom", type: "sample" },
      { id: "rim", name: "Rim", type: "sample" },
      { id: "cowbell", name: "Cowbell", type: "sample" },
      { id: "openhat", name: "Open Hat", type: "sample" },
      { id: "shaker", name: "Shaker", type: "sample" },
      { id: "conga", name: "Conga", type: "sample" },
      { id: "tambourine", name: "Tamb", type: "sample" },
      { id: "clave", name: "Clave", type: "sample" },
      { id: "cabasa", name: "Cabasa", type: "sample" },
      { id: "woodblock", name: "Wood", type: "sample" },
      { id: "tone:membrane-kick", name: "Synth Kick", type: "tone" },
      { id: "tone:membrane-tom", name: "Synth Tom", type: "tone" },
      { id: "tone:metal-cymbal", name: "Cymbal", type: "tone" },
      { id: "tone:metal-hihat", name: "Metal Hat", type: "tone" },
    ],
  },
  bass: {
    label: "Bass",
    instruments: [
      { id: "sampled:finger-bass", name: "Finger", type: "sampled" },
      { id: "sampled:slap-bass", name: "Slap", type: "sampled" },
      { id: "bass", name: "Bass", type: "sample" },
      { id: "subbass", name: "Sub", type: "sample" },
      { id: "synth:bass", name: "Synth", type: "synth" },
      { id: "synth:acid", name: "Acid", type: "synth" },
      { id: "synth:sub", name: "Deep Sub", type: "synth" },
      { id: "synth:funkbass", name: "Funk", type: "synth" },
      { id: "synth:discobass", name: "Disco", type: "synth" },
      { id: "synth:reese", name: "Reese", type: "synth" },
      { id: "synth:hoover", name: "Hoover", type: "synth" },
      { id: "tone:fm-bass", name: "FM Bass", type: "tone" },
      { id: "advanced:sub-bass", name: "Sub Bass", type: "advanced" },
      { id: "advanced:wobble-bass", name: "Wobble Bass", type: "advanced" },
      { id: "advanced:acid-bass", name: "Acid 303", type: "advanced" },
    ],
  },
  keys: {
    label: "Keys",
    instruments: [
      { id: "sampled:piano", name: "Piano", type: "sampled" },
      { id: "sampled:vibraphone", name: "Vibes", type: "sampled" },
      { id: "sampled:marimba", name: "Marimba", type: "sampled" },
      { id: "sampled:kalimba", name: "Kalimba", type: "sampled" },
      { id: "sampled:steel-drums", name: "Steel Pan", type: "sampled" },
      { id: "sampled:hammond-organ", name: "Hammond", type: "sampled" },
      { id: "synth:rhodes", name: "Synth Rhodes", type: "synth" },
      { id: "synth:wurlitzer", name: "Wurli", type: "synth" },
      { id: "synth:epiano", name: "E-Piano", type: "synth" },
      { id: "synth:vibes", name: "Synth Vibes", type: "synth" },
      { id: "tone:fm-epiano", name: "FM Piano", type: "tone" },
      { id: "synth:organ", name: "Organ", type: "synth" },
      { id: "synth:organphase", name: "Phaser", type: "synth" },
      { id: "synth:clavinet", name: "Clav", type: "synth" },
    ],
  },
  leads: {
    label: "Leads",
    instruments: [
      { id: "sampled:alto-sax", name: "Alto Sax", type: "sampled" },
      { id: "sampled:clean-guitar", name: "Clean Guitar", type: "sampled" },
      { id: "sampled:acoustic-guitar", name: "Acoustic", type: "sampled" },
      { id: "lead", name: "Lead", type: "sample" },
      { id: "pluck", name: "Pluck", type: "sample" },
      { id: "synth:lead", name: "Classic", type: "synth" },
      { id: "synth:pluck", name: "Synth Pluck", type: "synth" },
      { id: "synth:supersaw", name: "Supersaw", type: "synth" },
      { id: "synth:hypersaw", name: "Hypersaw", type: "synth" },
      { id: "tone:pluck-string", name: "String", type: "tone" },
      { id: "tone:duo-lead", name: "Duo", type: "tone" },
      { id: "advanced:supersaw", name: "Fat Saw", type: "advanced" },
      { id: "advanced:thick-lead", name: "Thick", type: "advanced" },
      { id: "advanced:vibrato-lead", name: "Vibrato", type: "advanced" },
    ],
  },
  pads: {
    label: "Pads",
    instruments: [
      { id: "sampled:string-section", name: "Strings", type: "sampled" },
      { id: "sampled:french-horn", name: "Horn", type: "sampled" },
      { id: "pad", name: "Pad", type: "sample" },
      { id: "chord", name: "Chord", type: "sample" },
      { id: "synth:pad", name: "Soft", type: "synth" },
      { id: "synth:warmpad", name: "Warm", type: "synth" },
      { id: "synth:strings", name: "Synth Str", type: "synth" },
      { id: "synth:shimmer", name: "Shimmer", type: "synth" },
      { id: "synth:dreampop", name: "Dream", type: "synth" },
      { id: "synth:glass", name: "Glass", type: "synth" },
      { id: "synth:jangle", name: "Jangle", type: "synth" },
      { id: "synth:evolving", name: "Evolve", type: "synth" },
      { id: "synth:sweep", name: "Sweep", type: "synth" },
      { id: "advanced:warm-pad", name: "Lush", type: "advanced" },
      { id: "advanced:tremolo-strings", name: "Trem Str", type: "advanced" },
    ],
  },
  fx: {
    label: "FX",
    instruments: [
      { id: "sampled:vinyl-crackle", name: "Vinyl", type: "sampled" },
      { id: "zap", name: "Zap", type: "sample" },
      { id: "noise", name: "Noise", type: "sample" },
      { id: "synth:bell", name: "Bell", type: "synth" },
      { id: "synth:stab", name: "Stab", type: "synth" },
      { id: "synth:brass", name: "Brass", type: "synth" },
      { id: "synth:wobble", name: "Wobble", type: "synth" },
      { id: "synth:growl", name: "Growl", type: "synth" },
      { id: "tone:fm-bell", name: "FM Bell", type: "tone" },
      { id: "tone:am-bell", name: "AM Bell", type: "tone" },
      { id: "tone:am-tremolo", name: "Tremolo", type: "tone" },
    ],
  },
} as const;

export const INSTRUMENT_CATEGORY_ORDER = ['drums', 'bass', 'keys', 'leads', 'pads', 'fx'] as const;
export type InstrumentCategory = keyof typeof INSTRUMENT_GROUPS;
export type CatalogInstrument = typeof INSTRUMENT_GROUPS[InstrumentCategory]['instruments'][number];

export const VALID_SAMPLE_IDS: Set<string> = new Set(
  Object.values(INSTRUMENT_GROUPS).flatMap(group =>
    group.instruments.map(instrument => instrument.id),
  ),
);

/** Persisted-only IDs: accepted by session validation, never by the picker. */
export const LEGACY_UNAVAILABLE_SAMPLE_IDS: ReadonlySet<string> = new Set([
  'sampled:rhodes-ep',
  'synth:rhodes-ep',
]);

const LEGACY_UNAVAILABLE_NAMES: Readonly<Record<string, string>> = {
  'sampled:rhodes-ep': 'Rhodes EP (Unavailable — choose synth:rhodes)',
  'synth:rhodes-ep': 'Rhodes EP (Unavailable — choose synth:rhodes)',
};

const INSTRUMENT_NAMES: ReadonlyMap<string, string> = new Map(
  Object.values(INSTRUMENT_GROUPS).flatMap(group =>
    group.instruments.map(instrument => [instrument.id, instrument.name] as const),
  ),
);

export function getInstrumentName(id: string): string {
  return INSTRUMENT_NAMES.get(id)
    ?? LEGACY_UNAVAILABLE_NAMES[id]
    ?? id.split(':').pop()
    ?? id;
}

