/**
 * Tests for worker-level input validation
 *
 * IMPORTANT: Write tests FIRST before implementing validation changes.
 * This ensures we catch schema mismatches before they break production.
 */
import { describe, it, expect } from 'vitest';
import { validateSessionState, isValidUUID, validateSessionName } from './validation';

describe('validateSessionState', () => {
  describe('effects validation', () => {
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

    const validEffects = {
      reverb: { decay: 2, wet: 0.3 },
      delay: { time: '4n', feedback: 0.3, wet: 0.2 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0.1 },
      distortion: { amount: 0.2, wet: 0.1 },
    };

    it('should accept valid effects', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: validEffects,
        version: 1,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject effects.chorus.rate (wrong field name)', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: {
          ...validEffects,
          chorus: { rate: 1.5, depth: 0.5, wet: 0.1 }, // rate instead of frequency
        },
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('chorus.frequency'))).toBe(true);
    });

    it('should reject effects.reverb.mix (wrong field name)', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: {
          ...validEffects,
          reverb: { decay: 2, mix: 0.3 }, // mix instead of wet
        },
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('reverb.wet'))).toBe(true);
    });

    it('should reject effects.distortion.drive (wrong field name)', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: {
          ...validEffects,
          distortion: { drive: 0.2, mix: 0.1 }, // drive/mix instead of amount/wet
        },
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('distortion.amount'))).toBe(true);
    });

    it('should reject missing required effects fields', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: {
          reverb: { decay: 2 }, // missing wet
          delay: { time: '4n', feedback: 0.3, wet: 0.2 },
          chorus: { frequency: 1.5, depth: 0.5, wet: 0.1 },
          distortion: { amount: 0.2, wet: 0.1 },
        },
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('reverb.wet'))).toBe(true);
    });

    it('should reject effects.reverb.decay out of range', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: {
          ...validEffects,
          reverb: { decay: 100, wet: 0.3 }, // decay too high (max 10)
        },
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('reverb.decay'))).toBe(true);
    });

    it('should reject effects.chorus.frequency out of range', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: {
          ...validEffects,
          chorus: { frequency: 100, depth: 0.5, wet: 0.1 }, // frequency too high (max 10)
        },
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('chorus.frequency'))).toBe(true);
    });

    it('should reject wet values out of range (0-1)', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: {
          ...validEffects,
          reverb: { decay: 2, wet: 1.5 }, // wet > 1
        },
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('reverb.wet'))).toBe(true);
    });

    it('should allow effects to be undefined (optional)', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        version: 1,
      });
      expect(result.valid).toBe(true);
    });

    it('should accept valid delay time formats', () => {
      const validTimes = ['4n', '8n', '16n', '1/4', '1/8', '1/16'];
      for (const time of validTimes) {
        const result = validateSessionState({
          tracks: [validTrack],
          tempo: 120,
          swing: 0,
          effects: {
            ...validEffects,
            delay: { time, feedback: 0.3, wet: 0.2 },
          },
          version: 1,
        });
        expect(result.valid).toBe(true);
      }
    });

    it('should reject invalid delay time format', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: {
          ...validEffects,
          delay: { time: 'invalid', feedback: 0.3, wet: 0.2 },
        },
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('delay.time'))).toBe(true);
    });

    it('should reject feedback > 0.95 (to prevent infinite feedback)', () => {
      const result = validateSessionState({
        tracks: [validTrack],
        tempo: 120,
        swing: 0,
        effects: {
          ...validEffects,
          delay: { time: '4n', feedback: 1.0, wet: 0.2 }, // feedback too high
        },
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('delay.feedback'))).toBe(true);
    });
  });

  describe('existing validations still work', () => {
    it('should reject tempo out of range', () => {
      const result = validateSessionState({
        tracks: [],
        tempo: 500, // too high
        swing: 0,
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Tempo'))).toBe(true);
    });

    it('should reject swing out of range', () => {
      const result = validateSessionState({
        tracks: [],
        tempo: 120,
        swing: 200, // too high
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Swing'))).toBe(true);
    });

    it('should reject track with invalid stepCount', () => {
      const result = validateSessionState({
        tracks: [{
          id: 'track-1',
          name: 'Test',
          sampleId: 'kick',
          steps: [true],
          parameterLocks: [null],
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 17, // not a valid step count
        }],
        tempo: 120,
        swing: 0,
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('stepCount'))).toBe(true);
    });
  });
});

describe('isValidUUID', () => {
  it('should accept valid UUID v4', () => {
    expect(isValidUUID('d382c6e5-cb9c-43ca-abb3-ab6a4dd2504d')).toBe(true);
    expect(isValidUUID('6d173a62-e2f7-40ca-bc63-60b2a3cb168b')).toBe(true);
  });

  it('should reject invalid UUIDs', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('d382c6e5-cb9c-43ca-abb3')).toBe(false); // too short
    expect(isValidUUID('')).toBe(false);
  });
});

describe('validateSessionName', () => {
  it('should accept valid names', () => {
    expect(validateSessionName('March of Death').valid).toBe(true);
    expect(validateSessionName('Test Session 123').valid).toBe(true);
    expect(validateSessionName(null).valid).toBe(true); // null clears name
  });

  it('should reject XSS attempts', () => {
    expect(validateSessionName('<script>alert(1)</script>').valid).toBe(false);
    expect(validateSessionName('onclick=alert(1)').valid).toBe(false);
  });

  it('should reject names that are too long', () => {
    const longName = 'a'.repeat(101);
    expect(validateSessionName(longName).valid).toBe(false);
  });
});
