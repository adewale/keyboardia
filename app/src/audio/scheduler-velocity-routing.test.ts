/**
 * Regression tests for bug P2 (SAMPLE-AUDIT-2026-06): the scheduler
 * never derived a MIDI velocity from the volume p-lock, so
 * playSampledInstrument always played the default-velocity layer and
 * the pp/ff samples were unreachable.
 *
 * Both scheduler implementations (main-thread Scheduler and the
 * AudioWorklet host) must derive velocity identically — this file pins
 * the contract for each, mirroring scheduler-volume-routing.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { velocityFromMultiplier } from './velocity';

const playSampledInstrument = vi.fn<(...args: unknown[]) => void>();

vi.mock('./engine', () => ({
  audioEngine: {
    isInitialized: () => true,
    isToneSynthReady: () => true,
    isSampledInstrumentReady: () => true,
    getCurrentTime: () => 0,
    setTrackVolume: vi.fn(),
    playSampledInstrument: (...a: unknown[]) => playSampledInstrument(...a),
    playToneSynth: vi.fn(),
    playAdvancedSynth: vi.fn(),
    playSynthNote: vi.fn(),
    playSample: vi.fn(),
  },
}));

import { Scheduler } from './scheduler';
import type { GridState } from '../types';
import { aTrackWithSteps, aState } from './__fixtures__/builders';

/** Velocity is the 8th positional argument of playSampledInstrument. */
const VELOCITY_ARG = 7;

function flushOneSampledNote(pLockVolume?: number): void {
  const scheduler = new Scheduler();
  const track = aTrackWithSteps({
    sampleId: 'sampled:piano',
    activeSteps: [0],
    parameterLocks: (() => {
      const locks = Array(16).fill(null);
      if (pLockVolume !== undefined) locks[0] = { volume: pLockVolume };
      return locks;
    })(),
  });
  const state = aState({ tracks: [track] });
  (scheduler as unknown as { getState: () => GridState }).getState = () => state;
  (scheduler as unknown as {
    scheduleStep: (state: GridState, step: number, time: number, dur: number) => void;
  }).scheduleStep(state, 0, 0, 0.125);
}

beforeEach(() => {
  playSampledInstrument.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('main-thread Scheduler velocity routing', () => {
  it('derives velocity from the volume p-lock', () => {
    flushOneSampledNote(0.3);
    expect(playSampledInstrument).toHaveBeenCalledTimes(1);
    expect(playSampledInstrument.mock.calls[0][VELOCITY_ARG]).toBe(
      velocityFromMultiplier(0.3)
    );
  });

  it('sends full velocity for steps with no p-lock', () => {
    flushOneSampledNote(undefined);
    expect(playSampledInstrument.mock.calls[0][VELOCITY_ARG]).toBe(127);
  });

  it('property: passed velocity always equals velocityFromMultiplier(p-lock)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (mult) => {
        playSampledInstrument.mockClear();
        flushOneSampledNote(mult);
        expect(playSampledInstrument.mock.calls[0][VELOCITY_ARG]).toBe(
          velocityFromMultiplier(mult)
        );
      })
    );
  });
});

describe('SchedulerWorkletHost velocity routing (parity with main-thread)', () => {
  async function dispatchSampledEvent(volumeMultiplier: number): Promise<void> {
    const { SchedulerWorkletHost } = await import('./scheduler-worklet-host');
    const host = new SchedulerWorkletHost();
    (host as unknown as {
      playInstrumentNote: (type: string, presetId: string, event: unknown) => void;
    }).playInstrumentNote('sampled', 'piano', {
      type: 'note',
      trackId: 't1',
      noteId: 'n1',
      sampleId: 'sampled:piano',
      pitchSemitones: 0,
      time: 1.5,
      duration: 0.125,
      volume: volumeMultiplier,
      volumeMultiplier,
    });
  }

  it('derives velocity from the event volumeMultiplier', async () => {
    await dispatchSampledEvent(0.3);
    expect(playSampledInstrument).toHaveBeenCalledTimes(1);
    expect(playSampledInstrument.mock.calls[0][VELOCITY_ARG]).toBe(
      velocityFromMultiplier(0.3)
    );
  });

  it('agrees with the main-thread scheduler for any multiplier (parity)', async () => {
    for (const mult of [0, 0.1, 0.39, 0.5, 0.79, 1]) {
      playSampledInstrument.mockClear();
      flushOneSampledNote(mult);
      const mainThreadVelocity =
        playSampledInstrument.mock.calls[0][VELOCITY_ARG];

      playSampledInstrument.mockClear();
      await dispatchSampledEvent(mult);
      expect(playSampledInstrument.mock.calls[0][VELOCITY_ARG]).toBe(
        mainThreadVelocity
      );
    }
  });
});
