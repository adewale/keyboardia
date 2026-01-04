/**
 * Shared Constants
 *
 * Constants used by both client and server code.
 * Import from here to ensure consistency across the codebase.
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for these values.
 * Do not duplicate these constants elsewhere.
 */

// =============================================================================
// Message Size Limits
// =============================================================================

// Maximum WebSocket/HTTP message size (64KB)
// Server rejects messages exceeding this limit.
// Client should validate before sending to fail fast with a clear error.
export const MAX_MESSAGE_SIZE = 64 * 1024;

// =============================================================================
// Track Limits
// =============================================================================

export const MAX_TRACKS = 16;
export const MAX_STEPS = 128;
export const STEPS_PER_PAGE = 16;
export const DEFAULT_STEP_COUNT = 16;

// =============================================================================
// Tempo Constraints (BPM)
// =============================================================================

export const MIN_TEMPO = 60;
export const MAX_TEMPO = 180;
export const DEFAULT_TEMPO = 120;

// =============================================================================
// Swing Constraints (percentage 0-100)
// =============================================================================

export const MIN_SWING = 0;
export const MAX_SWING = 100;
export const DEFAULT_SWING = 0;

// =============================================================================
// Volume Constraints
// =============================================================================

export const MIN_VOLUME = 0;
export const MAX_VOLUME = 1;

// =============================================================================
// Transpose Constraints (semitones)
// =============================================================================

export const MIN_TRANSPOSE = -24;  // 2 octaves down
export const MAX_TRANSPOSE = 24;   // 2 octaves up (4 octaves total range)

// =============================================================================
// Parameter Lock Constraints
// =============================================================================

export const MIN_PLOCK_PITCH = -24;
export const MAX_PLOCK_PITCH = 24;
export const MIN_PLOCK_VOLUME = 0;
export const MAX_PLOCK_VOLUME = 1;

// =============================================================================
// Cursor Position Bounds (percentage 0-100)
// =============================================================================

export const MIN_CURSOR_POSITION = 0;
export const MAX_CURSOR_POSITION = 100;

// =============================================================================
// Effect Parameter Bounds
// =============================================================================

export const REVERB_MIN_DECAY = 0.1;
export const REVERB_MAX_DECAY = 10;
export const DELAY_MAX_FEEDBACK = 0.95;
export const CHORUS_MIN_FREQUENCY = 0.1;
export const CHORUS_MAX_FREQUENCY = 10;

// =============================================================================
// Utility Function
// =============================================================================

/**
 * Clamp a value to a range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
