/**
 * TrackRow tests - focusing on instrument classification logic
 */

import { describe, it, expect } from 'vitest';

// Re-implement the logic here for testing (since it's a private function in TrackRow.tsx)
// This mirrors the implementation in TrackRow.tsx:13-33
const TONE_DRUM_SYNTHS = ['tone:membrane-kick', 'tone:membrane-tom', 'tone:metal-cymbal', 'tone:metal-hihat'];

function isMelodicInstrument(sampleId: string): boolean {
  if (sampleId.startsWith('synth:')) return true;
  if (sampleId.startsWith('advanced:')) return true;
  if (sampleId.startsWith('sampled:')) return true;
  if (sampleId.startsWith('tone:')) {
    return !TONE_DRUM_SYNTHS.includes(sampleId);
  }
  return false;
}

describe('isMelodicInstrument', () => {
  describe('synth: prefix instruments (all melodic)', () => {
    it.each([
      'synth:bass',
      'synth:lead',
      'synth:pad',
      'synth:pluck',
      'synth:acid',
      'synth:rhodes',
      'synth:organ',
      'synth:wurlitzer',
      'synth:clavinet',
      'synth:epiano',
      'synth:vibes',
      'synth:strings',
      'synth:brass',
      'synth:supersaw',
      'synth:hypersaw',
    ])('should return true for %s', (sampleId) => {
      expect(isMelodicInstrument(sampleId)).toBe(true);
    });
  });

  describe('advanced: prefix instruments (all melodic)', () => {
    it.each([
      'advanced:supersaw',
      'advanced:thick-lead',
      'advanced:vibrato-lead',
      'advanced:sub-bass',
      'advanced:wobble-bass',
      'advanced:acid-bass',
      'advanced:warm-pad',
      'advanced:tremolo-strings',
    ])('should return true for %s', (sampleId) => {
      expect(isMelodicInstrument(sampleId)).toBe(true);
    });
  });

  describe('sampled: prefix instruments (all melodic)', () => {
    it.each([
      'sampled:piano',
      'sampled:guitar', // Future instruments
      'sampled:string-section',
    ])('should return true for %s', (sampleId) => {
      expect(isMelodicInstrument(sampleId)).toBe(true);
    });
  });

  describe('tone: prefix instruments (mixed - some melodic, some drums)', () => {
    describe('melodic tone instruments', () => {
      it.each([
        'tone:fm-epiano',
        'tone:fm-bass',
        'tone:fm-bell',
        'tone:pluck-string',
        'tone:duo-lead',
        'tone:am-bell',
        'tone:am-tremolo',
      ])('should return true for %s (melodic)', (sampleId) => {
        expect(isMelodicInstrument(sampleId)).toBe(true);
      });
    });

    describe('drum tone instruments', () => {
      it.each([
        'tone:membrane-kick',
        'tone:membrane-tom',
        'tone:metal-cymbal',
        'tone:metal-hihat',
      ])('should return false for %s (drum)', (sampleId) => {
        expect(isMelodicInstrument(sampleId)).toBe(false);
      });
    });
  });

  describe('regular samples (percussive - not melodic)', () => {
    it.each([
      'kick',
      'snare',
      'hihat',
      'clap',
      'tom',
      'rim',
      'cowbell',
      'openhat',
      'bass',
      'subbass',
      'lead',
      'pluck',
      'chord',
      'pad',
      'zap',
      'noise',
    ])('should return false for %s (sample)', (sampleId) => {
      expect(isMelodicInstrument(sampleId)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false for empty string', () => {
      expect(isMelodicInstrument('')).toBe(false);
    });

    it('should return false for unknown prefix', () => {
      expect(isMelodicInstrument('unknown:instrument')).toBe(false);
    });

    it('should be case-sensitive (synth: vs SYNTH:)', () => {
      expect(isMelodicInstrument('SYNTH:bass')).toBe(false);
      expect(isMelodicInstrument('synth:bass')).toBe(true);
    });
  });
});

describe('Keyboard view requirements', () => {
  it('sampled:piano MUST show keyboard view', () => {
    // This is the critical bug that was fixed - piano wasn't showing keyboard
    expect(isMelodicInstrument('sampled:piano')).toBe(true);
  });

  it('all instruments in Keys category should show keyboard view', () => {
    // From sample-constants.ts keys category
    const keysInstruments = [
      'sampled:piano',
      'synth:rhodes',
      'synth:wurlitzer',
      'synth:epiano',
      'tone:fm-epiano',
      'synth:organ',
      'synth:organphase',
      'synth:clavinet',
      'synth:vibes',
    ];

    keysInstruments.forEach(id => {
      expect(isMelodicInstrument(id)).toBe(true);
    });
  });

  it('all instruments in Bass category should show keyboard view', () => {
    const bassInstruments = [
      'synth:bass',
      'synth:acid',
      'synth:sub',
      'synth:funkbass',
      'synth:discobass',
      'synth:reese',
      'synth:hoover',
      'tone:fm-bass',
      'advanced:sub-bass',
      'advanced:wobble-bass',
      'advanced:acid-bass',
    ];

    bassInstruments.forEach(id => {
      expect(isMelodicInstrument(id)).toBe(true);
    });
  });

  it('all instruments in Leads category should show keyboard view', () => {
    const leadInstruments = [
      'synth:lead',
      'synth:pluck',
      'synth:supersaw',
      'synth:hypersaw',
      'tone:pluck-string',
      'tone:duo-lead',
      'advanced:supersaw',
      'advanced:thick-lead',
      'advanced:vibrato-lead',
    ];

    leadInstruments.forEach(id => {
      expect(isMelodicInstrument(id)).toBe(true);
    });
  });

  it('all instruments in Pads category should show keyboard view', () => {
    const padInstruments = [
      'synth:pad',
      'synth:warmpad',
      'synth:strings',
      'synth:shimmer',
      'synth:dreampop',
      'synth:glass',
      'synth:jangle',
      'synth:evolving',
      'synth:sweep',
      'advanced:warm-pad',
      'advanced:tremolo-strings',
    ];

    padInstruments.forEach(id => {
      expect(isMelodicInstrument(id)).toBe(true);
    });
  });

  it('drum samples should NOT show keyboard view', () => {
    const drumSamples = [
      'kick',
      'snare',
      'hihat',
      'clap',
      'tom',
      'rim',
      'cowbell',
      'openhat',
      'tone:membrane-kick',
      'tone:membrane-tom',
      'tone:metal-cymbal',
      'tone:metal-hihat',
    ];

    drumSamples.forEach(id => {
      expect(isMelodicInstrument(id)).toBe(false);
    });
  });
});

// Import getInstrumentName for tooltip tests
import { getInstrumentName } from './sample-constants';

/**
 * Track name tooltip logic tests
 *
 * When a track is renamed (name !== instrumentName), the tooltip should show
 * the original instrument name to help users identify the underlying sound.
 */
describe('Track name tooltip behavior', () => {
  // Re-implement the tooltip logic from TrackRow.tsx:480-486 for testing
  function getTrackNameTooltip(trackName: string, sampleId: string): string {
    const instrumentName = getInstrumentName(sampleId);
    const isRenamed = trackName !== instrumentName;
    return isRenamed
      ? `Instrument: ${instrumentName} · Double-click to rename`
      : 'Double-click to rename';
  }

  describe('non-renamed tracks (name matches instrument)', () => {
    it.each([
      ['Kick', 'kick'],
      ['Snare', 'snare'],
      ['Wobble Bass', 'advanced:wobble-bass'],
      ['Piano', 'sampled:piano'],
      ['FM Piano', 'tone:fm-epiano'],
      ['Fat Saw', 'advanced:supersaw'], // Note: advanced:supersaw is named "Fat Saw" in INSTRUMENT_CATEGORIES
    ])('should show basic tooltip for "%s" with sampleId "%s"', (name, sampleId) => {
      expect(getTrackNameTooltip(name, sampleId)).toBe('Double-click to rename');
    });
  });

  describe('renamed tracks (name differs from instrument)', () => {
    it('should show instrument name when track is renamed', () => {
      expect(getTrackNameTooltip('My Bass', 'advanced:wobble-bass'))
        .toBe('Instrument: Wobble Bass · Double-click to rename');
    });

    it('should show instrument name for renamed piano track', () => {
      expect(getTrackNameTooltip('Melody', 'sampled:piano'))
        .toBe('Instrument: Piano · Double-click to rename');
    });

    it('should show instrument name for renamed drum track', () => {
      expect(getTrackNameTooltip('Beat 1', 'kick'))
        .toBe('Instrument: Kick · Double-click to rename');
    });

    it('should show instrument name for renamed synth track', () => {
      // Note: advanced:supersaw is named "Fat Saw" in INSTRUMENT_CATEGORIES
      expect(getTrackNameTooltip('Lead Line', 'advanced:supersaw'))
        .toBe('Instrument: Fat Saw · Double-click to rename');
    });

    it('should show instrument name for renamed FM synth track', () => {
      expect(getTrackNameTooltip('Keys', 'tone:fm-epiano'))
        .toBe('Instrument: FM Piano · Double-click to rename');
    });
  });

  describe('edge cases', () => {
    it('should handle case-sensitive name comparison', () => {
      // "kick" instrument displays as "Kick" - case difference means renamed
      expect(getTrackNameTooltip('kick', 'kick'))
        .toBe('Instrument: Kick · Double-click to rename');
    });

    it('should handle whitespace differences as renamed', () => {
      expect(getTrackNameTooltip('Wobble  Bass', 'advanced:wobble-bass'))
        .toBe('Instrument: Wobble Bass · Double-click to rename');
    });

    it('should handle empty track name gracefully', () => {
      // Empty name is different from instrument name
      expect(getTrackNameTooltip('', 'kick'))
        .toBe('Instrument: Kick · Double-click to rename');
    });
  });
});
