/**
 * Tests for centralized audio constants
 *
 * Verifies that shared constants are defined correctly and
 * helper functions work as expected.
 */

import { describe, it, expect } from 'vitest';
import {
  C4_FREQUENCY,
  NOTE_DURATIONS_120BPM,
  semitoneToFrequency,
} from './constants';
// NOTE_NAMES now lives in music-theory.ts (canonical source)
import { NOTE_NAMES } from '../music/music-theory';

describe('C4_FREQUENCY', () => {
  it('is defined as the correct value for middle C', () => {
    // Middle C (C4) is approximately 261.63 Hz
    expect(C4_FREQUENCY).toBeCloseTo(261.625565, 5);
  });

  it('is used consistently for semitone calculations', () => {
    // C5 (12 semitones up) should be exactly double C4
    const c5Frequency = C4_FREQUENCY * 2;
    expect(semitoneToFrequency(12)).toBeCloseTo(c5Frequency, 5);
  });
});

describe('NOTE_NAMES', () => {
  it('has 12 note names (chromatic scale)', () => {
    expect(NOTE_NAMES).toHaveLength(12);
  });

  it('starts with C', () => {
    expect(NOTE_NAMES[0]).toBe('C');
  });

  it('contains all chromatic notes', () => {
    expect(NOTE_NAMES).toContain('C');
    expect(NOTE_NAMES).toContain('C#');
    expect(NOTE_NAMES).toContain('D');
    expect(NOTE_NAMES).toContain('E');
    expect(NOTE_NAMES).toContain('F');
    expect(NOTE_NAMES).toContain('G');
    expect(NOTE_NAMES).toContain('A');
    expect(NOTE_NAMES).toContain('B');
  });
});

// NOTE: VALID_DELAY_TIMES tests removed in Phase 22.
// - For UI delay options: see delay-constants.ts
// - For validation: see worker/invariants.ts
// The constants.ts version was only used in tests and duplicated invariants.ts.

describe('NOTE_DURATIONS_120BPM', () => {
  it('has durations for common note values', () => {
    expect(NOTE_DURATIONS_120BPM['8n']).toBeDefined();
    expect(NOTE_DURATIONS_120BPM['4n']).toBeDefined();
    expect(NOTE_DURATIONS_120BPM['16n']).toBeDefined();
  });

  it('quarter note is 0.5 seconds at 120 BPM', () => {
    // At 120 BPM, one beat (quarter note) = 60/120 = 0.5 seconds
    expect(NOTE_DURATIONS_120BPM['4n']).toBe(0.5);
  });

  it('eighth note is half of quarter note', () => {
    expect(NOTE_DURATIONS_120BPM['8n']).toBe(0.25);
  });

  it('half note is double quarter note', () => {
    expect(NOTE_DURATIONS_120BPM['2n']).toBe(1);
  });

  it('whole note is 4 beats', () => {
    expect(NOTE_DURATIONS_120BPM['1n']).toBe(2);
  });

  it('measure (1m) is 4 beats at 4/4', () => {
    expect(NOTE_DURATIONS_120BPM['1m']).toBe(4);
  });
});

describe('semitoneToFrequency', () => {
  it('returns C4 frequency for semitone 0', () => {
    expect(semitoneToFrequency(0)).toBeCloseTo(C4_FREQUENCY, 5);
  });

  it('returns correct frequency for C5 (semitone 12)', () => {
    expect(semitoneToFrequency(12)).toBeCloseTo(C4_FREQUENCY * 2, 2);
  });

  it('returns correct frequency for C3 (semitone -12)', () => {
    expect(semitoneToFrequency(-12)).toBeCloseTo(C4_FREQUENCY / 2, 2);
  });

  it('returns A4 (440 Hz) for semitone 9', () => {
    // A4 is 9 semitones above C4
    expect(semitoneToFrequency(9)).toBeCloseTo(440, 0);
  });
});

// NOTE: semitoneToNoteName tests removed in Phase 22.
// Use ToneSynthManager.semitoneToNoteName() instead (see toneSynths.test.ts).
