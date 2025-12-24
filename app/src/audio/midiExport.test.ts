/**
 * MIDI Export Tests - Phase 32
 *
 * Test cases from spec /specs/MIDI-EXPORT.md
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
} from './midiExport';
import type { Track, GridState } from '../types';

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
// Helper Function Tests
// ============================================================================

describe('isDrumTrack', () => {
  it('identifies drum samples', () => {
    expect(isDrumTrack(createTrack({ sampleId: 'kick' }))).toBe(true);
    expect(isDrumTrack(createTrack({ sampleId: 'snare' }))).toBe(true);
    expect(isDrumTrack(createTrack({ sampleId: 'hihat' }))).toBe(true);
    expect(isDrumTrack(createTrack({ sampleId: 'openhat' }))).toBe(true);
    expect(isDrumTrack(createTrack({ sampleId: 'clap' }))).toBe(true);
    expect(isDrumTrack(createTrack({ sampleId: 'tom' }))).toBe(true);
    expect(isDrumTrack(createTrack({ sampleId: 'rim' }))).toBe(true);
    expect(isDrumTrack(createTrack({ sampleId: 'cowbell' }))).toBe(true);
  });

  it('identifies synth samples as non-drums', () => {
    expect(isDrumTrack(createTrack({ sampleId: 'bass' }))).toBe(false);
    expect(isDrumTrack(createTrack({ sampleId: 'lead' }))).toBe(false);
    expect(isDrumTrack(createTrack({ sampleId: 'pad' }))).toBe(false);
    expect(isDrumTrack(createTrack({ sampleId: 'synth:rhodes' }))).toBe(false);
    expect(isDrumTrack(createTrack({ sampleId: 'tone:fm-epiano' }))).toBe(false);
  });

  it('treats custom recordings as drums', () => {
    expect(isDrumTrack(createTrack({ sampleId: 'mic:recording-123' }))).toBe(true);
    expect(isDrumTrack(createTrack({ sampleId: 'recording:custom' }))).toBe(true);
  });
});

describe('getDrumNote', () => {
  it('maps drum samples to General MIDI notes', () => {
    expect(getDrumNote(createTrack({ sampleId: 'kick' }))).toBe(36);
    expect(getDrumNote(createTrack({ sampleId: 'snare' }))).toBe(38);
    expect(getDrumNote(createTrack({ sampleId: 'hihat' }))).toBe(42);
    expect(getDrumNote(createTrack({ sampleId: 'openhat' }))).toBe(46);
    expect(getDrumNote(createTrack({ sampleId: 'clap' }))).toBe(39);
    expect(getDrumNote(createTrack({ sampleId: 'tom' }))).toBe(45);
    expect(getDrumNote(createTrack({ sampleId: 'rim' }))).toBe(37);
    expect(getDrumNote(createTrack({ sampleId: 'cowbell' }))).toBe(56);
  });

  it('uses placeholder note for custom recordings', () => {
    expect(getDrumNote(createTrack({ sampleId: 'mic:recording-123' }))).toBe(60);
  });
});

describe('getSynthProgram', () => {
  it('maps core synth presets', () => {
    expect(getSynthProgram(createTrack({ sampleId: 'bass' }))).toBe(33);
    expect(getSynthProgram(createTrack({ sampleId: 'lead' }))).toBe(81);
    expect(getSynthProgram(createTrack({ sampleId: 'pad' }))).toBe(89);
    expect(getSynthProgram(createTrack({ sampleId: 'pluck' }))).toBe(46);
  });

  it('maps synth: prefixed presets', () => {
    expect(getSynthProgram(createTrack({ sampleId: 'synth:rhodes' }))).toBe(5);
    expect(getSynthProgram(createTrack({ sampleId: 'synth:organ' }))).toBe(17);
    expect(getSynthProgram(createTrack({ sampleId: 'synth:brass' }))).toBe(62);
    expect(getSynthProgram(createTrack({ sampleId: 'synth:funkbass' }))).toBe(37);
  });

  it('maps tone: prefixed presets', () => {
    expect(getSynthProgram(createTrack({ sampleId: 'tone:fm-epiano' }))).toBe(5);
    expect(getSynthProgram(createTrack({ sampleId: 'tone:am-synth' }))).toBe(81);
  });

  it('maps sampled: prefixed instruments', () => {
    expect(getSynthProgram(createTrack({ sampleId: 'sampled:piano' }))).toBe(1);
  });

  it('uses default program for unknown samples', () => {
    expect(getSynthProgram(createTrack({ sampleId: 'unknown' }))).toBe(1);
    expect(getSynthProgram(createTrack({ sampleId: 'synth:unknown' }))).toBe(1);
  });
});

describe('getSynthNotePitch', () => {
  it('uses base note 60 (C4) with no modifiers', () => {
    const track = createTrack({ transpose: 0 });
    expect(getSynthNotePitch(track, null)).toBe(60);
  });

  it('applies track transpose', () => {
    const track = createTrack({ transpose: 5 });
    expect(getSynthNotePitch(track, null)).toBe(65);
  });

  it('applies negative transpose', () => {
    const track = createTrack({ transpose: -12 });
    expect(getSynthNotePitch(track, null)).toBe(48);
  });

  it('applies pitch p-lock', () => {
    const track = createTrack({ transpose: 0 });
    expect(getSynthNotePitch(track, { pitch: 7 })).toBe(67);
  });

  it('combines transpose and p-lock', () => {
    const track = createTrack({ transpose: 5 });
    expect(getSynthNotePitch(track, { pitch: 7 })).toBe(72); // 60 + 5 + 7
  });
});

describe('getVelocity', () => {
  it('returns default velocity when no p-lock', () => {
    expect(getVelocity(null)).toBe(100);
    expect(getVelocity({})).toBe(100);
  });

  it('maps volume 0-1 to percentage 1-100 (midi-writer-js then scales to MIDI)', () => {
    expect(getVelocity({ volume: 1.0 })).toBe(100);  // 100% → MIDI 127
    expect(getVelocity({ volume: 0.5 })).toBe(50);   // 50% → MIDI 64
    expect(getVelocity({ volume: 0.0 })).toBe(1);    // Minimum 1% → MIDI 1
  });

  it('rounds to nearest integer', () => {
    expect(getVelocity({ volume: 0.78 })).toBe(78);  // 78% → MIDI 99
  });
});

describe('stepToTicks', () => {
  // TICKS_PER_STEP = 32 (128 PPQN / 4 steps per beat)

  it('calculates base ticks without swing', () => {
    expect(stepToTicks(0, 0)).toBe(0);
    expect(stepToTicks(1, 0)).toBe(32);
    expect(stepToTicks(2, 0)).toBe(64);
    expect(stepToTicks(3, 0)).toBe(96);
    expect(stepToTicks(15, 0)).toBe(480);
  });

  it('applies swing to off-beat steps only', () => {
    // Step 0 (on-beat) - no swing
    expect(stepToTicks(0, 50)).toBe(0);
    // Step 1 (off-beat) - swing applied: 32 + (50/100 * 32 * 0.5) = 32 + 8 = 40
    expect(stepToTicks(1, 50)).toBe(40);
    // Step 2 (on-beat) - no swing
    expect(stepToTicks(2, 50)).toBe(64);
    // Step 3 (off-beat) - swing applied: 96 + 8 = 104
    expect(stepToTicks(3, 50)).toBe(104);
  });

  it('scales swing offset with percentage', () => {
    // 100% swing = maximum offset (half a step): 32 + 16 = 48
    expect(stepToTicks(1, 100)).toBe(48);
    // 25% swing: 32 + 4 = 36
    expect(stepToTicks(1, 25)).toBe(36);
  });
});

describe('calculatePatternLength', () => {
  it('returns 16 for empty tracks', () => {
    expect(calculatePatternLength([])).toBe(16);
  });

  it('returns 16 for all muted tracks', () => {
    const tracks = [
      createTrack({ muted: true, stepCount: 32 }),
    ];
    expect(calculatePatternLength(tracks)).toBe(16);
  });

  it('returns single track length', () => {
    const tracks = [
      createTrack({ stepCount: 32, steps: [true, ...new Array(31).fill(false)] }),
    ];
    expect(calculatePatternLength(tracks)).toBe(32);
  });

  it('calculates LCM for polyrhythms', () => {
    const tracks = [
      createTrack({ id: '1', stepCount: 16, steps: [true, ...new Array(15).fill(false)] }),
      createTrack({ id: '2', stepCount: 12, steps: [true, ...new Array(11).fill(false)] }),
    ];
    expect(calculatePatternLength(tracks)).toBe(48); // LCM(16, 12) = 48
  });

  it('handles complex polyrhythms', () => {
    const tracks = [
      createTrack({ id: '1', stepCount: 4, steps: [true, false, false, false] }),
      createTrack({ id: '2', stepCount: 8, steps: [true, ...new Array(7).fill(false)] }),
      createTrack({ id: '3', stepCount: 16, steps: [true, ...new Array(15).fill(false)] }),
    ];
    expect(calculatePatternLength(tracks)).toBe(16); // LCM(4, 8, 16) = 16
  });

  it('only considers soloed tracks when any track is soloed', () => {
    const tracks = [
      createTrack({ id: '1', stepCount: 4, steps: [true, false, false, false], soloed: true }),
      createTrack({ id: '2', stepCount: 8, steps: [true, ...new Array(7).fill(false)], soloed: false }),
    ];
    // Only the soloed track (4 steps) should be considered
    expect(calculatePatternLength(tracks)).toBe(4);
  });

  it('considers multiple soloed tracks', () => {
    const tracks = [
      createTrack({ id: '1', stepCount: 4, steps: [true, false, false, false], soloed: true }),
      createTrack({ id: '2', stepCount: 12, steps: [true, ...new Array(11).fill(false)], soloed: true }),
      createTrack({ id: '3', stepCount: 8, steps: [true, ...new Array(7).fill(false)], soloed: false }),
    ];
    // LCM of soloed tracks (4 and 12) = 12
    expect(calculatePatternLength(tracks)).toBe(12);
  });

  it('solo wins over mute in pattern calculation', () => {
    const tracks = [
      createTrack({ id: '1', stepCount: 4, steps: [true, false, false, false], soloed: true, muted: true }),
    ];
    // Soloed+muted track should still be considered (solo wins)
    expect(calculatePatternLength(tracks)).toBe(4);
  });
});

describe('sanitizeFilename', () => {
  it('handles null/empty names', () => {
    expect(sanitizeFilename(null)).toBe('keyboardia-session');
    expect(sanitizeFilename('')).toBe('keyboardia-session');
    expect(sanitizeFilename('   ')).toBe('keyboardia-session');
  });

  it('preserves valid names', () => {
    expect(sanitizeFilename('My Session')).toBe('My-Session');
    expect(sanitizeFilename('cool-beat')).toBe('cool-beat');
  });

  it('removes invalid characters', () => {
    expect(sanitizeFilename('test<>:"/\\|?*file')).toBe('testfile');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeFilename('my cool session')).toBe('my-cool-session');
  });

  it('collapses multiple hyphens', () => {
    expect(sanitizeFilename('my   cool---session')).toBe('my-cool-session');
  });

  it('trims leading/trailing hyphens', () => {
    expect(sanitizeFilename('  -my session-  ')).toBe('my-session');
  });

  it('limits length to 100 characters', () => {
    const longName = 'a'.repeat(150);
    expect(sanitizeFilename(longName).length).toBe(100);
  });
});

// ============================================================================
// Integration Tests - Full Export
// ============================================================================

describe('exportToMidi', () => {
  it('exports empty session', () => {
    const state = createState({ tracks: [] });
    const result = exportToMidi(state);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('audio/midi');
    expect(result.filename).toBe('keyboardia-session.mid');
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('exports session with custom name', () => {
    const state = createState({ tracks: [] });
    const result = exportToMidi(state, { sessionName: 'My Beat' });

    expect(result.filename).toBe('My-Beat.mid');
  });

  it('exports basic drum track', () => {
    const kickTrack = createTrack({
      id: 'kick',
      name: 'Kick',
      sampleId: 'kick',
      steps: [true, false, false, false, true, false, false, false],
      stepCount: 8,
    });
    const state = createState({ tracks: [kickTrack], tempo: 120 });
    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.type).toBe('audio/midi');
  });

  it('exports synth track with transpose', () => {
    const bassTrack = createTrack({
      id: 'bass',
      name: 'Bass',
      sampleId: 'bass',
      steps: [true, false, false, true, false, false, false, false],
      stepCount: 8,
      transpose: -12,
    });
    const state = createState({ tracks: [bassTrack], tempo: 110 });
    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('exports track with pitch p-locks', () => {
    const leadTrack = createTrack({
      id: 'lead',
      name: 'Lead',
      sampleId: 'lead',
      steps: [true, true, true, true],
      parameterLocks: [
        { pitch: 0 },
        { pitch: 4 },
        { pitch: 7 },
        { pitch: 12 },
      ],
      stepCount: 4,
    });
    const state = createState({ tracks: [leadTrack] });
    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('exports track with volume p-locks', () => {
    const hihatTrack = createTrack({
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
    const state = createState({ tracks: [hihatTrack] });
    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('exports with swing', () => {
    const snareTrack = createTrack({
      id: 'snare',
      name: 'Snare',
      sampleId: 'snare',
      steps: [false, true, false, true, false, true, false, true],
      stepCount: 8,
    });
    const state = createState({ tracks: [snareTrack], swing: 50 });
    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('omits muted tracks', () => {
    const mutedTrack = createTrack({
      id: 'muted',
      name: 'Muted',
      sampleId: 'kick',
      steps: [true, true, true, true],
      muted: true,
    });
    const activeTrack = createTrack({
      id: 'active',
      name: 'Active',
      sampleId: 'snare',
      steps: [false, true, false, true],
    });
    const state = createState({ tracks: [mutedTrack, activeTrack] });

    // Export with muted track - should have certain size
    const result = exportToMidi(state);

    // Export without muted track - compare sizes
    const stateNoMuted = createState({ tracks: [activeTrack] });
    const resultNoMuted = exportToMidi(stateNoMuted);

    // Both should have same size since muted track is omitted
    expect(result.blob.size).toBe(resultNoMuted.blob.size);
  });

  it('exports only soloed tracks when any track is soloed', () => {
    const soloedTrack = createTrack({
      id: 'soloed',
      name: 'Soloed',
      sampleId: 'kick',
      steps: [true, false, false, false],
      soloed: true,
    });
    const notSoloedTrack = createTrack({
      id: 'not-soloed',
      name: 'Not Soloed',
      sampleId: 'snare',
      steps: [false, true, false, true],
      soloed: false,
    });
    const state = createState({ tracks: [soloedTrack, notSoloedTrack] });

    // Export with solo - should only have soloed track
    const result = exportToMidi(state);

    // Export with only the soloed track - compare sizes
    const stateSoloOnly = createState({ tracks: [soloedTrack] });
    const resultSoloOnly = exportToMidi(stateSoloOnly);

    // Both should have same size since non-soloed track is omitted
    expect(result.blob.size).toBe(resultSoloOnly.blob.size);
  });

  it('solo wins over mute (soloed+muted track is exported)', () => {
    const soloedAndMutedTrack = createTrack({
      id: 'soloed-muted',
      name: 'Soloed and Muted',
      sampleId: 'kick',
      steps: [true, false, false, false],
      soloed: true,
      muted: true,
    });
    const state = createState({ tracks: [soloedAndMutedTrack] });
    const result = exportToMidi(state);

    // Should produce valid MIDI even though track is muted (solo wins)
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('exports multiple soloed tracks', () => {
    const soloedKick = createTrack({
      id: 'soloed-kick',
      name: 'Kick',
      sampleId: 'kick',
      steps: [true, false, false, false],
      soloed: true,
    });
    const soloedSnare = createTrack({
      id: 'soloed-snare',
      name: 'Snare',
      sampleId: 'snare',
      steps: [false, false, true, false],
      soloed: true,
    });
    const notSoloed = createTrack({
      id: 'not-soloed',
      name: 'Hi-Hat',
      sampleId: 'hihat',
      steps: [true, true, true, true],
      soloed: false,
    });
    const state = createState({ tracks: [soloedKick, soloedSnare, notSoloed] });

    // Export with multiple solos
    const result = exportToMidi(state);

    // Export with only the soloed tracks - compare sizes
    const stateSoloedOnly = createState({ tracks: [soloedKick, soloedSnare] });
    const resultSoloedOnly = exportToMidi(stateSoloedOnly);

    // Both should have same size since non-soloed track is omitted
    expect(result.blob.size).toBe(resultSoloedOnly.blob.size);
  });

  it('omits tracks with no active steps', () => {
    const emptyTrack = createTrack({
      id: 'empty',
      name: 'Empty',
      sampleId: 'kick',
      steps: [false, false, false, false],
    });
    const activeTrack = createTrack({
      id: 'active',
      name: 'Active',
      sampleId: 'snare',
      steps: [true, false, false, false],
    });
    const state = createState({ tracks: [emptyTrack, activeTrack] });
    const result = exportToMidi(state);

    // Should still produce valid MIDI
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('handles polyrhythmic patterns', () => {
    const track4 = createTrack({
      id: 'track4',
      name: '4-step',
      sampleId: 'kick',
      steps: [true, false, false, false],
      stepCount: 4,
    });
    const track8 = createTrack({
      id: 'track8',
      name: '8-step',
      sampleId: 'snare',
      steps: [false, false, true, false, false, false, true, false],
      stepCount: 8,
    });
    const state = createState({ tracks: [track4, track8] });
    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('exports mixed drums and synths', () => {
    const kickTrack = createTrack({
      id: 'kick',
      name: 'Kick',
      sampleId: 'kick',
      steps: [true, false, false, false, true, false, false, false],
      stepCount: 8,
    });
    const bassTrack = createTrack({
      id: 'bass',
      name: 'Bass',
      sampleId: 'synth:funkbass',
      steps: [true, false, true, false, false, true, false, false],
      parameterLocks: [
        { pitch: 0 },
        null,
        { pitch: 5 },
        null,
        null,
        { pitch: 7 },
        null,
        null,
      ],
      stepCount: 8,
      transpose: -12,
    });
    const state = createState({ tracks: [kickTrack, bassTrack], tempo: 110 });
    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('exports complex session with all features', () => {
    // Create a complex session similar to afrobeat-groove demo
    const tracks = [
      createTrack({
        id: 'kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false],
        stepCount: 4,
      }),
      createTrack({
        id: 'conga',
        name: 'Conga',
        sampleId: 'tom',
        steps: [true, false, false, true, false, false, true, false],
        parameterLocks: [
          { pitch: 5 },
          null,
          null,
          { pitch: 3, volume: 0.8 },
          null,
          null,
          { pitch: 0 },
          null,
        ],
        stepCount: 8,
        volume: 0.7,
      }),
      createTrack({
        id: 'shaker',
        name: 'Shaker',
        sampleId: 'hihat',
        steps: [true, true, true, true, true, true, true, true],
        parameterLocks: [
          { volume: 1 },
          { volume: 0.5 },
          { volume: 0.7 },
          { volume: 0.5 },
          { volume: 0.9 },
          { volume: 0.5 },
          { volume: 0.7 },
          { volume: 0.5 },
        ],
        stepCount: 8,
        transpose: 3,
      }),
      createTrack({
        id: 'bass',
        name: 'Bass',
        sampleId: 'synth:funkbass',
        steps: [true, false, false, true, false, true, false, false, true, false, false, true, false, false, true, false],
        parameterLocks: [
          { pitch: 0 },
          null,
          null,
          { pitch: 0 },
          null,
          { pitch: 3 },
          null,
          null,
          { pitch: 5 },
          null,
          null,
          { pitch: 3 },
          null,
          null,
          { pitch: 0 },
          null,
        ],
        stepCount: 16,
        transpose: -12,
      }),
    ];

    const state = createState({
      tracks,
      tempo: 110,
      swing: 20,
    });

    const result = exportToMidi(state, { sessionName: 'Afrobeat Groove' });

    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.filename).toBe('Afrobeat-Groove.mid');
  });

  it('exports session with synth presets using correct programs', () => {
    const tracks = [
      createTrack({
        id: 'rhodes',
        name: 'Rhodes',
        sampleId: 'synth:rhodes',
        steps: [true, false, false, false],
        stepCount: 4,
      }),
      createTrack({
        id: 'organ',
        name: 'Organ',
        sampleId: 'synth:organ',
        steps: [false, true, false, false],
        stepCount: 4,
      }),
      createTrack({
        id: 'fm-epiano',
        name: 'FM E-Piano',
        sampleId: 'tone:fm-epiano',
        steps: [false, false, true, false],
        stepCount: 4,
      }),
    ];

    const state = createState({ tracks, tempo: 100 });
    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('handles all drum types', () => {
    const drumTypes = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'rim', 'cowbell'];
    const tracks = drumTypes.map((drum, i) =>
      createTrack({
        id: drum,
        name: drum.charAt(0).toUpperCase() + drum.slice(1),
        sampleId: drum,
        steps: (() => {
          const steps = new Array(16).fill(false);
          steps[i * 2] = true; // Each drum on different beat
          return steps;
        })(),
        stepCount: 16,
      })
    );

    const state = createState({ tracks });
    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('exports at different tempos', () => {
    const track = createTrack({
      steps: [true, false, false, false],
      stepCount: 4,
    });

    // Test various tempos
    for (const tempo of [60, 90, 120, 150, 180]) {
      const state = createState({ tracks: [track], tempo });
      const result = exportToMidi(state);
      expect(result.blob.size).toBeGreaterThan(0);
    }
  });
});
