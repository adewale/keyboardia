/**
 * Regression test for bug_010: volume double-application.
 *
 * The scheduler previously passed `volume = track.volume × volumeMultiplier`
 * to playSampledInstrument / playToneSynth / playAdvancedSynth. The bus
 * those methods route through ALSO multiplies by `track.volume`, so the
 * final amplitude was `source × track.volume² × volumeMultiplier`. At a
 * fader of 0.5 the user heard 0.25 instead of 0.5.
 *
 * For any instrument that is bus-routed, the scheduler must pass the
 * p-lock-only multiplier so the bus's `volumeGain.gain = track.volume`
 * does the per-track scaling exactly once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

const playSampledInstrument = vi.fn<(...args: unknown[]) => void>();
const playToneSynth = vi.fn<(...args: unknown[]) => void>();
const playAdvancedSynth = vi.fn<(...args: unknown[]) => void>();
const playSynthNote = vi.fn<(...args: unknown[]) => void>();
const playSample = vi.fn<(...args: unknown[]) => void>();

vi.mock('./engine', () => ({
  audioEngine: {
    isInitialized: () => true,
    isToneSynthReady: () => true,
    isSampledInstrumentReady: () => true,
    getCurrentTime: () => 0,
    setTrackVolume: vi.fn(),
    playSampledInstrument: (...a: unknown[]) => playSampledInstrument(...a),
    playToneSynth: (...a: unknown[]) => playToneSynth(...a),
    playAdvancedSynth: (...a: unknown[]) => playAdvancedSynth(...a),
    playSynthNote: (...a: unknown[]) => playSynthNote(...a),
    playSample: (...a: unknown[]) => playSample(...a),
  },
}));

import { Scheduler } from './scheduler';
import type { GridState, Track } from '../types';

function makeTrack(overrides: Partial<Track> & { sampleId: string; volume: number }): Track {
  const steps = Array(16).fill(false);
  steps[0] = true; // single active step at index 0
  return {
    id: `track-${overrides.sampleId}`,
    sampleId: overrides.sampleId,
    name: overrides.sampleId,
    steps,
    muted: false,
    soloed: false,
    transpose: 0,
    swing: 0,
    parameterLocks: Array(16).fill(null),
    stepCount: 16,
    ...overrides,
  } as Track;
}

function makeState(track: Track): GridState {
  return {
    tracks: [track],
    tempo: 120,
    swing: 0,
    loopRegion: null,
  } as unknown as GridState;
}

interface FlushOptions { trackVolume: number; pLockVolume?: number; sampleId: string; }

function flushOneNote(
  scheduler: Scheduler,
  { trackVolume, pLockVolume, sampleId }: FlushOptions,
): void {
  const track = makeTrack({ sampleId, volume: trackVolume });
  if (pLockVolume !== undefined) {
    track.parameterLocks = Array(16).fill(null);
    track.parameterLocks[0] = { volume: pLockVolume };
  }
  // scheduleStep reads `this.getState()` (the param is unused), so wire a
  // closure that returns our test state.
  const state = makeState(track);
  (scheduler as unknown as { getState: () => GridState }).getState = () => state;
  (scheduler as unknown as {
    scheduleStep: (state: GridState, step: number, time: number, dur: number) => void;
  }).scheduleStep(state, 0, 0, 0.125);
}

describe('Scheduler volume routing (bug_010)', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
    playSampledInstrument.mockClear();
    playToneSynth.mockClear();
    playAdvancedSynth.mockClear();
    playSynthNote.mockClear();
    playSample.mockClear();
  });
  afterEach(() => {
    scheduler.stop();
    vi.restoreAllMocks();
  });

  it('passes volumeMultiplier (not track.volume × multiplier) to playSampledInstrument', () => {
    flushOneNote(scheduler, { trackVolume: 0.5, pLockVolume: 0.8, sampleId: 'sampled:piano' });
    expect(playSampledInstrument).toHaveBeenCalledTimes(1);
    const volumeArg = playSampledInstrument.mock.calls[0][5];
    expect(volumeArg).toBe(0.8);                  // multiplier only
    expect(volumeArg).not.toBe(0.5 * 0.8);        // not the bug
  });

  it('passes volumeMultiplier (not track.volume × multiplier) to playToneSynth', () => {
    flushOneNote(scheduler, { trackVolume: 0.3, pLockVolume: 0.6, sampleId: 'tone:fm-bass' });
    expect(playToneSynth).toHaveBeenCalledTimes(1);
    const volumeArg = playToneSynth.mock.calls[0][4];
    expect(volumeArg).toBe(0.6);
    expect(volumeArg).not.toBe(0.3 * 0.6);
  });

  it('passes volumeMultiplier (not track.volume × multiplier) to playAdvancedSynth', () => {
    flushOneNote(scheduler, { trackVolume: 0.7, pLockVolume: 0.4, sampleId: 'advanced:supersaw' });
    expect(playAdvancedSynth).toHaveBeenCalledTimes(1);
    const volumeArg = playAdvancedSynth.mock.calls[0][4];
    expect(volumeArg).toBe(0.4);
    expect(volumeArg).not.toBe(0.7 * 0.4);
  });

  it('still passes volumeMultiplier to playSynthNote (unchanged behavior)', () => {
    flushOneNote(scheduler, { trackVolume: 0.5, pLockVolume: 0.8, sampleId: 'synth:bass' });
    expect(playSynthNote).toHaveBeenCalledTimes(1);
    expect(playSynthNote.mock.calls[0][5]).toBe(0.8);
  });

  it('still passes volumeMultiplier to playSample (unchanged behavior)', () => {
    flushOneNote(scheduler, { trackVolume: 0.5, pLockVolume: 0.8, sampleId: '808-kick' });
    expect(playSample).toHaveBeenCalledTimes(1);
    expect(playSample.mock.calls[0][5]).toBe(0.8);
  });

  it('uses 1 (no p-lock) when none is set, regardless of track.volume', () => {
    flushOneNote(scheduler, { trackVolume: 0.42, sampleId: 'tone:fm-bass' });
    expect(playToneSynth.mock.calls[0][4]).toBe(1);
  });

  // PBT: across arbitrary trackVolume × pLockVolume, the volume arg
  // passed to each bus-routed play method always equals the p-lock
  // multiplier — never the composed product. Skips degenerate cases
  // (trackVolume = 1 or pLockVolume = 0) where the two coincide.
  type Spy = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  const cases: Array<{ sampleId: string; spy: Spy; volumeArgIndex: number }> = [
    { sampleId: 'sampled:piano', spy: playSampledInstrument, volumeArgIndex: 5 },
    { sampleId: 'tone:fm-bass', spy: playToneSynth, volumeArgIndex: 4 },
    { sampleId: 'advanced:supersaw', spy: playAdvancedSynth, volumeArgIndex: 4 },
    { sampleId: '808-kick', spy: playSample, volumeArgIndex: 5 },
    { sampleId: 'synth:bass', spy: playSynthNote, volumeArgIndex: 5 },
  ];

  it('pbt: each bus-routed play method receives the multiplier, never the composed product', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 0.99, noNaN: true }), // exclude 1 (degenerate)
        fc.double({ min: 0.01, max: 0.99, noNaN: true }), // exclude 0 (degenerate)
        fc.integer({ min: 0, max: cases.length - 1 }),
        (trackVolume, pLockVolume, caseIdx) => {
          const { sampleId, spy, volumeArgIndex } = cases[caseIdx];
          cases.forEach(c => c.spy.mockClear());
          flushOneNote(scheduler, { trackVolume, pLockVolume, sampleId });
          expect(spy).toHaveBeenCalledTimes(1);
          const arg = spy.mock.calls[0][volumeArgIndex];
          expect(arg).toBeCloseTo(pLockVolume, 10);
          expect(arg).not.toBeCloseTo(trackVolume * pLockVolume, 10);
        },
      ),
      { numRuns: 200, seed: 0x4ce5e771 },
    );
  });
});
