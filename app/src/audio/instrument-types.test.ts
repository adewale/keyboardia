import { describe, it, expect } from 'vitest';
import {
  parseInstrumentId,
  requiresToneJs,
  getSampledInstrumentId,
  collectSampledInstruments,
} from './instrument-types';

describe('parseInstrumentId', () => {
  describe('synth: prefix', () => {
    it('identifies synth:lead as synth type', () => {
      const result = parseInstrumentId('synth:lead');
      expect(result.type).toBe('synth');
      expect(result.presetId).toBe('lead');
    });

    it('identifies synth:piano as sampled type (not synth)', () => {
      // Piano is a sampled instrument, even with synth: prefix
      const result = parseInstrumentId('synth:piano');
      expect(result.type).toBe('sampled');
      expect(result.presetId).toBe('piano');
    });

    it('identifies synth:pad as synth type', () => {
      const result = parseInstrumentId('synth:pad');
      expect(result.type).toBe('synth');
      expect(result.presetId).toBe('pad');
    });
  });

  describe('sampled: prefix', () => {
    it('identifies sampled:piano as sampled type', () => {
      const result = parseInstrumentId('sampled:piano');
      expect(result.type).toBe('sampled');
      expect(result.presetId).toBe('piano');
    });
  });

  describe('tone: prefix', () => {
    it('identifies tone:fm-epiano as tone type', () => {
      const result = parseInstrumentId('tone:fm-epiano');
      expect(result.type).toBe('tone');
      expect(result.presetId).toBe('fm-epiano');
    });

    it('identifies tone:membrane-kick as tone type', () => {
      const result = parseInstrumentId('tone:membrane-kick');
      expect(result.type).toBe('tone');
      expect(result.presetId).toBe('membrane-kick');
    });
  });

  describe('advanced: prefix', () => {
    it('identifies advanced:supersaw as advanced type', () => {
      const result = parseInstrumentId('advanced:supersaw');
      expect(result.type).toBe('advanced');
      expect(result.presetId).toBe('supersaw');
    });

    it('identifies advanced:wobble-bass as advanced type', () => {
      const result = parseInstrumentId('advanced:wobble-bass');
      expect(result.type).toBe('advanced');
      expect(result.presetId).toBe('wobble-bass');
    });
  });

  describe('no prefix (plain samples)', () => {
    it('identifies kick as sample type', () => {
      const result = parseInstrumentId('kick');
      expect(result.type).toBe('sample');
      expect(result.presetId).toBe('kick');
    });

    it('identifies snare as sample type', () => {
      const result = parseInstrumentId('snare');
      expect(result.type).toBe('sample');
      expect(result.presetId).toBe('snare');
    });

    it('identifies recording-123 as sample type', () => {
      const result = parseInstrumentId('recording-123');
      expect(result.type).toBe('sample');
      expect(result.presetId).toBe('recording-123');
    });
  });

  it('preserves originalId on every branch', () => {
    // One id per branch of parseInstrumentId. The synth:-but-actually-sampled
    // case is the one that matters: it is the only branch where presetId and
    // originalId differ *and* the type is rewritten, so a mix-up there is
    // invisible everywhere else. Sabotaging that branch's originalId to
    // presetId passed the previous version of this test, which sampled three
    // ids and missed it.
    expect(parseInstrumentId('synth:lead').originalId).toBe('synth:lead');
    expect(parseInstrumentId('synth:piano').originalId).toBe('synth:piano');
    expect(parseInstrumentId('sampled:piano').originalId).toBe('sampled:piano');
    expect(parseInstrumentId('tone:fm-epiano').originalId).toBe('tone:fm-epiano');
    expect(parseInstrumentId('advanced:supersaw').originalId).toBe('advanced:supersaw');
    expect(parseInstrumentId('kick').originalId).toBe('kick');
  });
});

// The `isMelodicInstrument` describe that stood here covered a helper derived
// from the engine prefix, which disagreed with the instrument catalogue on 24
// of its 99 ids. Its four tests all passed, because they only ever asked about
// ids the prefix happens to get right — 'synth:lead', 'sampled:piano', 'kick'
// — and never about a `sampled:` drum or a bare pitched preset, which are the
// two cases the prefix cannot decide. Nothing outside this file imported the
// helper, so the coverage protected nobody.
//
// The question now has one answer: isDrumInstrument in
// shared/instrument-classification.ts, tested in its own file against the
// catalogue rather than against a hand-picked list.

describe('requiresToneJs', () => {
  it('returns true for tone: presets', () => {
    expect(requiresToneJs('tone:fm-epiano')).toBe(true);
    expect(requiresToneJs('tone:membrane-kick')).toBe(true);
  });

  it('returns true for advanced: presets', () => {
    expect(requiresToneJs('advanced:supersaw')).toBe(true);
    expect(requiresToneJs('advanced:wobble-bass')).toBe(true);
  });

  it('returns false for synth: presets', () => {
    expect(requiresToneJs('synth:lead')).toBe(false);
    expect(requiresToneJs('synth:piano')).toBe(false);
  });

  it('returns false for sampled: instruments', () => {
    expect(requiresToneJs('sampled:piano')).toBe(false);
  });

  it('returns false for plain samples', () => {
    expect(requiresToneJs('kick')).toBe(false);
  });
});

describe('getSampledInstrumentId', () => {
  it('returns instrument ID for synth:piano', () => {
    expect(getSampledInstrumentId('synth:piano')).toBe('piano');
  });

  it('returns instrument ID for sampled:piano', () => {
    expect(getSampledInstrumentId('sampled:piano')).toBe('piano');
  });

  it('returns null for synth:lead (not a sampled instrument)', () => {
    expect(getSampledInstrumentId('synth:lead')).toBeNull();
  });

  it('returns null for tone: presets', () => {
    expect(getSampledInstrumentId('tone:fm-epiano')).toBeNull();
  });

  it('returns null for plain samples', () => {
    expect(getSampledInstrumentId('kick')).toBeNull();
  });

  it('rejects unknown IDs but preserves both quarantined legacy aliases', () => {
    expect(getSampledInstrumentId('sampled:not-registered')).toBeNull();
    expect(getSampledInstrumentId('sampled:rhodes-ep')).toBe('rhodes-ep');
    expect(getSampledInstrumentId('synth:rhodes-ep')).toBe('rhodes-ep');
    expect(parseInstrumentId('synth:rhodes-ep').type).toBe('sampled');
  });
});

describe('collectSampledInstruments', () => {
  it('collects piano from synth:piano track', () => {
    const tracks = [{ sampleId: 'synth:piano' }];
    const result = collectSampledInstruments(tracks);
    expect(result.has('piano')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('collects piano from sampled:piano track', () => {
    const tracks = [{ sampleId: 'sampled:piano' }];
    const result = collectSampledInstruments(tracks);
    expect(result.has('piano')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('deduplicates when both formats present', () => {
    const tracks = [
      { sampleId: 'synth:piano' },
      { sampleId: 'sampled:piano' },
    ];
    const result = collectSampledInstruments(tracks);
    expect(result.has('piano')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('preserves quarantined sampled IDs for explicit preload diagnostics', () => {
    const tracks = [
      { sampleId: 'synth:lead' },
      { sampleId: 'tone:fm-epiano' },
      { sampleId: 'sampled:rhodes-ep' },
      { sampleId: 'synth:rhodes-ep' },
      { sampleId: 'kick' },
    ];
    const result = collectSampledInstruments(tracks);
    expect([...result]).toEqual(['rhodes-ep']);
  });

  it('handles mixed track types', () => {
    const tracks = [
      { sampleId: 'synth:piano' },
      { sampleId: 'synth:lead' },
      { sampleId: 'tone:fm-epiano' },
      { sampleId: 'kick' },
    ];
    const result = collectSampledInstruments(tracks);
    expect(result.has('piano')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('returns empty set for empty tracks', () => {
    const result = collectSampledInstruments([]);
    expect(result.size).toBe(0);
  });
});
