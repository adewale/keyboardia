/**
 * Pattern manipulation operations for 31B: Pattern Manipulation
 *
 * These operations work on step patterns (boolean arrays) and preserve
 * parameter locks during transformations.
 */

import type { ParameterLock } from '../shared/sync-types';

/**
 * Rotate pattern left: Step 0 → Step N-1, Step 1 → Step 0, etc.
 * Wraps around so no steps are lost.
 */
export function rotateLeft<T>(arr: T[], stepCount: number): T[] {
  if (stepCount <= 1) return arr;
  const result = [...arr];
  // Only rotate within the active step count
  const first = result[0];
  for (let i = 0; i < stepCount - 1; i++) {
    result[i] = result[i + 1];
  }
  result[stepCount - 1] = first;
  return result;
}

/**
 * Rotate pattern right: Step N-1 → Step 0, Step 0 → Step 1, etc.
 * Wraps around so no steps are lost.
 */
export function rotateRight<T>(arr: T[], stepCount: number): T[] {
  if (stepCount <= 1) return arr;
  const result = [...arr];
  // Only rotate within the active step count
  const last = result[stepCount - 1];
  for (let i = stepCount - 1; i > 0; i--) {
    result[i] = result[i - 1];
  }
  result[0] = last;
  return result;
}

/**
 * Invert pattern: Toggle all steps (active → inactive, inactive → active)
 * Only affects steps within stepCount.
 */
export function invertPattern(steps: boolean[], stepCount: number): boolean[] {
  const result = [...steps];
  for (let i = 0; i < stepCount; i++) {
    result[i] = !result[i];
  }
  return result;
}

/**
 * Reverse pattern: Play the pattern backwards
 * Step 0 ↔ Step N-1, Step 1 ↔ Step N-2, etc.
 * Parameter locks are also reversed.
 */
export function reversePattern<T>(arr: T[], stepCount: number): T[] {
  const result = [...arr];
  // Only reverse within the active step count
  for (let i = 0; i < Math.floor(stepCount / 2); i++) {
    const temp = result[i];
    result[i] = result[stepCount - 1 - i];
    result[stepCount - 1 - i] = temp;
  }
  return result;
}

/**
 * Mirror pattern: Create ABCDCBA structure from ABCD
 * First half defines pattern, second half mirrors it.
 * For step count N: steps 0...(N/2) are mirrored to (N/2)...N-1
 *
 * Examples:
 * - 4 steps: ABCD → ABBA (mirror around center)
 * - 8 steps: ABCDEFGH → ABCDDCBA
 * - Odd counts: center step stays, others mirror around it
 */
export function mirrorPattern<T>(arr: T[], stepCount: number): T[] {
  if (stepCount <= 2) return arr; // Too short to mirror meaningfully

  const result = [...arr];
  const midpoint = Math.floor(stepCount / 2);

  // Mirror: copy first half to second half in reverse
  for (let i = 0; i < midpoint; i++) {
    result[stepCount - 1 - i] = result[i];
  }

  return result;
}

/**
 * Bjorklund's algorithm for Euclidean rhythms
 * Distributes N hits across M steps as evenly as possible.
 *
 * Common patterns:
 * - E(3, 8) = Cuban tresillo: [X][ ][ ][X][ ][ ][X][ ]
 * - E(5, 8) = Cuban cinquillo: [X][ ][X][X][ ][X][X][ ]
 * - E(5, 16) = Bossa nova feel
 *
 * @param steps Total number of steps
 * @param hits Number of active steps to distribute
 * @returns Boolean array with hits distributed evenly
 */
export function euclidean(steps: number, hits: number): boolean[] {
  // Edge cases
  if (hits <= 0) return Array(steps).fill(false);
  if (hits >= steps) return Array(steps).fill(true);

  // Bjorklund's algorithm implementation
  // Build the pattern using the Euclidean algorithm for rhythm
  const pattern: boolean[] = [];

  // Start with groups: 'hits' groups of [true] and 'steps-hits' groups of [false]
  let groups: boolean[][] = [];
  for (let i = 0; i < hits; i++) {
    groups.push([true]);
  }
  for (let i = 0; i < steps - hits; i++) {
    groups.push([false]);
  }

  // Recursively distribute until we have one or two distinct group types
  while (true) {
    const lastGroupStart = groups.findIndex(
      (g, i) => i > 0 && JSON.stringify(g) !== JSON.stringify(groups[0])
    );

    if (lastGroupStart === -1 || lastGroupStart === groups.length - 1) {
      break;
    }

    // How many groups are different from the first?
    const numTail = groups.length - lastGroupStart;
    const numHead = lastGroupStart;
    const toMerge = Math.min(numHead, numTail);

    if (toMerge === 0) break;

    // Merge tail groups into head groups
    const newGroups: boolean[][] = [];
    for (let i = 0; i < toMerge; i++) {
      newGroups.push([...groups[i], ...groups[lastGroupStart + i]]);
    }
    // Add remaining head groups
    for (let i = toMerge; i < numHead; i++) {
      newGroups.push(groups[i]);
    }
    // Add remaining tail groups
    for (let i = lastGroupStart + toMerge; i < groups.length; i++) {
      newGroups.push(groups[i]);
    }

    groups = newGroups;
  }

  // Flatten groups into final pattern
  for (const group of groups) {
    pattern.push(...group);
  }

  return pattern;
}

/**
 * Apply Euclidean distribution to a track, preserving parameter locks
 * on steps that remain active.
 */
export function applyEuclidean(
  currentSteps: boolean[],
  currentLocks: (ParameterLock | null)[],
  stepCount: number,
  hits: number
): { steps: boolean[]; locks: (ParameterLock | null)[] } {
  const newPattern = euclidean(stepCount, hits);
  const newSteps = [...currentSteps];
  const newLocks = [...currentLocks];

  // Apply new pattern within stepCount
  for (let i = 0; i < stepCount; i++) {
    const wasActive = newSteps[i];
    const willBeActive = newPattern[i];
    newSteps[i] = willBeActive;

    // Clear lock if step becomes inactive
    if (wasActive && !willBeActive) {
      newLocks[i] = null;
    }
  }

  return { steps: newSteps, locks: newLocks };
}
