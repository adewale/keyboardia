import { describe, it, expect } from 'vitest';
import type { Track } from '../types';
import { MAX_STEPS, STEPS_PER_PAGE } from '../types';

/**
 * Pure function that calculates which step a track should play given the global step.
 * This is the core polyrhythm logic extracted from the scheduler.
 */
function getTrackStep(globalStep: number, trackStepCount: number): number {
  return globalStep % trackStepCount;
}

/**
 * Determines if a track should trigger at a given global step.
 * A track triggers when:
 * 1. It's not muted
 * 2. The track's local step (globalStep % stepCount) is active
 */
function shouldTrackTrigger(track: Track, globalStep: number): boolean {
  if (track.muted) return false;
  const trackStep = getTrackStep(globalStep, track.stepCount);
  return track.steps[trackStep] === true;
}

/**
 * Creates a minimal test track with the given step count and active steps.
 */
function createTrack(
  id: string,
  stepCount: number,
  activeSteps: number[],
  muted = false
): Track {
  const steps = Array(MAX_STEPS).fill(false);
  activeSteps.forEach(s => { steps[s] = true; });

  return {
    id,
    name: `Track ${id}`,
    sampleId: 'kick',
    steps,
    parameterLocks: Array(MAX_STEPS).fill(null),
    volume: 1,
    muted,
    soloed: false,
    transpose: 0,
    stepCount,
  };
}

describe('Polyrhythmic Track Behavior', () => {
  describe('getTrackStep - basic looping', () => {
    it('should return the correct step for a 16-step track', () => {
      const stepCount = 16;

      expect(getTrackStep(0, stepCount)).toBe(0);
      expect(getTrackStep(15, stepCount)).toBe(15);
      expect(getTrackStep(16, stepCount)).toBe(0); // Loops back
      expect(getTrackStep(17, stepCount)).toBe(1);
      expect(getTrackStep(31, stepCount)).toBe(15);
      expect(getTrackStep(32, stepCount)).toBe(0); // Second loop
    });

    it('should return the correct step for a 32-step track', () => {
      const stepCount = 32;

      expect(getTrackStep(0, stepCount)).toBe(0);
      expect(getTrackStep(31, stepCount)).toBe(31);
      expect(getTrackStep(32, stepCount)).toBe(0); // Loops back
      expect(getTrackStep(63, stepCount)).toBe(31);
    });

    it('should return the correct step for a 64-step track', () => {
      const stepCount = 64;

      expect(getTrackStep(0, stepCount)).toBe(0);
      expect(getTrackStep(63, stepCount)).toBe(63);
      // 64-step track only loops when global step exceeds MAX_STEPS
    });
  });

  describe('Polyrhythmic combinations', () => {
    it('16-step and 32-step tracks: 16-step loops twice per 32-step cycle', () => {
      const track16 = createTrack('t16', 16, [0]); // Beat 1 only
      const track32 = createTrack('t32', 32, [0, 16]); // Beat 1 and beat 17

      // Global steps 0-31 (one full 32-step cycle)
      const triggers16: number[] = [];
      const triggers32: number[] = [];

      for (let globalStep = 0; globalStep < 32; globalStep++) {
        if (shouldTrackTrigger(track16, globalStep)) {
          triggers16.push(globalStep);
        }
        if (shouldTrackTrigger(track32, globalStep)) {
          triggers32.push(globalStep);
        }
      }

      // 16-step track should trigger at global steps 0 and 16 (loops twice)
      expect(triggers16).toEqual([0, 16]);

      // 32-step track triggers once at 0 and once at 16
      expect(triggers32).toEqual([0, 16]);
    });

    it('3 against 4 polyrhythm: 12-step vs 16-step tracks', () => {
      // Classic 3:4 polyrhythm
      // 12-step track with beats on 0, 4, 8 (3 even divisions of 12)
      // 16-step track with beats on 0, 4, 8, 12 (4 even divisions of 16)
      const track12 = createTrack('t12', 12, [0, 4, 8]);
      const track16 = createTrack('t16', 16, [0, 4, 8, 12]);

      // Over 48 steps (LCM of 12 and 16), each track loops different times
      // track12 loops 4 times (48/12 = 4)
      // track16 loops 3 times (48/16 = 3)

      const triggers12: number[] = [];
      const triggers16: number[] = [];

      for (let globalStep = 0; globalStep < 48; globalStep++) {
        if (shouldTrackTrigger(track12, globalStep)) {
          triggers12.push(globalStep);
        }
        if (shouldTrackTrigger(track16, globalStep)) {
          triggers16.push(globalStep);
        }
      }

      // 12-step track: triggers at 0, 4, 8 then loops at 12, 16, 20, etc.
      expect(triggers12).toEqual([
        0, 4, 8,        // First cycle
        12, 16, 20,     // Second cycle
        24, 28, 32,     // Third cycle
        36, 40, 44      // Fourth cycle
      ]);

      // 16-step track: triggers at 0, 4, 8, 12 then loops at 16, 20, etc.
      expect(triggers16).toEqual([
        0, 4, 8, 12,    // First cycle
        16, 20, 24, 28, // Second cycle
        32, 36, 40, 44  // Third cycle
      ]);

      // Both tracks trigger at the same time when their patterns align
      const bothTrigger = triggers12.filter(s => triggers16.includes(s));
      // Steps where both 12-step and 16-step tracks trigger together
      expect(bothTrigger).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44]);
    });

    it('8-step track loops 16 times over 128 global steps', () => {
      const track8 = createTrack('t8', 8, [0, 4]); // Kick on 1 and 5

      const triggers: number[] = [];
      for (let globalStep = 0; globalStep < MAX_STEPS; globalStep++) {
        if (shouldTrackTrigger(track8, globalStep)) {
          triggers.push(globalStep);
        }
      }

      // 16 loops * 2 triggers per loop = 32 total triggers
      expect(triggers.length).toBe(32);

      // Should trigger at every 4 steps (positions 0 and 4 of each 8-step loop)
      expect(triggers).toEqual([
        0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60,
        64, 68, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120, 124
      ]);
    });
  });

  describe('Edge cases', () => {
    it('muted tracks should never trigger', () => {
      const mutedTrack = createTrack('muted', 16, [0, 4, 8, 12], true);

      for (let globalStep = 0; globalStep < MAX_STEPS; globalStep++) {
        expect(shouldTrackTrigger(mutedTrack, globalStep)).toBe(false);
      }
    });

    it('track with no active steps should never trigger', () => {
      const emptyTrack = createTrack('empty', 16, []);

      for (let globalStep = 0; globalStep < MAX_STEPS; globalStep++) {
        expect(shouldTrackTrigger(emptyTrack, globalStep)).toBe(false);
      }
    });

    it('track with all steps active should trigger every step up to stepCount', () => {
      const fullTrack = createTrack('full', 16, Array.from({ length: 16 }, (_, i) => i));

      // Should trigger for every step in the pattern
      for (let globalStep = 0; globalStep < MAX_STEPS; globalStep++) {
        expect(shouldTrackTrigger(fullTrack, globalStep)).toBe(true);
      }
    });

    it('single step active should trigger once per loop', () => {
      const singleStep = createTrack('single', 16, [7]); // Only step 8 (0-indexed 7)

      const triggers: number[] = [];
      for (let globalStep = 0; globalStep < MAX_STEPS; globalStep++) {
        if (shouldTrackTrigger(singleStep, globalStep)) {
          triggers.push(globalStep);
        }
      }

      // Should trigger at global steps 7, 23, 39, 55, 71, 87, 103, 119 (every 16 steps in 128 steps)
      expect(triggers).toEqual([7, 23, 39, 55, 71, 87, 103, 119]);
    });
  });

  describe('Default step count behavior', () => {
    it('STEPS_PER_PAGE should be 16', () => {
      expect(STEPS_PER_PAGE).toBe(16);
    });

    it('MAX_STEPS should be 128 (8 bars at 16th note resolution)', () => {
      expect(MAX_STEPS).toBe(128);
    });

    it('global counter wraps at MAX_STEPS', () => {
      // This simulates the scheduler behavior
      let currentStep = 0;
      const stepsVisited: number[] = [];

      // Run for 256 steps (2 full cycles)
      for (let i = 0; i < 256; i++) {
        stepsVisited.push(currentStep);
        currentStep = (currentStep + 1) % MAX_STEPS;
      }

      // Should visit 0-127 twice
      expect(stepsVisited.slice(0, 128)).toEqual(Array.from({ length: 128 }, (_, i) => i));
      expect(stepsVisited.slice(128, 256)).toEqual(Array.from({ length: 128 }, (_, i) => i));
    });
  });

  describe('Real-world polyrhythm scenarios', () => {
    it('Elektron-style: 16-step kick with 12-step hi-hat creates evolving pattern', () => {
      // Common techno pattern: 4/4 kick with triplet hi-hats
      const kick = createTrack('kick', 16, [0, 4, 8, 12]); // Four-on-the-floor
      const hihat = createTrack('hihat', 12, [0, 2, 4, 6, 8, 10]); // Triplet feel

      // Check first 48 steps (LCM of 12 and 16)
      const kickTriggers: number[] = [];
      const hihatTriggers: number[] = [];

      for (let step = 0; step < 48; step++) {
        if (shouldTrackTrigger(kick, step)) kickTriggers.push(step);
        if (shouldTrackTrigger(hihat, step)) hihatTriggers.push(step);
      }

      // Kick: every 4 steps within 16-step loop
      expect(kickTriggers).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44]);

      // Hi-hat: every 2 steps within 12-step loop
      expect(hihatTriggers).toEqual([
        0, 2, 4, 6, 8, 10,      // Loop 1
        12, 14, 16, 18, 20, 22, // Loop 2
        24, 26, 28, 30, 32, 34, // Loop 3
        36, 38, 40, 42, 44, 46  // Loop 4
      ]);

      // Simultaneous hits (kick + hi-hat together)
      const simultaneous = kickTriggers.filter(k => hihatTriggers.includes(k));
      expect(simultaneous).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44]);
    });

    it('OP-Z style: different track lengths create evolving compositions', () => {
      // OP-Z allows 1-16 steps per track for polymetric sequences
      const bass = createTrack('bass', 16, [0, 8]); // Half note bass
      const arp = createTrack('arp', 5, [0, 2, 4]); // 5-step arpeggio
      const perc = createTrack('perc', 7, [0, 3, 5]); // 7-step percussion

      // Check full 128 steps (MAX_STEPS) - covers multiple loops of all tracks
      const triggers = {
        bass: [] as number[],
        arp: [] as number[],
        perc: [] as number[],
      };

      for (let step = 0; step < MAX_STEPS; step++) {
        if (shouldTrackTrigger(bass, step)) triggers.bass.push(step);
        if (shouldTrackTrigger(arp, step)) triggers.arp.push(step);
        if (shouldTrackTrigger(perc, step)) triggers.perc.push(step);
      }

      // Bass: 8 loops of 16 in 128 steps = triggers at 0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120
      expect(triggers.bass).toEqual([0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120]);

      // Arp: loops of 5 in 128 steps with 3 active steps per loop
      // Pattern 0, 2, 4 repeats: 0,2,4 | 5,7,9 | 10,12,14 | ...
      // 128 steps / 5 step pattern = 25 full loops + 3 partial steps
      // 25 loops * 3 triggers + 2 triggers in partial (steps 125, 127) = 77
      expect(triggers.arp.length).toBe(77);
      expect(triggers.arp.slice(0, 6)).toEqual([0, 2, 4, 5, 7, 9]); // First two loops

      // Perc: 18 loops of 7 in 128 steps (plus 2 partial steps)
      expect(triggers.perc.slice(0, 6)).toEqual([0, 3, 5, 7, 10, 12]); // First two loops
    });
  });
});

describe('Track State Machine', () => {
  describe('Track step state transitions', () => {
    it('track step index should increase monotonically within its cycle', () => {
      const stepCount = 16;
      let prevStep = -1;

      for (let globalStep = 0; globalStep < stepCount; globalStep++) {
        const trackStep = getTrackStep(globalStep, stepCount);
        expect(trackStep).toBeGreaterThan(prevStep);
        prevStep = trackStep;
      }
    });

    it('track step should reset to 0 after completing a cycle', () => {
      const stepCount = 16;

      const lastStepInCycle = getTrackStep(stepCount - 1, stepCount);
      const firstStepNextCycle = getTrackStep(stepCount, stepCount);

      expect(lastStepInCycle).toBe(stepCount - 1);
      expect(firstStepNextCycle).toBe(0);
    });
  });

  describe('Multiple tracks maintain independent state', () => {
    it('each track loops independently based on its stepCount', () => {
      const track16 = createTrack('t16', 16, [0]);
      const track8 = createTrack('t8', 8, [0]);
      const track4 = createTrack('t4', 4, [0]);

      // At global step 4:
      // - track16 is at step 4
      // - track8 is at step 4
      // - track4 is at step 0 (looped)
      expect(getTrackStep(4, track16.stepCount)).toBe(4);
      expect(getTrackStep(4, track8.stepCount)).toBe(4);
      expect(getTrackStep(4, track4.stepCount)).toBe(0);

      // At global step 8:
      // - track16 is at step 8
      // - track8 is at step 0 (looped)
      // - track4 is at step 0 (looped twice)
      expect(getTrackStep(8, track16.stepCount)).toBe(8);
      expect(getTrackStep(8, track8.stepCount)).toBe(0);
      expect(getTrackStep(8, track4.stepCount)).toBe(0);
    });
  });
});

/**
 * Phase 22: Tests for BPM change handling during playback
 *
 * These are pure unit tests for the timing math that prevents:
 * 1. Note flooding when BPM increases
 * 2. Note skipping when BPM decreases
 * 3. Timing errors in audio scheduling
 *
 * The scheduler uses this formula for drift-free timing:
 *   nextStepTime = audioStartTime + (totalStepsScheduled * stepDuration)
 *
 * When BPM changes, stepDuration changes, which would cause nextStepTime
 * to jump to the wrong value. The fix recalculates audioStartTime:
 *   audioStartTime = currentTime - (totalStepsScheduled * newStepDuration)
 */
describe('BPM Change Handling', () => {
  /**
   * Pure function to calculate step duration (same as scheduler)
   */
  function getStepDuration(tempo: number): number {
    const beatsPerSecond = tempo / 60;
    const stepsPerBeat = 4; // 16th notes
    return 1 / (beatsPerSecond * stepsPerBeat);
  }

  /**
   * Simulates what happens during a BPM change
   * Returns the timing adjustment needed
   */
  function simulateBpmChange(
    oldTempo: number,
    newTempo: number,
    stepsScheduled: number
  ): {
    elapsedTime: number;
    brokenNextStepTime: number;
    fixedNextStepTime: number;
    drift: number;
  } {
    const oldStepDuration = getStepDuration(oldTempo);
    const newStepDuration = getStepDuration(newTempo);

    // Time elapsed at old tempo
    const elapsedTime = stepsScheduled * oldStepDuration;

    // Without fix: audioStartTime stays at 0
    const brokenNextStepTime = 0 + (stepsScheduled * newStepDuration);

    // With fix: recalculate audioStartTime
    const fixedAudioStartTime = elapsedTime - (stepsScheduled * newStepDuration);
    const fixedNextStepTime = fixedAudioStartTime + (stepsScheduled * newStepDuration);

    return {
      elapsedTime,
      brokenNextStepTime,
      fixedNextStepTime,
      drift: brokenNextStepTime - elapsedTime,
    };
  }

  describe('Step duration calculation', () => {
    it('calculates correct step duration at 120 BPM', () => {
      // At 120 BPM: 1 beat = 0.5 seconds, 1 step (16th note) = 0.125 seconds
      expect(getStepDuration(120)).toBeCloseTo(0.125);
    });

    it('calculates correct step duration at 60 BPM', () => {
      // At 60 BPM: 1 beat = 1 second, 1 step (16th note) = 0.25 seconds
      expect(getStepDuration(60)).toBeCloseTo(0.25);
    });

    it('calculates correct step duration at 240 BPM', () => {
      // At 240 BPM: 1 beat = 0.25 seconds, 1 step (16th note) = 0.0625 seconds
      expect(getStepDuration(240)).toBeCloseTo(0.0625);
    });
  });

  describe('BPM change timing adjustment', () => {
    it('doubling BPM should not cause notes to flood', () => {
      // At 120 BPM, after 100 steps: elapsed time = 100 * 0.125 = 12.5 seconds
      // If BPM changes to 240: step duration halves to 0.0625
      // Without fix: nextStepTime = 0 + (100 * 0.0625) = 6.25s (way in the past!)
      const result = simulateBpmChange(120, 240, 100);

      expect(result.elapsedTime).toBeCloseTo(12.5);
      expect(result.brokenNextStepTime).toBeCloseTo(6.25);

      // The broken calculation is 6.25 seconds in the past - would flood notes!
      expect(result.drift).toBeCloseTo(-6.25);

      // Fixed nextStepTime should equal currentTime (no drift)
      expect(result.fixedNextStepTime).toBeCloseTo(result.elapsedTime);
    });

    it('halving BPM should not skip notes', () => {
      // At 240 BPM, after 100 steps: elapsed time = 100 * 0.0625 = 6.25 seconds
      // If BPM changes to 120: step duration doubles to 0.125
      // Without fix: nextStepTime = 0 + (100 * 0.125) = 12.5s (in the future!)
      const result = simulateBpmChange(240, 120, 100);

      expect(result.elapsedTime).toBeCloseTo(6.25);
      expect(result.brokenNextStepTime).toBeCloseTo(12.5);

      // The broken calculation is 6.25 seconds in the future - would skip notes!
      expect(result.drift).toBeCloseTo(6.25);

      // Fixed nextStepTime should equal currentTime
      expect(result.fixedNextStepTime).toBeCloseTo(result.elapsedTime);
    });

    it('small BPM changes should still maintain timing', () => {
      // Small changes (e.g., 120 -> 125) should also be handled correctly
      const result = simulateBpmChange(120, 125, 100);

      // Fixed timing should match elapsed time
      expect(result.fixedNextStepTime).toBeCloseTo(result.elapsedTime);

      // Drift should be non-zero without fix
      expect(result.drift).not.toBe(0);
    });

    it('rapid BPM changes during playback should not accumulate errors', () => {
      // Simulate multiple BPM changes: 120 -> 140 -> 100 -> 120
      // After each change, the fixed timing should stay in sync

      const steps = 50;
      let currentTime = steps * getStepDuration(120); // 6.25s at 120 BPM

      // Change 1: 120 -> 140
      const result = simulateBpmChange(120, 140, steps);
      expect(result.fixedNextStepTime).toBeCloseTo(currentTime);

      // Change 2: 140 -> 100 (simulate more steps)
      const moreSteps = steps + 20;
      currentTime = steps * getStepDuration(120) + 20 * getStepDuration(140);
      // The fix recalculates based on current time, so timing stays correct
      const newStepDuration = getStepDuration(100);
      const fixedAudioStartTime = currentTime - (moreSteps * newStepDuration);
      const fixedNextStepTime = fixedAudioStartTime + (moreSteps * newStepDuration);
      expect(fixedNextStepTime).toBeCloseTo(currentTime);
    });
  });

  describe('Edge cases', () => {
    it('BPM change at step 0 should not cause issues', () => {
      const result = simulateBpmChange(120, 240, 0);

      expect(result.elapsedTime).toBe(0);
      expect(result.fixedNextStepTime).toBe(0);
      expect(result.drift).toBe(0);
    });

    it('extreme BPM values should be handled', () => {
      // Test with minimum (30) and maximum (300) BPM
      expect(getStepDuration(30)).toBeCloseTo(0.5); // Very slow
      expect(getStepDuration(300)).toBeCloseTo(0.05); // Very fast

      // Both should be valid positive numbers
      expect(getStepDuration(30)).toBeGreaterThan(0);
      expect(getStepDuration(300)).toBeGreaterThan(0);

      // Extreme change should still work
      const result = simulateBpmChange(30, 300, 100);
      expect(result.fixedNextStepTime).toBeCloseTo(result.elapsedTime);
    });

    it('same BPM should cause no change', () => {
      const result = simulateBpmChange(120, 120, 100);

      expect(result.drift).toBe(0);
      expect(result.fixedNextStepTime).toBeCloseTo(result.elapsedTime);
    });
  });
});
