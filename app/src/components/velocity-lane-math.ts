/**
 * Pure velocity maths for the velocity lane.
 *
 * Split out of VelocityLane.tsx so it can be imported by tests. The component
 * cannot be imported from a node-env test (its module graph reaches the audio
 * engine, which reads `window` at load), and VelocityLane.test.ts previously
 * worked around that by keeping its own copies of these four functions. Those
 * copies happened to still match production, but nothing kept them that way —
 * the same pattern in TrackRow.test.ts had drifted and was masking a real bug.
 */
import { clampVelocity } from '../shared/validation';

/** Bar height in px; velocity maps linearly over this range. */
export const BAR_HEIGHT = 40;

/** Visual banding for a velocity value. */
export function getVelocityLevel(velocity: number): 'extreme-low' | 'normal' | 'extreme-high' {
  if (velocity < 20) return 'extreme-low';
  if (velocity > 80) return 'extreme-high';
  return 'normal';
}

/** Velocity from a mouse Y offset within a step element. Top = 100%, bottom = 0%. */
export function calculateVelocityFromY(y: number, elementHeight: number = BAR_HEIGHT): number {
  const velocity = Math.round((1 - y / elementHeight) * 100);
  return clampVelocity(velocity);
}

/** Velocity for a step, from its parameter lock or the 100% default. */
export function getVelocityFromLock(lock: { volume?: number } | null): number {
  if (lock?.volume !== undefined) {
    return Math.round(lock.volume * 100);
  }
  return 100;
}

/**
 * The parameter lock a velocity change should produce.
 *
 * Returns null when velocity is 100% and there is no pitch or tie to preserve —
 * that clears the lock rather than storing a redundant volume: 1.
 */
export function computeVelocityLock(
  velocity: number,
  existingLock: { volume?: number; pitch?: number; tie?: boolean } | null
): { volume: number; pitch?: number; tie?: boolean } | null {
  const clampedVel = clampVelocity(velocity);
  if (clampedVel === 100 && !existingLock?.pitch && !existingLock?.tie) {
    return null;
  }
  return { ...existingLock, volume: clampedVel / 100 };
}
