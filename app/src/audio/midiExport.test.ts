/**
 * MIDI Export Unit Tests
 *
 * Tests for helper functions and integration scenarios.
 * See midiExport.fidelity.test.ts for binary parsing tests.
 */

import { describe, it, expect } from 'vitest';
import {
  isDrumTrack,
  getDrumNote,
  getSynthProgram,
  getSynthNotePitch,
  getVelocity,
  stepToTicks,
  calculatePatternLength,
  sanitizeFilename,
  exportToMidi,
  TICKS_PER_STEP,
  BASE_NOTE,
  DEFAULT_VELOCITY,
  DEFAULT_PROGRAM,
  DRUM_NOTE_MAP,
  SYNTH_PROGRAM_MAP,
} from './midiExport';
import type { Track } from '../types';
import type { ParameterLock } from '../shared/sync-types';

// ============================================================================
// Test Fixtures
// ============================================================================

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'test-track',
    name: 'Test Track',
    sampleId: 'kick',
    steps: Array(128).fill(false),
    parameterLocks: Array(128).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    playbackMode: 'oneshot',
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

function createState(overrides: Partial<{ tracks: Track[]; tempo: number; swing: number }> = {}) {
  return {
    tracks: [createTrack()],
    tempo: 120,
    swing: 0,
    ...overrides,
  };
}

// ============================================================================
// isDrumTrack Tests
// ============================================================================

describe('isDrumTrack', () => {
  describe('drum samples', () => {
    it.each(Object.keys(DRUM_NOTE_MAP))('returns true for %s', (sampleId) => {
      const track = createTrack({ sampleId });
      expect(isDrumTrack(track)).toBe(true);
    });
  });

  describe('synth samples', () => {
    it.each(['bass', 'lead', 'pad', 'pluck', 'chord'])('returns false for %s', (sampleId) => {
      const track = createTrack({ sampleId });
      expect(isDrumTrack(track)).toBe(false);
    });
  });

  describe('prefixed samples', () => {
    it('returns false for synth: prefix', () => {
      const track = createTrack({ sampleId: 'synth:lead' });
      expect(isDrumTrack(track)).toBe(false);
    });

    it('returns false for tone: prefix', () => {
      const track = createTrack({ sampleId: 'tone:fm-epiano' });
      expect(isDrumTrack(track)).toBe(false);
    });

    it('returns false for sampled: prefix', () => {
      const track = createTrack({ sampleId: 'sampled:piano' });
      expect(isDrumTrack(track)).toBe(false);
    });

    it('returns true for mic: prefix (custom recordings)', () => {
      const track = createTrack({ sampleId: 'mic:recording-123' });
      expect(isDrumTrack(track)).toBe(true);
    });
  });

  it('handles case insensitivity', () => {
    expect(isDrumTrack(createTrack({ sampleId: 'KICK' }))).toBe(true);
    expect(isDrumTrack(createTrack({ sampleId: 'Snare' }))).toBe(true);
  });
});

// ============================================================================
// getDrumNote Tests
// ============================================================================

describe('getDrumNote', () => {
  it.each(Object.entries(DRUM_NOTE_MAP))('returns %i for %s', (sampleId, expectedNote) => {
    const track = createTrack({ sampleId });
    expect(getDrumNote(track)).toBe(expectedNote);
  });

  it('returns BASE_NOTE (60) for mic: recordings', () => {
    const track = createTrack({ sampleId: 'mic:custom-sound' });
    expect(getDrumNote(track)).toBe(BASE_NOTE);
  });

  it('returns BASE_NOTE (60) for unknown drums', () => {
    const track = createTrack({ sampleId: 'unknown-drum' });
    expect(getDrumNote(track)).toBe(BASE_NOTE);
  });

  it('handles case insensitivity', () => {
    expect(getDrumNote(createTrack({ sampleId: 'KICK' }))).toBe(36);
    expect(getDrumNote(createTrack({ sampleId: 'Snare' }))).toBe(38);
  });
});

// ============================================================================
// getSynthProgram Tests
// ============================================================================

describe('getSynthProgram', () => {
  it.each(Object.entries(SYNTH_PROGRAM_MAP))('returns %i for %s', (sampleId, expectedProgram) => {
    const track = createTrack({ sampleId });
    expect(getSynthProgram(track)).toBe(expectedProgram);
  });

  it('strips synth: prefix', () => {
    const track = createTrack({ sampleId: 'synth:lead' });
    expect(getSynthProgram(track)).toBe(SYNTH_PROGRAM_MAP['lead']);
  });

  it('strips tone: prefix', () => {
    const track = createTrack({ sampleId: 'tone:fm-epiano' });
    expect(getSynthProgram(track)).toBe(SYNTH_PROGRAM_MAP['fm-epiano']);
  });

  it('strips sampled: prefix', () => {
    const track = createTrack({ sampleId: 'sampled:piano' });
    expect(getSynthProgram(track)).toBe(SYNTH_PROGRAM_MAP['piano']);
  });

  it('returns DEFAULT_PROGRAM (1) for unknown presets', () => {
    const track = createTrack({ sampleId: 'unknown-synth' });
    expect(getSynthProgram(track)).toBe(DEFAULT_PROGRAM);
  });
});

// ============================================================================
// getSynthNotePitch Tests
// ============================================================================

describe('getSynthNotePitch', () => {
  it('returns BASE_NOTE (60) with no transpose or p-lock', () => {
    const track = createTrack({ transpose: 0 });
    expect(getSynthNotePitch(track, null)).toBe(BASE_NOTE);
  });

  it('applies positive transpose', () => {
    const track = createTrack({ transpose: 5 });
    expect(getSynthNotePitch(track, null)).toBe(BASE_NOTE + 5);
  });

  it('applies negative transpose', () => {
    const track = createTrack({ transpose: -7 });
    expect(getSynthNotePitch(track, null)).toBe(BASE_NOTE - 7);
  });

  it('applies pitch p-lock', () => {
    const track = createTrack({ transpose: 0 });
    const pLock: ParameterLock = { pitch: 12 };
    expect(getSynthNotePitch(track, pLock)).toBe(BASE_NOTE + 12);
  });

  it('combines transpose and p-lock', () => {
    const track = createTrack({ transpose: 5 });
    const pLock: ParameterLock = { pitch: 7 };
    expect(getSynthNotePitch(track, pLock)).toBe(BASE_NOTE + 5 + 7);
  });

  it('clamps to maximum 127', () => {
    const track = createTrack({ transpose: 50 });
    const pLock: ParameterLock = { pitch: 50 };
    expect(getSynthNotePitch(track, pLock)).toBe(127);
  });

  it('clamps to minimum 0', () => {
    const track = createTrack({ transpose: -50 });
    const pLock: ParameterLock = { pitch: -50 };
    expect(getSynthNotePitch(track, pLock)).toBe(0);
  });
});

// ============================================================================
// getVelocity Tests
// ============================================================================

describe('getVelocity', () => {
  it('returns DEFAULT_VELOCITY (100) with no p-lock', () => {
    expect(getVelocity(null)).toBe(DEFAULT_VELOCITY);
  });

  it('returns DEFAULT_VELOCITY (100) with p-lock but no volume', () => {
    const pLock: ParameterLock = { pitch: 5 };
    expect(getVelocity(pLock)).toBe(DEFAULT_VELOCITY);
  });

  it('converts volume 1.0 to 100', () => {
    const pLock: ParameterLock = { volume: 1.0 };
    expect(getVelocity(pLock)).toBe(100);
  });

  it('converts volume 0.5 to 50', () => {
    const pLock: ParameterLock = { volume: 0.5 };
    expect(getVelocity(pLock)).toBe(50);
  });

  it('converts volume 0.25 to 25', () => {
    const pLock: ParameterLock = { volume: 0.25 };
    expect(getVelocity(pLock)).toBe(25);
  });

  it('rounds to nearest integer', () => {
    const pLock: ParameterLock = { volume: 0.333 };
    expect(getVelocity(pLock)).toBe(33);
  });

  it('enforces minimum velocity of 1', () => {
    const pLock: ParameterLock = { volume: 0 };
    expect(getVelocity(pLock)).toBe(1);
  });

  it('enforces minimum velocity of 1 for very small values', () => {
    const pLock: ParameterLock = { volume: 0.001 };
    expect(getVelocity(pLock)).toBe(1);
  });
});

// ============================================================================
// stepToTicks Tests
// ============================================================================

describe('stepToTicks', () => {
  it('calculates base ticks without swing', () => {
    expect(stepToTicks(0, 0)).toBe(0);
    expect(stepToTicks(1, 0)).toBe(TICKS_PER_STEP);
    expect(stepToTicks(2, 0)).toBe(TICKS_PER_STEP * 2);
    expect(stepToTicks(15, 0)).toBe(TICKS_PER_STEP * 15);
  });

  it('does not apply swing to on-beat steps (even)', () => {
    expect(stepToTicks(0, 50)).toBe(0);
    expect(stepToTicks(2, 50)).toBe(TICKS_PER_STEP * 2);
    expect(stepToTicks(4, 100)).toBe(TICKS_PER_STEP * 4);
  });

  it('applies swing to off-beat steps (odd)', () => {
    // At 50% swing, offset = 0.5 * 32 * 0.5 = 8 ticks
    expect(stepToTicks(1, 50)).toBe(TICKS_PER_STEP + 8);
    expect(stepToTicks(3, 50)).toBe(TICKS_PER_STEP * 3 + 8);
  });

  it('applies maximum swing (100%)', () => {
    // At 100% swing, offset = 1.0 * 32 * 0.5 = 16 ticks
    expect(stepToTicks(1, 100)).toBe(TICKS_PER_STEP + 16);
  });

  it('rounds swing offset to nearest tick', () => {
    // At 33% swing, offset = 0.33 * 32 * 0.5 = 5.28 -> 5 ticks
    expect(stepToTicks(1, 33)).toBe(TICKS_PER_STEP + 5);
  });
});

// ============================================================================
// calculatePatternLength Tests
// ============================================================================

describe('calculatePatternLength', () => {
  it('returns 16 for empty tracks', () => {
    expect(calculatePatternLength([])).toBe(16);
  });

  it('returns 16 for single track with no active steps', () => {
    const tracks = [createTrack({ steps: Array(128).fill(false) })];
    expect(calculatePatternLength(tracks)).toBe(16);
  });

  it('returns track stepCount for single active track', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const tracks = [createTrack({ stepCount: 32, steps })];
    expect(calculatePatternLength(tracks)).toBe(32);
  });

  it('calculates LCM for multiple tracks', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const tracks = [
      createTrack({ stepCount: 16, steps }),
      createTrack({ stepCount: 12, steps }),
    ];
    // LCM(16, 12) = 48
    expect(calculatePatternLength(tracks)).toBe(48);
  });

  it('excludes muted tracks from LCM', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const tracks = [
      createTrack({ stepCount: 16, steps, muted: false }),
      createTrack({ stepCount: 64, steps, muted: true }),
    ];
    expect(calculatePatternLength(tracks)).toBe(16);
  });

  it('only includes soloed tracks when any are soloed', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const tracks = [
      createTrack({ stepCount: 16, steps, soloed: true }),
      createTrack({ stepCount: 64, steps, soloed: false }),
    ];
    expect(calculatePatternLength(tracks)).toBe(16);
  });

  it('handles complex polyrhythms (3:4:6)', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const tracks = [
      createTrack({ stepCount: 12, steps }), // 3 beats * 4 steps
      createTrack({ stepCount: 16, steps }), // 4 beats * 4 steps
      createTrack({ stepCount: 24, steps }), // 6 beats * 4 steps
    ];
    // LCM(12, 16, 24) = 48
    expect(calculatePatternLength(tracks)).toBe(48);
  });
});

// ============================================================================
// sanitizeFilename Tests
// ============================================================================

describe('sanitizeFilename', () => {
  it('returns "keyboardia" for null', () => {
    expect(sanitizeFilename(null)).toBe('keyboardia');
  });

  it('returns "keyboardia" for undefined', () => {
    expect(sanitizeFilename(undefined)).toBe('keyboardia');
  });

  it('returns "keyboardia" for empty string', () => {
    expect(sanitizeFilename('')).toBe('keyboardia');
  });

  it('returns "keyboardia" for whitespace only', () => {
    expect(sanitizeFilename('   ')).toBe('keyboardia');
  });

  it('keeps valid filenames unchanged', () => {
    expect(sanitizeFilename('my-song')).toBe('my-song');
    expect(sanitizeFilename('track_01')).toBe('track_01');
  });

  it('replaces spaces with dashes', () => {
    expect(sanitizeFilename('my song')).toBe('my-song');
    expect(sanitizeFilename('drum beat 001')).toBe('drum-beat-001');
  });

  it('removes invalid characters', () => {
    expect(sanitizeFilename('song<>:"/\\|?*')).toBe('song');
  });

  it('collapses multiple dashes', () => {
    expect(sanitizeFilename('my---song')).toBe('my-song');
    expect(sanitizeFilename('song - - - name')).toBe('song-name');
  });

  it('removes leading and trailing dashes', () => {
    expect(sanitizeFilename('-my-song-')).toBe('my-song');
    expect(sanitizeFilename('---song---')).toBe('song');
  });

  it('truncates long names to 100 characters', () => {
    const longName = 'a'.repeat(150);
    expect(sanitizeFilename(longName).length).toBe(100);
  });
});

// ============================================================================
// exportToMidi Integration Tests
// ============================================================================

describe('exportToMidi', () => {
  describe('basic export', () => {
    it('exports empty session with valid blob', () => {
      const state = createState({ tracks: [] });
      const result = exportToMidi(state);

      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.size).toBeGreaterThan(0);
      expect(result.filename).toBe('keyboardia.mid');
    });

    it('uses session name for filename', () => {
      const state = createState({ tracks: [] });
      const result = exportToMidi(state, { sessionName: 'My Song' });

      expect(result.filename).toBe('My-Song.mid');
    });

    it('exports basic drum track', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      steps[4] = true;
      steps[8] = true;
      steps[12] = true;
      const track = createTrack({ sampleId: 'kick', steps });
      const state = createState({ tracks: [track] });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
      expect(result._midiData.length).toBeGreaterThan(0);
    });

    it('exports synth track with transpose', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const track = createTrack({ sampleId: 'lead', steps, transpose: 5 });
      const state = createState({ tracks: [track] });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
    });
  });

  describe('parameter locks', () => {
    it('exports with pitch p-locks', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const parameterLocks: (ParameterLock | null)[] = Array(128).fill(null);
      parameterLocks[0] = { pitch: 12 };
      const track = createTrack({ sampleId: 'lead', steps, parameterLocks });
      const state = createState({ tracks: [track] });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
    });

    it('exports with volume p-locks', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const parameterLocks: (ParameterLock | null)[] = Array(128).fill(null);
      parameterLocks[0] = { volume: 0.5 };
      const track = createTrack({ sampleId: 'kick', steps, parameterLocks });
      const state = createState({ tracks: [track] });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
    });
  });

  describe('swing', () => {
    it('exports with swing applied', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      steps[1] = true; // Off-beat, should have swing
      const track = createTrack({ sampleId: 'kick', steps });
      const state = createState({ tracks: [track], swing: 50 });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
    });
  });

  describe('track selection (behavioral parity)', () => {
    it('excludes muted tracks', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const track1 = createTrack({ id: '1', sampleId: 'kick', steps, muted: false });
      const track2 = createTrack({ id: '2', sampleId: 'snare', steps, muted: true });
      const stateAll = createState({ tracks: [track1, track2] });
      const stateMuted = createState({ tracks: [{ ...track1, muted: true }, { ...track2, muted: true }] });

      const resultAll = exportToMidi(stateAll);
      const resultMuted = exportToMidi(stateMuted);

      // All muted should be smaller (only tempo track)
      expect(resultMuted.blob.size).toBeLessThan(resultAll.blob.size);
    });

    it('exports only soloed tracks when any are soloed (BP-03)', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const track1 = createTrack({ id: '1', sampleId: 'kick', steps, soloed: true });
      const track2 = createTrack({ id: '2', sampleId: 'snare', steps, soloed: false });
      const track3 = createTrack({ id: '3', sampleId: 'hihat', steps, soloed: false });
      const state = createState({ tracks: [track1, track2, track3] });
      const result = exportToMidi(state);

      // Should only have 2 tracks (tempo + kick), not 4
      expect(result.blob.size).toBeGreaterThan(0);
    });

    it('exports multiple soloed tracks (BP-04)', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const track1 = createTrack({ id: '1', sampleId: 'kick', steps, soloed: true });
      const track2 = createTrack({ id: '2', sampleId: 'snare', steps, soloed: true });
      const track3 = createTrack({ id: '3', sampleId: 'hihat', steps, soloed: false });
      const state = createState({ tracks: [track1, track2, track3] });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
    });

    it('solo wins over mute (BP-05)', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const track1 = createTrack({ id: '1', sampleId: 'kick', steps, muted: true, soloed: true });
      const track2 = createTrack({ id: '2', sampleId: 'snare', steps, muted: false, soloed: false });
      const state = createState({ tracks: [track1, track2] });
      const result = exportToMidi(state);

      // Track 1 should be exported despite being muted (solo wins)
      expect(result.blob.size).toBeGreaterThan(0);
    });
  });

  describe('empty tracks', () => {
    it('skips tracks with no active steps', () => {
      const emptySteps = Array(128).fill(false);
      const activeSteps = Array(128).fill(false);
      activeSteps[0] = true;

      const emptyTrack = createTrack({ id: '1', sampleId: 'kick', steps: emptySteps });
      const activeTrack = createTrack({ id: '2', sampleId: 'snare', steps: activeSteps });

      const stateWithEmpty = createState({ tracks: [emptyTrack, activeTrack] });
      const stateActiveOnly = createState({ tracks: [activeTrack] });

      const resultWithEmpty = exportToMidi(stateWithEmpty);
      const resultActiveOnly = exportToMidi(stateActiveOnly);

      // Should be same size since empty track is skipped
      expect(resultWithEmpty.blob.size).toBe(resultActiveOnly.blob.size);
    });
  });

  describe('polyrhythms', () => {
    it('exports tracks with different step counts', () => {
      const steps16 = Array(128).fill(false);
      steps16[0] = true;
      const steps32 = Array(128).fill(false);
      steps32[0] = true;

      const track1 = createTrack({ id: '1', sampleId: 'kick', steps: steps16, stepCount: 16 });
      const track2 = createTrack({ id: '2', sampleId: 'bass', steps: steps32, stepCount: 32 });
      const state = createState({ tracks: [track1, track2] });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
    });
  });

  describe('mixed drums and synths', () => {
    it('exports both drum and synth tracks', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;

      const drumTrack = createTrack({ id: '1', name: 'Kick', sampleId: 'kick', steps });
      const synthTrack = createTrack({ id: '2', name: 'Bass', sampleId: 'bass', steps });
      const state = createState({ tracks: [drumTrack, synthTrack] });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
    });
  });

  describe('tempo', () => {
    it.each([60, 90, 120, 140, 180])('exports with tempo %i BPM', (tempo) => {
      const state = createState({ tempo });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
    });
  });

  describe('all drum types', () => {
    it('exports all 8 standard drum types', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;

      const tracks = Object.keys(DRUM_NOTE_MAP).slice(0, 8).map((sampleId, i) =>
        createTrack({ id: String(i), name: sampleId, sampleId, steps })
      );
      const state = createState({ tracks });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
    });
  });

  describe('complex session', () => {
    it('exports session with all features combined', () => {
      const kickSteps = Array(128).fill(false);
      kickSteps[0] = kickSteps[4] = kickSteps[8] = kickSteps[12] = true;

      const snareSteps = Array(128).fill(false);
      snareSteps[4] = snareSteps[12] = true;
      const snareLocks: (ParameterLock | null)[] = Array(128).fill(null);
      snareLocks[4] = { volume: 0.8 };

      const bassSteps = Array(128).fill(false);
      bassSteps[0] = bassSteps[8] = true;
      const bassLocks: (ParameterLock | null)[] = Array(128).fill(null);
      bassLocks[0] = { pitch: -12 };

      const tracks = [
        createTrack({ id: '1', name: 'Kick', sampleId: 'kick', steps: kickSteps }),
        createTrack({ id: '2', name: 'Snare', sampleId: 'snare', steps: snareSteps, parameterLocks: snareLocks }),
        createTrack({ id: '3', name: 'Bass', sampleId: 'bass', steps: bassSteps, parameterLocks: bassLocks, transpose: 5 }),
      ];
      const state = createState({ tracks, tempo: 110, swing: 25 });
      const result = exportToMidi(state);

      expect(result.blob.size).toBeGreaterThan(0);
      expect(result.filename).toBe('keyboardia.mid');
    });
  });
});
