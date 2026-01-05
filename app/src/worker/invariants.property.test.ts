/**
 * Property-Based Tests for Debug Invariants
 *
 * Tests invariants from invariants.ts, validation.ts, and state-mutations.ts
 * that weren't covered by validators.property.test.ts.
 *
 * Test categories:
 * - EF-001: Effects validation bounds and schema
 * - SN-001: Session name XSS prevention
 * - LR-001: Loop region bounds after mutations
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateSessionState,
  validateSessionName,
  isValidUUID,
  isBodySizeValid,
} from './validation';
import {
  REVERB_MIN_DECAY,
  REVERB_MAX_DECAY,
  DELAY_MAX_FEEDBACK,
  CHORUS_MIN_FREQUENCY,
  CHORUS_MAX_FREQUENCY,
  MAX_MESSAGE_SIZE,
} from '../shared/constants';
import { applyMutation } from '../shared/state-mutations';
import type { SessionState } from '../shared/state';
import { arbFloat32, arbSessionState, arbStepCount } from '../test/arbitraries';

// =============================================================================
// Helper Arbitraries for Effects Testing
// =============================================================================

/** Valid reverb state */
const arbValidReverb = fc.record({
  decay: arbFloat32(REVERB_MIN_DECAY, REVERB_MAX_DECAY),
  wet: arbFloat32(0, 1),
});

/** Valid delay state */
const arbValidDelay = fc.record({
  time: fc.constantFrom('32n', '16n', '16t', '8n', '8t', '4n', '4t', '2n', '2t', '1n', '1m', '2m', '4m'),
  feedback: arbFloat32(0, DELAY_MAX_FEEDBACK),
  wet: arbFloat32(0, 1),
});

/** Valid chorus state */
const arbValidChorus = fc.record({
  frequency: arbFloat32(CHORUS_MIN_FREQUENCY, CHORUS_MAX_FREQUENCY),
  depth: arbFloat32(0, 1),
  wet: arbFloat32(0, 1),
});

/** Valid distortion state */
const arbValidDistortion = fc.record({
  amount: arbFloat32(0, 1),
  wet: arbFloat32(0, 1),
});

/** Complete valid effects state */
const arbValidEffects = fc.record({
  reverb: arbValidReverb,
  delay: arbValidDelay,
  chorus: arbValidChorus,
  distortion: arbValidDistortion,
});

/** Out-of-range reverb (for testing clamping/rejection) */
const arbOutOfRangeReverb = fc.record({
  decay: fc.oneof(
    arbFloat32(-10, REVERB_MIN_DECAY - 0.01),  // Below min
    arbFloat32(REVERB_MAX_DECAY + 0.01, 100)   // Above max
  ),
  wet: fc.oneof(
    arbFloat32(-1, -0.01),    // Below 0
    arbFloat32(1.01, 2)       // Above 1
  ),
});

/** Reverb with wrong field names (schema violation) */
const arbWrongSchemaReverb = fc.record({
  mix: arbFloat32(0, 1),      // Wrong! Should be 'wet'
  decay: arbFloat32(REVERB_MIN_DECAY, REVERB_MAX_DECAY),
});

/** Chorus with wrong field names */
const arbWrongSchemaChorus = fc.record({
  rate: arbFloat32(0.1, 10),   // Wrong! Should be 'frequency'
  depth: arbFloat32(0, 1),
  wet: arbFloat32(0, 1),
});

// =============================================================================
// Helper Arbitraries for Session Name Testing
// =============================================================================

/** Valid session names - alphanumeric with common punctuation */
const arbValidSessionName = fc.string({ minLength: 1, maxLength: 100 }).filter(
  // Filter out XSS patterns so we only test truly valid names
  (s) => !/<script|javascript:|on\w+\s*=/i.test(s)
);

/** XSS attack patterns - only patterns that contain actual XSS vectors */
const arbXSSPattern = fc.constantFrom(
  '<script>alert(1)</script>',
  'javascript:alert(1)',
  '<img onerror="alert(1)">',
  '<div onclick="alert(1)">',
  '<script src="evil.js">',
  'JAVASCRIPT:alert(1)',  // Case variation
  '<SCRIPT>alert(1)</SCRIPT>',
  '"><script>alert(1)</script>',
  // Note: "'; alert(1); //" is SQL injection, not XSS - removed
);

/** Names that are too long */
const arbTooLongName = fc.string({ minLength: 101, maxLength: 200 });

// =============================================================================
// Helper Arbitraries for Loop Region Testing
// =============================================================================

/** Loop region with potentially invalid bounds (for testing normalization) */
const arbUnnormalizedLoopRegion = fc.record({
  start: fc.integer({ min: -10, max: 200 }),
  end: fc.integer({ min: -10, max: 200 }),
});

// =============================================================================
// EF-001: Effects Validation Bounds and Schema
// =============================================================================

describe('EF-001: Effects Validation', () => {
  describe('EF-001a: Valid effects pass validation', () => {
    it('valid effects should pass validateSessionState', () => {
      fc.assert(
        fc.property(arbValidEffects, (effects) => {
          const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
          const result = validateSessionState(state);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('EF-001b: Reverb bounds are enforced', () => {
    it('reverb.decay must be in [0.1, 10]', () => {
      fc.assert(
        fc.property(
          arbFloat32(-10, 100),
          arbFloat32(0, 1),
          (decay, wet) => {
            const effects = {
              reverb: { decay, wet },
              delay: { time: '8n', feedback: 0.3, wet: 0.2 },
              chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
              distortion: { amount: 0.2, wet: 0.1 },
            };
            const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
            const result = validateSessionState(state);

            if (decay < REVERB_MIN_DECAY || decay > REVERB_MAX_DECAY) {
              expect(result.valid).toBe(false);
              expect(result.errors.some(e => e.includes('reverb.decay'))).toBe(true);
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('reverb.wet must be in [0, 1]', () => {
      fc.assert(
        fc.property(
          arbFloat32(REVERB_MIN_DECAY, REVERB_MAX_DECAY),
          arbFloat32(-2, 3),
          (decay, wet) => {
            const effects = {
              reverb: { decay, wet },
              delay: { time: '8n', feedback: 0.3, wet: 0.2 },
              chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
              distortion: { amount: 0.2, wet: 0.1 },
            };
            const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
            const result = validateSessionState(state);

            if (wet < 0 || wet > 1) {
              expect(result.valid).toBe(false);
              expect(result.errors.some(e => e.includes('reverb.wet'))).toBe(true);
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('EF-001c: Delay bounds are enforced', () => {
    it('delay.feedback must be in [0, 0.95]', () => {
      fc.assert(
        fc.property(arbFloat32(-1, 2), (feedback) => {
          const effects = {
            reverb: { decay: 2, wet: 0.3 },
            delay: { time: '8n', feedback, wet: 0.2 },
            chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
            distortion: { amount: 0.2, wet: 0.1 },
          };
          const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
          const result = validateSessionState(state);

          if (feedback < 0 || feedback > DELAY_MAX_FEEDBACK) {
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('delay.feedback'))).toBe(true);
          }
        }),
        { numRuns: 200 }
      );
    });

    it('delay.time must be a valid note value', () => {
      const invalidTimes = ['1s', '100ms', 'fast', '3n', '5n', 'invalid'];
      const validTimes = ['32n', '16n', '16t', '8n', '8t', '4n', '4t', '2n', '2t', '1n', '1m', '2m', '4m'];

      for (const time of invalidTimes) {
        const effects = {
          reverb: { decay: 2, wet: 0.3 },
          delay: { time, feedback: 0.3, wet: 0.2 },
          chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
          distortion: { amount: 0.2, wet: 0.1 },
        };
        const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
        const result = validateSessionState(state);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('delay.time'))).toBe(true);
      }

      for (const time of validTimes) {
        const effects = {
          reverb: { decay: 2, wet: 0.3 },
          delay: { time, feedback: 0.3, wet: 0.2 },
          chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
          distortion: { amount: 0.2, wet: 0.1 },
        };
        const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
        const result = validateSessionState(state);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('EF-001d: Chorus bounds are enforced', () => {
    it('chorus.frequency must be in [0.1, 10]', () => {
      fc.assert(
        fc.property(arbFloat32(-5, 50), (frequency) => {
          const effects = {
            reverb: { decay: 2, wet: 0.3 },
            delay: { time: '8n', feedback: 0.3, wet: 0.2 },
            chorus: { frequency, depth: 0.5, wet: 0.1 },
            distortion: { amount: 0.2, wet: 0.1 },
          };
          const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
          const result = validateSessionState(state);

          if (frequency < CHORUS_MIN_FREQUENCY || frequency > CHORUS_MAX_FREQUENCY) {
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('chorus.frequency'))).toBe(true);
          }
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('EF-001e: Schema violations are rejected', () => {
    it('reverb.mix is rejected (should be reverb.wet)', () => {
      const effects = {
        reverb: { mix: 0.5, decay: 2 },  // Wrong field name!
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
        distortion: { amount: 0.2, wet: 0.1 },
      };
      const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
      const result = validateSessionState(state);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('reverb.mix is invalid'))).toBe(true);
    });

    it('chorus.rate is rejected (should be chorus.frequency)', () => {
      const effects = {
        reverb: { decay: 2, wet: 0.3 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { rate: 1, depth: 0.5, wet: 0.1 },  // Wrong field name!
        distortion: { amount: 0.2, wet: 0.1 },
      };
      const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
      const result = validateSessionState(state);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('chorus.rate is invalid'))).toBe(true);
    });

    it('distortion.drive is rejected (should be distortion.amount)', () => {
      const effects = {
        reverb: { decay: 2, wet: 0.3 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 1, depth: 0.5, wet: 0.1 },
        distortion: { drive: 0.2, wet: 0.1 },  // Wrong field name!
      };
      const state = { effects, tracks: [], tempo: 120, swing: 0, version: 1 };
      const result = validateSessionState(state);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('distortion.drive is invalid'))).toBe(true);
    });
  });
});

// =============================================================================
// SN-001: Session Name XSS Prevention
// =============================================================================

describe('SN-001: Session Name Validation', () => {
  describe('SN-001a: Valid names pass', () => {
    it('alphanumeric names with spaces pass', () => {
      fc.assert(
        fc.property(arbValidSessionName, (name) => {
          const result = validateSessionName(name);
          // Most generated names should pass (unless they happen to match XSS patterns)
          // We're mainly testing that valid characters don't cause false rejections
          if (!/<script|javascript:|on\w+\s*=/i.test(name)) {
            expect(result.valid).toBe(true);
          }
        }),
        { numRuns: 300 }
      );
    });

    it('null is valid (clears name)', () => {
      const result = validateSessionName(null);
      expect(result.valid).toBe(true);
    });

    it('empty string is valid', () => {
      const result = validateSessionName('');
      expect(result.valid).toBe(true);
    });

    it('unicode characters are valid', () => {
      const unicodeNames = ['日本語', 'Привет', '你好', 'مرحبا', '🎵🎶', 'Müsik'];
      for (const name of unicodeNames) {
        const result = validateSessionName(name);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('SN-001b: XSS patterns are always rejected', () => {
    it('script tags are rejected', () => {
      fc.assert(
        fc.property(arbXSSPattern, (xssPattern) => {
          const result = validateSessionName(xssPattern);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('unsafe'))).toBe(true);
        }),
        { numRuns: 50 }  // All patterns in arbXSSPattern
      );
    });

    it('embedded XSS in valid text is rejected', () => {
      const embeddedPatterns = [
        'My Song <script>alert(1)</script>',
        'Track javascript:alert(1)',
        'Beat<img onerror="alert(1)">Drop',
      ];
      for (const name of embeddedPatterns) {
        const result = validateSessionName(name);
        expect(result.valid).toBe(false);
      }
    });

    it('case variations of XSS are rejected', () => {
      const caseVariations = [
        '<SCRIPT>alert(1)</SCRIPT>',
        '<ScRiPt>alert(1)</ScRiPt>',
        'JAVASCRIPT:alert(1)',
        'JaVaScRiPt:alert(1)',
        'ONCLICK=alert(1)',
        'OnClick=alert(1)',
      ];
      for (const name of caseVariations) {
        const result = validateSessionName(name);
        expect(result.valid).toBe(false);
      }
    });
  });

  describe('SN-001c: Length limits are enforced', () => {
    it('names over 100 characters are rejected', () => {
      fc.assert(
        fc.property(arbTooLongName, (name) => {
          const result = validateSessionName(name);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('100 characters'))).toBe(true);
        }),
        { numRuns: 50 }
      );
    });

    it('names exactly 100 characters pass', () => {
      const name = 'a'.repeat(100);
      const result = validateSessionName(name);
      expect(result.valid).toBe(true);
    });

    it('names at 101 characters fail', () => {
      const name = 'a'.repeat(101);
      const result = validateSessionName(name);
      expect(result.valid).toBe(false);
    });
  });

  describe('SN-001d: Non-string types are rejected', () => {
    it('numbers are rejected', () => {
      const result = validateSessionName(12345 as unknown);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('string'))).toBe(true);
    });

    it('objects are rejected', () => {
      const result = validateSessionName({ name: 'test' } as unknown);
      expect(result.valid).toBe(false);
    });

    it('arrays are rejected', () => {
      const result = validateSessionName(['test'] as unknown);
      expect(result.valid).toBe(false);
    });

    it('undefined is rejected (but null is allowed)', () => {
      const result = validateSessionName(undefined as unknown);
      expect(result.valid).toBe(false);
    });
  });
});

// =============================================================================
// LR-001: Loop Region Bounds After Mutations
// =============================================================================

describe('LR-001: Loop Region Invariants', () => {
  describe('LR-001a: Loop region start <= end after mutation', () => {
    it('set_loop_region normalizes reversed bounds', () => {
      fc.assert(
        fc.property(
          arbSessionState,
          fc.integer({ min: 0, max: 127 }),
          fc.integer({ min: 0, max: 127 }),
          (state, rawStart, rawEnd) => {
            // Apply set_loop_region mutation
            const newState = applyMutation(state, {
              type: 'set_loop_region',
              region: { start: rawStart, end: rawEnd },
            });

            // Loop region should always have start <= end
            if (newState.loopRegion) {
              expect(newState.loopRegion.start).toBeLessThanOrEqual(newState.loopRegion.end);
            }
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  describe('LR-001b: Loop region is bounded by track length', () => {
    it('loop region is clamped to longest track length', () => {
      // Import DEFAULT_STEP_COUNT to match the algorithm
      const DEFAULT_STEP_COUNT = 16;

      fc.assert(
        fc.property(
          arbSessionState,
          fc.integer({ min: 0, max: 500 }),  // Potentially way out of bounds
          fc.integer({ min: 0, max: 500 }),
          (state, rawStart, rawEnd) => {
            const newState = applyMutation(state, {
              type: 'set_loop_region',
              region: { start: rawStart, end: rawEnd },
            });

            if (newState.loopRegion) {
              // Calculate longest track - matches the algorithm in state-mutations.ts
              // Note: DEFAULT_STEP_COUNT is used as a baseline even when tracks exist
              const longestTrack = Math.max(
                ...state.tracks.map(t => t.stepCount ?? DEFAULT_STEP_COUNT),
                DEFAULT_STEP_COUNT
              );

              // Loop region should be within bounds [0, longestTrack - 1]
              expect(newState.loopRegion.start).toBeGreaterThanOrEqual(0);
              expect(newState.loopRegion.end).toBeGreaterThanOrEqual(0);
              expect(newState.loopRegion.start).toBeLessThanOrEqual(longestTrack - 1);
              expect(newState.loopRegion.end).toBeLessThanOrEqual(longestTrack - 1);
            }
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  describe('LR-001c: Null loop region clears correctly', () => {
    it('set_loop_region with null clears the loop', () => {
      fc.assert(
        fc.property(arbSessionState, (state) => {
          // First set a loop region
          const withLoop = applyMutation(state, {
            type: 'set_loop_region',
            region: { start: 0, end: 8 },
          });

          // Then clear it
          const cleared = applyMutation(withLoop, {
            type: 'set_loop_region',
            region: null,
          });

          expect(cleared.loopRegion).toBeNull();
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('LR-001d: Loop region survives track mutations', () => {
    it('loop region persists after adding track', () => {
      fc.assert(
        fc.property(arbSessionState, (state) => {
          fc.pre(state.tracks.length < 16);  // Can add tracks

          // Set loop region
          const withLoop = applyMutation(state, {
            type: 'set_loop_region',
            region: { start: 2, end: 10 },
          });

          // Add a track
          const afterAdd = applyMutation(withLoop, {
            type: 'add_track',
            track: {
              id: 'new-track-' + Math.random(),
              name: 'New Track',
              sampleId: 'synth:kick',
              steps: new Array(128).fill(false),
              parameterLocks: new Array(128).fill(null),
              volume: 1,
              muted: false,
              soloed: false,
              transpose: 0,
              stepCount: 16,
            },
          });

          // Loop region should still exist
          expect(afterAdd.loopRegion).not.toBeNull();
          if (afterAdd.loopRegion) {
            expect(afterAdd.loopRegion.start).toBe(2);
            expect(afterAdd.loopRegion.end).toBe(10);
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});

// =============================================================================
// UUID Validation Properties
// =============================================================================

describe('UUID-001: UUID Validation', () => {
  it('valid UUIDs pass validation', () => {
    fc.assert(
      fc.property(fc.uuid(), (uuid) => {
        expect(isValidUUID(uuid)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('invalid formats are rejected', () => {
    const invalidUUIDs = [
      'not-a-uuid',
      '12345678-1234-1234-1234-12345678901',   // Too short
      '12345678-1234-1234-1234-1234567890123', // Too long
      '12345678-1234-1234-1234-12345678901g',  // Invalid char 'g'
      '12345678123412341234123456789012',      // No dashes
      '',
      '  ',
    ];
    for (const uuid of invalidUUIDs) {
      expect(isValidUUID(uuid)).toBe(false);
    }
  });

  it('case insensitive (both upper and lower case pass)', () => {
    const upperUUID = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
    const lowerUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(isValidUUID(upperUUID)).toBe(true);
    expect(isValidUUID(lowerUUID)).toBe(true);
  });
});

// =============================================================================
// Body Size Validation Properties
// =============================================================================

describe('BS-001: Body Size Validation', () => {
  it('sizes under MAX_MESSAGE_SIZE pass', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_MESSAGE_SIZE }), (size) => {
        expect(isBodySizeValid(String(size))).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('sizes over MAX_MESSAGE_SIZE fail', () => {
    fc.assert(
      fc.property(fc.integer({ min: MAX_MESSAGE_SIZE + 1, max: MAX_MESSAGE_SIZE * 10 }), (size) => {
        expect(isBodySizeValid(String(size))).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('null/missing Content-Length passes (let fetch handle it)', () => {
    expect(isBodySizeValid(null)).toBe(true);
    expect(isBodySizeValid('')).toBe(true);
  });

  it('non-numeric Content-Length passes (let server handle it)', () => {
    expect(isBodySizeValid('abc')).toBe(true);
    expect(isBodySizeValid('NaN')).toBe(true);
  });
});
