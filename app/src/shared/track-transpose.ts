/**
 * Default transpose for a newly added track.
 *
 * Synth, Tone.js, advanced, and sampled instruments all play pitch 0 at C4
 * (MIDI 60). That is the right home for keys, leads, and pads, but it puts a
 * bass at the top of its register and a synthesized kick an octave or two
 * above where a kick lives. A new track therefore starts in the instrument's
 * natural octave, as a visible transpose the user can change.
 *
 * Procedural samples (`bass`, `subbass`) are recorded at their own low pitch
 * (A1, E1) and play pitch 0 at that native pitch, so they need no offset.
 *
 * Only track creation uses this. Changing an existing track's instrument keeps
 * its transpose (specs/CHANGE-INSTRUMENT.md), and saved sessions keep theirs.
 */
const RECOMMENDED_TRANSPOSE: Readonly<Record<string, number>> = {
  // Bass voices: pitch 0 = C3, the centre of the grid covers C1–C5.
  'sampled:finger-bass': -12,
  'sampled:slap-bass': -12,
  'synth:bass': -12,
  'synth:acid': -12,
  'synth:funkbass': -12,
  'synth:discobass': -12,
  'synth:reese': -12,
  'synth:hoover': -12,
  'tone:fm-bass': -12,
  'advanced:wobble-bass': -12,
  'advanced:acid-bass': -12,
  // Sub basses and the synthesized kick: pitch 0 = C2.
  'synth:sub': -24,
  'advanced:sub-bass': -24,
  'tone:membrane-kick': -24,
};

export function recommendedTrackTranspose(sampleId: string): number {
  return RECOMMENDED_TRANSPOSE[sampleId] ?? 0;
}
