/**
 * Playhead Index Utilities
 *
 * Provides safe step index calculations for UI components that display
 * playhead position. Handles the boundary wrapping issue where currentStep
 * (0-127) must map to a component's local step range (0 to stepCount-1).
 *
 * @see bug-patterns.ts#step-index-boundary-wrapping
 */

import { MAX_STEPS } from '../types';

/**
 * Calculate the playhead index for a UI component.
 *
 * The global scheduler's currentStep cycles through 0-127 (MAX_STEPS).
 * When a component displays fewer steps (e.g., 16), we need to wrap
 * currentStep to the component's range.
 *
 * @param currentStep - The global scheduler step (0 to MAX_STEPS-1)
 * @param maxStepCount - The component's step count (1 to MAX_STEPS)
 * @returns The wrapped index in range [0, maxStepCount)
 *
 * @example
 * // 16-step track, scheduler at step 16 -> should highlight step 0
 * getPlayheadIndex(16, 16) // returns 0
 *
 * @example
 * // 64-step track, scheduler at step 80 -> should highlight step 16
 * getPlayheadIndex(80, 64) // returns 16
 *
 * @example
 * // 128-step track (full), no wrapping needed
 * getPlayheadIndex(100, 128) // returns 100
 */
export function getPlayheadIndex(currentStep: number, maxStepCount: number): number {
  // Guard against invalid maxStepCount (division by zero)
  if (maxStepCount <= 0) {
    return 0;
  }

  // Clamp maxStepCount to valid range
  const clampedMax = Math.min(maxStepCount, MAX_STEPS);

  // Handle negative currentStep (shouldn't happen, but be safe)
  // Using double-modulo pattern: ((a % b) + b) % b ensures positive result
  return ((currentStep % clampedMax) + clampedMax) % clampedMax;
}

/**
 * Check if a specific step index should be highlighted as "playing".
 *
 * Convenience function that combines the playhead calculation with
 * the isPlaying check that's common in UI components.
 *
 * @param stepIndex - The step index in the UI (0-based)
 * @param currentStep - The global scheduler step
 * @param maxStepCount - The component's step count
 * @param isPlaying - Whether playback is active
 * @returns true if this step should show the playhead indicator
 *
 * @example
 * // In a component's render:
 * className={`step ${isStepPlaying(i, currentStep, stepCount, isPlaying) ? 'playing' : ''}`}
 */
export function isStepPlaying(
  stepIndex: number,
  currentStep: number,
  maxStepCount: number,
  isPlaying: boolean
): boolean {
  if (!isPlaying || currentStep < 0) {
    return false;
  }
  return getPlayheadIndex(currentStep, maxStepCount) === stepIndex;
}

/**
 * Calculate playhead position as a percentage (for progress bars).
 *
 * @param currentStep - The global scheduler step
 * @param maxStepCount - The component's step count
 * @param isPlaying - Whether playback is active
 * @returns Percentage (0-100) or 0 if not playing
 *
 * @example
 * // Progress bar width
 * style={{ width: `${getPlayheadPercent(currentStep, stepCount, isPlaying)}%` }}
 */
export function getPlayheadPercent(
  currentStep: number,
  maxStepCount: number,
  isPlaying: boolean
): number {
  if (!isPlaying || currentStep < 0 || maxStepCount <= 0) {
    return 0;
  }
  const index = getPlayheadIndex(currentStep, maxStepCount);
  return (index / maxStepCount) * 100;
}
