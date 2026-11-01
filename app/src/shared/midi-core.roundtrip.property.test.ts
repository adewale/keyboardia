/**
 * MIDI export round-trip conservation for encodeMidi.
 *
 * The oracle parses the emitted Standard MIDI File bytes with a minimal
 * spec-based SMF reader (header/track chunks, variable-length deltas,
 * running status) — independent verification against the file format, not a
 * restatement of encodeMidi:
 *   - note-on conservation: one note-on (vel > 0) per active step per
 *     pattern repetition; polyrhythmic tracks repeat LCM/stepCount times
 *   - solo/mute selection matches the documented scheduler contract
 *   - the tempo meta event encodes state.tempo
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { encodeMidi, calculatePatternLength, type MidiState, type MidiTrack } from './midi-core';

// ---------------------------------------------------------------------------
// Minimal SMF reader (spec-based oracle)
// ---------------------------------------------------------------------------

interface ParsedSmf {
  format: number;
  trackChunks: number;
  noteOnCount: number;
  tempoMicrosPerQuarter: number | null;
}

function parseSmf(data: Uint8Array): ParsedSmf {
  const ascii = (o: number, n: number) => String.fromCharCode(...data.subarray(o, o + n));
  const u16 = (o: number) => (data[o] << 8) | data[o + 1];
  const u32 = (o: number) => (data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3];
  expect(ascii(0, 4)).toBe('MThd');
  expect(u32(4)).toBe(6);
  const format = u16(8);
  const trackChunks = u16(10);

  let offset = 14;
  let noteOnCount = 0;
  let tempoMicrosPerQuarter: number | null = null;

  for (let chunk = 0; chunk < trackChunks; chunk++) {
    expect(ascii(offset, 4)).toBe('MTrk');
    const length = u32(offset + 4);
    let p = offset + 8;
    const end = p + length;
    let runningStatus = 0;

    while (p < end) {
      // variable-length delta time
      while (data[p] & 0x80) p++;
      p++;

      let status = data[p];
      if (status & 0x80) {
        p++;
        runningStatus = status;
      } else {
        status = runningStatus; // running status: data byte follows directly
      }

      if (status === 0xff) {
        const metaType = data[p]; p++;
        let len = 0;
        while (data[p] & 0x80) { len = (len << 7) | (data[p] & 0x7f); p++; }
        len = (len << 7) | (data[p] & 0x7f); p++;
        if (metaType === 0x51 && len === 3) {
          tempoMicrosPerQuarter = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
        }
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        let len = 0;
        while (data[p] & 0x80) { len = (len << 7) | (data[p] & 0x7f); p++; }
        len = (len << 7) | (data[p] & 0x7f); p++;
        p += len;
      } else {
        const kind = status & 0xf0;
        const dataBytes = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
        if (kind === 0x90 && data[p + 1] > 0) noteOnCount++;
        p += dataBytes;
      }
    }
    offset = end;
  }

  return { format, trackChunks, noteOnCount, tempoMicrosPerQuarter };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const STEP_COUNT_CHOICES = [8, 12, 16, 32] as const;

function makeTrack(id: number, stepCount: number, activeSteps: number[], opts?: Partial<MidiTrack>): MidiTrack {
  const steps = Array(stepCount).fill(false) as boolean[];
  for (const s of activeSteps) steps[s % stepCount] = true;
  return {
    id: `t${id}`,
    name: `Track ${id}`,
    sampleId: id % 2 === 0 ? 'kick' : 'bass',
    steps,
    parameterLocks: Array(stepCount).fill(null),
    volume: 0.8,
    muted: false,
    transpose: 0,
    stepCount,
    ...opts,
  };
}

const trackArb = (id: number) =>
  fc
    .record({
      stepCount: fc.constantFrom(...STEP_COUNT_CHOICES),
      stepPicks: fc.array(fc.nat(127), { minLength: 0, maxLength: 10 }),
      muted: fc.boolean(),
      soloed: fc.boolean(),
    })
    .map(({ stepCount, stepPicks, muted, soloed }) =>
      makeTrack(id, stepCount, stepPicks, { muted, soloed }),
    );

const stateArb: fc.Arbitrary<MidiState> = fc
  .record({
    t0: trackArb(0),
    t1: trackArb(1),
    t2: trackArb(2),
    tempo: fc.integer({ min: 60, max: 220 }),
    swing: fc.integer({ min: 0, max: 100 }),
  })
  .map(({ t0, t1, t2, tempo, swing }) => ({ tracks: [t0, t1, t2], tempo, swing }));

function expectedNoteOns(state: MidiState): number {
  const patternLength = calculatePatternLength(state.tracks);
  const anySoloed = state.tracks.some((t) => t.soloed);
  let total = 0;
  for (const track of state.tracks) {
    const exported = anySoloed ? track.soloed : !track.muted;
    if (!exported) continue;
    const stepCount = track.stepCount ?? track.steps.length;
    const active = track.steps.slice(0, stepCount).filter(Boolean).length;
    total += active * (patternLength / stepCount);
  }
  return total;
}

// ---------------------------------------------------------------------------

describe('encodeMidi round-trip conservation', () => {
  it('emits exactly one note-on per active step per pattern repetition, honoring solo/mute', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const { midiData } = encodeMidi(state);
        const parsed = parseSmf(midiData);
        expect(parsed.noteOnCount, JSON.stringify(state.tracks.map(t => ({
          sc: t.stepCount, on: t.steps.filter(Boolean).length, m: t.muted, s: t.soloed,
        })))).toBe(expectedNoteOns(state));
      }),
      { numRuns: 40 },
    );
  });

  it('encodes state.tempo in the tempo meta event', () => {
    fc.assert(
      fc.property(fc.integer({ min: 60, max: 220 }), (tempo) => {
        const state: MidiState = {
          tracks: [makeTrack(0, 16, [0, 4, 8, 12])],
          tempo,
          swing: 0,
        };
        const parsed = parseSmf(encodeMidi(state).midiData);
        expect(parsed.tempoMicrosPerQuarter).not.toBeNull();
        // SMF stores microseconds per quarter note, truncated to integer.
        expect(Math.abs(parsed.tempoMicrosPerQuarter! - 60_000_000 / tempo)).toBeLessThan(1);
      }),
      { numRuns: 25 },
    );
  });

  it('a polyrhythmic pair multiplies note-ons by pattern repetitions (16 vs 12 -> LCM 48)', () => {
    const state: MidiState = {
      tracks: [
        makeTrack(0, 16, [0, 4, 8, 12]), // 4 active × 3 repetitions = 12
        makeTrack(1, 12, [0, 3, 6]),     // 3 active × 4 repetitions = 12
      ],
      tempo: 120,
      swing: 0,
    };
    expect(calculatePatternLength(state.tracks)).toBe(48);
    const parsed = parseSmf(encodeMidi(state).midiData);
    expect(parsed.noteOnCount).toBe(24);
  });
});
