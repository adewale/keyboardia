// @vitest-environment jsdom
/**
 * Playback × mutation race lane (scoped v1).
 *
 * The scheduler re-reads state through its injected getState on every 25 ms
 * lookahead tick, so remote multiplayer mutations racing active playback are
 * reproduced exactly by swapping what getState returns BETWEEN ticks while
 * virtual time advances in lockstep with fake timers. This drives the real
 * Scheduler through the real timing kernel (timing-calculations) against a
 * recording engine mock — the seam the other scheduler tests already use.
 *
 * Oracles are model-free (they do not re-implement scheduling):
 *   1. Never schedule into the past: every trigger's audio time is >= the
 *      virtual clock at the moment it was scheduled.
 *   2. No near-duplicate triggers: two triggers for the same track closer
 *      than 40% of the smallest step duration are a double-fire.
 *   3. Per-track trigger times are non-decreasing.
 *   4. stop() is clean: no triggers after stop, no pending timers
 *      (assertPlaybackStopped's own invariant, checked from the test side).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GridState, Track } from '../types';

interface TriggerRecord {
  trackId: string;
  time: number;
  clockAtSchedule: number;
}

const clock = { t: 0 };
const triggers: TriggerRecord[] = [];

const record = (trackId: string, time: number) => {
  triggers.push({ trackId, time, clockAtSchedule: clock.t });
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

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function makeTrack(id: string, stepCount: number, activeSteps: number[]): Track {
  const steps = Array(128).fill(false) as boolean[];
  for (const s of activeSteps) steps[s % stepCount] = true;
  return {
    id,
    name: id,
    sampleId: 'kick',
    steps,
    parameterLocks: Array(128).fill(null),
    volume: 0.8,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount,
  } as Track;
}

describe('scheduler under racing mutations (virtual time)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clock.t = 0;
    triggers.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const SEEDS = [7, 77, 777];
  const TICKS = 80;              // 80 × 25 ms = 2 s of virtual playback
  const TICK_SEC = 0.025;

  it.each(SEEDS)('seed %i: tempo/stepCount/track mutations mid-flight never double-fire or schedule into the past', (seed) => {
    const rng = mulberry32(seed);
    let minStepDuration = Infinity;

    let state: GridState = {
      tracks: [makeTrack('a', 16, [0, 4, 8, 12]), makeTrack('b', 12, [0, 6])],
      tempo: 120,
      swing: 0,
    } as GridState;
    const noteTempo = () => { minStepDuration = Math.min(minStepDuration, 60 / (state.tempo * 4)); };
    noteTempo();

    const scheduler = new Scheduler();
    scheduler.start(() => state);

    for (let tick = 0; tick < TICKS; tick++) {
      // Racing mutation between lookahead ticks, ~every 5th tick.
      if (tick > 0 && tick % 5 === 0) {
        const roll = rng();
        if (roll < 0.4) {
          state = { ...state, tempo: randInt(rng, 60, 200) };
          noteTempo();
        } else if (roll < 0.7) {
          // Index must stay in range: an earlier delete may have shrunk the
          // list, and {...undefined} would fabricate a track with no steps —
          // a state the reducer can never produce (it crashed this harness's
          // first draft, not the scheduler).
          const which = randInt(rng, 0, state.tracks.length - 1);
          const newCount = [8, 12, 16, 24][randInt(rng, 0, 3)];
          const tracks = state.tracks.slice();
          tracks[which] = { ...tracks[which], stepCount: newCount } as Track;
          state = { ...state, tracks };
        } else if (roll < 0.85 && state.tracks.length > 1) {
          state = { ...state, tracks: state.tracks.slice(0, -1) }; // delete last track
        } else {
          state = {
            ...state,
            tracks: [...state.tracks, makeTrack(`n${tick}`, 16, [randInt(rng, 0, 15)])],
          };
        }
      }
      clock.t += TICK_SEC;
      vi.advanceTimersByTime(TICK_SEC * 1000);
    }

    // Sanity floor, not a model: mutations legitimately thin the pattern
    // (deletes, stepCount shrinks), but a scheduler that silently stopped
    // producing triggers would pass every per-trigger oracle vacuously.
    const triggerCount = triggers.length;
    expect(triggerCount, `seed=${seed} playback produced triggers`).toBeGreaterThanOrEqual(5);

    // ORACLE 1 — never into the past (small epsilon for float noise).
    for (const trig of triggers) {
      expect(
        trig.time,
        `seed=${seed} ${trig.trackId} scheduled at clock=${trig.clockAtSchedule.toFixed(3)}`,
      ).toBeGreaterThanOrEqual(trig.clockAtSchedule - 1e-3);
    }

    // ORACLES 2+3 — per-track: monotone non-decreasing, no near-duplicates.
    const byTrack = new Map<string, number[]>();
    for (const trig of triggers) {
      const list = byTrack.get(trig.trackId) ?? [];
      list.push(trig.time);
      byTrack.set(trig.trackId, list);
    }
    const dupeThreshold = minStepDuration * 0.4;
    for (const [trackId, times] of byTrack) {
      for (let i = 1; i < times.length; i++) {
        expect(times[i], `seed=${seed} ${trackId} monotone at #${i}`).toBeGreaterThanOrEqual(times[i - 1]);
        expect(
          times[i] - times[i - 1],
          `seed=${seed} ${trackId} near-duplicate at #${i} (t=${times[i].toFixed(3)})`,
        ).toBeGreaterThanOrEqual(dupeThreshold);
      }
    }

    // ORACLE 4 — clean stop: no further triggers, timers drained.
    scheduler.stop();
    const afterStop = triggers.length;
    clock.t += 1;
    vi.advanceTimersByTime(1000);
    expect(triggers.length, `seed=${seed} triggers after stop`).toBe(afterStop);
    const internals = scheduler as unknown as { pendingTimers: Set<unknown>; timerId: number | null };
    expect(internals.pendingTimers.size, `seed=${seed} pending timers after stop`).toBe(0);
    expect(internals.timerId, `seed=${seed} loop timer after stop`).toBeNull();
  });
});
