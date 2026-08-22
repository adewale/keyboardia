// @vitest-environment jsdom
/**
 * Playback × mutation race lane.
 *
 * The scheduler re-reads state through its injected getState on every 25 ms
 * lookahead tick, so remote multiplayer mutations racing active playback are
 * reproduced exactly by swapping what getState returns BETWEEN ticks while
 * virtual time advances in lockstep with fake timers. This drives the real
 * Scheduler through the real timing kernel (timing-calculations) against a
 * recording engine mock — the seam the other scheduler tests already use.
 *
 * Mutation schedules are GENERATED AND SHRUNK BY FAST-CHECK (issue #97, T1):
 * a failure minimizes to the smallest failing action sequence (e.g. a single
 * tempo change for the historical Phase-22 reformula bug). Seeding comes
 * from the repo-wide fast-check seed (src/test/setup-fast-check.ts).
 *
 * Oracles are model-free (they do not re-implement scheduling):
 *   1. Liveness: triggers keep arriving into the final quarter of the run
 *      (a scheduler that silently dies mid-run fails here, not vacuously).
 *   2. Never schedule into the past: every trigger's audio time is >= the
 *      virtual clock at the moment it was scheduled.
 *   3. No exact double-fires for a track (1 ms epsilon — NOT a fraction of
 *      step duration: consecutive BPM-change rebases legitimately compress
 *      gaps to ~38 ms, so burst pathologies are oracle 2's job).
 *   4. stop() is clean: no triggers after stop, no pending timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { GridState, Track } from '../types';
import { MAX_TEMPO, MIN_TEMPO } from '../shared/constants';

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
import { resetSchedulerTracking } from './playback-state-debug';

// ---------------------------------------------------------------------------
// Generated mutation schedule (shrinkable)
// ---------------------------------------------------------------------------

type RaceAction =
  | { kind: 'tempo'; tempo: number }
  | { kind: 'stepCount'; trackPick: number; count: 8 | 12 | 16 | 24 }
  | { kind: 'deleteLast' }
  | { kind: 'addTrack'; step: number };

const actionArb: fc.Arbitrary<RaceAction> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant<'tempo'>('tempo'), tempo: fc.integer({ min: MIN_TEMPO, max: MAX_TEMPO }) }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant<'stepCount'>('stepCount'),
      trackPick: fc.nat(7), // taken mod tracks.length at apply time
      count: fc.constantFrom<8 | 12 | 16 | 24>(8, 12, 16, 24),
    }),
  },
  { weight: 1, arbitrary: fc.constant<RaceAction>({ kind: 'deleteLast' }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant<'addTrack'>('addTrack'), step: fc.integer({ min: 0, max: 15 }) }) },
);

const raceScheduleArb = fc.array(actionArb, { minLength: 0, maxLength: 15 });

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

function applyAction(state: GridState, action: RaceAction, tick: number): GridState {
  switch (action.kind) {
    case 'tempo':
      return { ...state, tempo: action.tempo };
    case 'stepCount': {
      // Index stays in range by construction: an out-of-range spread over
      // undefined would fabricate a reducer-unreachable state (Lesson 68).
      const which = action.trackPick % state.tracks.length;
      const tracks = state.tracks.slice();
      tracks[which] = { ...tracks[which], stepCount: action.count } as Track;
      return { ...state, tracks };
    }
    case 'deleteLast':
      return state.tracks.length > 1 ? { ...state, tracks: state.tracks.slice(0, -1) } : state;
    case 'addTrack':
      return { ...state, tracks: [...state.tracks, makeTrack(`n${tick}`, 16, [action.step])] };
  }
}

describe('scheduler under racing mutations (virtual time)', () => {
  let scheduler: Scheduler | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Safety net: if an oracle fails mid-run, stop() still runs so the
    // live scheduler and its fake timers cannot leak out of this test.
    try { scheduler?.stop(); } catch { /* already stopped */ }
    scheduler = null;
    vi.useRealTimers();
  });

  const TICKS = 80;              // 80 × 25 ms = 2 s of virtual playback
  const TICK_SEC = 0.025;
  const NUM_RUNS = 6;

  /** Execute one mutation schedule against a fresh scheduler; throws on violation. */
  function runRace(actions: RaceAction[]): void {
    clock.t = 0;
    triggers.length = 0;
    // Fresh instance per run; without this reset the registry climbs across
    // runs and fires the app's own multiple-instances debug alarm.
    resetSchedulerTracking();

    let state: GridState = {
      tracks: [makeTrack('a', 16, [0, 4, 8, 12]), makeTrack('b', 12, [0, 6])],
      tempo: 120,
      swing: 0,
    } as GridState;

    const sched = new Scheduler();
    scheduler = sched; // afterEach safety net
    sched.start(() => state);

    try {
      const queue = actions.slice();
      for (let tick = 0; tick < TICKS; tick++) {
        // One racing mutation lands between lookahead ticks, every 5th tick,
        // until the generated schedule is exhausted.
        if (tick > 0 && tick % 5 === 0 && queue.length > 0) {
          state = applyAction(state, queue.shift()!, tick);
        }
        clock.t += TICK_SEC;
        vi.advanceTimersByTime(TICK_SEC * 1000);
      }

      // ORACLE 1 — liveness: the last trigger lands in the final quarter.
      const lastScheduledAt = Math.max(...triggers.map((t) => t.clockAtSchedule));
      expect(
        lastScheduledAt,
        `scheduler stayed live to the end (${triggers.length} triggers)`,
      ).toBeGreaterThan(TICKS * TICK_SEC * 0.75);

      // ORACLE 2 — never into the past (small epsilon for float noise).
      for (const trig of triggers) {
        expect(
          trig.time,
          `${trig.trackId} scheduled at clock=${trig.clockAtSchedule.toFixed(3)}`,
        ).toBeGreaterThanOrEqual(trig.clockAtSchedule - 1e-3);
      }

      // ORACLE 3 — per-track: no exact double-fires (see docblock).
      const byTrack = new Map<string, number[]>();
      for (const trig of triggers) {
        const list = byTrack.get(trig.trackId) ?? [];
        list.push(trig.time);
        byTrack.set(trig.trackId, list);
      }
      for (const [trackId, times] of byTrack) {
        for (let i = 1; i < times.length; i++) {
          expect(
            times[i] - times[i - 1],
            `${trackId} exact double-fire at #${i} (t=${times[i].toFixed(3)})`,
          ).toBeGreaterThanOrEqual(0.001);
        }
      }

      // ORACLE 4 — clean stop: no further triggers, timers drained.
      sched.stop();
      const afterStop = triggers.length;
      clock.t += 1;
      vi.advanceTimersByTime(1000);
      expect(triggers.length, 'triggers after stop').toBe(afterStop);
      const internals = sched as unknown as { pendingTimers: Set<unknown>; timerId: number | null };
      expect(internals.pendingTimers.size, 'pending timers after stop').toBe(0);
      expect(internals.timerId, 'loop timer after stop').toBeNull();
    } finally {
      try { sched.stop(); } catch { /* already stopped */ }
    }
  }

  it('generated tempo/stepCount/track mutations mid-flight never double-fire or schedule into the past', () => {
    fc.assert(fc.property(raceScheduleArb, runRace), { numRuns: NUM_RUNS });
  });
});
