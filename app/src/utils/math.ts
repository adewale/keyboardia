/**
 * Math utility functions - consolidated from duplicated implementations
 */

/**
 * Clamp a value to a given range
 * @param value The value to clamp
 * @param min Minimum allowed value
 * @param max Maximum allowed value
 * @returns The clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
