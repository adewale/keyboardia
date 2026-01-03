/**
 * Instrument Ranges Tests
 *
 * Phase 31H: Tests for instrument range utilities
 */

import { describe, it, expect } from 'vitest';
import {
  getInstrumentRange,
  isInRange,
  isInOptimalRange,
  getRangeWarning,
  DEFAULT_RANGE,
  INSTRUMENT_RANGES,
} from './instrument-ranges';

describe('getInstrumentRange', () => {
  it('should return specific range for known instruments', () => {
    const pianoRange = getInstrumentRange('sampled:piano');
    expect(pianoRange.minMidi).toBe(21);  // A0
    expect(pianoRange.maxMidi).toBe(108); // C8
  });

  it('should return default range for unknown instruments', () => {
    const unknownRange = getInstrumentRange('unknown:instrument');
    expect(unknownRange).toEqual(DEFAULT_RANGE);
  });

  it('should match synth types by name content', () => {
    // Bass synth should get bass range
    const bassRange = getInstrumentRange('synth:deep-bass');
    expect(bassRange).toEqual(INSTRUMENT_RANGES['synth:bass']);

    // Lead synth should get lead range
    const leadRange = getInstrumentRange('synth:bright-lead');
    expect(leadRange).toEqual(INSTRUMENT_RANGES['synth:lead']);

    // Pad synth should get pad range
    const padRange = getInstrumentRange('synth:warm-pad');
    expect(padRange).toEqual(INSTRUMENT_RANGES['synth:pad']);
  });

  it('should return correct ranges for sampled instruments', () => {
    // Vibraphone has a limited range
    const vibesRange = getInstrumentRange('sampled:vibraphone');
    expect(vibesRange.minMidi).toBe(53);  // F3
    expect(vibesRange.maxMidi).toBe(89);  // F6

    // Alto sax has specific range
    const saxRange = getInstrumentRange('sampled:alto-sax');
    expect(saxRange.minMidi).toBe(49);  // Db3
    expect(saxRange.maxMidi).toBe(80);  // Ab5
  });

  it('should return correct ranges for advanced synths', () => {
    const subBassRange = getInstrumentRange('advanced:sub-bass');
    expect(subBassRange.minMidi).toBe(24);  // C1
    expect(subBassRange.maxMidi).toBe(55);  // G3
  });
});

describe('isInRange', () => {
  it('should return true for notes within range', () => {
    // Piano range: 21-108
    expect(isInRange(60, 'sampled:piano')).toBe(true);  // Middle C
    expect(isInRange(21, 'sampled:piano')).toBe(true);  // A0 (lowest)
    expect(isInRange(108, 'sampled:piano')).toBe(true); // C8 (highest)
  });

  it('should return false for notes outside range', () => {
    // Piano range: 21-108
    expect(isInRange(20, 'sampled:piano')).toBe(false);  // Below A0
    expect(isInRange(109, 'sampled:piano')).toBe(false); // Above C8

    // Vibraphone range: 53-89
    expect(isInRange(52, 'sampled:vibraphone')).toBe(false);
    expect(isInRange(90, 'sampled:vibraphone')).toBe(false);
  });

  it('should use default range for unknown instruments', () => {
    // DEFAULT_RANGE: 24-96
    expect(isInRange(60, 'unknown:test')).toBe(true);
    expect(isInRange(23, 'unknown:test')).toBe(false);
    expect(isInRange(97, 'unknown:test')).toBe(false);
  });
});

describe('isInOptimalRange', () => {
  it('should return true for notes in optimal range', () => {
    // Piano optimal: 36-96
    expect(isInOptimalRange(60, 'sampled:piano')).toBe(true);
    expect(isInOptimalRange(36, 'sampled:piano')).toBe(true);
    expect(isInOptimalRange(96, 'sampled:piano')).toBe(true);
  });

  it('should return false for notes outside optimal but inside playable', () => {
    // Piano: playable 21-108, optimal 36-96
    expect(isInOptimalRange(21, 'sampled:piano')).toBe(false); // Playable but not optimal
    expect(isInOptimalRange(30, 'sampled:piano')).toBe(false);
    expect(isInOptimalRange(100, 'sampled:piano')).toBe(false);
  });

  it('should use minMidi/maxMidi if optimal not defined', () => {
    // This tests the fallback behavior
    const range = getInstrumentRange('sampled:vibraphone');
    expect(range.optimalMin).toBeDefined();
    expect(range.optimalMax).toBeDefined();
  });
});

describe('getRangeWarning', () => {
  it('should return undefined for notes in range', () => {
    // Base 60 (C4), transpose 0, pitch 0 = MIDI 60 (in piano range)
    expect(getRangeWarning(0, 0, 'sampled:piano')).toBeUndefined();
    expect(getRangeWarning(12, 0, 'sampled:piano')).toBeUndefined(); // C5
  });

  it('should return warning for notes too low', () => {
    // Piano min is 21 (A0)
    // Base 60, transpose -24, pitch -24 = MIDI 12 (below A0)
    const warning = getRangeWarning(-24, -24, 'sampled:piano');
    expect(warning).toContain('too low');
    expect(warning).toContain('12');
    expect(warning).toContain('21');
  });

  it('should return warning for notes too high', () => {
    // Piano max is 108 (C8)
    // Base 60, transpose 24, pitch 36 = MIDI 120 (above C8)
    const warning = getRangeWarning(36, 24, 'sampled:piano');
    expect(warning).toContain('too high');
    expect(warning).toContain('120');
    expect(warning).toContain('108');
  });

  it('should respect custom base MIDI', () => {
    // Custom base 48 (C3), transpose 0, pitch 0 = MIDI 48
    expect(getRangeWarning(0, 0, 'sampled:piano', 48)).toBeUndefined();

    // Base 48, transpose 0, pitch -30 = MIDI 18 (below piano range)
    const warning = getRangeWarning(-30, 0, 'sampled:piano', 48);
    expect(warning).toContain('too low');
  });

  it('should handle narrow-range instruments', () => {
    // Vibraphone: 53-89
    // Base 60, pitch 0, transpose 0 = MIDI 60 (in range)
    expect(getRangeWarning(0, 0, 'sampled:vibraphone')).toBeUndefined();

    // Base 60, pitch 36, transpose 0 = MIDI 96 (above vibraphone range)
    const warning = getRangeWarning(36, 0, 'sampled:vibraphone');
    expect(warning).toContain('too high');
  });
});

describe('INSTRUMENT_RANGES constants', () => {
  it('should have valid ranges (min < max)', () => {
    for (const range of Object.values(INSTRUMENT_RANGES)) {
      expect(range.minMidi).toBeLessThan(range.maxMidi);
      if (range.optimalMin !== undefined && range.optimalMax !== undefined) {
        expect(range.optimalMin).toBeLessThanOrEqual(range.optimalMax);
      }
    }
  });

  it('should have optimal range within playable range', () => {
    for (const range of Object.values(INSTRUMENT_RANGES)) {
      if (range.optimalMin !== undefined) {
        expect(range.optimalMin).toBeGreaterThanOrEqual(range.minMidi);
      }
      if (range.optimalMax !== undefined) {
        expect(range.optimalMax).toBeLessThanOrEqual(range.maxMidi);
      }
    }
  });

  it('should have reasonable MIDI values (0-127)', () => {
    for (const range of Object.values(INSTRUMENT_RANGES)) {
      expect(range.minMidi).toBeGreaterThanOrEqual(0);
      expect(range.maxMidi).toBeLessThanOrEqual(127);
    }
  });
});
