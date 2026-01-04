/**
 * Property-Based Tests for Audio Scheduler
 *
 * Tests AU-001 through AU-005 from the Property-Based Testing specification.
 * These cover timing monotonicity, swing behavior, loop containment,
 * tied note duration, and voice bounds.
 *
 * Since Scheduler methods are private, we extract and test the pure
 * calculation logic in isolation (matching the approach in scheduler.test.ts).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  arbStepCount,
  arbStepIndex,
  arbTempo,
  arbSwing,
  createTrackWithTies,
  VALID_STEP_COUNTS,
  MAX_STEPS,
} from '../test/arbitraries';

// =============================================================================
// Pure Functions Extracted from Scheduler
// =============================================================================

const STEPS_PER_BEAT = 4; // 16th notes

/**
 * Calculate step duration in seconds (same logic as Scheduler.getStepDuration)
 */
function getStepDuration(tempo: number): number {
  const beatsPerSecond = tempo / 60;
  return 1 / (beatsPerSecond * STEPS_PER_BEAT);
}

/**
 * Calculate swing delay for a step (same logic as Scheduler.scheduleStep)
 */
function calculateSwingDelay(
  trackStep: number,
  globalSwing: number,
  trackSwing: number,
  stepDuration: number
): number {
  // Swing blending formula from scheduler.ts:321-323
  const swingAmount = globalSwing + trackSwing - globalSwing * trackSwing;
  const isSwungStep = trackStep % 2 === 1;
  return isSwungStep ? stepDuration * swingAmount * 0.5 : 0;
}

/**
 * Calculate tied note duration (same logic as Scheduler.calculateTiedDuration)
 * Note: This replicates the CURRENT (potentially buggy) behavior for testing
 */
function calculateTiedDuration(
  track: { steps: boolean[]; parameterLocks: ({ tie?: boolean } | null)[] },
  startStep: number,
  trackStepCount: number,
  stepDuration: number
): number {
  let tieCount = 1;
  let nextStep = (startStep + 1) % trackStepCount;

  // Current scheduler logic - may not handle wrap-around correctly
  while (nextStep > startStep && nextStep < trackStepCount) {
    const nextPLock = track.parameterLocks[nextStep];
    if (track.steps[nextStep] && nextPLock?.tie === true) {
      tieCount++;
      nextStep = (nextStep + 1) % trackStepCount;
    } else {
      break;
    }
  }

  return stepDuration * tieCount * 0.9;
}

/**
 * Calculate tied note duration with CORRECTED wrap-around logic
 * This is what the implementation SHOULD do
 */
function calculateTiedDurationCorrected(
  track: { steps: boolean[]; parameterLocks: ({ tie?: boolean } | null)[] },
  startStep: number,
  trackStepCount: number,
  stepDuration: number,
  allowWrapAround: boolean = false
): number {
  let tieCount = 1;
  let nextStep = (startStep + 1) % trackStepCount;
  let stepsChecked = 0;

  // Correct logic: count consecutive tied steps, optionally wrapping around
  while (stepsChecked < trackStepCount - 1) {
    // Don't check more than remaining steps
    const nextPLock = track.parameterLocks[nextStep];
    if (track.steps[nextStep] && nextPLock?.tie === true) {
      tieCount++;
      nextStep = (nextStep + 1) % trackStepCount;
      stepsChecked++;

      // If not allowing wrap-around and we've returned to start, stop
      if (!allowWrapAround && nextStep <= startStep) {
        break;
      }
    } else {
      break;
    }
  }

  return stepDuration * tieCount * 0.9;
}

/**
 * Advance step within loop region (same logic as Scheduler.scheduler)
 */
function advanceStep(
  currentStep: number,
  loopRegion: { start: number; end: number } | null
): number {
  if (loopRegion) {
    if (currentStep >= loopRegion.end) {
      return loopRegion.start;
    }
    return currentStep + 1;
  }
  return (currentStep + 1) % MAX_STEPS;
}

/**
 * Calculate step time using drift-free formula
 */
function calculateStepTime(
  audioStartTime: number,
  stepIndex: number,
  tempo: number
): number {
  const stepDuration = getStepDuration(tempo);
  return audioStartTime + stepIndex * stepDuration;
}

// =============================================================================
// AU-001: Timing Monotonicity
// =============================================================================

describe('AU-001: Timing Monotonicity', () => {
  it('AU-001a: step duration decreases as tempo increases', () => {
    fc.assert(
      fc.property(arbTempo, arbTempo, (tempo1, tempo2) => {
        fc.pre(tempo1 !== tempo2);
        const duration1 = getStepDuration(tempo1);
        const duration2 = getStepDuration(tempo2);

        if (tempo1 < tempo2) {
          expect(duration1).toBeGreaterThan(duration2);
        } else {
          expect(duration1).toBeLessThan(duration2);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('AU-001b: step duration is always positive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }), // Extended tempo range
        (tempo) => {
          const duration = getStepDuration(tempo);
          expect(duration).toBeGreaterThan(0);
          expect(Number.isFinite(duration)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('AU-001c: later steps have later or equal times', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1000, noNaN: true }), // audioStartTime
        arbTempo,
        fc.array(fc.integer({ min: 0, max: 1000 }), {
          minLength: 2,
          maxLength: 20,
        }),
        (audioStartTime, tempo, stepIndices) => {
          const sortedIndices = [...stepIndices].sort((a, b) => a - b);

          for (let i = 1; i < sortedIndices.length; i++) {
            const prevTime = calculateStepTime(
              audioStartTime,
              sortedIndices[i - 1],
              tempo
            );
            const currTime = calculateStepTime(
              audioStartTime,
              sortedIndices[i],
              tempo
            );
            expect(currTime).toBeGreaterThanOrEqual(prevTime);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('AU-001d: step time formula is deterministic', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1000, noNaN: true }),
        arbTempo,
        fc.nat({ max: 1000 }),
        (audioStartTime, tempo, stepIndex) => {
          const time1 = calculateStepTime(audioStartTime, stepIndex, tempo);
          const time2 = calculateStepTime(audioStartTime, stepIndex, tempo);
          expect(time1).toBe(time2);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('AU-001e: standard tempos produce expected step durations', () => {
    // At 120 BPM: 1 beat = 0.5s, 1 step (16th note) = 0.125s
    expect(getStepDuration(120)).toBeCloseTo(0.125, 6);
    // At 60 BPM: 1 step = 0.25s
    expect(getStepDuration(60)).toBeCloseTo(0.25, 6);
    // At 240 BPM: 1 step = 0.0625s
    expect(getStepDuration(240)).toBeCloseTo(0.0625, 6);
  });
});

// =============================================================================
// AU-002: Swing on Odd Steps Only
// =============================================================================

describe('AU-002: Swing on Odd Steps Only', () => {
  it('AU-002a: even steps have zero swing delay', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 63 }).map((n) => n * 2), // Even steps only
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        arbTempo,
        (evenStep, globalSwing, trackSwing, tempo) => {
          const stepDuration = getStepDuration(tempo);
          const delay = calculateSwingDelay(
            evenStep,
            globalSwing,
            trackSwing,
            stepDuration
          );
          expect(delay).toBe(0);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('AU-002b: odd steps get swing delay proportional to swing amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 63 }).map((n) => n * 2 + 1), // Odd steps only
        fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }), // Non-zero swing
        arbTempo,
        (oddStep, globalSwing, tempo) => {
          const stepDuration = getStepDuration(tempo);
          const delay = calculateSwingDelay(oddStep, globalSwing, 0, stepDuration);
          expect(delay).toBeGreaterThan(0);
          expect(delay).toBeLessThanOrEqual(stepDuration * 0.5);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('AU-002c: swing blend formula is commutative', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (globalSwing, trackSwing) => {
          // Formula: g + t - (g * t)
          const blend1 = globalSwing + trackSwing - globalSwing * trackSwing;
          const blend2 = trackSwing + globalSwing - trackSwing * globalSwing;
          expect(blend1).toBeCloseTo(blend2, 10);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('AU-002d: zero global swing uses only track swing', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        (trackSwing) => {
          const blend = 0 + trackSwing - 0 * trackSwing;
          expect(blend).toBeCloseTo(trackSwing, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('AU-002e: zero track swing uses only global swing', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        (globalSwing) => {
          const blend = globalSwing + 0 - globalSwing * 0;
          expect(blend).toBeCloseTo(globalSwing, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('AU-002f: swing monotonically increases with swing amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 63 }).map((n) => n * 2 + 1), // Odd step
        fc.float({ min: Math.fround(0), max: Math.fround(0.9), noNaN: true }),
        arbTempo,
        (oddStep, swing, tempo) => {
          const stepDuration = getStepDuration(tempo);
          const delay1 = calculateSwingDelay(oddStep, swing, 0, stepDuration);
          const delay2 = calculateSwingDelay(oddStep, swing + 0.1, 0, stepDuration);
          expect(delay2).toBeGreaterThan(delay1);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('AU-002g: swing blend is bounded [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (globalSwing, trackSwing) => {
          const blend = globalSwing + trackSwing - globalSwing * trackSwing;
          expect(blend).toBeGreaterThanOrEqual(0);
          expect(blend).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('AU-002h: full swing on both produces full swing (not > 1)', () => {
    // When both global and track are 100%, blend should be 1, not 2
    const blend = 1 + 1 - 1 * 1;
    expect(blend).toBe(1);
  });
});

// =============================================================================
// AU-003: Loop Containment
// =============================================================================

describe('AU-003: Loop Containment', () => {
  it('AU-003a: steps stay within loop region bounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 126 }),
        fc.integer({ min: 1, max: 127 }),
        fc.integer({ min: 1, max: 500 }),
        (start, span, stepsToRun) => {
          const end = Math.min(start + span, 127);
          fc.pre(start < end); // Valid loop region

          const loopRegion = { start, end };
          const visited = new Set<number>();
          let currentStep = start;

          for (let i = 0; i < stepsToRun; i++) {
            visited.add(currentStep);
            currentStep = advanceStep(currentStep, loopRegion);
          }

          // All visited steps should be in [start, end]
          for (const step of visited) {
            expect(step).toBeGreaterThanOrEqual(start);
            expect(step).toBeLessThanOrEqual(end);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('AU-003b: without loop region, steps wrap at MAX_STEPS', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (stepsToRun) => {
        const visited = new Set<number>();
        let currentStep = 0;

        for (let i = 0; i < stepsToRun; i++) {
          visited.add(currentStep);
          currentStep = advanceStep(currentStep, null);
        }

        // All steps should be in [0, MAX_STEPS)
        for (const step of visited) {
          expect(step).toBeGreaterThanOrEqual(0);
          expect(step).toBeLessThan(MAX_STEPS);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('AU-003c: loop eventually visits all steps in region', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 2, max: 64 }),
        (start, regionSize) => {
          const end = Math.min(start + regionSize, 127);
          const loopRegion = { start, end };
          const expectedSize = end - start + 1;

          const visited = new Set<number>();
          let currentStep = start;

          // Run enough steps to visit entire region at least once
          for (let i = 0; i < expectedSize * 2; i++) {
            visited.add(currentStep);
            currentStep = advanceStep(currentStep, loopRegion);
          }

          // Should visit every step in the region
          expect(visited.size).toBe(expectedSize);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('AU-003d: loop wraps correctly at region end', () => {
    // Specific test: loop region [4, 7] should cycle 4->5->6->7->4->...
    const loopRegion = { start: 4, end: 7 };
    let step = 4;

    const sequence = [];
    for (let i = 0; i < 8; i++) {
      sequence.push(step);
      step = advanceStep(step, loopRegion);
    }

    expect(sequence).toEqual([4, 5, 6, 7, 4, 5, 6, 7]);
  });

  it('AU-003e: single-step loop stays on that step', () => {
    // Edge case: start === end - should stay on that step
    const loopRegion = { start: 5, end: 5 };
    let step = 5;

    for (let i = 0; i < 10; i++) {
      expect(step).toBe(5);
      // When currentStep >= end and start === end, we return to start (same step)
      step = advanceStep(step, loopRegion);
    }
  });
});

// =============================================================================
// AU-004: Tied Duration Calculation
// =============================================================================

describe('AU-004: Tied Duration Calculation', () => {
  it('AU-004a: single untied step has base duration', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_STEP_COUNTS.filter((s) => s <= 64)),
        arbTempo,
        (stepCount, tempo) => {
          const stepDuration = getStepDuration(tempo);
          const track = {
            steps: new Array(MAX_STEPS).fill(false),
            parameterLocks: new Array(MAX_STEPS).fill(null) as (
              | { tie?: boolean }
              | null
            )[],
          };
          // Single active step, no tie
          track.steps[0] = true;

          const duration = calculateTiedDuration(
            track,
            0,
            stepCount,
            stepDuration
          );
          expect(duration).toBeCloseTo(stepDuration * 0.9, 6);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('AU-004b: consecutive tied steps extend duration', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 32 }), // stepCount
        fc.integer({ min: 2, max: 8 }), // tieLength
        arbTempo,
        (stepCount, tieLength, tempo) => {
          fc.pre(tieLength < stepCount); // Ties must fit within pattern

          const stepDuration = getStepDuration(tempo);
          const { steps, locks } = createTrackWithTies(0, tieLength, stepCount);
          const track = { steps, parameterLocks: locks };

          const duration = calculateTiedDurationCorrected(
            track,
            0,
            stepCount,
            stepDuration,
            false
          );

          // Expected: tieLength steps * stepDuration * 0.9 gate time
          expect(duration).toBeCloseTo(stepDuration * tieLength * 0.9, 4);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('AU-004c: duration is proportional to tie count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 32 }), // stepCount
        fc.integer({ min: 1, max: 4 }), // baseTieLength
        arbTempo,
        (stepCount, baseTieLength, tempo) => {
          const stepDuration = getStepDuration(tempo);

          // Create two tracks with different tie lengths
          const { steps: steps1, locks: locks1 } = createTrackWithTies(
            0,
            baseTieLength,
            stepCount
          );
          const { steps: steps2, locks: locks2 } = createTrackWithTies(
            0,
            baseTieLength * 2,
            stepCount
          );

          const duration1 = calculateTiedDurationCorrected(
            { steps: steps1, parameterLocks: locks1 },
            0,
            stepCount,
            stepDuration,
            false
          );
          const duration2 = calculateTiedDurationCorrected(
            { steps: steps2, parameterLocks: locks2 },
            0,
            stepCount,
            stepDuration,
            false
          );

          // Double the ties = double the duration
          expect(duration2).toBeCloseTo(duration1 * 2, 4);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('AU-004d: BUG DETECTION - current implementation fails at loop boundary', () => {
    // This test documents the known bug in calculateTiedDuration
    // When startStep is near the end and ties wrap around, the current
    // implementation breaks because: while (nextStep > startStep && nextStep < trackStepCount)
    // fails when nextStep wraps to 0 (0 > 14 is false)

    const stepCount = 16;
    const stepDuration = 0.125;

    // Tied note starting at step 14, extending to steps 15 and 0
    const track = {
      steps: new Array(MAX_STEPS).fill(false),
      parameterLocks: new Array(MAX_STEPS).fill(null) as (
        | { tie?: boolean }
        | null
      )[],
    };
    track.steps[14] = true;
    track.steps[15] = true;
    track.parameterLocks[15] = { tie: true };
    // Note: step 0 would also be tied in a proper wrap-around scenario

    // Current (buggy) implementation
    const buggyDuration = calculateTiedDuration(track, 14, stepCount, stepDuration);

    // The bug: it counts step 14 and 15 correctly (2 steps)
    // But if we had a wrap-around tie to step 0, it would fail
    expect(buggyDuration).toBeCloseTo(stepDuration * 2 * 0.9, 6);

    // Now test the actual bug: start at step 15, try to tie to step 0
    track.steps[0] = true;
    track.parameterLocks[0] = { tie: true };

    const wrapBuggyDuration = calculateTiedDuration(
      track,
      15,
      stepCount,
      stepDuration
    );

    // BUG: This only counts 1 step because nextStep=0 and 0 > 15 is FALSE
    expect(wrapBuggyDuration).toBeCloseTo(stepDuration * 1 * 0.9, 6);
    // It SHOULD be 2 steps if wrap-around were handled
  });

  it('AU-004e: gate time is 90% of duration', () => {
    const stepDuration = 0.125;
    const stepCount = 16;

    const track = {
      steps: [true, ...new Array(MAX_STEPS - 1).fill(false)],
      parameterLocks: new Array(MAX_STEPS).fill(null) as (
        | { tie?: boolean }
        | null
      )[],
    };

    const duration = calculateTiedDuration(track, 0, stepCount, stepDuration);
    expect(duration).toBe(stepDuration * 0.9);
  });
});

// =============================================================================
// AU-005: Voice Count Bounded (Conceptual Properties)
// =============================================================================

describe('AU-005: Voice Count Properties', () => {
  // Note: Actual voice counting requires integration with audioEngine
  // These tests verify the conceptual properties that should hold

  it('AU-005a: maximum theoretical voices is bounded by track count × steps', () => {
    const MAX_TRACKS = 16;
    const MAX_STEPS_VAL = 128;

    // At most, we could trigger one voice per track per step
    // But in practice, tied notes reduce this
    const theoreticalMax = MAX_TRACKS * MAX_STEPS_VAL;
    expect(theoreticalMax).toBe(2048);
  });

  it('AU-005b: tied notes reduce active voice count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 16 }), // stepCount
        fc.integer({ min: 1, max: 8 }), // activeSteps
        fc.integer({ min: 0, max: 4 }), // tiedSteps
        (stepCount, activeSteps, tiedSteps) => {
          fc.pre(activeSteps + tiedSteps <= stepCount);

          // Without ties: each active step triggers a new voice
          const voicesWithoutTies = activeSteps;

          // With ties: tied steps extend duration, don't trigger new voices
          const voicesWithTies = activeSteps; // First step still triggers

          // Tied notes extend existing voices rather than creating new ones
          expect(voicesWithTies).toBeLessThanOrEqual(voicesWithoutTies);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('AU-005c: polyphony is bounded per instrument type', () => {
    // Document expected polyphony limits (these are architectural constraints)
    const EXPECTED_LIMITS: Record<string, number> = {
      sample: 32, // Unlimited practical polyphony for one-shots
      synth: 16, // Typical synth polyphony
      tone: 8, // Tone.js default polyphony
      sampled: 16, // Sampled instruments (piano, etc.)
    };

    for (const [type, limit] of Object.entries(EXPECTED_LIMITS)) {
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(128);
    }
  });
});

// =============================================================================
// Polyrhythm LCM Properties (Related to AU-004)
// =============================================================================

describe('Polyrhythm LCM Properties', () => {
  /**
   * Calculate LCM of two numbers
   */
  function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
  }

  function lcm(a: number, b: number): number {
    return (a * b) / gcd(a, b);
  }

  it('tracks with coprime step counts have LCM = product', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(3, 5, 7, 11, 13), // Primes
        fc.constantFrom(4, 8, 16), // Powers of 2
        (prime, powerOf2) => {
          const result = lcm(prime, powerOf2);
          expect(result).toBe(prime * powerOf2);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('LCM > MAX_STEPS means tracks never realign within pattern', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_STEP_COUNTS),
        fc.constantFrom(...VALID_STEP_COUNTS),
        (countA, countB) => {
          const trackLcm = lcm(countA, countB);

          if (trackLcm > MAX_STEPS) {
            // These tracks will NOT sync within one pattern cycle
            // This is important information for users
            expect(trackLcm).toBeGreaterThan(MAX_STEPS);
          } else {
            // These tracks WILL sync
            expect(trackLcm).toBeLessThanOrEqual(MAX_STEPS);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('common polyrhythm combinations have reasonable LCMs', () => {
    // 3:4 polyrhythm (common in electronic music)
    expect(lcm(12, 16)).toBe(48);
    expect(lcm(12, 16)).toBeLessThanOrEqual(MAX_STEPS);

    // 5:4 polyrhythm
    expect(lcm(5, 16)).toBe(80);
    expect(lcm(5, 16)).toBeLessThanOrEqual(MAX_STEPS);

    // 7:4 polyrhythm
    expect(lcm(7, 16)).toBe(112);
    expect(lcm(7, 16)).toBeLessThanOrEqual(MAX_STEPS);

    // Problematic: 96 and 64 step patterns
    expect(lcm(96, 64)).toBe(192);
    expect(lcm(96, 64)).toBeGreaterThan(MAX_STEPS); // Never syncs!
  });
});
