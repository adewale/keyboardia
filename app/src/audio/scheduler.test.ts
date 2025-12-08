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
    playbackMode: 'oneshot',
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

    it('8-step track loops 8 times over 64 global steps', () => {
      const track8 = createTrack('t8', 8, [0, 4]); // Kick on 1 and 5

      const triggers: number[] = [];
      for (let globalStep = 0; globalStep < MAX_STEPS; globalStep++) {
        if (shouldTrackTrigger(track8, globalStep)) {
          triggers.push(globalStep);
        }
      }

      // 8 loops * 2 triggers per loop = 16 total triggers
      expect(triggers.length).toBe(16);

      // Should trigger at 0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60
      expect(triggers).toEqual([
        0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60
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

      // Should trigger at global steps 7, 23, 39, 55 (every 16 steps)
      expect(triggers).toEqual([7, 23, 39, 55]);
    });
  });

  describe('Default step count behavior', () => {
    it('STEPS_PER_PAGE should be 16', () => {
      expect(STEPS_PER_PAGE).toBe(16);
    });

    it('MAX_STEPS should be 64', () => {
      expect(MAX_STEPS).toBe(64);
    });

    it('global counter wraps at MAX_STEPS', () => {
      // This simulates the scheduler behavior
      let currentStep = 0;
      const stepsVisited: number[] = [];

      // Run for 128 steps (2 full cycles)
      for (let i = 0; i < 128; i++) {
        stepsVisited.push(currentStep);
        currentStep = (currentStep + 1) % MAX_STEPS;
      }

      // Should visit 0-63 twice
      expect(stepsVisited.slice(0, 64)).toEqual(Array.from({ length: 64 }, (_, i) => i));
      expect(stepsVisited.slice(64, 128)).toEqual(Array.from({ length: 64 }, (_, i) => i));
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

      // Check first 64 steps (beyond any single track's length)
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

      // Bass: 4 loops of 16 = triggers at 0, 8, 16, 24, 32, 40, 48, 56
      expect(triggers.bass).toEqual([0, 8, 16, 24, 32, 40, 48, 56]);

      // Arp: loops of 5 in 64 steps with 3 active steps per loop
      // Pattern 0, 2, 4 repeats: 0,2,4 | 5,7,9 | 10,12,14 | ...
      // 64 steps / 5 step pattern = 12 full loops + 4 partial steps
      // 12 loops * 3 triggers + 2 triggers in partial (steps 60,62) = 38
      expect(triggers.arp.length).toBe(38);
      expect(triggers.arp.slice(0, 6)).toEqual([0, 2, 4, 5, 7, 9]); // First two loops

      // Perc: 9 loops of 7 in 64 steps (plus partial)
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
