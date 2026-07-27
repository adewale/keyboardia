/**
 * Instrument role classification.
 *
 * This is the single drum catalogue. Four consumers depend on it — TrackRow
 * (whether to offer the chromatic keyboard), PitchOverview (which tracks to
 * plot), midiExport (channel 10), and the worker's MCP lifecycle — and it lives
 * in shared/ because the worker cannot import from components/.
 *
 * It replaced two other classifiers during the July 2026 audit, both of which
 * decided the same question from `sampled:` / `tone:` prefixes plus a local
 * drum list. That approach is what these tests are aimed at, because it failed
 * in two opposite directions at once:
 *
 *   - a prefix list has to be kept in step with the catalogue by hand, and
 *     had already drifted (a `tone:` drum was classified melodic);
 *   - anything without a recognised prefix fell through to "not melodic", so
 *     the bare procedural ids — bass, subbass, lead, pluck, chord, pad — were
 *     classified percussive and denied the keyboard view. The test that
 *     covered them asserted exactly that, under a describe named
 *     "regular samples (percussive - not melodic)". Implementation and test
 *     were written from each other rather than from the catalogue.
 *
 * So the assertions below are driven from INSTRUMENT_CATEGORIES wherever they
 * can be, rather than from a hand-kept list that can drift the same way.
 */
import { describe, it, expect } from 'vitest';
import {
  isDrumInstrument,
  instrumentPresetId,
  DRUM_INSTRUMENT_IDS,
} from './instrument-classification';
import {
  INSTRUMENT_CATEGORIES,
  SAMPLED_CATEGORIES,
  TONE_SYNTH_CATEGORIES,
} from '../components/sample-constants';

/** Every instrument id the picker can actually produce. */
function catalogueIds(): string[] {
  const ids: string[] = [];
  for (const category of Object.values(INSTRUMENT_CATEGORIES) as unknown[]) {
    if (!category || typeof category !== 'object') continue;
    for (const value of Object.values(category as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        if (entry && typeof entry === 'object' && 'id' in entry) {
          ids.push((entry as { id: string }).id);
        }
      }
    }
  }
  return [...new Set(ids)];
}

describe('isDrumInstrument', () => {
  it('classifies every catalogue id without throwing', () => {
    const ids = catalogueIds();
    expect(ids.length, 'catalogue looks empty — the assertions below prove nothing')
      .toBeGreaterThan(50);
    for (const id of ids) {
      expect(typeof isDrumInstrument(id), `${id} produced a non-boolean`).toBe('boolean');
    }
  });

  it('treats every drum in the sampled and Tone.js drum categories as a drum', () => {
    // Driven from the category tables the UI groups by, so adding a drum there
    // without adding it here fails rather than silently reaching the keyboard.
    const drums = [...SAMPLED_CATEGORIES.drums, ...TONE_SYNTH_CATEGORIES.drum];
    expect(drums.length).toBeGreaterThan(0);
    for (const id of drums) {
      expect(isDrumInstrument(id), `${id} should be a drum`).toBe(true);
    }
  });

  it('treats the bare procedural pitched instruments as melodic', () => {
    // The regression this consolidation fixed. These are the ids the previous
    // prefix-based classifiers fell through on; every one is filed under a
    // pitched category (bass / leads / pads) in INSTRUMENT_CATEGORIES.
    for (const id of ['bass', 'subbass', 'lead', 'pluck', 'chord', 'pad']) {
      expect(isDrumInstrument(id), `${id} is pitched and must not be a drum`).toBe(false);
    }
  });

  it('treats the bare procedural drums as drums', () => {
    for (const id of ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'rim', 'cowbell']) {
      expect(isDrumInstrument(id), `${id} should be a drum`).toBe(true);
    }
  });

  it('classifies pitched engine-prefixed instruments as melodic', () => {
    for (const id of [
      'synth:bass', 'synth:lead', 'synth:pad',
      'advanced:supersaw', 'advanced:wobble-bass',
      'tone:fm-epiano', 'tone:pluck-string',
      'sampled:piano', 'sampled:alto-sax',
    ]) {
      expect(isDrumInstrument(id), `${id} is pitched`).toBe(false);
    }
  });

  it('does not decide the answer from the engine prefix', () => {
    // The core of the old bug: `sampled:` and `tone:` contain both drums and
    // pitched instruments, so the prefix carries no role information.
    const sampled = catalogueIds().filter((id) => id.startsWith('sampled:'));
    const tone = catalogueIds().filter((id) => id.startsWith('tone:'));

    for (const group of [sampled, tone]) {
      expect(group.some(isDrumInstrument), 'expected drums in this namespace').toBe(true);
      expect(group.some((id) => !isDrumInstrument(id)), 'expected pitched too').toBe(true);
    }
  });

  it('treats user-supplied audio as unpitched, in the forms actually produced', () => {
    // Recorder.tsx mints these two; `mic:` is consumed by midiExport and
    // mcp-lifecycle but produced by nothing, so testing only `mic:` — as the
    // deleted instrument-types test effectively did — misses every real
    // recording. The ids below are the literal template shapes from
    // Recorder.tsx:193 and :201.
    expect(isDrumInstrument(`recording-${1730000000000}`)).toBe(true);
    expect(isDrumInstrument(`slice-${1730000000000}-3`)).toBe(true);
    expect(isDrumInstrument('mic:recording-1')).toBe(true);
  });

  it('does not swallow catalogue instruments whose id merely contains those words', () => {
    // The prefixes are anchored, so a hypothetical 'sampled:slice-guitar'
    // stays pitched.
    expect(isDrumInstrument('sampled:slice-guitar')).toBe(false);
    expect(isDrumInstrument('synth:recording-pad')).toBe(false);
  });

  it('normalises case and surrounding whitespace', () => {
    expect(isDrumInstrument('  KICK  ')).toBe(true);
    expect(isDrumInstrument('Sampled:808-Kick')).toBe(true);
  });

  it('treats an unrecognised id as pitched rather than as a drum', () => {
    // Deliberate: a new pitched instrument that nobody remembered to classify
    // should get the keyboard, not silently lose it. The failure mode of the
    // other default is invisible; this one is obvious the first time a drum
    // shows a keyboard.
    expect(isDrumInstrument('unknown:instrument')).toBe(false);
    expect(isDrumInstrument('')).toBe(false);
  });

  it('keeps every drum id in the set reachable', () => {
    // Guards against an entry that can never match — a typo, or an id with
    // stray case that normalisation would never produce.
    for (const id of DRUM_INSTRUMENT_IDS) {
      expect(isDrumInstrument(id), `${id} is in the set but does not classify`).toBe(true);
      expect(id, `${id} is not normalised, so it can never match`).toBe(id.trim().toLowerCase());
    }
  });
});

describe('instrumentPresetId', () => {
  it('strips the engine prefix', () => {
    expect(instrumentPresetId('tone:fm-epiano')).toBe('fm-epiano');
    expect(instrumentPresetId('advanced:supersaw')).toBe('supersaw');
  });

  it('leaves a bare id alone', () => {
    expect(instrumentPresetId('kick')).toBe('kick');
  });

  it('keeps everything after the first separator', () => {
    expect(instrumentPresetId('a:b:c')).toBe('b:c');
  });
});
