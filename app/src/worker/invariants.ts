/**
 * State Invariant Validation for Keyboardia
 *
 * These invariants must ALWAYS hold true. If violated, state corruption has occurred.
 * Use validateStateInvariants() after mutations and logInvariantStatus() in production.
 */

import type { SessionState, SessionTrack } from './types';
import type { ParameterLock } from '../shared/sync-types';

// Re-export all constants from canonical source (shared/constants.ts)
// This maintains backwards compatibility for existing imports from worker/invariants.ts
export {
  MAX_MESSAGE_SIZE,
  MAX_TRACKS,
  MAX_STEPS,
  MIN_TEMPO,
  MAX_TEMPO,
  MIN_SWING,
  MAX_SWING,
  MIN_VOLUME,
  MAX_VOLUME,
  MIN_TRANSPOSE,
  MAX_TRANSPOSE,
  clamp,
} from '../shared/constants';

// Import for local use
import {
  MAX_TRACKS,
  MAX_STEPS,
  DEFAULT_STEP_COUNT,
  MIN_TEMPO,
  MAX_TEMPO,
  MIN_SWING,
  MAX_SWING,
  MIN_VOLUME,
  MAX_VOLUME,
  MIN_PLOCK_PITCH,
  MAX_PLOCK_PITCH,
  MIN_PLOCK_VOLUME,
  MAX_PLOCK_VOLUME,
  MIN_CURSOR_POSITION,
  MAX_CURSOR_POSITION,
  clamp,
} from '../shared/constants';

// Valid delay time notations (Tone.js format)
// Full set for server-side validation. UI only exposes a subset (see src/audio/delay-constants.ts).
// Extended values ('2t', '1n', '1m', '2m', '4m') support API clients and future UI expansion.
export const VALID_DELAY_TIMES = new Set([
  '32n', '16n', '16t', '8n', '8t', '4n', '4t', '2n', '2t', '1n', '1m', '2m', '4m',
]);

/**
 * Check if a value is a valid number within bounds.
 *
 * NOTE: This is distinct from shared/validation.ts isValidNumber() which only
 * checks if a value is a finite number (no bounds check).
 */
export function isValidNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value) && value >= min && value <= max;
}

/** Validate a discrete array/playhead index rather than a continuous value. */
export function isValidIntegerInRange(value: unknown, min: number, max: number): value is number {
  return isValidNumberInRange(value, min, max) && Number.isInteger(value);
}

/**
 * Phase 26 BUG-10: Validate and sanitize a parameter lock
 *
 * ABSTRACTION FIX (VA-004): Preserves valid fields even if others are invalid.
 * Previously, one invalid field caused the entire lock to be rejected, losing
 * valid data. Now we use field-level validation with partial preservation.
 *
 * Returns null if the lock is invalid or empty (no valid fields).
 * Returns sanitized lock with clamped values for valid fields.
 * Invalid fields are silently dropped (not propagated).
 */
export function validateParameterLock(lock: unknown): ParameterLock | null {
  // null/undefined is valid (clearing a lock)
  if (lock === null || lock === undefined) {
    return null;
  }

  // Must be an object
  if (typeof lock !== 'object' || Array.isArray(lock)) {
    return null;
  }

  const input = lock as Record<string, unknown>;
  const result: ParameterLock = {};
  let hasValidField = false;

  // Validate pitch - invalid pitch is DROPPED, not rejected
  if (input.pitch !== undefined) {
    if (typeof input.pitch === 'number' && !isNaN(input.pitch) && isFinite(input.pitch)) {
      result.pitch = clamp(input.pitch, MIN_PLOCK_PITCH, MAX_PLOCK_PITCH);
      hasValidField = true;
    }
    // Invalid pitch is silently dropped, preserving other valid fields
  }

  // Validate volume - invalid volume is DROPPED, not rejected
  if (input.volume !== undefined) {
    if (typeof input.volume === 'number' && !isNaN(input.volume) && isFinite(input.volume)) {
      result.volume = clamp(input.volume, MIN_PLOCK_VOLUME, MAX_PLOCK_VOLUME);
      hasValidField = true;
    }
    // Invalid volume is silently dropped, preserving other valid fields
  }

  // Validate tie (Phase 29B: Held Notes) - invalid tie is DROPPED, not rejected
  if (input.tie !== undefined) {
    if (typeof input.tie === 'boolean') {
      result.tie = input.tie;
      hasValidField = true;
    }
    // Invalid tie is silently dropped, preserving other valid fields
  }

  // Return null if no valid fields (empty lock)
  return hasValidField ? result : null;
}

/**
 * Cursor position interface (matches shared/player.ts)
 */
export interface CursorPosition {
  x: number;
  y: number;
  trackId?: string;
  step?: number;
}

/**
 * Validate and sanitize cursor position
 *
 * Clamps x/y to valid percentage range [0, 100].
 * Returns null if position is fundamentally invalid (not an object, non-numeric coordinates).
 * This prevents malicious clients from sending extreme values that could cause
 * layout issues or memory problems on other clients.
 */
export function validateCursorPosition(position: unknown): CursorPosition | null {
  // Must be an object
  if (!position || typeof position !== 'object' || Array.isArray(position)) {
    return null;
  }

  const input = position as Record<string, unknown>;

  // x and y are required and must be numbers
  if (typeof input.x !== 'number' || !isFinite(input.x)) {
    return null;
  }
  if (typeof input.y !== 'number' || !isFinite(input.y)) {
    return null;
  }

  // Clamp to valid range
  const result: CursorPosition = {
    x: clamp(input.x, MIN_CURSOR_POSITION, MAX_CURSOR_POSITION),
    y: clamp(input.y, MIN_CURSOR_POSITION, MAX_CURSOR_POSITION),
  };

  // Optional trackId (must be string if present)
  if (input.trackId !== undefined) {
    if (typeof input.trackId === 'string') {
      result.trackId = input.trackId;
    }
    // Silently ignore non-string trackId
  }

  // Optional step (must be non-negative integer if present)
  if (input.step !== undefined) {
    if (typeof input.step === 'number' && isFinite(input.step) && input.step >= 0) {
      result.step = Math.floor(input.step);
    }
    // Silently ignore invalid step
  }

  return result;
}

export interface InvariantResult {
  valid: boolean;
  violations: string[];
  warnings: string[];
}

/**
 * Check for duplicate track IDs - CRITICAL invariant
 */
function checkNoDuplicateTrackIds(tracks: SessionTrack[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const track of tracks) {
    if (seen.has(track.id)) {
      violations.push(`Duplicate track ID: ${track.id}`);
    }
    seen.add(track.id);
  }

  return violations;
}

/**
 * Check track count is within limit
 */
function checkTrackCountWithinLimit(tracks: SessionTrack[]): string[] {
  if (tracks.length > MAX_TRACKS) {
    return [`Track count ${tracks.length} exceeds maximum ${MAX_TRACKS}`];
  }
  return [];
}

/**
 * Check tempo is within bounds
 */
function checkTempoWithinBounds(tempo: number): string[] {
  // `tempo < MIN || tempo > MAX` is FALSE for NaN, so the previous version
  // reported a non-finite tempo as valid — the one value most worth catching
  // here, since this function is the storage boundary's second opinion.
  if (!isValidNumberInRange(tempo, MIN_TEMPO, MAX_TEMPO)) {
    return [`Tempo ${tempo} is outside valid range [${MIN_TEMPO}, ${MAX_TEMPO}]`];
  }
  return [];
}

/**
 * Check swing is within bounds
 */
function checkSwingWithinBounds(swing: number): string[] {
  // Comparison operators are NaN-false; see checkTempoWithinBounds.
  if (!isValidNumberInRange(swing, MIN_SWING, MAX_SWING)) {
    return [`Swing ${swing} is outside valid range [${MIN_SWING}, ${MAX_SWING}]`];
  }
  return [];
}

/**
 * Check all tracks have valid arrays
 */
function checkTracksHaveValidArrays(tracks: SessionTrack[]): string[] {
  const violations: string[] = [];

  for (const track of tracks) {
    if (!Array.isArray(track.steps)) {
      violations.push(`Track ${track.id}: steps is not an array`);
    } else if (track.steps.length !== MAX_STEPS) {
      violations.push(`Track ${track.id}: steps length ${track.steps.length} !== ${MAX_STEPS}`);
    }

    if (!Array.isArray(track.parameterLocks)) {
      violations.push(`Track ${track.id}: parameterLocks is not an array`);
    } else if (track.parameterLocks.length !== MAX_STEPS) {
      violations.push(`Track ${track.id}: parameterLocks length ${track.parameterLocks.length} !== ${MAX_STEPS}`);
    }
  }

  return violations;
}

/**
 * Check step count is within bounds for all tracks
 */
function checkStepCountWithinBounds(tracks: SessionTrack[]): string[] {
  const violations: string[] = [];

  for (const track of tracks) {
    // `undefined` means "use the default" and is valid; any other non-numeric
    // value is not, and must not be hidden by the `??` below.
    if (track.stepCount !== undefined && !Number.isFinite(track.stepCount)) {
      violations.push(`Track ${track.id}: stepCount ${track.stepCount} is not a finite number`);
      continue;
    }
    const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
    if (!isValidNumberInRange(stepCount, 1, MAX_STEPS)) {
      violations.push(`Track ${track.id}: stepCount ${stepCount} is outside valid range [1, ${MAX_STEPS}]`);
    }
  }

  return violations;
}

/**
 * Check volume is within bounds for all tracks
 */
function checkVolumeWithinBounds(tracks: SessionTrack[]): string[] {
  const violations: string[] = [];

  for (const track of tracks) {
    if (!isValidNumberInRange(track.volume, MIN_VOLUME, MAX_VOLUME)) {
      violations.push(`Track ${track.id}: volume ${track.volume} is outside valid range [${MIN_VOLUME}, ${MAX_VOLUME}]`);
    }
  }

  return violations;
}

function checkLoopRegionWithinBounds(loopRegion: unknown): string[] {
  if (loopRegion === undefined || loopRegion === null) return [];
  if (!loopRegion || typeof loopRegion !== 'object' || Array.isArray(loopRegion)) {
    return ['Stored loop region must be null or an object'];
  }

  const value = loopRegion as Record<string, unknown>;
  const startValid = isValidIntegerInRange(value.start, 0, MAX_STEPS - 1);
  const endValid = isValidIntegerInRange(value.end, 0, MAX_STEPS - 1);
  const violations: string[] = [];
  if (!startValid) violations.push('Stored loop region start is outside valid bounds');
  if (!endValid) violations.push('Stored loop region end is outside valid bounds');
  if (startValid && endValid) {
    const start = value.start as number;
    const end = value.end as number;
    if (start > end) violations.push('Stored loop region start exceeds end');
  }
  return violations;
}

/**
 * Validate all state invariants
 */
export function validateStateInvariants(state: SessionState): InvariantResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  // Critical invariants
  violations.push(...checkNoDuplicateTrackIds(state.tracks));
  violations.push(...checkTrackCountWithinLimit(state.tracks));
  violations.push(...checkTracksHaveValidArrays(state.tracks));

  // Bounds invariants
  violations.push(...checkTempoWithinBounds(state.tempo));
  violations.push(...checkSwingWithinBounds(state.swing));
  violations.push(...checkStepCountWithinBounds(state.tracks));
  violations.push(...checkVolumeWithinBounds(state.tracks));
  violations.push(...checkLoopRegionWithinBounds((state as { loopRegion?: unknown }).loopRegion));

  return {
    valid: violations.length === 0,
    violations,
    warnings,
  };
}

/**
 * Log invariant status - for production monitoring
 */
export function logInvariantStatus(state: SessionState, sessionId: string, context?: string): void {
  const result = validateStateInvariants(state);

  if (!result.valid) {
    const prefix = context ? `[${context}]` : '';
    console.error(`[INVARIANT VIOLATION]${prefix} session=${sessionId}`, {
      violations: result.violations,
      trackCount: state.tracks.length,
      trackIds: state.tracks.map(t => t.id),
    });
  }

  if (result.warnings.length > 0) {
    console.warn(`[INVARIANT WARNING] session=${sessionId}`, {
      warnings: result.warnings,
    });
  }
}

/**
 * Repair state to satisfy invariants (best effort)
 * Returns repaired state and list of repairs made
 */
export function repairStateInvariants(state: SessionState): {
  repairedState: SessionState;
  repairs: string[];
} {
  const repairs: string[] = [];
  const repairedState = JSON.parse(JSON.stringify(state)) as SessionState;

  // Remove duplicate tracks (keep first occurrence)
  const seenIds = new Set<string>();
  const uniqueTracks: SessionTrack[] = [];
  for (const track of repairedState.tracks) {
    if (!seenIds.has(track.id)) {
      seenIds.add(track.id);
      uniqueTracks.push(track);
    } else {
      repairs.push(`Removed duplicate track: ${track.id}`);
    }
  }
  repairedState.tracks = uniqueTracks;

  // Clamp tempo. The non-finite case must come first, but not for the reason
  // it looks like: this function clones with JSON.parse(JSON.stringify(...)),
  // which turns NaN into null, and `null < MIN_TEMPO` coerces to `0 < 60` and
  // repairs. The value the comparisons genuinely could not see is **undefined**
  // — JSON.stringify drops the key entirely — and `undefined < 60` and
  // `undefined > 180` are both false, so a stored state with no tempo came out
  // of the repair still having no tempo. That is exactly the legacy/corrupted
  // KV case this function exists for.
  if (!Number.isFinite(repairedState.tempo)) {
    repairs.push(`Replaced non-finite tempo ${repairedState.tempo} with ${MIN_TEMPO}`);
    repairedState.tempo = MIN_TEMPO;
  } else if (repairedState.tempo < MIN_TEMPO) {
    repairs.push(`Clamped tempo from ${repairedState.tempo} to ${MIN_TEMPO}`);
    repairedState.tempo = MIN_TEMPO;
  } else if (repairedState.tempo > MAX_TEMPO) {
    repairs.push(`Clamped tempo from ${repairedState.tempo} to ${MAX_TEMPO}`);
    repairedState.tempo = MAX_TEMPO;
  }

  // Clamp swing (non-finite first — chiefly a missing key; see tempo above).
  if (!Number.isFinite(repairedState.swing)) {
    repairs.push(`Replaced non-finite swing ${repairedState.swing} with ${MIN_SWING}`);
    repairedState.swing = MIN_SWING;
  } else if (repairedState.swing < MIN_SWING) {
    repairs.push(`Clamped swing from ${repairedState.swing} to ${MIN_SWING}`);
    repairedState.swing = MIN_SWING;
  } else if (repairedState.swing > MAX_SWING) {
    repairs.push(`Clamped swing from ${repairedState.swing} to ${MAX_SWING}`);
    repairedState.swing = MAX_SWING;
  }

  // Repair persisted loop metadata before schedulers can consume it. Requests
  // are rejected at the HTTP boundary; this second boundary handles legacy or
  // externally-corrupted KV/DO state.
  const loopRegion = (repairedState as { loopRegion?: unknown }).loopRegion;
  if (loopRegion !== undefined && loopRegion !== null) {
    if (!loopRegion || typeof loopRegion !== 'object' || Array.isArray(loopRegion)) {
      repairedState.loopRegion = null;
      repairs.push('Cleared invalid stored loop region');
    } else {
      const value = loopRegion as Record<string, unknown>;
      const startValid = isValidIntegerInRange(value.start, 0, MAX_STEPS - 1);
      const endValid = isValidIntegerInRange(value.end, 0, MAX_STEPS - 1);
      if (!startValid || !endValid) {
        repairedState.loopRegion = null;
        repairs.push('Cleared invalid stored loop region');
      } else {
        const start = value.start as number;
        const end = value.end as number;
        if (start > end) {
          repairedState.loopRegion = { start: end, end: start };
          repairs.push('Normalized reversed loop region bounds');
        }
      }
    }
  }

  // Fix track arrays and bounds
  for (const track of repairedState.tracks) {
    // Ensure steps array is correct length
    if (track.steps.length < MAX_STEPS) {
      const padding = Array(MAX_STEPS - track.steps.length).fill(false);
      track.steps = [...track.steps, ...padding];
      repairs.push(`Padded steps array for track ${track.id}`);
    } else if (track.steps.length > MAX_STEPS) {
      track.steps = track.steps.slice(0, MAX_STEPS);
      repairs.push(`Truncated steps array for track ${track.id}`);
    }

    // Ensure parameterLocks array is correct length
    if (track.parameterLocks.length < MAX_STEPS) {
      const padding = Array(MAX_STEPS - track.parameterLocks.length).fill(null);
      track.parameterLocks = [...track.parameterLocks, ...padding];
      repairs.push(`Padded parameterLocks array for track ${track.id}`);
    } else if (track.parameterLocks.length > MAX_STEPS) {
      track.parameterLocks = track.parameterLocks.slice(0, MAX_STEPS);
      repairs.push(`Truncated parameterLocks array for track ${track.id}`);
    }

    // Clamp step count.
    //
    // Checked on the field rather than on `track.stepCount ?? DEFAULT`: the
    // default only lands in the local, so a bad field value survived the repair
    // untouched. That matters more than it looks, because line 376 clones with
    // JSON.parse(JSON.stringify(...)) and **JSON.stringify turns NaN and
    // ±Infinity into null** — so by the time this runs, a NaN stepCount is
    // already `null`, `null ?? DEFAULT` is a finite 16, and nothing fired.
    // `undefined` is legal (it means "use the default"); null and non-finite
    // numbers are not.
    if (track.stepCount !== undefined && !Number.isFinite(track.stepCount)) {
      repairs.push(
        `Replaced non-finite stepCount ${track.stepCount} with ${DEFAULT_STEP_COUNT} ` +
        `for track ${track.id}`
      );
      track.stepCount = DEFAULT_STEP_COUNT;
    }
    const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
    if (!Number.isFinite(stepCount)) {
      track.stepCount = DEFAULT_STEP_COUNT;
      repairs.push(
        `Replaced non-finite stepCount ${stepCount} with ${DEFAULT_STEP_COUNT} for track ${track.id}`
      );
    } else if (stepCount < 1) {
      track.stepCount = 1;
      repairs.push(`Clamped stepCount from ${stepCount} to 1 for track ${track.id}`);
    } else if (stepCount > MAX_STEPS) {
      track.stepCount = MAX_STEPS;
      repairs.push(`Clamped stepCount from ${stepCount} to ${MAX_STEPS} for track ${track.id}`);
    }

    // Clamp volume (non-finite first — chiefly a missing key; see tempo above).
    if (!Number.isFinite(track.volume)) {
      repairs.push(
        `Replaced non-finite volume ${track.volume} with ${MAX_VOLUME} for track ${track.id}`
      );
      track.volume = MAX_VOLUME;
    } else if (track.volume < MIN_VOLUME) {
      repairs.push(`Clamped volume from ${track.volume} to ${MIN_VOLUME} for track ${track.id}`);
      track.volume = MIN_VOLUME;
    } else if (track.volume > MAX_VOLUME) {
      repairs.push(`Clamped volume from ${track.volume} to ${MAX_VOLUME} for track ${track.id}`);
      track.volume = MAX_VOLUME;
    }
  }

  return { repairedState, repairs };
}
