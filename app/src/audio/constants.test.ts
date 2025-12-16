/**
 * Tests for centralized audio constants
 *
 * Verifies that shared constants are defined correctly and
 * helper functions work as expected.
 */

import { describe, it, expect } from 'vitest';
import {
  C4_FREQUENCY,
  NOTE_NAMES,
  VALID_DELAY_TIMES,
  NOTE_DURATIONS_120BPM,
  semitoneToFrequency,
  semitoneToNoteName,
} from './constants';

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

describe('VALID_DELAY_TIMES', () => {
  it('contains common musical note values', () => {
    expect(VALID_DELAY_TIMES).toContain('8n');
    expect(VALID_DELAY_TIMES).toContain('4n');
    expect(VALID_DELAY_TIMES).toContain('16n');
    expect(VALID_DELAY_TIMES).toContain('2n');
    expect(VALID_DELAY_TIMES).toContain('1n');
  });

  it('contains triplet values', () => {
    expect(VALID_DELAY_TIMES).toContain('8t');
    expect(VALID_DELAY_TIMES).toContain('4t');
    expect(VALID_DELAY_TIMES).toContain('16t');
    expect(VALID_DELAY_TIMES).toContain('2t');
  });

  it('contains measure-based values', () => {
    expect(VALID_DELAY_TIMES).toContain('1m');
    expect(VALID_DELAY_TIMES).toContain('2m');
    expect(VALID_DELAY_TIMES).toContain('4m');
  });

  it('does not contain invalid values', () => {
    expect(VALID_DELAY_TIMES).not.toContain('invalid');
    expect(VALID_DELAY_TIMES).not.toContain('3n');
    expect(VALID_DELAY_TIMES).not.toContain('');
  });

  it('can be used for delay time validation', () => {
    // This is how live-session.ts validates delay times
    // Widen to Set<string> to allow checking arbitrary strings
    const validDelaySet = new Set<string>(VALID_DELAY_TIMES);

    expect(validDelaySet.has('8n')).toBe(true);
    expect(validDelaySet.has('4n')).toBe(true);
    expect(validDelaySet.has('invalid' as never)).toBe(false);
    expect(validDelaySet.has('' as never)).toBe(false);
  });
});

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

describe('semitoneToNoteName', () => {
  it('returns C4 for semitone 0', () => {
    expect(semitoneToNoteName(0)).toBe('C4');
  });

  it('returns C5 for semitone 12', () => {
    expect(semitoneToNoteName(12)).toBe('C5');
  });

  it('returns C3 for semitone -12', () => {
    expect(semitoneToNoteName(-12)).toBe('C3');
  });

  it('returns A4 for semitone 9', () => {
    expect(semitoneToNoteName(9)).toBe('A4');
  });

  it('returns F#4 for semitone 6', () => {
    expect(semitoneToNoteName(6)).toBe('F#4');
  });

  it('handles negative semitones correctly', () => {
    expect(semitoneToNoteName(-1)).toBe('B3');
    expect(semitoneToNoteName(-7)).toBe('F3');
  });
});
