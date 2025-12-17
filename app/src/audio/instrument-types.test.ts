import { describe, it, expect } from 'vitest';
import {
  parseInstrumentId,
  isMelodicInstrument,
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
      expect(result.isMelodicInstrument).toBe(true);
    });

    it('identifies synth:piano as sampled type (not synth)', () => {
      // Piano is a sampled instrument, even with synth: prefix
      const result = parseInstrumentId('synth:piano');
      expect(result.type).toBe('sampled');
      expect(result.presetId).toBe('piano');
      expect(result.isMelodicInstrument).toBe(true);
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
      expect(result.isMelodicInstrument).toBe(true);
    });
  });

  describe('tone: prefix', () => {
    it('identifies tone:fm-epiano as tone type', () => {
      const result = parseInstrumentId('tone:fm-epiano');
      expect(result.type).toBe('tone');
      expect(result.presetId).toBe('fm-epiano');
      expect(result.isMelodicInstrument).toBe(true);
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
      expect(result.isMelodicInstrument).toBe(true);
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
      expect(result.isMelodicInstrument).toBe(false);
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

  it('preserves originalId', () => {
    expect(parseInstrumentId('synth:lead').originalId).toBe('synth:lead');
    expect(parseInstrumentId('tone:fm-epiano').originalId).toBe('tone:fm-epiano');
    expect(parseInstrumentId('kick').originalId).toBe('kick');
  });
});

describe('isMelodicInstrument', () => {
  it('returns true for synth presets', () => {
    expect(isMelodicInstrument('synth:lead')).toBe(true);
    expect(isMelodicInstrument('synth:pad')).toBe(true);
  });

  it('returns true for sampled instruments', () => {
    expect(isMelodicInstrument('synth:piano')).toBe(true);
    expect(isMelodicInstrument('sampled:piano')).toBe(true);
  });

  it('returns true for Tone.js synths', () => {
    expect(isMelodicInstrument('tone:fm-epiano')).toBe(true);
    expect(isMelodicInstrument('advanced:supersaw')).toBe(true);
  });

  it('returns false for plain samples', () => {
    expect(isMelodicInstrument('kick')).toBe(false);
    expect(isMelodicInstrument('snare')).toBe(false);
    expect(isMelodicInstrument('recording-123')).toBe(false);
  });
});

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

  it('ignores non-sampled instruments', () => {
    const tracks = [
      { sampleId: 'synth:lead' },
      { sampleId: 'tone:fm-epiano' },
      { sampleId: 'kick' },
    ];
    const result = collectSampledInstruments(tracks);
    expect(result.size).toBe(0);
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
