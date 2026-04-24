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

  it('advances step proportional to elapsed time at 120 BPM', () => {
    // 120 BPM × 4 steps/beat → stepDuration = 0.125s = 125ms.
    // Joining 250ms in should put us at step 2 of the loop.
    const result = computeJoinOffset({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_250,
      tempo: 120,
      maxSteps: MAX_STEPS,
      loopStart: 0,
    });
    expect(result.currentStep).toBe(2);
    // 250ms = exactly 2 full steps → remainder 0 → nextStepTime = audioStartTime + 125ms.
    expect(result.nextStepTime).toBeCloseTo(10.125, 5);
  });

  it('wraps around when elapsed time exceeds a full loop', () => {
    const tempo = 120;
    const dur = stepDurationOf(tempo);
    const elapsedMs = (MAX_STEPS + 5) * dur * 1000;
    const result = computeJoinOffset({
      audioStartTime: 10.0,
      serverStartTime: 1_000_000,
      currentServerTime: 1_000_000 + elapsedMs,
      tempo,
      maxSteps: MAX_STEPS,
      loopStart: 0,
    });
    // Should wrap: (MAX_STEPS + 5) % MAX_STEPS = 5
    expect(result.currentStep).toBe(5);
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
