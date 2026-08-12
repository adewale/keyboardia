/**
 * Shared Validation Utilities
 *
 * Consolidated validation logic for common patterns across the codebase.
 * Use these functions instead of inline Math.max/min patterns and
 * .trim().slice() sanitization.
 *
 * TASK-003 from DUPLICATION-REMEDIATION-PLAN.md
 */

import {
  clamp,
  MIN_VOLUME,
  MAX_VOLUME,
  MIN_PAN,
  MAX_PAN,
} from './constants';

// Re-export clamp from constants (single source of truth)
export { clamp };

// =============================================================================
// Name Sanitization
// =============================================================================

/** Maximum length for session names */
export const MAX_SESSION_NAME_LENGTH = 100;

/** Maximum length for track names */
export const MAX_TRACK_NAME_LENGTH = 32;

/**
 * Sanitize a session name for storage/display.
 * - Trims whitespace
 * - Truncates to max length
 * - Returns null for empty strings
 *
 * @param name The raw name input
 * @param maxLength Maximum allowed length (default: 100)
 * @returns Sanitized name or null if empty
 */
export function sanitizeSessionName(
  name: string | null | undefined,
  maxLength = MAX_SESSION_NAME_LENGTH
): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * Sanitize a track name for storage/display.
 * - Trims whitespace
 * - Truncates to max length
 * - Returns empty string for null/undefined (tracks always have a name)
 *
 * @param name The raw name input
 * @param maxLength Maximum allowed length (default: 32)
 * @returns Sanitized name
 */
export function sanitizeTrackName(
  name: string | null | undefined,
  maxLength = MAX_TRACK_NAME_LENGTH
): string {
  if (!name) return '';
  return name.trim().slice(0, maxLength);
}

/**
 * Validates that a value is a valid number (not NaN, not Infinity).
 *
 * @param value Value to validate
 * @returns Type guard for valid number
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Public pan payloads are normalized finite numbers; transports reject bad input. */
export function isValidPan(value: unknown): value is number {
  return isValidNumber(value) && value >= MIN_PAN && value <= MAX_PAN;
}

// =============================================================================
// Domain-Specific Clamps
// =============================================================================

/**
 * Clamp velocity to valid range (0-100).
 * Used in VelocityLane and parameter locks.
 */
export function clampVelocity(velocity: number): number {
  return clamp(velocity, 0, 100);
}

/**
 * Clamp volume to valid range (0-1).
 * Used in track volume controls.
 */
export function clampVolume(volume: number): number {
  return clamp(volume, MIN_VOLUME, MAX_VOLUME);
}

/**
 * Clamp pan to valid range (-1 to 1).
 * Used in track pan controls.
 */
export function clampPan(pan: number): number {
  return clamp(pan, MIN_PAN, MAX_PAN);
}

/**
 * Clamp gain/boost value to 0-2 range.
 * Used for audio gain that can boost above unity.
 */
export function clampGain(gain: number): number {
  return clamp(gain, 0, 2);
}
