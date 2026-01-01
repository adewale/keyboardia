/**
 * MIDI Export Fidelity Tests
 *
 * These tests parse the actual MIDI binary output to verify correctness.
 * Uses the midi-file package for binary parsing.
 *
 * @see /specs/MIDI-EXPORT.md for specification
 */

import { describe, it, expect } from 'vitest';
import { parseMidi } from 'midi-file';
import type { MidiData } from 'midi-file';
import {
  exportToMidi,
  TICKS_PER_STEP,
  BASE_NOTE,
  DRUM_CHANNEL,
  DRUM_NOTE_MAP,
  SYNTH_PROGRAM_MAP,
} from './midiExport';
import type { Track } from '../types';
import type { ParameterLock } from '../shared/sync-types';

// ============================================================================
// Test Utilities
// ============================================================================

interface NoteEvent {
  note: number;
  velocity: number;
  channel: number;
  startTick: number;
  track: number;
}

interface ProgramChange {
  program: number;
  channel: number;
  track: number;
}

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

function parseMidiData(midiData: Uint8Array): MidiData {
  return parseMidi(midiData);
}

function extractNoteEvents(midi: MidiData): NoteEvent[] {
  const notes: NoteEvent[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    let absoluteTick = 0;

    for (const event of track) {
      absoluteTick += event.deltaTime;

      if (event.type === 'noteOn' && event.velocity > 0) {
        notes.push({
          note: event.noteNumber,
          velocity: event.velocity,
          channel: event.channel + 1, // Convert 0-indexed to 1-indexed
          startTick: absoluteTick,
          track: trackIndex,
        });
      }
    }
  });

  return notes;
}

function extractTempo(midi: MidiData): number | null {
  for (const track of midi.tracks) {
    for (const event of track) {
      if (event.type === 'setTempo') {
        // Convert microseconds per quarter to BPM
        return Math.round(60_000_000 / event.microsecondsPerBeat);
      }
    }
  }
  return null;
}

function extractProgramChanges(midi: MidiData): ProgramChange[] {
  const programs: ProgramChange[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    for (const event of track) {
      if (event.type === 'programChange') {
        programs.push({
          program: event.programNumber,
          channel: event.channel + 1, // Convert 0-indexed to 1-indexed
          track: trackIndex,
        });
      }
    }
  });

  return programs;
}

function extractTrackNames(midi: MidiData): string[] {
  const names: string[] = [];

  for (const track of midi.tracks) {
    for (const event of track) {
      if (event.type === 'trackName') {
        names.push(event.text);
      }
    }
  }

  return names;
}

function extractChannels(midi: MidiData): Set<number> {
  const channels = new Set<number>();

  for (const track of midi.tracks) {
    for (const event of track) {
      if ('channel' in event && typeof event.channel === 'number') {
        channels.add(event.channel + 1); // 0-indexed to 1-indexed
      }
    }
  }

  return channels;
}

// ============================================================================
// File Structure Tests
// ============================================================================

describe('MIDI File Structure', () => {
  it('generates SMF Type 1 (multi-track) format', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const track = createTrack({ steps });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);

    expect(midi.header.format).toBe(1);
  });

  it('uses 128 ticks per quarter note (PPQN)', () => {
    const state = createState({ tracks: [] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);

    expect(midi.header.ticksPerBeat).toBe(128);
  });

  it('has correct track count (tempo track + instrument tracks)', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const tracks = [
      createTrack({ id: '1', sampleId: 'kick', steps }),
      createTrack({ id: '2', sampleId: 'snare', steps }),
    ];
    const state = createState({ tracks });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);

    // 1 tempo track + 2 instrument tracks
    expect(midi.tracks.length).toBe(3);
  });

  it('includes track name meta events', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const track = createTrack({ name: 'My Kick', steps });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const names = extractTrackNames(midi);

    expect(names).toContain('Tempo');
    expect(names).toContain('My Kick');
  });
});

// ============================================================================
// Tempo Tests
// ============================================================================

describe('MIDI Tempo', () => {
  it.each([
    [120, 500000], // 60,000,000 / 120 = 500,000
    [90, 666667],  // 60,000,000 / 90 ≈ 666,667
    [140, 428571], // 60,000,000 / 140 ≈ 428,571
  ])('encodes %i BPM as %i microseconds per quarter', (bpm, expectedMicroseconds) => {
    const state = createState({ tempo: bpm, tracks: [] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);

    // Find the tempo event
    let foundTempo = 0;
    for (const track of midi.tracks) {
      for (const event of track) {
        if (event.type === 'setTempo') {
          foundTempo = event.microsecondsPerBeat;
          break;
        }
      }
    }

    expect(foundTempo).toBe(expectedMicroseconds);
  });

  it('extracts correct BPM from encoded tempo', () => {
    const state = createState({ tempo: 120, tracks: [] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const tempo = extractTempo(midi);

    expect(tempo).toBe(120);
  });
});

// ============================================================================
// Note Timing Tests
// ============================================================================

describe('MIDI Note Timing', () => {
  it('places notes at correct tick positions (no swing)', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;  // tick 0
    steps[4] = true;  // tick 128 (4 * 32)
    steps[8] = true;  // tick 256 (8 * 32)

    const track = createTrack({ steps, stepCount: 16 });
    const state = createState({ tracks: [track], swing: 0 });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes).toHaveLength(3);
    expect(notes[0].startTick).toBe(0);
    expect(notes[1].startTick).toBe(4 * TICKS_PER_STEP);
    expect(notes[2].startTick).toBe(8 * TICKS_PER_STEP);
  });

  it('applies swing offset to off-beat steps', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;  // on-beat, no swing
    steps[1] = true;  // off-beat, gets swing

    const track = createTrack({ steps, stepCount: 16 });
    const state = createState({ tracks: [track], swing: 50 });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes).toHaveLength(2);
    expect(notes[0].startTick).toBe(0); // On-beat, no swing

    // Off-beat with 50% swing: 32 + (0.5 * 32 * 0.5) = 32 + 8 = 40
    expect(notes[1].startTick).toBe(TICKS_PER_STEP + 8);
  });

  it('does not apply swing to on-beat steps', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;  // on-beat
    steps[2] = true;  // on-beat
    steps[4] = true;  // on-beat

    const track = createTrack({ steps, stepCount: 16 });
    const state = createState({ tracks: [track], swing: 100 });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes).toHaveLength(3);
    expect(notes[0].startTick).toBe(0);
    expect(notes[1].startTick).toBe(2 * TICKS_PER_STEP);
    expect(notes[2].startTick).toBe(4 * TICKS_PER_STEP);
  });
});

// ============================================================================
// Note Pitch Tests
// ============================================================================

describe('MIDI Note Pitch', () => {
  describe('drum notes', () => {
    it.each(Object.entries(DRUM_NOTE_MAP))('maps %s to GM drum note %i', (sampleId, expectedNote) => {
      const steps = Array(128).fill(false);
      steps[0] = true;

      const track = createTrack({ sampleId, steps });
      const state = createState({ tracks: [track] });
      const { _midiData } = exportToMidi(state);
      const midi = parseMidiData(_midiData);
      const notes = extractNoteEvents(midi);

      expect(notes).toHaveLength(1);
      expect(notes[0].note).toBe(expectedNote);
    });
  });

  describe('synth notes', () => {
    it('uses BASE_NOTE (60) for synth with no transpose', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;

      const track = createTrack({ sampleId: 'lead', steps, transpose: 0 });
      const state = createState({ tracks: [track] });
      const { _midiData } = exportToMidi(state);
      const midi = parseMidiData(_midiData);
      const notes = extractNoteEvents(midi);

      expect(notes).toHaveLength(1);
      expect(notes[0].note).toBe(BASE_NOTE);
    });

    it('applies positive transpose', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;

      const track = createTrack({ sampleId: 'lead', steps, transpose: 7 });
      const state = createState({ tracks: [track] });
      const { _midiData } = exportToMidi(state);
      const midi = parseMidiData(_midiData);
      const notes = extractNoteEvents(midi);

      expect(notes[0].note).toBe(BASE_NOTE + 7);
    });

    it('applies negative transpose', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;

      const track = createTrack({ sampleId: 'lead', steps, transpose: -12 });
      const state = createState({ tracks: [track] });
      const { _midiData } = exportToMidi(state);
      const midi = parseMidiData(_midiData);
      const notes = extractNoteEvents(midi);

      expect(notes[0].note).toBe(BASE_NOTE - 12);
    });

    it('applies pitch p-lock', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const parameterLocks: (ParameterLock | null)[] = Array(128).fill(null);
      parameterLocks[0] = { pitch: 5 };

      const track = createTrack({ sampleId: 'lead', steps, parameterLocks, transpose: 0 });
      const state = createState({ tracks: [track] });
      const { _midiData } = exportToMidi(state);
      const midi = parseMidiData(_midiData);
      const notes = extractNoteEvents(midi);

      expect(notes[0].note).toBe(BASE_NOTE + 5);
    });

    it('combines transpose and pitch p-lock', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const parameterLocks: (ParameterLock | null)[] = Array(128).fill(null);
      parameterLocks[0] = { pitch: 3 };

      const track = createTrack({ sampleId: 'lead', steps, parameterLocks, transpose: 5 });
      const state = createState({ tracks: [track] });
      const { _midiData } = exportToMidi(state);
      const midi = parseMidiData(_midiData);
      const notes = extractNoteEvents(midi);

      expect(notes[0].note).toBe(BASE_NOTE + 5 + 3);
    });

    it('clamps note to maximum 127', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const parameterLocks: (ParameterLock | null)[] = Array(128).fill(null);
      parameterLocks[0] = { pitch: 50 };

      const track = createTrack({ sampleId: 'lead', steps, parameterLocks, transpose: 50 });
      const state = createState({ tracks: [track] });
      const { _midiData } = exportToMidi(state);
      const midi = parseMidiData(_midiData);
      const notes = extractNoteEvents(midi);

      expect(notes[0].note).toBe(127);
    });

    it('clamps note to minimum 0', () => {
      const steps = Array(128).fill(false);
      steps[0] = true;
      const parameterLocks: (ParameterLock | null)[] = Array(128).fill(null);
      parameterLocks[0] = { pitch: -50 };

      const track = createTrack({ sampleId: 'lead', steps, parameterLocks, transpose: -50 });
      const state = createState({ tracks: [track] });
      const { _midiData } = exportToMidi(state);
      const midi = parseMidiData(_midiData);
      const notes = extractNoteEvents(midi);

      expect(notes[0].note).toBe(0);
    });
  });
});

// ============================================================================
// Velocity Tests
// ============================================================================

describe('MIDI Velocity', () => {
  it('uses default velocity 127 (100%) with no p-lock', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track = createTrack({ steps });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes[0].velocity).toBe(127);
  });

  it('scales velocity based on volume p-lock', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const parameterLocks: (ParameterLock | null)[] = Array(128).fill(null);
    parameterLocks[0] = { volume: 0.5 };

    const track = createTrack({ steps, parameterLocks });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    // 50% volume -> velocity ~64 (midi-writer-js scales 0-100 to 0-127)
    expect(notes[0].velocity).toBeGreaterThan(50);
    expect(notes[0].velocity).toBeLessThan(70);
  });

  it('enforces minimum velocity', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;
    const parameterLocks: (ParameterLock | null)[] = Array(128).fill(null);
    parameterLocks[0] = { volume: 0.01 };

    const track = createTrack({ steps, parameterLocks });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes[0].velocity).toBeGreaterThan(0);
  });
});

// ============================================================================
// Channel Assignment Tests
// ============================================================================

describe('MIDI Channel Assignment', () => {
  it('assigns drums to channel 10', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track = createTrack({ sampleId: 'kick', steps });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes[0].channel).toBe(DRUM_CHANNEL);
  });

  it('assigns synths to channels 1-9, 11-16 (skipping 10)', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track = createTrack({ sampleId: 'lead', steps });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes[0].channel).not.toBe(DRUM_CHANNEL);
    expect(notes[0].channel).toBeGreaterThanOrEqual(1);
    expect(notes[0].channel).toBeLessThanOrEqual(16);
  });

  it('handles mixed drums and synths correctly', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const drumTrack = createTrack({ id: '1', sampleId: 'kick', steps });
    const synthTrack = createTrack({ id: '2', sampleId: 'lead', steps });
    const state = createState({ tracks: [drumTrack, synthTrack] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const channels = extractChannels(midi);

    expect(channels.has(DRUM_CHANNEL)).toBe(true); // Drum on channel 10
    expect(channels.has(1)).toBe(true); // Synth on channel 1
  });
});

// ============================================================================
// Program Change Tests
// ============================================================================

describe('MIDI Program Changes', () => {
  it('includes program change for synth tracks', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track = createTrack({ sampleId: 'lead', steps });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const programs = extractProgramChanges(midi);

    expect(programs.length).toBeGreaterThan(0);
  });

  it('uses correct 0-indexed GM program number', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    // bass = GM program 33 (1-indexed), so 32 (0-indexed)
    const track = createTrack({ sampleId: 'bass', steps });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const programs = extractProgramChanges(midi);

    const bassProgram = programs.find(p => p.program === SYNTH_PROGRAM_MAP['bass'] - 1);
    expect(bassProgram).toBeDefined();
  });

  it('does not include program change for drum tracks', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track = createTrack({ sampleId: 'kick', steps });
    const state = createState({ tracks: [track] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const programs = extractProgramChanges(midi);

    // Filter to drum channel only
    const drumPrograms = programs.filter(p => p.channel === DRUM_CHANNEL);
    expect(drumPrograms.length).toBe(0);
  });
});

// ============================================================================
// Polyrhythm Tests
// ============================================================================

describe('MIDI Polyrhythm Expansion', () => {
  it('expands shorter tracks to match LCM length', () => {
    const steps16 = Array(128).fill(false);
    steps16[0] = true; // One note at start

    const steps32 = Array(128).fill(false);
    steps32[0] = true; // One note at start

    const track16 = createTrack({ id: '1', sampleId: 'kick', steps: steps16, stepCount: 16 });
    const track32 = createTrack({ id: '2', sampleId: 'snare', steps: steps32, stepCount: 32 });
    const state = createState({ tracks: [track16, track32] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    // Track with 16 steps should loop twice (LCM = 32)
    // So we should have 3 notes: 2 kicks + 1 snare
    const kickNotes = notes.filter(n => n.note === DRUM_NOTE_MAP['kick']);
    const snareNotes = notes.filter(n => n.note === DRUM_NOTE_MAP['snare']);

    expect(kickNotes.length).toBe(2); // Looped twice
    expect(snareNotes.length).toBe(1); // No loop
  });

  it('handles 3:4 polyrhythm (LCM = 12)', () => {
    // 12 steps = 3 beats, 16 steps = 4 beats
    // LCM(12, 16) = 48
    const steps12 = Array(128).fill(false);
    steps12[0] = true;

    const steps16 = Array(128).fill(false);
    steps16[0] = true;

    const track12 = createTrack({ id: '1', sampleId: 'kick', steps: steps12, stepCount: 12 });
    const track16 = createTrack({ id: '2', sampleId: 'snare', steps: steps16, stepCount: 16 });
    const state = createState({ tracks: [track12, track16] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    // LCM(12, 16) = 48
    // 48 / 12 = 4 loops for track 12
    // 48 / 16 = 3 loops for track 16
    const kickNotes = notes.filter(n => n.note === DRUM_NOTE_MAP['kick']);
    const snareNotes = notes.filter(n => n.note === DRUM_NOTE_MAP['snare']);

    expect(kickNotes.length).toBe(4);
    expect(snareNotes.length).toBe(3);
  });
});

// ============================================================================
// Track Selection Tests (Behavioral Parity)
// ============================================================================

describe('MIDI Track Selection (Behavioral Parity)', () => {
  it('BP-02: excludes muted tracks', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track1 = createTrack({ id: '1', sampleId: 'kick', steps, muted: false });
    const track2 = createTrack({ id: '2', sampleId: 'snare', steps, muted: true });
    const state = createState({ tracks: [track1, track2] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    // Only kick should be present
    expect(notes.length).toBe(1);
    expect(notes[0].note).toBe(DRUM_NOTE_MAP['kick']);
  });

  it('BP-03: exports only soloed track when one is soloed', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track1 = createTrack({ id: '1', sampleId: 'kick', steps, soloed: true });
    const track2 = createTrack({ id: '2', sampleId: 'snare', steps, soloed: false });
    const track3 = createTrack({ id: '3', sampleId: 'hihat', steps, soloed: false });
    const state = createState({ tracks: [track1, track2, track3] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes.length).toBe(1);
    expect(notes[0].note).toBe(DRUM_NOTE_MAP['kick']);
  });

  it('BP-04: exports multiple soloed tracks', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track1 = createTrack({ id: '1', sampleId: 'kick', steps, soloed: true });
    const track2 = createTrack({ id: '2', sampleId: 'snare', steps, soloed: true });
    const track3 = createTrack({ id: '3', sampleId: 'hihat', steps, soloed: false });
    const state = createState({ tracks: [track1, track2, track3] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes.length).toBe(2);
    const noteNumbers = notes.map(n => n.note).sort();
    expect(noteNumbers).toContain(DRUM_NOTE_MAP['kick']);
    expect(noteNumbers).toContain(DRUM_NOTE_MAP['snare']);
  });

  it('BP-05: solo wins over mute', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track1 = createTrack({ id: '1', sampleId: 'kick', steps, muted: true, soloed: true });
    const track2 = createTrack({ id: '2', sampleId: 'snare', steps, muted: false, soloed: false });
    const state = createState({ tracks: [track1, track2] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    // Kick should be exported despite being muted (solo wins)
    expect(notes.length).toBe(1);
    expect(notes[0].note).toBe(DRUM_NOTE_MAP['kick']);
  });

  it('BP-06: all muted exports only tempo track', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const track1 = createTrack({ id: '1', sampleId: 'kick', steps, muted: true });
    const track2 = createTrack({ id: '2', sampleId: 'snare', steps, muted: true });
    const state = createState({ tracks: [track1, track2] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes.length).toBe(0);
    expect(midi.tracks.length).toBe(1); // Only tempo track
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('MIDI Edge Cases', () => {
  it('handles empty session (tempo track only)', () => {
    const state = createState({ tracks: [] });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);

    expect(midi.tracks.length).toBe(1); // Just tempo track
    const tempo = extractTempo(midi);
    expect(tempo).toBe(120);
  });

  it('handles all 8 standard drum types', () => {
    const steps = Array(128).fill(false);
    steps[0] = true;

    const drumTypes = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'rim', 'cowbell'];
    const tracks = drumTypes.map((sampleId, i) =>
      createTrack({ id: String(i), sampleId, steps })
    );
    const state = createState({ tracks });
    const { _midiData } = exportToMidi(state);
    const midi = parseMidiData(_midiData);
    const notes = extractNoteEvents(midi);

    expect(notes.length).toBe(8);
    const noteNumbers = notes.map(n => n.note).sort((a, b) => a - b);
    const expectedNotes = drumTypes.map(d => DRUM_NOTE_MAP[d]).sort((a, b) => a - b);
    expect(noteNumbers).toEqual(expectedNotes);
  });

  it('handles maximum complexity (16 tracks, 64 steps each)', () => {
    const steps = Array(128).fill(false);
    for (let i = 0; i < 64; i += 4) {
      steps[i] = true; // 16 notes per track
    }

    const drumTypes = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'rim', 'cowbell'];
    const synthTypes = ['bass', 'lead', 'pad', 'pluck', 'chord', 'acid', 'rhodes', 'organ'];

    const tracks = [
      ...drumTypes.map((sampleId, i) =>
        createTrack({ id: `drum-${i}`, name: sampleId, sampleId, steps, stepCount: 64 })
      ),
      ...synthTypes.map((sampleId, i) =>
        createTrack({ id: `synth-${i}`, name: sampleId, sampleId, steps, stepCount: 64 })
      ),
    ];

    const state = createState({ tracks, tempo: 140, swing: 25 });
    const { _midiData, blob } = exportToMidi(state);
    const midi = parseMidiData(_midiData);

    // 1 tempo track + 16 instrument tracks
    expect(midi.tracks.length).toBe(17);

    // Each track has 16 notes
    const notes = extractNoteEvents(midi);
    expect(notes.length).toBe(16 * 16); // 256 notes total

    // File should be reasonably sized
    expect(blob.size).toBeLessThan(100000); // < 100KB
  });
});

// ============================================================================
// Golden File Test (Complex Session)
// ============================================================================

describe('MIDI Golden File Test', () => {
  it('exports complex multi-track session correctly', () => {
    // Create a realistic session
    const kickSteps = Array(128).fill(false);
    [0, 4, 8, 12].forEach(i => kickSteps[i] = true);

    const snareSteps = Array(128).fill(false);
    [4, 12].forEach(i => snareSteps[i] = true);

    const hihatSteps = Array(128).fill(false);
    [0, 2, 4, 6, 8, 10, 12, 14].forEach(i => hihatSteps[i] = true);

    const bassSteps = Array(128).fill(false);
    [0, 6, 8, 14].forEach(i => bassSteps[i] = true);
    const bassLocks: (ParameterLock | null)[] = Array(128).fill(null);
    bassLocks[0] = { pitch: -12 };
    bassLocks[8] = { pitch: -5 };

    const tracks = [
      createTrack({ id: '1', name: 'Kick', sampleId: 'kick', steps: kickSteps }),
      createTrack({ id: '2', name: 'Snare', sampleId: 'snare', steps: snareSteps }),
      createTrack({ id: '3', name: 'Hi-Hat', sampleId: 'hihat', steps: hihatSteps }),
      createTrack({
        id: '4',
        name: 'Bass',
        sampleId: 'bass',
        steps: bassSteps,
        parameterLocks: bassLocks,
        transpose: 5,
      }),
    ];

    const state = createState({ tracks, tempo: 115, swing: 30 });
    const { _midiData, blob, filename } = exportToMidi(state, { sessionName: 'Golden Test' });
    const midi = parseMidiData(_midiData);

    // Verify structure
    expect(midi.header.format).toBe(1);
    expect(midi.header.ticksPerBeat).toBe(128);
    expect(midi.tracks.length).toBe(5); // tempo + 4 instruments

    // Verify tempo
    expect(extractTempo(midi)).toBe(115);

    // Verify track names
    const names = extractTrackNames(midi);
    expect(names).toContain('Kick');
    expect(names).toContain('Snare');
    expect(names).toContain('Hi-Hat');
    expect(names).toContain('Bass');

    // Verify note count
    const notes = extractNoteEvents(midi);
    expect(notes.length).toBe(4 + 2 + 8 + 4); // 18 total notes

    // Verify bass uses synth channel (not 10)
    const bassNotes = notes.filter(n => n.channel !== DRUM_CHANNEL);
    expect(bassNotes.length).toBe(4);

    // Verify filename
    expect(filename).toBe('Golden-Test.mid');

    // Verify reasonable file size
    expect(blob.size).toBeLessThan(10000); // < 10KB for this small session
  });
});
