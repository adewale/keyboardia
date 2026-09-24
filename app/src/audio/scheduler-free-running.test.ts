// @vitest-environment jsdom
/**
 * Free-running tracks: every track loops at its own length for as long as
 * playback runs.
 *
 * Without a loop region, the global step counter used to wrap at MAX_STEPS
 * (128). Each track reads its position as `global % stepCount`, so every
 * length that does not divide 128 — 20 of the 26 allowed lengths — was cut
 * short at each wrap. A 10-step track played steps 0–7 and started again,
 * slipping an eight-step bar into the pattern every 128 steps.
 *
 * Oracle (model-free): a track whose only active step is its first must sound
 * once per `stepCount` steps, so every gap between its onsets is exactly
 * `stepCount × stepDuration`, across several former wrap points.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GridState, Track } from '../types';
import { MAX_STEPS, STEP_COUNT_OPTIONS } from '../types';
import { getStepDuration } from './timing-calculations';

const clock = { t: 0 };
const onsets = new Map<string, number[]>();

const record = (trackId: string, time: number) => {
  const list = onsets.get(trackId) ?? [];
  list.push(time);
  onsets.set(trackId, list);
};

vi.mock('./engine', () => ({
  audioEngine: {
    isInitialized: () => true,
    getCurrentTime: () => clock.t,
    playSample: (_sampleId: string, trackId: string, time: number) => record(trackId, time),
    playSynthNote: (_noteId: string, _presetId: string, _pitch: number, time: number, _dur: number, _gain: number, trackId: string) => record(trackId, time),
    playSampledInstrument: (_presetId: string, _noteId: string, _midi: number, time: number, _dur: number, _gain: number, trackId: string) => record(trackId, time),
    playToneSynth: (_presetId: string, _pitch: number, time: number, _dur: number, _gain: number, trackId: string) => record(trackId, time),
    playAdvancedSynth: (_presetId: string, _pitch: number, time: number, _dur: number, _gain: number, trackId: string) => record(trackId, time),
    isSampledInstrumentReady: () => true,
    isToneSynthReady: () => true,
  },
}));

import { Scheduler } from './scheduler';
import { resetSchedulerTracking } from './playback-state-debug';

function firstStepOnly(stepCount: number): Track {
  const steps = Array(MAX_STEPS).fill(false);
  steps[0] = true;
  return {
    id: `len-${stepCount}`,
    name: `len-${stepCount}`,
    sampleId: 'kick',
    steps,
    parameterLocks: Array(MAX_STEPS).fill(null),
    volume: 0.8,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount,
  };
}

describe('main-thread scheduler without a loop region', () => {
  let scheduler: Scheduler | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    clock.t = 0;
    onsets.clear();
    resetSchedulerTracking();
  });

  afterEach(() => {
    try { scheduler?.stop(); } catch { /* already stopped */ }
    scheduler = null;
    vi.useRealTimers();
  });

  it('plays every allowed track length whole across former 128-step wraps', () => {
    const tempo = 180;
    const stepDuration = getStepDuration(tempo);
    const totalSteps = 3 * MAX_STEPS + 40;
    const state = {
      tracks: STEP_COUNT_OPTIONS.map(firstStepOnly),
      tempo,
      swing: 0,
    } as GridState;

    scheduler = new Scheduler();
    scheduler.start(() => state);
    const TICK_SEC = 0.025;
    while (clock.t < totalSteps * stepDuration) {
      clock.t += TICK_SEC;
      vi.advanceTimersByTime(TICK_SEC * 1000);
    }

    for (const stepCount of STEP_COUNT_OPTIONS) {
      const times = onsets.get(`len-${stepCount}`) ?? [];
      expect(times.length, `${stepCount}-step track onsets`).toBeGreaterThanOrEqual(
        Math.floor(totalSteps / stepCount),
      );
      // The first onset is due at the instant playback starts, so dispatch
      // moves it LATE_NOTE_CONTROL_LEAD past "now"; spacing is checked from
      // the second onset on.
      for (let i = 2; i < times.length; i++) {
        expect(
          times[i] - times[i - 1],
          `${stepCount}-step track, gap before onset ${i}`,
        ).toBeCloseTo(stepCount * stepDuration, 6);
      }
    }
  });
});
