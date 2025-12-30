/**
 * Phase 13A: Worker-level input validation
 *
 * Cloudflare best practice: Validate requests in the Worker BEFORE routing to
 * Durable Objects to avoid billing for invalid requests.
 *
 * @see https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 */

import {
  MIN_TEMPO,
  MAX_TEMPO,
  MIN_SWING,
  MAX_SWING,
  MAX_TRACKS,
  MAX_STEPS,
  MAX_MESSAGE_SIZE,
} from './invariants';

// ============================================================================
// Session ID Validation
// ============================================================================

/**
 * Validate UUID v4 format
 * This prevents routing invalid session IDs to Durable Objects
 */
export function isValidUUID(id: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
}

// ============================================================================
// Session State Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate session state from request body
 * Used for POST /api/sessions and PUT /api/sessions/:id
 */
export function validateSessionState(state: unknown): ValidationResult {
  const errors: string[] = [];

  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['State must be an object'] };
  }

  const s = state as Record<string, unknown>;

  // Validate tempo if present
  if (s.tempo !== undefined) {
    if (typeof s.tempo !== 'number' || isNaN(s.tempo)) {
      errors.push('Tempo must be a number');
    } else if (s.tempo < MIN_TEMPO || s.tempo > MAX_TEMPO) {
      errors.push(`Tempo must be between ${MIN_TEMPO} and ${MAX_TEMPO}`);
    }
  }

  // Validate swing if present
  if (s.swing !== undefined) {
    if (typeof s.swing !== 'number' || isNaN(s.swing)) {
      errors.push('Swing must be a number');
    } else if (s.swing < MIN_SWING || s.swing > MAX_SWING) {
      errors.push(`Swing must be between ${MIN_SWING} and ${MAX_SWING}`);
    }
  }

  // Validate tracks if present
  if (s.tracks !== undefined) {
    if (!Array.isArray(s.tracks)) {
      errors.push('Tracks must be an array');
    } else if (s.tracks.length > MAX_TRACKS) {
      errors.push(`Cannot have more than ${MAX_TRACKS} tracks`);
    } else {
      // Validate each track
      for (let i = 0; i < s.tracks.length; i++) {
        const trackErrors = validateTrack(s.tracks[i], i);
        errors.push(...trackErrors);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single track
 */
function validateTrack(track: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `Track[${index}]`;

  if (!track || typeof track !== 'object') {
    return [`${prefix}: must be an object`];
  }

  const t = track as Record<string, unknown>;

  // Required fields
  if (typeof t.id !== 'string' || t.id.length === 0) {
    errors.push(`${prefix}: id must be a non-empty string`);
  }

  if (typeof t.sampleId !== 'string') {
    errors.push(`${prefix}: sampleId must be a string`);
  }

  if (typeof t.name !== 'string') {
    errors.push(`${prefix}: name must be a string`);
  }

  // Steps array
  if (!Array.isArray(t.steps)) {
    errors.push(`${prefix}: steps must be an array`);
  } else if (t.steps.length > MAX_STEPS) {
    errors.push(`${prefix}: steps cannot exceed ${MAX_STEPS}`);
  }

  // Volume
  if (t.volume !== undefined && (typeof t.volume !== 'number' || t.volume < 0 || t.volume > 1)) {
    errors.push(`${prefix}: volume must be between 0 and 1`);
  }

  // Transpose (±24 semitones = 4 octaves total range)
  if (t.transpose !== undefined && (typeof t.transpose !== 'number' || t.transpose < -24 || t.transpose > 24)) {
    errors.push(`${prefix}: transpose must be between -24 and 24`);
  }

  // Step count (Phase 29F: added odd counts for polyrhythm support)
  if (t.stepCount !== undefined) {
    const validStepCounts = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 18, 20, 21, 24, 27, 32, 36, 48, 64, 96, 128];
    if (!validStepCounts.includes(t.stepCount as number)) {
      errors.push(`${prefix}: stepCount must be one of ${validStepCounts.join(', ')}`);
    }
  }

  return errors;
}

// ============================================================================
// Session Name Validation
// ============================================================================

const MAX_SESSION_NAME_LENGTH = 100;
const SESSION_NAME_PATTERN = /^[\p{L}\p{N}\p{P}\p{S}\s]*$/u; // Unicode letters, numbers, punctuation, symbols, spaces

/**
 * Validate and sanitize session name
 * Prevents XSS and enforces reasonable limits
 */
export function validateSessionName(name: unknown): ValidationResult {
  if (name === null) {
    return { valid: true, errors: [] }; // null is allowed (clears name)
  }

  if (typeof name !== 'string') {
    return { valid: false, errors: ['Name must be a string or null'] };
  }

  const errors: string[] = [];

  if (name.length > MAX_SESSION_NAME_LENGTH) {
    errors.push(`Name cannot exceed ${MAX_SESSION_NAME_LENGTH} characters`);
  }

  // Check for potential XSS patterns
  if (/<script|javascript:|on\w+\s*=/i.test(name)) {
    errors.push('Name contains potentially unsafe content');
  }

  // Must match allowed character pattern
  if (!SESSION_NAME_PATTERN.test(name)) {
    errors.push('Name contains invalid characters');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Request Body Size Validation
// ============================================================================

/**
 * Check if request body size is within limits
 */
export function isBodySizeValid(contentLength: string | null): boolean {
  if (!contentLength) return true; // No Content-Length header, let fetch handle it
  const size = parseInt(contentLength, 10);
  if (isNaN(size)) return true;
  return size <= MAX_MESSAGE_SIZE;
}

// ============================================================================
// Error Response Helper
// ============================================================================

/**
 * Create a validation error response
 */
export function validationErrorResponse(errors: string[]): Response {
  return new Response(
    JSON.stringify({
      error: 'Validation failed',
      details: errors,
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
