/**
 * MIDI Export Fidelity Tests - Phase 32.5
 *
 * These tests verify the ACCURACY of exported MIDI files by parsing
 * the output and checking actual note data, timing, channels, etc.
 *
 * Unlike the smoke tests in midiExport.test.ts (which only check blob.size > 0),
 * these tests parse the MIDI binary and verify correctness.
 *
 * @see /specs/MIDI-EXPORT.md for specification
 */

import { describe, it, expect } from 'vitest';
import { parseMidi, MidiData } from 'midi-file';
import { exportToMidi } from './midiExport';
import type { Track, GridState } from '../types';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Parse exported MIDI data into structured data
 * Uses the raw Uint8Array for reliable test environment support
 */
function parseMidiData(midiData: Uint8Array): MidiData {
  return parseMidi(midiData);
}

/**
 * Extract all note-on events from a parsed MIDI file
 */
interface NoteEvent {
  track: number;
  channel: number;
  noteNumber: number;
  velocity: number;
  absoluteTick: number;
}

function extractNoteEvents(midi: MidiData): NoteEvent[] {
  const notes: NoteEvent[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    let absoluteTick = 0;

    for (const event of track) {
      absoluteTick += event.deltaTime;

      if (event.type === 'noteOn' && event.velocity > 0) {
        notes.push({
          track: trackIndex,
          channel: event.channel,
          noteNumber: event.noteNumber,
          velocity: event.velocity,
          absoluteTick,
        });
      }
    }
  });

  return notes;
}

/**
 * Extract tempo from parsed MIDI (microseconds per quarter note)
 */
function extractTempo(midi: MidiData): number | null {
  for (const track of midi.tracks) {
    for (const event of track) {
      if (event.type === 'setTempo') {
        return event.microsecondsPerBeat;
      }
    }
  }
  return null;
}

/**
 * Extract program change events
 */
interface ProgramChange {
  track: number;
  channel: number;
  program: number;
}

function extractProgramChanges(midi: MidiData): ProgramChange[] {
  const changes: ProgramChange[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    for (const event of track) {
      if (event.type === 'programChange') {
        changes.push({
          track: trackIndex,
          channel: event.channel,
          program: event.programNumber,
        });
      }
    }
  });

  return changes;
}

/**
 * Extract track names from parsed MIDI
 */
function extractTrackNames(midi: MidiData): string[] {
  const names: string[] = [];

  for (const track of midi.tracks) {
    for (const event of track) {
      if (event.type === 'trackName') {
        names.push(event.text);
        break;
      }
    }
  }

  return names;
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'test-track',
    name: 'Test',
    sampleId: 'kick',
    steps: new Array(16).fill(false),
    parameterLocks: new Array(16).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    playbackMode: 'oneshot',
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

function createState(overrides: Partial<GridState> = {}): GridState {
  return {
    tracks: [],
    tempo: 120,
    swing: 0,
    isPlaying: false,
    currentStep: 0,
    ...overrides,
  };
}

// ============================================================================
// File Structure Tests
// ============================================================================

describe('MIDI Fidelity: File Structure', () => {
  it('exports SMF Type 1 format', async () => {
    const track = createTrack({ steps: [true, false, false, false] });
    const state = createState({ tracks: [track] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);

    expect(midi.header.format).toBe(1); // Type 1
  });

  it('uses 128 ticks per quarter note (midi-writer-js default)', async () => {
    const track = createTrack({ steps: [true, false, false, false] });
    const state = createState({ tracks: [track] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);

    expect(midi.header.ticksPerBeat).toBe(128);
  });

  it('creates tempo track plus instrument tracks', async () => {
    const kick = createTrack({ id: 'kick', name: 'Kick', sampleId: 'kick', steps: [true, false, false, false] });
    const snare = createTrack({ id: 'snare', name: 'Snare', sampleId: 'snare', steps: [false, true, false, false] });
    const state = createState({ tracks: [kick, snare] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);

    // 1 tempo track + 2 instrument tracks = 3 total
    expect(midi.header.numTracks).toBe(3);
    expect(midi.tracks.length).toBe(3);
  });

  it('includes track names', async () => {
    const kick = createTrack({ name: 'My Kick', sampleId: 'kick', steps: [true, false, false, false] });
    const bass = createTrack({ name: 'Funky Bass', sampleId: 'bass', steps: [true, false, false, false] });
    const state = createState({ tracks: [kick, bass] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const names = extractTrackNames(midi);

    expect(names).toContain('Tempo');
    expect(names).toContain('My Kick');
    expect(names).toContain('Funky Bass');
  });
});

// ============================================================================
// Tempo Tests
// ============================================================================

describe('MIDI Fidelity: Tempo', () => {
  it('exports correct tempo at 120 BPM', async () => {
    const track = createTrack({ steps: [true, false, false, false] });
    const state = createState({ tracks: [track], tempo: 120 });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const tempo = extractTempo(midi);

    // 120 BPM = 500,000 microseconds per quarter note
    expect(tempo).toBe(500000);
  });

  it('exports correct tempo at 90 BPM', async () => {
    const track = createTrack({ steps: [true, false, false, false] });
    const state = createState({ tracks: [track], tempo: 90 });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const tempo = extractTempo(midi);

    // 90 BPM = 666,667 microseconds per quarter note
    expect(tempo).toBe(666667);
  });

  it('exports correct tempo at 140 BPM', async () => {
    const track = createTrack({ steps: [true, false, false, false] });
    const state = createState({ tracks: [track], tempo: 140 });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const tempo = extractTempo(midi);

    // 140 BPM = 428,571 microseconds per quarter note
    expect(tempo).toBe(428571);
  });
});

// ============================================================================
// Note Timing Tests
// ============================================================================

describe('MIDI Fidelity: Note Timing', () => {
  it('places notes at correct tick positions (no swing)', async () => {
    // Notes on steps 0, 2, 4, 6 (on-beats)
    const track = createTrack({
      sampleId: 'kick',
      steps: [true, false, true, false, true, false, true, false],
      stepCount: 8,
    });
    const state = createState({ tracks: [track], swing: 0 });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // Each step = 32 ticks (128 PPQN / 4 steps per beat)
    expect(notes.length).toBe(4);
    expect(notes[0].absoluteTick).toBe(0);   // Step 0
    expect(notes[1].absoluteTick).toBe(64);  // Step 2
    expect(notes[2].absoluteTick).toBe(128); // Step 4
    expect(notes[3].absoluteTick).toBe(192); // Step 6
  });

  it('applies swing offset to off-beat steps', async () => {
    // Notes on steps 1, 3 (off-beats only)
    const track = createTrack({
      sampleId: 'snare',
      steps: [false, true, false, true, false, false, false, false],
      stepCount: 8,
    });
    const state = createState({ tracks: [track], swing: 50 });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // 50% swing = 8 tick offset (50% of 16, which is half a step at 128 PPQN)
    // Step 1: base 32, swung to 40
    // Step 3: base 96, swung to 104
    expect(notes.length).toBe(2);
    expect(notes[0].absoluteTick).toBe(40);  // 32 + 8
    expect(notes[1].absoluteTick).toBe(104); // 96 + 8
  });

  it('does not apply swing to on-beat steps', async () => {
    // Notes on steps 0, 2 (on-beats)
    const track = createTrack({
      sampleId: 'kick',
      steps: [true, false, true, false],
      stepCount: 4,
    });
    const state = createState({ tracks: [track], swing: 100 }); // Max swing
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // On-beats should not be affected by swing
    expect(notes[0].absoluteTick).toBe(0);  // Step 0 - no swing
    expect(notes[1].absoluteTick).toBe(64); // Step 2 - no swing
  });

  it('handles 100% swing correctly', async () => {
    // Note on step 1 (off-beat)
    const track = createTrack({
      sampleId: 'hihat',
      steps: [false, true, false, false],
      stepCount: 4,
    });
    const state = createState({ tracks: [track], swing: 100 });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // 100% swing = 16 tick offset (100% of 16, half a step)
    expect(notes[0].absoluteTick).toBe(48); // 32 + 16
  });
});

// ============================================================================
// Note Pitch Tests
// ============================================================================

describe('MIDI Fidelity: Note Pitch', () => {
  it('uses correct drum note numbers (GM mapping)', async () => {
    const kick = createTrack({ id: 'kick', sampleId: 'kick', steps: [true, false, false, false], stepCount: 4 });
    const snare = createTrack({ id: 'snare', sampleId: 'snare', steps: [false, true, false, false], stepCount: 4 });
    const hihat = createTrack({ id: 'hihat', sampleId: 'hihat', steps: [false, false, true, false], stepCount: 4 });
    const state = createState({ tracks: [kick, snare, hihat] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    expect(notes.find(n => n.absoluteTick === 0)?.noteNumber).toBe(36);  // Kick = C2
    expect(notes.find(n => n.absoluteTick === 32)?.noteNumber).toBe(38); // Snare = D2
    expect(notes.find(n => n.absoluteTick === 64)?.noteNumber).toBe(42); // Hihat = F#2
  });

  it('uses base note 60 (C4) for synths', async () => {
    const synth = createTrack({
      sampleId: 'lead',
      steps: [true, false, false, false],
      stepCount: 4,
      transpose: 0,
    });
    const state = createState({ tracks: [synth] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    expect(notes[0].noteNumber).toBe(60); // Middle C
  });

  it('applies track transpose to synth notes', async () => {
    const synth = createTrack({
      sampleId: 'bass',
      steps: [true, false, false, false],
      stepCount: 4,
      transpose: -12, // One octave down
    });
    const state = createState({ tracks: [synth] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    expect(notes[0].noteNumber).toBe(48); // 60 - 12
  });

  it('applies pitch parameter locks', async () => {
    const synth = createTrack({
      sampleId: 'lead',
      steps: [true, true, true, true],
      parameterLocks: [
        { pitch: 0 },
        { pitch: 4 },  // Major 3rd
        { pitch: 7 },  // Perfect 5th
        { pitch: 12 }, // Octave
      ],
      stepCount: 4,
      transpose: 0,
    });
    const state = createState({ tracks: [synth] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    expect(notes[0].noteNumber).toBe(60); // C4
    expect(notes[1].noteNumber).toBe(64); // E4
    expect(notes[2].noteNumber).toBe(67); // G4
    expect(notes[3].noteNumber).toBe(72); // C5
  });

  it('combines transpose and pitch locks', async () => {
    const synth = createTrack({
      sampleId: 'lead',
      steps: [true, false, false, false],
      parameterLocks: [{ pitch: 7 }],
      stepCount: 4,
      transpose: 5, // Up a 4th
    });
    const state = createState({ tracks: [synth] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // 60 + 5 (transpose) + 7 (p-lock) = 72
    expect(notes[0].noteNumber).toBe(72);
  });

  it('clamps notes to valid MIDI range (0-127)', async () => {
    const synth = createTrack({
      sampleId: 'lead',
      steps: [true, true],
      parameterLocks: [
        { pitch: 100 },  // Would be 160 without clamping
        { pitch: -100 }, // Would be -40 without clamping
      ],
      stepCount: 2,
      transpose: 0,
    });
    const state = createState({ tracks: [synth] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    expect(notes[0].noteNumber).toBe(127); // Clamped to max
    expect(notes[1].noteNumber).toBe(0);   // Clamped to min
  });
});

// ============================================================================
// Velocity Tests
// ============================================================================

describe('MIDI Fidelity: Velocity', () => {
  it('uses default velocity 100 (scaled to MIDI 127)', async () => {
    const track = createTrack({
      sampleId: 'kick',
      steps: [true, false, false, false],
      parameterLocks: [null],
      stepCount: 4,
    });
    const state = createState({ tracks: [track] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // midi-writer-js scales 100% to MIDI velocity 127
    expect(notes[0].velocity).toBe(127);
  });

  it('maps volume p-locks to velocity (1-127)', async () => {
    const track = createTrack({
      sampleId: 'hihat',
      steps: [true, true, true, true],
      parameterLocks: [
        { volume: 1.0 },  // Max
        { volume: 0.5 },  // Half
        { volume: 0.0 },  // Min (becomes 1)
        { volume: 0.78 }, // ~99
      ],
      stepCount: 4,
    });
    const state = createState({ tracks: [track] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    expect(notes[0].velocity).toBe(127); // 1.0 * 127
    expect(notes[1].velocity).toBe(64);  // 0.5 * 127, rounded
    expect(notes[2].velocity).toBe(1);   // Min velocity is 1, not 0
    expect(notes[3].velocity).toBe(99);  // 0.78 * 127, rounded
  });
});

// ============================================================================
// Channel Assignment Tests
// ============================================================================

describe('MIDI Fidelity: Channel Assignment', () => {
  it('assigns drums to channel 10', async () => {
    const kick = createTrack({ sampleId: 'kick', steps: [true, false, false, false] });
    const snare = createTrack({ sampleId: 'snare', steps: [false, true, false, false] });
    const state = createState({ tracks: [kick, snare] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // All drum notes should be on channel 10 (0-indexed = 9)
    for (const note of notes) {
      expect(note.channel).toBe(9); // 0-indexed, so 9 = channel 10
    }
  });

  it('assigns synths to channels 1-9, 11-16 (skipping 10)', async () => {
    const bass = createTrack({ id: 'bass', sampleId: 'bass', steps: [true, false, false, false] });
    const lead = createTrack({ id: 'lead', sampleId: 'lead', steps: [false, true, false, false] });
    const pad = createTrack({ id: 'pad', sampleId: 'pad', steps: [false, false, true, false] });
    const state = createState({ tracks: [bass, lead, pad] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // Synths should NOT be on channel 10
    for (const note of notes) {
      expect(note.channel).not.toBe(9); // Not channel 10
    }

    // Get unique channels used
    const channels = [...new Set(notes.map(n => n.channel))];
    expect(channels.length).toBe(3); // 3 different channels
  });

  it('handles mixed drums and synths correctly', async () => {
    const kick = createTrack({ id: 'kick', sampleId: 'kick', steps: [true, false, false, false] });
    const bass = createTrack({ id: 'bass', sampleId: 'bass', steps: [true, false, false, false] });
    const state = createState({ tracks: [kick, bass] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // Find the drum note (note 36 = kick)
    const drumNote = notes.find(n => n.noteNumber === 36);
    expect(drumNote?.channel).toBe(9); // Channel 10

    // Find the bass note (note 60 or transposed)
    const bassNote = notes.find(n => n.noteNumber === 60);
    expect(bassNote?.channel).not.toBe(9); // Not channel 10
  });
});

// ============================================================================
// Program Change Tests
// ============================================================================

describe('MIDI Fidelity: Program Changes', () => {
  it('includes program change for synth tracks', async () => {
    const bass = createTrack({ sampleId: 'bass', steps: [true, false, false, false] });
    const state = createState({ tracks: [bass] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const programChanges = extractProgramChanges(midi);

    // Should have at least one program change
    expect(programChanges.length).toBeGreaterThan(0);

    // Bass = GM program 33 (0-indexed = 32)
    const bassPC = programChanges.find(pc => pc.program === 32);
    expect(bassPC).toBeDefined();
  });

  it('uses correct GM program numbers', async () => {
    const lead = createTrack({ id: 'lead', sampleId: 'lead', steps: [true, false, false, false] });
    const rhodes = createTrack({ id: 'rhodes', sampleId: 'synth:rhodes', steps: [true, false, false, false] });
    const state = createState({ tracks: [lead, rhodes] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const programChanges = extractProgramChanges(midi);

    // Lead = GM 81 (0-indexed = 80)
    expect(programChanges.some(pc => pc.program === 80)).toBe(true);

    // Rhodes = GM 5 (0-indexed = 4)
    expect(programChanges.some(pc => pc.program === 4)).toBe(true);
  });

  it('does not include program change for drum tracks', async () => {
    const kick = createTrack({ sampleId: 'kick', steps: [true, false, false, false] });
    const state = createState({ tracks: [kick] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const programChanges = extractProgramChanges(midi);

    // Should have no program changes (or none on channel 10)
    const drumProgramChanges = programChanges.filter(pc => pc.channel === 9);
    expect(drumProgramChanges.length).toBe(0);
  });
});

// ============================================================================
// Polyrhythm Tests
// ============================================================================

describe('MIDI Fidelity: Polyrhythms', () => {
  it('expands shorter tracks to LCM length', async () => {
    // 4-step track should loop 4 times to match 16-step LCM
    const short = createTrack({
      id: 'short',
      sampleId: 'kick',
      steps: [true, false, false, false],
      stepCount: 4,
    });
    const long = createTrack({
      id: 'long',
      sampleId: 'snare',
      steps: [true, false, false, false, false, false, false, false,
              false, false, false, false, false, false, false, false],
      stepCount: 16,
    });
    const state = createState({ tracks: [short, long] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // Kick should appear 4 times (steps 0, 4, 8, 12)
    const kickNotes = notes.filter(n => n.noteNumber === 36);
    expect(kickNotes.length).toBe(4);

    expect(kickNotes[0].absoluteTick).toBe(0);   // Step 0
    expect(kickNotes[1].absoluteTick).toBe(128); // Step 4
    expect(kickNotes[2].absoluteTick).toBe(256); // Step 8
    expect(kickNotes[3].absoluteTick).toBe(384); // Step 12
  });

  it('calculates LCM correctly for 3:4 polyrhythm', async () => {
    // 3-step and 4-step = LCM of 12
    const threes = createTrack({
      id: 'threes',
      sampleId: 'kick',
      steps: [true, false, false],
      stepCount: 3,
    });
    const fours = createTrack({
      id: 'fours',
      sampleId: 'snare',
      steps: [true, false, false, false],
      stepCount: 4,
    });
    const state = createState({ tracks: [threes, fours] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // 3-step loops 4 times in 12 steps
    const kickNotes = notes.filter(n => n.noteNumber === 36);
    expect(kickNotes.length).toBe(4);

    // 4-step loops 3 times in 12 steps
    const snareNotes = notes.filter(n => n.noteNumber === 38);
    expect(snareNotes.length).toBe(3);
  });
});

// ============================================================================
// Track Selection Tests (Solo/Mute)
// ============================================================================

describe('MIDI Fidelity: Track Selection', () => {
  it('excludes muted tracks completely', async () => {
    const muted = createTrack({
      id: 'muted',
      sampleId: 'kick',
      steps: [true, true, true, true],
      muted: true,
    });
    const active = createTrack({
      id: 'active',
      sampleId: 'snare',
      steps: [true, false, false, false],
      muted: false,
    });
    const state = createState({ tracks: [muted, active] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // Should only have snare notes, no kick notes
    expect(notes.every(n => n.noteNumber === 38)).toBe(true);
    expect(notes.length).toBe(1);
  });

  it('exports only soloed tracks when any are soloed', async () => {
    const soloed = createTrack({
      id: 'soloed',
      sampleId: 'kick',
      steps: [true, false, false, false],
      soloed: true,
    });
    const notSoloed = createTrack({
      id: 'notSoloed',
      sampleId: 'snare',
      steps: [true, true, true, true],
      soloed: false,
    });
    const state = createState({ tracks: [soloed, notSoloed] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // Should only have kick (soloed), no snare
    expect(notes.every(n => n.noteNumber === 36)).toBe(true);
    expect(notes.length).toBe(1);
  });

  it('solo wins over mute', async () => {
    const soloedAndMuted = createTrack({
      id: 'soloedMuted',
      sampleId: 'kick',
      steps: [true, false, false, false],
      soloed: true,
      muted: true,
    });
    const state = createState({ tracks: [soloedAndMuted] });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    // Should export the track despite being muted (solo wins)
    expect(notes.length).toBe(1);
    expect(notes[0].noteNumber).toBe(36);
  });
});

// ============================================================================
// Golden File: Complete Session Test
// ============================================================================

describe('MIDI Fidelity: Complete Session', () => {
  it('exports a complete multi-track session with full fidelity', async () => {
    // Create a realistic session with multiple features
    const kick = createTrack({
      id: 'kick',
      name: 'Kick',
      sampleId: 'kick',
      steps: [true, false, false, false, true, false, false, false],
      stepCount: 8,
    });

    const hihat = createTrack({
      id: 'hihat',
      name: 'Hi-Hat',
      sampleId: 'hihat',
      steps: [true, true, true, true, true, true, true, true],
      parameterLocks: [
        { volume: 1.0 },
        { volume: 0.5 },
        { volume: 0.8 },
        { volume: 0.5 },
        { volume: 1.0 },
        { volume: 0.5 },
        { volume: 0.8 },
        { volume: 0.5 },
      ],
      stepCount: 8,
    });

    const bass = createTrack({
      id: 'bass',
      name: 'Bass',
      sampleId: 'synth:funkbass',
      steps: [true, false, false, true, false, false, true, false],
      parameterLocks: [
        { pitch: 0 },
        null,
        null,
        { pitch: 0 },
        null,
        null,
        { pitch: 5 },
        null,
      ],
      stepCount: 8,
      transpose: -12,
    });

    const state = createState({
      tracks: [kick, hihat, bass],
      tempo: 110,
      swing: 25,
    });

    const result = exportToMidi(state, { sessionName: 'Test Session' });
    const midi = parseMidiData(result._midiData);

    // Verify file structure
    expect(midi.header.format).toBe(1);
    expect(midi.header.ticksPerBeat).toBe(128);
    expect(midi.header.numTracks).toBe(4); // tempo + 3 instruments

    // Verify tempo (110 BPM = 545,455 microseconds)
    const tempo = extractTempo(midi);
    expect(tempo).toBe(545455);

    // Verify track names
    const names = extractTrackNames(midi);
    expect(names).toContain('Kick');
    expect(names).toContain('Hi-Hat');
    expect(names).toContain('Bass');

    // Verify notes
    const notes = extractNoteEvents(midi);

    // Kick: 2 notes at steps 0, 4
    const kickNotes = notes.filter(n => n.noteNumber === 36);
    expect(kickNotes.length).toBe(2);
    expect(kickNotes[0].absoluteTick).toBe(0);
    expect(kickNotes[1].absoluteTick).toBe(128); // Step 4
    expect(kickNotes[0].channel).toBe(9); // Channel 10

    // Hi-hat: 8 notes with velocity variations
    const hihatNotes = notes.filter(n => n.noteNumber === 42);
    expect(hihatNotes.length).toBe(8);
    expect(hihatNotes[0].velocity).toBe(127); // volume 1.0
    expect(hihatNotes[1].velocity).toBe(64);  // volume 0.5

    // Off-beat hihats should have swing applied (25% = 4 tick offset at 128 PPQN)
    expect(hihatNotes[1].absoluteTick).toBe(36); // Step 1 (32) + swing (4)

    // Bass: 3 notes with pitch variations
    const bassNotes = notes.filter(n => n.channel !== 9); // Not drums
    expect(bassNotes.length).toBe(3);
    expect(bassNotes[0].noteNumber).toBe(48);  // 60 - 12 + 0
    expect(bassNotes[2].noteNumber).toBe(53);  // 60 - 12 + 5

    // Verify program change for bass
    const programChanges = extractProgramChanges(midi);
    expect(programChanges.some(pc => pc.program === 36)).toBe(true); // Funkbass = GM 37 (0-indexed 36)
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('MIDI Fidelity: Edge Cases', () => {
  it('handles empty session (tempo track only)', async () => {
    const state = createState({ tracks: [], tempo: 120 });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);

    expect(midi.header.numTracks).toBe(1); // Just tempo track
    expect(extractTempo(midi)).toBe(500000);
  });

  it('handles all 8 drum types', async () => {
    const drumTypes = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'rim', 'cowbell'];
    const expectedNotes = [36, 38, 42, 46, 39, 45, 37, 56];

    const tracks = drumTypes.map((drum, i) => createTrack({
      id: drum,
      sampleId: drum,
      steps: (() => {
        const s = new Array(16).fill(false);
        s[i] = true;
        return s;
      })(),
      stepCount: 16,
    }));

    const state = createState({ tracks });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);
    const notes = extractNoteEvents(midi);

    expect(notes.length).toBe(8);

    // Verify each drum maps to correct note
    for (let i = 0; i < 8; i++) {
      expect(notes.some(n => n.noteNumber === expectedNotes[i])).toBe(true);
    }

    // All on channel 10
    expect(notes.every(n => n.channel === 9)).toBe(true);
  });

  it('handles maximum complexity (16 tracks, 64 steps, all p-locks)', async () => {
    const tracks: Track[] = [];

    for (let t = 0; t < 16; t++) {
      const steps = new Array(64).fill(false);
      const pLocks = new Array(64).fill(null);

      // Every 4th step has a note with p-locks
      for (let s = 0; s < 64; s += 4) {
        steps[s] = true;
        pLocks[s] = { pitch: s % 12, volume: 0.5 + (s % 5) * 0.1 };
      }

      tracks.push(createTrack({
        id: `track-${t}`,
        name: `Track ${t + 1}`,
        sampleId: t < 8 ? ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'rim', 'cowbell'][t] : 'lead',
        steps,
        parameterLocks: pLocks,
        stepCount: 64,
        transpose: t < 8 ? 0 : (t - 8) * 2,
      }));
    }

    const state = createState({ tracks, tempo: 140, swing: 30 });
    const result = exportToMidi(state);

    const midi = parseMidiData(result._midiData);

    // Should have 17 tracks (tempo + 16 instruments)
    expect(midi.header.numTracks).toBe(17);

    // Should have notes
    const notes = extractNoteEvents(midi);
    expect(notes.length).toBeGreaterThan(0);

    // Each track has 16 notes (64 steps / 4)
    expect(notes.length).toBe(16 * 16); // 256 notes
  });
});
