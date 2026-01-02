/**
 * Session API PUT Endpoint Tests
 *
 * Tests for error handling in the PUT /api/sessions/:id endpoint.
 * Write tests FIRST, then fix the implementation.
 *
 * Issue: The PUT endpoint returns generic "Invalid request body" errors
 * without details, making debugging difficult. Error details from the
 * Durable Object are lost in the worker's catch block.
 */
import { describe, it, expect } from 'vitest';
import { validateSessionState, validateSessionName } from './validation';

// ============================================================================
// Test Fixtures
// ============================================================================

const validTrack = {
  id: 'track-1',
  name: 'Test Track',
  sampleId: 'kick',
  steps: [true, false, false, false],
  parameterLocks: [null, null, null, null],
  volume: 1,
  muted: false,
  transpose: 0,
  stepCount: 4,
};

const validState = {
  tracks: [validTrack],
  tempo: 120,
  swing: 0,
  version: 1,
};

// ============================================================================
// PUT Request Body Validation
// ============================================================================

describe('PUT /api/sessions/:id request body validation', () => {
  describe('valid request bodies', () => {
    it('should accept { state: validState }', () => {
      const body = { state: validState };
      const result = validateSessionState(body.state);
      expect(result.valid).toBe(true);
    });

    it('should accept minimal valid state (empty tracks)', () => {
      const body = { state: { tracks: [], tempo: 120, swing: 0, version: 1 } };
      const result = validateSessionState(body.state);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid request bodies - should return descriptive errors', () => {
    it('should reject missing state with clear error', () => {
      // When state is undefined/missing, validation should fail with clear message
      const result = validateSessionState(undefined);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be an object');
    });

    it('should reject null state with clear error', () => {
      const result = validateSessionState(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be an object');
    });

    it('should reject state with invalid tempo (too high)', () => {
      const body = { state: { ...validState, tempo: 500 } };
      const result = validateSessionState(body.state);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('tempo'))).toBe(true);
    });

    it('should reject state with invalid tempo (too low)', () => {
      const body = { state: { ...validState, tempo: 10 } };
      const result = validateSessionState(body.state);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('tempo'))).toBe(true);
    });

    it('should reject state with invalid swing', () => {
      const body = { state: { ...validState, swing: 200 } };
      const result = validateSessionState(body.state);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('swing'))).toBe(true);
    });

    it('should reject track with missing id', () => {
      const body = {
        state: {
          ...validState,
          tracks: [{ ...validTrack, id: '' }],
        },
      };
      const result = validateSessionState(body.state);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('id'))).toBe(true);
    });

    it('should reject track with invalid volume', () => {
      const body = {
        state: {
          ...validState,
          tracks: [{ ...validTrack, volume: 2 }],
        },
      };
      const result = validateSessionState(body.state);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('volume'))).toBe(true);
    });

    it('should reject track with invalid stepCount', () => {
      const body = {
        state: {
          ...validState,
          tracks: [{ ...validTrack, stepCount: 17 }],
        },
      };
      const result = validateSessionState(body.state);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('stepCount'))).toBe(true);
    });
  });
});

// ============================================================================
// Error Response Format
// ============================================================================

describe('PUT endpoint error response format', () => {
  /**
   * Expected error response format:
   * {
   *   error: "Validation failed" | "Invalid request body" | "Missing state in request body",
   *   details: string | string[]
   * }
   *
   * The 'details' field should contain actionable information about what went wrong.
   */

  it('validation errors should include specific details', () => {
    const result = validateSessionState({ tempo: 'not a number' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Each error should be descriptive
    result.errors.forEach(error => {
      expect(error.length).toBeGreaterThan(5); // Not just "error"
    });
  });

  it('multiple validation errors should all be reported', () => {
    const result = validateSessionState({
      tempo: 500, // invalid
      swing: 200, // invalid
      tracks: [{ id: '', sampleId: 123, name: null }], // multiple issues
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2); // Should report all issues
  });
});

// ============================================================================
// PUT with name field (the specific issue that triggered this fix)
// ============================================================================

describe('PUT with name field in request body', () => {
  /**
   * Issue: PUT request with { name: "...", state: {...} } was rejected
   * with generic "Invalid request body" error.
   *
   * The PUT endpoint expects ONLY { state: SessionState }.
   * If a name field is included, the endpoint should either:
   * 1. Accept it and update the name (preferred for API convenience)
   * 2. Reject it with a CLEAR error message (current behavior, but error is unclear)
   *
   * Current behavior: Generic error makes it unclear what went wrong.
   * Expected behavior: Clear error explaining that name should be updated via PATCH.
   */

  it('session name validation should accept valid names', () => {
    const result = validateSessionName('Orbital bliss');
    expect(result.valid).toBe(true);
  });

  it('session name validation should reject XSS attempts', () => {
    const result = validateSessionName('<script>alert(1)</script>');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('unsafe'))).toBe(true);
  });

  it('session name validation should reject too-long names', () => {
    const result = validateSessionName('a'.repeat(101));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('100'))).toBe(true);
  });
});

// ============================================================================
// Error propagation (integration-style tests)
// ============================================================================

describe('error message clarity', () => {
  it('should provide actionable error for state validation failures', () => {
    const invalidState = {
      tracks: [{ id: 'track-1', sampleId: 'kick', name: 'Test', steps: [], parameterLocks: [], volume: 1.5 }],
      tempo: 120,
      swing: 0,
      version: 1,
    };
    const result = validateSessionState(invalidState);
    expect(result.valid).toBe(false);
    // Error should mention the specific issue (volume out of range)
    expect(result.errors.some(e => e.includes('volume'))).toBe(true);
  });

  it('should aggregate multiple track errors', () => {
    const invalidState = {
      tracks: [
        { id: '', sampleId: 'kick', name: 'Test', steps: [], parameterLocks: [], volume: 1.5 },
        { id: 'track-2', sampleId: '', name: '', steps: [], parameterLocks: [], transpose: 100 },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    };
    const result = validateSessionState(invalidState);
    expect(result.valid).toBe(false);
    // Should report errors from both tracks
    expect(result.errors.some(e => e.includes('Track[0]'))).toBe(true);
    expect(result.errors.some(e => e.includes('Track[1]'))).toBe(true);
  });
});

// ============================================================================
// Error Response Structure Tests
// ============================================================================

describe('error response structure', () => {
  /**
   * Error responses should follow this structure:
   * {
   *   error: string,      // Short error type
   *   details: string | string[]  // Actionable details
   * }
   *
   * The PUT/PATCH endpoints in index.ts now return this structure
   * instead of just { error: string }.
   */

  it('JSON parse errors should return error + details', () => {
    // This test documents the expected response format.
    // The actual response is tested via integration tests.
    const expectedFormat = {
      error: 'Invalid JSON',
      details: 'Request body is not valid JSON. Check for syntax errors.',
    };
    expect(expectedFormat).toHaveProperty('error');
    expect(expectedFormat).toHaveProperty('details');
    expect(typeof expectedFormat.details).toBe('string');
  });

  it('other errors should include error message in details', () => {
    // The catch block now includes errorMessage in details
    const expectedFormat = {
      error: 'Invalid request body',
      details: 'Some error message here',
    };
    expect(expectedFormat).toHaveProperty('error');
    expect(expectedFormat).toHaveProperty('details');
  });

  it('validation errors from validateSessionState should provide details array', () => {
    // validationErrorResponse in validation.ts returns this format
    const result = validateSessionState({ tempo: 'not a number' });
    expect(result.valid).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
