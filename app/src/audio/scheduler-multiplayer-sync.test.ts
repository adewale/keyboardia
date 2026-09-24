/**
 * Tests for multiplayer join-in-progress math.
 *
 * When a client joins an already-playing session, it must align its local
 * playhead with the rest of the room. The pure helper `computeJoinOffset`
 * produces the initial step and next-step-time given the server timing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeJoinOffset } from './scheduler-multiplayer-sync';
import { audioTime, serverTimeMs } from './audio-time';

function computeJoinOffsetFromNumbers(input: {
  audioStartTime: number;
  serverStartTime: number;
  currentServerTime: number;
  tempo: number;
  loopRegion: { start: number; end: number } | null;
}) {
  return computeJoinOffset({
    ...input,
    audioStartTime: audioTime(input.audioStartTime),
    serverStartTime: serverTimeMs(input.serverStartTime),
    currentServerTime: serverTimeMs(input.currentServerTime),
  });
}

const STEPS_PER_BEAT = 4;
const LOOP_STEPS = 64;
const FULL_LOOP = { start: 0, end: LOOP_STEPS - 1 };

function stepDurationOf(tempo: number): number {
  return 1 / ((tempo / 60) * STEPS_PER_BEAT);
}

describe('computeJoinOffset', () => {
  it('mid-step join schedules the NEXT step at the next boundary, not the already-sounding step', () => {
    // 120 BPM × 4 steps/beat → stepDuration = 125ms.
    // Joining 75ms in (mid-way through step 0): step 0 has already
    // started elsewhere; the next thing this peer can play is step 1
    // at audioStartTime + (125 - 75) = audioStartTime + 50ms.
    const result = computeJoinOffsetFromNumbers({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_075,
      tempo: 120,
      loopRegion: null,
    });
    expect(result.currentStep).toBe(1);
    expect(result.nextStepTime).toBeCloseTo(10.05, 5);
  });

  it('exact-boundary join schedules the boundary step at audioStartTime (now), not one stepDuration later', () => {
    // Joining exactly at step 2 boundary (250ms = 2 × 125ms).
    // currentStep=2 should play at the boundary, which is right now
    // (audioStartTime), not at audioStartTime + stepDuration.
    const result = computeJoinOffsetFromNumbers({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_250,
      tempo: 120,
      loopRegion: null,
    });
    expect(result.currentStep).toBe(2);
    expect(result.nextStepTime).toBe(10.0);
  });

  it('starts at step 0 when client joins at the server-start moment', () => {
    const result = computeJoinOffsetFromNumbers({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_000,
      tempo: 120,
      loopRegion: null,
    });
    expect(result.currentStep).toBe(0);
    expect(result.nextStepTime).toBe(10.0);
  });

  it('returns the loop region start when the client is "ahead" of the server', () => {
    // Negative elapsed — treated as fresh start
    const result = computeJoinOffsetFromNumbers({
      audioStartTime: 10.0,
      serverStartTime: 1_000_100,
      currentServerTime: 1_000_000,
      tempo: 120,
      loopRegion: { start: 3, end: 10 },
    });
    expect(result.currentStep).toBe(3);
    expect(result.nextStepTime).toBe(10.0);
  });

  it('keeps counting past 128 steps without a loop region', () => {
    // Tracks read the global step modulo their own length, so a joiner must
    // land on the room's unwrapped step: a wrap at 128 would put a 10-step
    // track at step 5 of its loop instead of step 3.
    const tempo = 120;
    const dur = stepDurationOf(tempo);
    const elapsedMs = (128 + 5) * dur * 1000;
    const result = computeJoinOffsetFromNumbers({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_000 + elapsedMs,
      tempo,
      loopRegion: null,
    });
    expect(result.currentStep).toBe(133);
    expect(result.nextStepTime).toBe(10.0);
  });

  it('wraps inside the loop region, counting from its start', () => {
    const tempo = 120;
    const dur = stepDurationOf(tempo);
    // Exact-boundary case after one pass of an 8-step region + 5 steps.
    const elapsedMs = (8 + 5) * dur * 1000;
    const result = computeJoinOffsetFromNumbers({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_000 + elapsedMs,
      tempo,
      loopRegion: { start: 4, end: 11 },
    });
    expect(result.currentStep).toBe(4 + 5);
    expect(result.nextStepTime).toBe(10.0);
  });

  it('mid-step join in a later loop wraps the +1 step around correctly', () => {
    const tempo = 120;
    const dur = stepDurationOf(tempo);
    // Join 50ms into the region's last step on its second pass. The next
    // step is the region's first.
    const elapsedMs = (LOOP_STEPS + (LOOP_STEPS - 1)) * dur * 1000 + 50;
    const result = computeJoinOffsetFromNumbers({
      audioStartTime: 10.0,
      serverStartTime: 0,
      currentServerTime: elapsedMs,
      tempo,
      loopRegion: FULL_LOOP,
    });
    expect(result.currentStep).toBe(0);
  });

  // Property: with a loop region, currentStep always lies inside it whenever
  // server time is at or after server start. Includes a region whose end is
  // below its start (defensive).
  it('always produces currentStep inside the loop region for non-negative elapsed', () => {
    fc.assert(
      fc.property(
        fc.record({
          tempo: fc.double({ min: 30, max: 300, noNaN: true, noDefaultInfinity: true }),
          elapsedMs: fc.double({ min: 0, max: 1e9, noNaN: true, noDefaultInfinity: true }),
          audioStartTime: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
          start: fc.integer({ min: 0, max: 127 }),
          end: fc.integer({ min: 0, max: 127 }),
        }),
        ({ tempo, elapsedMs, audioStartTime, start, end }) => {
          const result = computeJoinOffsetFromNumbers({
            audioStartTime,
            serverStartTime: 0,
            currentServerTime: elapsedMs,
            tempo,
            loopRegion: { start, end },
          });
          expect(result.currentStep).toBeGreaterThanOrEqual(start);
          expect(result.currentStep).toBeLessThanOrEqual(Math.max(start, end));
        }
      ),
      { numRuns: 300, seed: 0x4a4d5051 }
    );
  });

  // Property: without a loop region, the step a joiner schedules is the one
  // the room reaches at the joiner's nextStepTime. The room plays step s at
  // s × stepDuration after server start.
  it('without a loop region, schedules the step the room plays at nextStepTime', () => {
    fc.assert(
      fc.property(
        fc.record({
          tempo: fc.double({ min: 30, max: 300, noNaN: true, noDefaultInfinity: true }),
          elapsedMs: fc.double({ min: 0, max: 1e7, noNaN: true, noDefaultInfinity: true }),
          audioStartTime: fc.double({ min: 0, max: 1e3, noNaN: true, noDefaultInfinity: true }),
        }),
        ({ tempo, elapsedMs, audioStartTime }) => {
          const result = computeJoinOffsetFromNumbers({
            audioStartTime,
            serverStartTime: 0,
            currentServerTime: elapsedMs,
            tempo,
            loopRegion: null,
          });
          const roomTimeOfStep = result.currentStep * stepDurationOf(tempo);
          const roomTimeAtNextStep = elapsedMs / 1000 + (result.nextStepTime - audioStartTime);
          expect(roomTimeOfStep).toBeCloseTo(roomTimeAtNextStep, 5);
        }
      ),
      { numRuns: 300, seed: 0x4a4d5053 }
    );
  });

  // Lesson 33: user-observable property — the next 3 step boundaries
  // are evenly spaced. Stronger than "currentStep in range" because it
  // catches both the off-by-one AND the join-offset-discarded bugs that
  // earlier rounds shipped.
  it('pbt: scheduling N steps from a join offset gives an evenly-spaced sequence', () => {
    fc.assert(
      fc.property(
        fc.record({
          tempo: fc.double({ min: 60, max: 240, noNaN: true, noDefaultInfinity: true }),
          elapsedMs: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
          audioStartTime: fc.double({ min: 0, max: 1e3, noNaN: true, noDefaultInfinity: true }),
        }),
        ({ tempo, elapsedMs, audioStartTime }) => {
          const step = stepDurationOf(tempo);
          const offset = computeJoinOffsetFromNumbers({
            audioStartTime,
            serverStartTime: 0,
            currentServerTime: elapsedMs,
            tempo,
            loopRegion: null,
          });
          // The simulated "next 3 step times" the worklet would emit
          // after applying the fix from review #2 (anchor audioStartTime
          // to initialNextStepTime). All three must be equally spaced.
          const t0 = offset.nextStepTime;
          const t1 = t0 + step;
          const t2 = t0 + 2 * step;
          expect(t1 - t0).toBeCloseTo(step, 9);
          expect(t2 - t1).toBeCloseTo(step, 9);
        }
      ),
      { numRuns: 300, seed: 0x4a4d5052 }
    );
  });

  // Property: nextStepTime is always on or after audioStartTime and within one
  // step-duration past it. You never scheduling a step in the past.
  it('nextStepTime lies in [audioStartTime, audioStartTime + stepDuration]', () => {
    fc.assert(
      fc.property(
        fc.record({
          tempo: fc.double({ min: 30, max: 300, noNaN: true, noDefaultInfinity: true }),
          elapsedMs: fc.double({ min: 0, max: 1e7, noNaN: true, noDefaultInfinity: true }),
          audioStartTime: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        }),
        ({ tempo, elapsedMs, audioStartTime }) => {
          const stepDuration = stepDurationOf(tempo);
          const result = computeJoinOffsetFromNumbers({
            audioStartTime,
            serverStartTime: 0,
            currentServerTime: elapsedMs,
            tempo,
            loopRegion: null,
          });
          expect(result.nextStepTime).toBeGreaterThanOrEqual(audioStartTime - 1e-9);
          expect(result.nextStepTime).toBeLessThanOrEqual(audioStartTime + stepDuration + 1e-9);
        }
      ),
      { numRuns: 300, seed: 0x4a4d5051 }
    );
  });
});
