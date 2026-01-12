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
  MIN_TEMPO,
  MAX_TEMPO,
  MIN_SWING,
  MAX_SWING,
  MIN_VOLUME,
  MAX_VOLUME,
  MIN_TRANSPOSE,
  MAX_TRANSPOSE,
  MAX_STEPS,
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

// =============================================================================
// Step Index Validation
// =============================================================================

/**
 * Validates that a value is a valid step index (integer 0 to MAX_STEPS-1).
 *
 * @param step Value to validate
 * @returns Type guard for valid step index
 */
export function isValidStepIndex(step: unknown): step is number {
  return (
    typeof step === 'number' &&
    Number.isFinite(step) &&
    Number.isInteger(step) &&
    step >= 0 &&
    step < MAX_STEPS
  );
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
  return clamp(pan, -1, 1);
}

/**
 * Clamp tempo to valid range (MIN_TEMPO to MAX_TEMPO BPM).
 * Used in TransportBar and session creation.
 */
export function clampTempo(tempo: number): number {
  return clamp(tempo, MIN_TEMPO, MAX_TEMPO);
}

/**
 * Clamp swing to valid range (0-100%).
 * Used in TransportBar and track settings.
 */
export function clampSwing(swing: number): number {
  return clamp(swing, MIN_SWING, MAX_SWING);
}

/**
 * Clamp transpose to valid range (MIN_TRANSPOSE to MAX_TRANSPOSE semitones).
 * Used in track transpose controls.
 */
export function clampTranspose(transpose: number): number {
  return Math.round(clamp(transpose, MIN_TRANSPOSE, MAX_TRANSPOSE));
}

/**
 * Clamp a normalized value to 0-1 range.
 * Used for XY pad coordinates, filter cutoff, and other normalized parameters.
 */
export function clampNormalized(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Clamp gain/boost value to 0-2 range.
 * Used for audio gain that can boost above unity.
 */
export function clampGain(gain: number): number {
  return clamp(gain, 0, 2);
}

/**
 * Clamp step index to valid range for a given step count.
 * Returns -1 for invalid values.
 */
export function clampStepIndex(step: number, stepCount: number): number {
  if (!isValidNumber(step) || !Number.isInteger(step)) return -1;
  return clamp(step, 0, stepCount - 1);
}
