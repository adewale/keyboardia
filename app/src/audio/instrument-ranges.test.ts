/**
 * Instrument Ranges Tests
 *
 * Phase 31H: Tests for instrument range utilities
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getInstrumentRange,
  isInRange,
  isInOptimalRange,
  getRangeWarning,
  DEFAULT_RANGE,
  INSTRUMENT_RANGES,
} from './instrument-ranges';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_DIR = resolve(THIS_DIR, '../../public/instruments');

describe('getInstrumentRange', () => {
  it('should return specific range for known instruments', () => {
    const pianoRange = getInstrumentRange('sampled:piano');
    expect(pianoRange.minMidi).toBe(30);
    expect(pianoRange.maxMidi).toBe(78);
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
    expect(vibesRange.minMidi).toBe(47);  // B2 (VCSL samples F3-E6, +/-6 shift)
    expect(vibesRange.maxMidi).toBe(94);  // A#6

    // Alto sax has specific range
    const saxRange = getInstrumentRange('sampled:alto-sax');
    expect(saxRange.minMidi).toBe(47);
    expect(saxRange.maxMidi).toBe(83);
  });

  it('should return correct ranges for advanced synths', () => {
    const subBassRange = getInstrumentRange('advanced:sub-bass');
    expect(subBassRange.minMidi).toBe(24);  // C1
    expect(subBassRange.maxMidi).toBe(55);  // G3
  });
});

describe('isInRange', () => {
  it('should return true for notes within range', () => {
    // Piano manifest range: 30-78
    expect(isInRange(60, 'sampled:piano')).toBe(true);  // Middle C
    expect(isInRange(30, 'sampled:piano')).toBe(true);  // Lowest playable note
    expect(isInRange(78, 'sampled:piano')).toBe(true);  // Highest playable note
  });

  it('should return false for notes outside range', () => {
    // Piano manifest range: 30-78
    expect(isInRange(29, 'sampled:piano')).toBe(false);
    expect(isInRange(79, 'sampled:piano')).toBe(false);

    // Vibraphone range: 47-94
    expect(isInRange(46, 'sampled:vibraphone')).toBe(false);
    expect(isInRange(95, 'sampled:vibraphone')).toBe(false);
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
    // Sampled instruments without an explicit optimal band use playable range.
    expect(isInOptimalRange(60, 'sampled:piano')).toBe(true);
    expect(isInOptimalRange(30, 'sampled:piano')).toBe(true);
    expect(isInOptimalRange(78, 'sampled:piano')).toBe(true);
  });

  it('should return false for notes outside explicit optimal bands', () => {
    // Synth bass: playable 24-60, optimal 28-55
    expect(isInOptimalRange(28, 'synth:bass')).toBe(true);
    expect(isInOptimalRange(24, 'synth:bass')).toBe(false);
    expect(isInOptimalRange(60, 'synth:bass')).toBe(false);
  });

  it('should use minMidi/maxMidi if optimal not defined', () => {
    // This tests the fallback behavior
    const range = getInstrumentRange('sampled:vibraphone');
    expect(range.optimalMin).toBeUndefined();
    expect(range.optimalMax).toBeUndefined();
    expect(isInOptimalRange(range.minMidi, 'sampled:vibraphone')).toBe(true);
    expect(isInOptimalRange(range.maxMidi, 'sampled:vibraphone')).toBe(true);
  });
});

describe('getRangeWarning', () => {
  it('should return undefined for notes in range', () => {
    // Base 60 (C4), transpose 0, pitch 0 = MIDI 60 (in piano range)
    expect(getRangeWarning(0, 0, 'sampled:piano')).toBeUndefined();
    expect(getRangeWarning(12, 0, 'sampled:piano')).toBeUndefined(); // C5
  });

  it('should return warning for notes too low', () => {
    // Piano min is 30.
    // Base 60, transpose -24, pitch -24 = MIDI 12 (below range)
    const warning = getRangeWarning(-24, -24, 'sampled:piano');
    expect(warning).toContain('too low');
    expect(warning).toContain('12');
    expect(warning).toContain('30');
  });

  it('should return warning for notes too high', () => {
    // Piano max is 78.
    // Base 60, transpose 0, pitch 24 = MIDI 84 (above range)
    const warning = getRangeWarning(24, 0, 'sampled:piano');
    expect(warning).toContain('too high');
    expect(warning).toContain('84');
    expect(warning).toContain('78');
  });

  it('should respect custom base MIDI', () => {
    // Custom base 48 (C3), transpose 0, pitch 0 = MIDI 48
    expect(getRangeWarning(0, 0, 'sampled:piano', 48)).toBeUndefined();

    // Base 48, transpose 0, pitch -30 = MIDI 18 (below piano range)
    const warning = getRangeWarning(-30, 0, 'sampled:piano', 48);
    expect(warning).toContain('too low');
  });

  it('should handle narrow-range instruments', () => {
    // Vibraphone: 47-94
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

  it('sampled instrument ranges match manifest playableRange exactly', () => {
    const mismatches: string[] = [];

    for (const entry of readdirSync(INSTRUMENTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(
        readFileSync(resolve(INSTRUMENTS_DIR, entry.name, 'manifest.json'), 'utf-8')
      ) as {
        id?: string;
        samples?: unknown[];
        playableRange?: { min: number; max: number };
      };
      if (!manifest.samples?.length || !manifest.playableRange) continue;

      const sampleId = `sampled:${manifest.id ?? entry.name}`;
      const range = INSTRUMENT_RANGES[sampleId];
      if (!range) {
        mismatches.push(`${sampleId}: missing from INSTRUMENT_RANGES`);
        continue;
      }
      if (range.minMidi !== manifest.playableRange.min || range.maxMidi !== manifest.playableRange.max) {
        mismatches.push(
          `${sampleId}: UI [${range.minMidi},${range.maxMidi}] != manifest [${manifest.playableRange.min},${manifest.playableRange.max}]`
        );
      }
    }

    expect(mismatches).toEqual([]);
  });
});
