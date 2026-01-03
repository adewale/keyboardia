/**
 * REFACTOR-06: Consolidated Validation Module Integration Tests
 *
 * Verifies that the validators module correctly validates and sanitizes
 * all message types with consistent {valid, sanitized, error} interface.
 */
import { describe, it, expect } from 'vitest';
import { validators, type ValidationResult } from '../../src/worker/validators';
import type { SessionState } from '../../src/worker/types';

describe('REFACTOR-06: Consolidated Validation', () => {

  const mockState: SessionState = {
    tracks: [
      {
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: Array(128).fill(false),
        parameterLocks: Array(128).fill(null),
        volume: 0.8,
        muted: false,
        transpose: 0,
      },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  };

  describe('toggleStep validator', () => {
    it('accepts valid toggle_step message', () => {
      const result = validators.toggleStep(
        { trackId: 'track-1', step: 0 },
        mockState
      );
      expect(result.valid).toBe(true);
    });

    it('accepts step at boundary (step 127)', () => {
      const result = validators.toggleStep(
        { trackId: 'track-1', step: 127 },
        mockState
      );
      expect(result.valid).toBe(true);
    });

    it('rejects invalid step index (negative)', () => {
      const result = validators.toggleStep(
        { trackId: 'track-1', step: -1 },
        mockState
      );
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects invalid step index (too high)', () => {
      const result = validators.toggleStep(
        { trackId: 'track-1', step: 200 },
        mockState
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('step');
    });

    it('rejects non-existent track', () => {
      const result = validators.toggleStep(
        { trackId: 'nonexistent', step: 0 },
        mockState
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('track');
    });
  });

  describe('setTempo validator', () => {
    it('accepts valid tempo', () => {
      const result = validators.setTempo({ tempo: 120 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.tempo).toBe(120);
    });

    it('clamps tempo to max (180)', () => {
      const result = validators.setTempo({ tempo: 300 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.tempo).toBe(180);
    });

    it('clamps tempo to min (60)', () => {
      const result = validators.setTempo({ tempo: 30 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.tempo).toBe(60);
    });

    it('rejects non-numeric tempo', () => {
      const result = validators.setTempo({ tempo: 'fast' as unknown as number });
      expect(result.valid).toBe(false);
    });

    it('rejects NaN tempo', () => {
      const result = validators.setTempo({ tempo: NaN });
      expect(result.valid).toBe(false);
    });
  });

  describe('setSwing validator', () => {
    it('accepts valid swing', () => {
      const result = validators.setSwing({ swing: 50 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.swing).toBe(50);
    });

    it('clamps swing to max (100)', () => {
      const result = validators.setSwing({ swing: 150 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.swing).toBe(100);
    });

    it('clamps swing to min (0)', () => {
      const result = validators.setSwing({ swing: -10 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.swing).toBe(0);
    });

    it('rejects non-numeric swing', () => {
      const result = validators.setSwing({ swing: 'high' as unknown as number });
      expect(result.valid).toBe(false);
    });
  });

  describe('setTrackVolume validator', () => {
    it('accepts valid volume', () => {
      const result = validators.setTrackVolume({ trackId: 'track-1', volume: 0.5 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.volume).toBe(0.5);
    });

    it('clamps volume to max (1)', () => {
      const result = validators.setTrackVolume({ trackId: 'track-1', volume: 2 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.volume).toBe(1);
    });

    it('clamps volume to min (0)', () => {
      const result = validators.setTrackVolume({ trackId: 'track-1', volume: -0.5 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.volume).toBe(0);
    });

    it('rejects non-numeric volume', () => {
      const result = validators.setTrackVolume({ trackId: 'track-1', volume: 'loud' as unknown as number });
      expect(result.valid).toBe(false);
    });
  });

  describe('setTrackTranspose validator', () => {
    it('accepts valid transpose', () => {
      const result = validators.setTrackTranspose({ trackId: 'track-1', transpose: 12 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.transpose).toBe(12);
    });

    it('clamps transpose to max (24)', () => {
      const result = validators.setTrackTranspose({ trackId: 'track-1', transpose: 48 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.transpose).toBe(24);
    });

    it('clamps transpose to min (-24)', () => {
      const result = validators.setTrackTranspose({ trackId: 'track-1', transpose: -48 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.transpose).toBe(-24);
    });

    it('rejects non-numeric transpose', () => {
      const result = validators.setTrackTranspose({ trackId: 'track-1', transpose: 'up' as unknown as number });
      expect(result.valid).toBe(false);
    });
  });

  describe('setParameterLock validator', () => {
    it('accepts valid parameter lock with pitch', () => {
      const result = validators.setParameterLock({
        trackId: 'track-1',
        step: 0,
        lock: { pitch: 5 },
      });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.lock?.pitch).toBe(5);
    });

    it('validates and clamps pitch', () => {
      const result = validators.setParameterLock({
        trackId: 'track-1',
        step: 0,
        lock: { pitch: 100 }, // Out of range
      });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.lock?.pitch).toBe(24); // MAX_PLOCK_PITCH
    });

    it('validates and clamps volume', () => {
      const result = validators.setParameterLock({
        trackId: 'track-1',
        step: 0,
        lock: { volume: 5 }, // Out of range
      });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.lock?.volume).toBe(1); // MAX_PLOCK_VOLUME
    });

    it('rejects invalid lock type (non-object)', () => {
      const result = validators.setParameterLock({
        trackId: 'track-1',
        step: 0,
        lock: 'invalid' as unknown,
      });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid pitch type', () => {
      const result = validators.setParameterLock({
        trackId: 'track-1',
        step: 0,
        lock: { pitch: 'high' as unknown as number },
      });
      expect(result.valid).toBe(false);
    });

    it('accepts null lock (clearing)', () => {
      const result = validators.setParameterLock({
        trackId: 'track-1',
        step: 0,
        lock: null,
      });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.lock).toBeNull();
    });
  });

  describe('setEffects validator', () => {
    it('accepts valid complete effects object', () => {
      const result = validators.setEffects({
        effects: {
          reverb: { decay: 2, wet: 0.5 },
          delay: { time: '8n', feedback: 0.3, wet: 0.2 },
          chorus: { frequency: 2, depth: 0.5, wet: 0.1 },
          distortion: { amount: 0.3, wet: 0.1 },
        },
      });
      expect(result.valid).toBe(true);
    });

    it('clamps reverb values', () => {
      const result = validators.setEffects({
        effects: {
          reverb: { decay: 100, wet: 5 },
          delay: { time: '8n', feedback: 0.3, wet: 0.2 },
          chorus: { frequency: 2, depth: 0.5, wet: 0.1 },
          distortion: { amount: 0.3, wet: 0.1 },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.effects.reverb.decay).toBeLessThanOrEqual(10);
      expect(result.sanitized?.effects.reverb.wet).toBeLessThanOrEqual(1);
    });

    it('sanitizes invalid delay time to default', () => {
      const result = validators.setEffects({
        effects: {
          reverb: { decay: 2, wet: 0.5 },
          delay: { time: 'invalid' as unknown as string, feedback: 0.3, wet: 0.2 },
          chorus: { frequency: 2, depth: 0.5, wet: 0.1 },
          distortion: { amount: 0.3, wet: 0.1 },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.effects.delay.time).toBe('8n'); // Default
    });
  });

  describe('setFMParams validator', () => {
    it('accepts valid FM params', () => {
      const result = validators.setFMParams({
        trackId: 'track-1',
        fmParams: {
          modulationType: 'sine',
          harmonicity: 2,
          modulationIndex: 10,
          attack: 0.01,
          decay: 0.2,
          sustain: 0.5,
          release: 1,
        },
      });
      expect(result.valid).toBe(true);
    });

    it('clamps FM param values', () => {
      const result = validators.setFMParams({
        trackId: 'track-1',
        fmParams: {
          modulationType: 'sine',
          harmonicity: 100, // Out of range
          modulationIndex: 500, // Out of range
          attack: 0.01,
          decay: 0.2,
          sustain: 0.5,
          release: 1,
        },
      });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.fmParams.harmonicity).toBeLessThanOrEqual(10);
      expect(result.sanitized?.fmParams.modulationIndex).toBeLessThanOrEqual(20);
    });

    it('rejects invalid modulation type', () => {
      const result = validators.setFMParams({
        trackId: 'track-1',
        fmParams: {
          modulationType: 'invalid' as unknown as string,
          harmonicity: 2,
          modulationIndex: 10,
          attack: 0.01,
          decay: 0.2,
          sustain: 0.5,
          release: 1,
        },
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('ValidationResult interface', () => {
    it('all validators return consistent shape', () => {
      // Test that all validators return {valid, sanitized?, error?}
      const results: ValidationResult<unknown>[] = [
        validators.toggleStep({ trackId: 'track-1', step: 0 }, mockState),
        validators.setTempo({ tempo: 120 }),
        validators.setSwing({ swing: 50 }),
        validators.setTrackVolume({ trackId: 'track-1', volume: 0.5 }),
        validators.setTrackTranspose({ trackId: 'track-1', transpose: 0 }),
        validators.setParameterLock({ trackId: 'track-1', step: 0, lock: null }),
      ];

      for (const result of results) {
        expect(result).toHaveProperty('valid');
        expect(typeof result.valid).toBe('boolean');
        if (result.valid) {
          expect(result.sanitized).toBeDefined();
        } else {
          expect(result.error).toBeDefined();
        }
      }
    });
  });

  describe('All validators exist', () => {
    it('has validator for main mutation types', () => {
      const expectedValidators = [
        'toggleStep',
        'setTempo',
        'setSwing',
        'setTrackVolume',
        'setTrackTranspose',
        'setParameterLock',
        'setEffects',
        'setFMParams',
      ];

      for (const name of expectedValidators) {
        expect(validators[name as keyof typeof validators]).toBeDefined();
        expect(typeof validators[name as keyof typeof validators]).toBe('function');
      }
    });
  });
});
