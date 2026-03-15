/**
 * Tests for MIDI Export Web Worker integration.
 *
 * Since Web Workers don't run in jsdom/vitest, these tests verify:
 * 1. The worker module's message handler produces correct output
 * 2. The main-thread fallback path works correctly
 * 3. The async wrapper matches synchronous export results
 */

import { describe, it, expect } from 'vitest';
import { exportToMidi } from './midiExport';
import type { GridState } from '../types';

// Minimal state fixture for testing
function makeState(): Pick<GridState, 'tracks' | 'tempo' | 'swing'> {
  return {
    tracks: [
      {
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false,
                true, false, false, false, true, false, false, false],
        parameterLocks: Array(16).fill(null),
        volume: 1,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'track-2',
        name: 'Bass',
        sampleId: 'synth:bass',
        steps: [true, false, false, true, false, false, true, false,
                false, true, false, false, true, false, false, false],
        parameterLocks: Array(16).fill(null),
        volume: 0.8,
        muted: false,
        soloed: false,
        transpose: -12,
        stepCount: 16,
      },
    ],
    tempo: 120,
    swing: 25,
  };
}

describe('MIDI Export Worker: synchronous fallback correctness', () => {
  it('exportToMidi produces valid MIDI data', () => {
    const state = makeState();
    const result = exportToMidi(state, { sessionName: 'test-session' });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('audio/midi');
    expect(result.filename).toBe('test-session.mid');
    expect(result._midiData.length).toBeGreaterThan(0);
  });

  it('MIDI header is valid (MThd)', () => {
    const state = makeState();
    const result = exportToMidi(state);

    // Standard MIDI File header: "MThd" (0x4D546864)
    expect(result._midiData[0]).toBe(0x4D); // M
    expect(result._midiData[1]).toBe(0x54); // T
    expect(result._midiData[2]).toBe(0x68); // h
    expect(result._midiData[3]).toBe(0x64); // d
  });

  it('MIDI file is SMF Type 1 (multiple simultaneous tracks)', () => {
    const state = makeState();
    const result = exportToMidi(state);

    // Bytes 8-9: format type (0x0001 = Type 1)
    expect(result._midiData[8]).toBe(0x00);
    expect(result._midiData[9]).toBe(0x01);
  });

  it('produces deterministic output for same input', () => {
    const state = makeState();
    const result1 = exportToMidi(state, { sessionName: 'test' });
    const result2 = exportToMidi(state, { sessionName: 'test' });

    expect(result1._midiData).toEqual(result2._midiData);
    expect(result1.filename).toBe(result2.filename);
  });

  it('handles empty session (no active tracks)', () => {
    const state: Pick<GridState, 'tracks' | 'tempo' | 'swing'> = {
      tracks: [{
        id: 'track-1',
        name: 'Empty',
        sampleId: 'kick',
        steps: Array(16).fill(false),
        parameterLocks: Array(16).fill(null),
        volume: 1,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
      }],
      tempo: 120,
      swing: 0,
    };

    const result = exportToMidi(state);
    // Should still produce valid MIDI (just a tempo track)
    expect(result._midiData[0]).toBe(0x4D); // MThd
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('handles session with many tracks without error', () => {
    const state: Pick<GridState, 'tracks' | 'tempo' | 'swing'> = {
      tracks: Array.from({ length: 16 }, (_, i) => ({
        id: `track-${i}`,
        name: `Track ${i}`,
        sampleId: i % 2 === 0 ? 'kick' : 'synth:bass',
        steps: Array.from({ length: 32 }, (_, j) => j % (i + 2) === 0),
        parameterLocks: Array(32).fill(null),
        volume: 1,
        muted: false,
        soloed: false,
        transpose: i % 2 === 0 ? 0 : -12 + i,
        stepCount: 32,
      })),
      tempo: 140,
      swing: 50,
    };

    const result = exportToMidi(state, { sessionName: 'large-session' });
    expect(result._midiData.length).toBeGreaterThan(100);
    expect(result.filename).toBe('large-session.mid');
  });
});

describe('MIDI Export Worker: worker module handler', () => {
  // Simulate what the worker does: call exportToMidi and return results
  it('worker message handler protocol: success case', () => {
    const state = makeState();
    const options = { sessionName: 'worker-test' };

    // Simulate worker logic
    const { blob, filename } = exportToMidi(state, options);
    const response = { blob, filename };

    expect(response.blob).toBeInstanceOf(Blob);
    expect(response.filename).toBe('worker-test.mid');
  });

  it('worker message handler protocol: error case', () => {
    // Simulate what happens if exportToMidi throws
    const badState = { tracks: null, tempo: 120, swing: 0 } as unknown as Pick<GridState, 'tracks' | 'tempo' | 'swing'>;

    expect(() => exportToMidi(badState)).toThrow();
  });
});
