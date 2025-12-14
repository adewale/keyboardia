/**
 * State Invariant Validation for Keyboardia
 *
 * These invariants must ALWAYS hold true. If violated, state corruption has occurred.
 * Use validateStateInvariants() after mutations and logInvariantStatus() in production.
 */

import type { SessionState, SessionTrack } from './types';

// Exported bounds for use in message validation
// These MUST match the values in src/types.ts (client-side)
export const MAX_TRACKS = 16;
export const MAX_STEPS = 64;
export const MIN_TEMPO = 60;   // Aligned with src/types.ts
export const MAX_TEMPO = 180;  // Aligned with src/types.ts
export const MIN_SWING = 0;
export const MAX_SWING = 100;
export const MIN_VOLUME = 0;
export const MAX_VOLUME = 1;
export const MIN_TRANSPOSE = -24;  // Extended for cinematic, orchestral, bass music
export const MAX_TRANSPOSE = 24;   // 4 octaves total range
export const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB max message size

/**
 * Clamp a value to a range (for input validation)
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Check if a value is a valid number within bounds
 */
export function isValidNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value) && value >= min && value <= max;
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
  if (tempo < MIN_TEMPO || tempo > MAX_TEMPO) {
    return [`Tempo ${tempo} is outside valid range [${MIN_TEMPO}, ${MAX_TEMPO}]`];
  }
  return [];
}

/**
 * Check swing is within bounds
 */
function checkSwingWithinBounds(swing: number): string[] {
  if (swing < MIN_SWING || swing > MAX_SWING) {
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
    const stepCount = track.stepCount ?? 16;
    if (stepCount < 1 || stepCount > MAX_STEPS) {
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
    if (track.volume < MIN_VOLUME || track.volume > MAX_VOLUME) {
      violations.push(`Track ${track.id}: volume ${track.volume} is outside valid range [${MIN_VOLUME}, ${MAX_VOLUME}]`);
    }
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

  // Clamp tempo
  if (repairedState.tempo < MIN_TEMPO) {
    repairs.push(`Clamped tempo from ${repairedState.tempo} to ${MIN_TEMPO}`);
    repairedState.tempo = MIN_TEMPO;
  } else if (repairedState.tempo > MAX_TEMPO) {
    repairs.push(`Clamped tempo from ${repairedState.tempo} to ${MAX_TEMPO}`);
    repairedState.tempo = MAX_TEMPO;
  }

  // Clamp swing
  if (repairedState.swing < MIN_SWING) {
    repairs.push(`Clamped swing from ${repairedState.swing} to ${MIN_SWING}`);
    repairedState.swing = MIN_SWING;
  } else if (repairedState.swing > MAX_SWING) {
    repairs.push(`Clamped swing from ${repairedState.swing} to ${MAX_SWING}`);
    repairedState.swing = MAX_SWING;
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

    // Clamp step count
    const stepCount = track.stepCount ?? 16;
    if (stepCount < 1) {
      track.stepCount = 1;
      repairs.push(`Clamped stepCount from ${stepCount} to 1 for track ${track.id}`);
    } else if (stepCount > MAX_STEPS) {
      track.stepCount = MAX_STEPS;
      repairs.push(`Clamped stepCount from ${stepCount} to ${MAX_STEPS} for track ${track.id}`);
    }

    // Clamp volume
    if (track.volume < MIN_VOLUME) {
      repairs.push(`Clamped volume from ${track.volume} to ${MIN_VOLUME} for track ${track.id}`);
      track.volume = MIN_VOLUME;
    } else if (track.volume > MAX_VOLUME) {
      repairs.push(`Clamped volume from ${track.volume} to ${MAX_VOLUME} for track ${track.id}`);
      track.volume = MAX_VOLUME;
    }
  }

  return { repairedState, repairs };
}
