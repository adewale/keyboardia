/**
 * Pure Timing Calculations for Audio Scheduling
 *
 * ABSTRACTION: Extracted from Scheduler to enable direct property-based testing.
 * These functions have no side effects and can be tested independently of the
 * Web Audio API.
 *
 * Timing values use nominal units so seconds cannot be confused with absolute
 * AudioContext time at compile time.
 */

import {
  audioTime,
  beats,
  beatsToSeconds,
  seconds,
  stepIndex as checkedStepIndex,
  steps,
  stepsToSeconds,
  type AudioTime,
  type Seconds,
} from './audio-time';

/** Steps per beat (16th notes) */
export const STEPS_PER_BEAT = 4;

/**
 * Swing delay factor - the proportion of step duration to delay swung notes.
 * At 0.5, a fully-swung step is delayed by half a step duration (triplet feel).
 */
export const SWING_DELAY_FACTOR = 0.5;

/**
 * Calculate step duration in seconds.
 *
 * @param tempo - Tempo in BPM (60-180)
 * @returns Duration of one step in seconds
 *
 * Property: duration decreases as tempo increases (AU-001a)
 * Property: duration is always positive (AU-001b)
 */
export function getStepDuration(tempo: number): Seconds {
  return stepsToSeconds(steps(1), tempo, STEPS_PER_BEAT);
}

/**
 * Calculate swing delay for a step.
 *
 * Swing delays odd-numbered steps (1, 3, 5...) by a fraction of the step duration.
 * Uses the swing blending formula: globalSwing + trackSwing - globalSwing * trackSwing
 *
 * @param step - Current step index
 * @param globalSwing - Global swing amount (0-1)
 * @param trackSwing - Per-track swing amount (0-1)
 * @param stepDuration - Duration of one step in seconds
 * @returns Delay in seconds to apply to this step
 *
 * Property: even steps have zero delay (AU-002a)
 * Property: delay is always non-negative (AU-002b)
 */
export function calculateSwingDelay(
  step: number,
  globalSwing: number,
  trackSwing: number,
  stepDuration: Seconds
): Seconds {
  // Swing blending formula - combines global and track swing
  const swingAmount = globalSwing + trackSwing - globalSwing * trackSwing;
  const isSwungStep = step % 2 === 1;
  return seconds(isSwungStep ? stepDuration * swingAmount * SWING_DELAY_FACTOR : 0);
}

/**
 * Calculate absolute step time using drift-free formula.
 *
 * Uses integer step index multiplication to avoid floating-point drift
 * that accumulates when repeatedly adding step durations.
 *
 * @param audioStartTime - Web Audio context time when playback started
 * @param stepIndex - Global step index from start
 * @param tempo - Tempo in BPM
 * @returns Absolute time in seconds
 *
 * Property: later steps have later times (AU-001c)
 */
export function calculateStepTime(
  audioStartTime: Seconds,
  stepIndex: number,
  tempo: number
): AudioTime {
  const resolvedStepIndex = checkedStepIndex(stepIndex);
  const offset = beatsToSeconds(beats(resolvedStepIndex / STEPS_PER_BEAT), tempo);
  return audioTime(audioStartTime + offset);
}

/**
 * Advance the global step counter.
 *
 * Inside a loop region the counter wraps at the region's end. Without one it
 * never wraps: each track reads its position as `globalStep % stepCount`, so
 * every track loops at its own length for as long as playback runs. (A wrap at
 * 128 used to cut short every track whose length does not divide 128.)
 *
 * @param currentStep - Current step index
 * @param loopRegion - Optional loop region {start, end}
 * @returns Next step index
 *
 * Property: step is always within loop bounds (AU-003a)
 * Property: wraps correctly at loop end (AU-003b)
 */
export function advanceStep(
  currentStep: number,
  loopRegion: { start: number; end: number } | null,
): number {
  if (loopRegion && currentStep >= loopRegion.end) {
    return loopRegion.start;
  }
  return currentStep + 1;
}
