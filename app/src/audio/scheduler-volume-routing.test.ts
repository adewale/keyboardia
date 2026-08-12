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
const setTrackVolume = vi.fn<(trackId: string, volume: number) => void>();

vi.mock('./engine', () => ({
  audioEngine: {
    isInitialized: () => true,
    isToneSynthReady: () => true,
    isSampledInstrumentReady: () => true,
    getCurrentTime: () => 0,
    setTrackVolume: (trackId: string, volume: number) => setTrackVolume(trackId, volume),
    playSampledInstrument: (...a: unknown[]) => playSampledInstrument(...a),
    playToneSynth: (...a: unknown[]) => playToneSynth(...a),
    playAdvancedSynth: (...a: unknown[]) => playAdvancedSynth(...a),
    playSynthNote: (...a: unknown[]) => playSynthNote(...a),
    playSample: (...a: unknown[]) => playSample(...a),
  },
}));

import { Scheduler } from './scheduler';
import type { GridState } from '../types';
import { aTrackWithSteps, aState } from './__fixtures__/builders';
import { resolveNoteDynamics } from './note-dynamics';

interface FlushOptions { trackVolume: number; pLockVolume?: number; sampleId: string; }

function flushOneNote(
  scheduler: Scheduler,
  { trackVolume, pLockVolume, sampleId }: FlushOptions,
): void {
  const track = aTrackWithSteps({
    sampleId,
    volume: trackVolume,
    activeSteps: [0],
    parameterLocks: pLockVolume !== undefined
      ? (() => { const l = Array(16).fill(null); l[0] = { volume: pLockVolume }; return l; })()
      : Array(16).fill(null),
  });
  // scheduleStep reads `this.getState()` (the param is unused), so wire a
  // closure that returns our test state.
  const state = aState({ tracks: [track] });
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
    setTrackVolume.mockClear();
  });
  afterEach(() => {
    scheduler.stop();
    vi.restoreAllMocks();
  });

  it('passes canonical noteGain (not track.volume × gain) to playSampledInstrument', () => {
    flushOneNote(scheduler, { trackVolume: 0.5, pLockVolume: 0.8, sampleId: 'sampled:piano' });
    expect(playSampledInstrument).toHaveBeenCalledTimes(1);
    const volumeArg = playSampledInstrument.mock.calls[0][5];
    expect(volumeArg).toBe(resolveNoteDynamics(0.8).noteGain);
    expect(volumeArg).not.toBe(0.5 * resolveNoteDynamics(0.8).noteGain);
  });

  it('passes canonical noteGain (not track.volume × gain) to playToneSynth', () => {
    flushOneNote(scheduler, { trackVolume: 0.3, pLockVolume: 0.6, sampleId: 'tone:fm-bass' });
    expect(playToneSynth).toHaveBeenCalledTimes(1);
    const volumeArg = playToneSynth.mock.calls[0][4];
    expect(volumeArg).toBe(resolveNoteDynamics(0.6).noteGain);
    expect(volumeArg).not.toBe(0.3 * resolveNoteDynamics(0.6).noteGain);
  });

  it('passes canonical noteGain (not track.volume × gain) to playAdvancedSynth', () => {
    flushOneNote(scheduler, { trackVolume: 0.7, pLockVolume: 0.4, sampleId: 'advanced:supersaw' });
    expect(playAdvancedSynth).toHaveBeenCalledTimes(1);
    const volumeArg = playAdvancedSynth.mock.calls[0][4];
    expect(volumeArg).toBe(resolveNoteDynamics(0.4).noteGain);
    expect(volumeArg).not.toBe(0.7 * resolveNoteDynamics(0.4).noteGain);
  });

  it('passes canonical noteGain to playSynthNote', () => {
    flushOneNote(scheduler, { trackVolume: 0.5, pLockVolume: 0.8, sampleId: 'synth:bass' });
    expect(playSynthNote).toHaveBeenCalledTimes(1);
    expect(playSynthNote.mock.calls[0][5]).toBe(resolveNoteDynamics(0.8).noteGain);
  });

  it('passes canonical noteGain to playSample', () => {
    flushOneNote(scheduler, { trackVolume: 0.5, pLockVolume: 0.8, sampleId: '808-kick' });
    expect(playSample).toHaveBeenCalledTimes(1);
    expect(playSample.mock.calls[0][5]).toBe(resolveNoteDynamics(0.8).noteGain);
  });

  it('keys unlocked sample variation while explicit locks bypass it', () => {
    flushOneNote(scheduler, { trackVolume: 1, sampleId: 'hihat' });
    expect(playSample.mock.calls[0][7]).toMatch(/-loop-0$/);

    playSample.mockClear();
    flushOneNote(scheduler, { trackVolume: 1, pLockVolume: 1, sampleId: 'hihat' });
    expect(playSample.mock.calls[0]).toHaveLength(7);
  });

  it('humanizes an unlocked note independently of track.volume', () => {
    flushOneNote(scheduler, { trackVolume: 0.42, sampleId: 'tone:fm-bass' });
    const gain = playToneSynth.mock.calls[0][4] as number;
    expect(gain).toBeGreaterThan(10 ** (-0.75 / 20));
    expect(gain).toBeLessThan(10 ** (0.75 / 20));
    expect(gain).not.toBe(0.42);
  });

  it('never automates the shared track bus for a per-note volume lock', () => {
    flushOneNote(scheduler, { trackVolume: 0.5, pLockVolume: 0.5, sampleId: 'sampled:piano' });

    // The voice receives perceptual note gain while the bus remains at the
    // stable base fader. Applying it to both stages would also
    // attenuate release tails from neighbouring notes.
    expect(playSampledInstrument.mock.calls[0][5]).toBe(resolveNoteDynamics(0.5).noteGain);
    expect(setTrackVolume).not.toHaveBeenCalled();
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
          const expectedGain = resolveNoteDynamics(pLockVolume).noteGain;
          expect(arg).toBeCloseTo(expectedGain, 10);
          expect(arg).not.toBeCloseTo(trackVolume * expectedGain, 10);
        },
      ),
      { numRuns: 200, seed: 0x4ce5e771 },
    );
  });
});
