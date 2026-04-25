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

const STEPS_PER_BEAT = 4;
const MAX_STEPS = 64;

function stepDurationOf(tempo: number): number {
  return 1 / ((tempo / 60) * STEPS_PER_BEAT);
}

describe('computeJoinOffset', () => {
  it('mid-step join schedules the NEXT step at the next boundary, not the already-sounding step', () => {
    // 120 BPM × 4 steps/beat → stepDuration = 125ms.
    // Joining 75ms in (mid-way through step 0): step 0 has already
    // started elsewhere; the next thing this peer can play is step 1
    // at audioStartTime + (125 - 75) = audioStartTime + 50ms.
    const result = computeJoinOffset({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_075,
      tempo: 120,
      maxSteps: 64,
      loopStart: 0,
    });
    expect(result.currentStep).toBe(1);
    expect(result.nextStepTime).toBeCloseTo(10.05, 5);
  });

  it('exact-boundary join schedules the boundary step at audioStartTime (now), not one stepDuration later', () => {
    // Joining exactly at step 2 boundary (250ms = 2 × 125ms).
    // currentStep=2 should play at the boundary, which is right now
    // (audioStartTime), not at audioStartTime + stepDuration.
    const result = computeJoinOffset({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_250,
      tempo: 120,
      maxSteps: 64,
      loopStart: 0,
    });
    expect(result.currentStep).toBe(2);
    expect(result.nextStepTime).toBe(10.0);
  });

  it('starts at step 0 when client joins at the server-start moment', () => {
    const result = computeJoinOffset({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_000,
      tempo: 120,
      maxSteps: MAX_STEPS,
      loopStart: 0,
    });
    expect(result.currentStep).toBe(0);
    expect(result.nextStepTime).toBe(10.0);
  });

  it('returns loopStart fallback when the client is "ahead" of the server', () => {
    // Negative elapsed — treated as fresh start
    const result = computeJoinOffset({
      audioStartTime: 10.0,
      serverStartTime: 1_000_100,
      currentServerTime: 1_000_000,
      tempo: 120,
      maxSteps: MAX_STEPS,
      loopStart: 3,
    });
    expect(result.currentStep).toBe(3);
    expect(result.nextStepTime).toBe(10.0);
  });

  it('wraps around when elapsed time exceeds a full loop', () => {
    const tempo = 120;
    const dur = stepDurationOf(tempo);
    // Exact-boundary case after one full loop + 5 steps.
    const elapsedMs = (MAX_STEPS + 5) * dur * 1000;
    const result = computeJoinOffset({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_000 + elapsedMs,
      tempo,
      maxSteps: MAX_STEPS,
      loopStart: 0,
    });
    // Boundary case: stepToSchedule = (MAX_STEPS + 5) % MAX_STEPS = 5
    expect(result.currentStep).toBe(5);
    expect(result.nextStepTime).toBe(10.0);
  });

  it('mid-step join in a later loop wraps the +1 step around correctly', () => {
    const tempo = 120;
    const dur = stepDurationOf(tempo);
    // Join 50ms into step (MAX_STEPS - 1) of the second loop. The next
    // step is step 0 of the next loop (wraps via mod).
    const elapsedMs = (MAX_STEPS + (MAX_STEPS - 1)) * dur * 1000 + 50;
    const result = computeJoinOffset({
      audioStartTime: 10.0,
      serverStartTime: 0,
      currentServerTime: elapsedMs,
      tempo,
      maxSteps: MAX_STEPS,
      loopStart: 0,
    });
    expect(result.currentStep).toBe(0);
  });

  // Property: currentStep is always within [0, maxSteps) whenever server time
  // is at or after server start. Includes the edge case where loopStart is
  // supplied out of range (defensive clamp).
  it('always produces currentStep in [0, maxSteps) for non-negative elapsed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 512 }).chain(maxSteps =>
          fc.record({
            tempo: fc.double({ min: 30, max: 300, noNaN: true, noDefaultInfinity: true }),
            elapsedMs: fc.double({ min: 0, max: 1e9, noNaN: true, noDefaultInfinity: true }),
            maxSteps: fc.constant(maxSteps),
            audioStartTime: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
            // Include out-of-range loopStart to exercise the defensive clamp.
            loopStart: fc.integer({ min: 0, max: Math.max(0, maxSteps * 2) }),
          })
        ),
        ({ tempo, elapsedMs, maxSteps, audioStartTime, loopStart }) => {
          const result = computeJoinOffset({
            audioStartTime,
            serverStartTime: 0,
            currentServerTime: elapsedMs,
            tempo,
            maxSteps,
            loopStart,
          });
          expect(result.currentStep).toBeGreaterThanOrEqual(0);
          expect(result.currentStep).toBeLessThan(maxSteps);
        }
      ),
      { numRuns: 300, seed: 0x4a4d5051 }
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
          const result = computeJoinOffset({
            audioStartTime,
            serverStartTime: 0,
            currentServerTime: elapsedMs,
            tempo,
            maxSteps: MAX_STEPS,
            loopStart: 0,
          });
          expect(result.nextStepTime).toBeGreaterThanOrEqual(audioStartTime - 1e-9);
          expect(result.nextStepTime).toBeLessThanOrEqual(audioStartTime + stepDuration + 1e-9);
        }
      ),
      { numRuns: 300, seed: 0x4a4d5051 }
    );
  });
});
