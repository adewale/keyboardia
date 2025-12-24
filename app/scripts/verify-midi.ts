/**
 * MIDI Export Verification Script
 * Run with: npx tsx scripts/verify-midi.ts
 */
import { exportToMidi } from '../src/audio/midiExport';
import { parseMidi } from 'midi-file';
import type { MidiData } from 'midi-file';
import type { Track, GridState } from '../src/types';
import * as fs from 'fs';

// Create a test session with various track types
const testTracks: Track[] = [
  {
    id: 'kick-track',
    name: 'Kick',
    sampleId: 'kick',
    steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    parameterLocks: Array(16).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    stepCount: 16,
  },
  {
    id: 'snare-track',
    name: 'Snare',
    sampleId: 'snare',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    parameterLocks: Array(16).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    stepCount: 16,
  },
  {
    id: 'bass-track',
    name: 'Bass',
    sampleId: 'synth:bass',
    steps: [true, false, false, false, false, false, true, false, true, false, false, false, false, false, true, false],
    parameterLocks: [null, null, null, null, null, null, { pitch: -12 }, null, null, null, null, null, null, null, { pitch: 7 }, null],
    volume: 0.8,
    muted: false,
    soloed: false,
    stepCount: 16,
    transpose: -12,
  },
  {
    id: 'muted-track',
    name: 'Muted Lead',
    sampleId: 'synth:lead',
    steps: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
    parameterLocks: Array(16).fill(null),
    volume: 1,
    muted: true, // Should NOT be exported
    soloed: false,
    stepCount: 16,
  },
];

const testState: Pick<GridState, 'tracks' | 'tempo' | 'swing'> = {
  tempo: 120,
  swing: 25,
  tracks: testTracks,
};

// Type for MIDI events we care about
interface MidiNoteOn {
  type: 'noteOn';
  channel: number;
  noteNumber: number;
  velocity: number;
}

interface MidiTrackName {
  type: 'trackName';
  text: string;
}

interface MidiProgramChange {
  type: 'programChange';
  channel: number;
  programNumber: number;
}

interface MidiSetTempo {
  type: 'setTempo';
  microsecondsPerBeat: number;
}

type MidiEvent = { type: string; deltaTime: number } & Record<string, unknown>;

// Export to MIDI
const result = exportToMidi(testState, { sessionName: 'test-session' });

// Parse and analyze
const midi: MidiData = parseMidi(result._midiData);

console.log('='.repeat(60));
console.log('MIDI EXPORT VERIFICATION');
console.log('='.repeat(60));

// File info
console.log('\n📁 FILE INFO');
const formatOk = midi.header.format === 1;
const ppqnOk = midi.header.ticksPerBeat === 128;
console.log('  Format: Type ' + midi.header.format + ' (' + (formatOk ? 'Multi-track ✓' : 'ERROR') + ')');
console.log('  PPQN: ' + midi.header.ticksPerBeat + ' (' + (ppqnOk ? '✓' : 'ERROR - expected 128') + ')');
console.log('  Tracks: ' + midi.header.numTracks + ' (expected 4: tempo + kick + snare + bass)');
console.log('  Filename: ' + result.filename);

// Track details
console.log('\n🎵 TRACKS');
for (let i = 0; i < midi.tracks.length; i++) {
  const track = midi.tracks[i] as MidiEvent[];
  const trackNameEvent = track.find((e): e is MidiEvent & MidiTrackName => e.type === 'trackName');
  const trackName = trackNameEvent?.text || 'Unnamed';
  const noteOns = track.filter((e): e is MidiEvent & MidiNoteOn => e.type === 'noteOn' && (e as MidiNoteOn).velocity > 0);
  const programChange = track.find((e): e is MidiEvent & MidiProgramChange => e.type === 'programChange');
  const tempo = track.find((e): e is MidiEvent & MidiSetTempo => e.type === 'setTempo');

  console.log('\n  Track ' + i + ': ' + trackName);
  if (tempo) {
    const bpm = Math.round(60000000 / tempo.microsecondsPerBeat);
    console.log('    Tempo: ' + bpm + ' BPM ' + (bpm === 120 ? '✓' : 'ERROR'));
  }
  if (programChange) {
    console.log('    Program: ' + programChange.programNumber + ' (channel ' + programChange.channel + ')');
  }
  if (noteOns.length > 0) {
    const channels = [...new Set(noteOns.map((n) => n.channel))];
    const pitches = [...new Set(noteOns.map((n) => n.noteNumber))].sort((a, b) => a - b);
    console.log('    Notes: ' + noteOns.length);
    console.log('    Channels: ' + channels.join(', '));
    console.log('    Pitches: ' + pitches.join(', '));
  }
}

// Verify muted track exclusion
const allNotes = midi.tracks.flatMap((t) =>
  (t as MidiEvent[]).filter((e): e is MidiEvent & MidiNoteOn => e.type === 'noteOn' && (e as MidiNoteOn).velocity > 0)
);
console.log('\n🔇 MUTE/SOLO VERIFICATION');
console.log('  Total notes in file: ' + allNotes.length);
console.log('  Expected: 4 (kick) + 2 (snare) + 4 (bass) = 10 notes');
console.log('  Muted track excluded: ' + (allNotes.length <= 10 ? 'YES ✓' : 'NO - ERROR!'));

// Verify drum channel (midi-file uses 0-indexed channels, so channel 10 = index 9)
const DRUM_CHANNEL_INDEX = 9; // Channel 10 in 0-indexed
const drumNotes = allNotes.filter((n) => n.channel === DRUM_CHANNEL_INDEX);
console.log('\n🥁 DRUM CHANNEL VERIFICATION');
console.log('  Notes on channel 10 (index 9): ' + drumNotes.length + ' (expected 6: 4 kick + 2 snare)');
console.log('  Drum channel check: ' + (drumNotes.length === 6 ? '✓' : 'ERROR'));
console.log('  Drum pitches: ' + [...new Set(drumNotes.map((n) => n.noteNumber))].join(', '));
console.log('  Expected: 36 (kick), 38 (snare)');

// Verify synth channel (not drum channel)
const synthNotes = allNotes.filter((n) => n.channel !== DRUM_CHANNEL_INDEX);
console.log('\n🎹 SYNTH CHANNEL VERIFICATION');
console.log('  Notes NOT on drum channel: ' + synthNotes.length + ' (expected 4 bass notes)');
console.log('  Synth channel check: ' + (synthNotes.length === 4 ? '✓' : 'ERROR'));
console.log('  Synth channels used: ' + [...new Set(synthNotes.map((n) => n.channel + 1))].join(', ') + ' (1-indexed)');
console.log('  Synth pitches: ' + [...new Set(synthNotes.map((n) => n.noteNumber))].join(', '));
console.log('  Expected: 48 (C3), 36 (C2 via p-lock), 55 (G3 via p-lock)');

// Save for manual inspection
const outPath = './test-output.mid';
fs.writeFileSync(outPath, Buffer.from(result._midiData));
console.log('\n💾 Saved to: ' + outPath);
console.log('   Open with: open test-output.mid  (macOS)');
console.log('   Or import into GarageBand/Logic/Ableton');

console.log('\n' + '='.repeat(60));
console.log('VERIFICATION COMPLETE');
console.log('='.repeat(60));
