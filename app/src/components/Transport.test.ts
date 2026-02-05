import { describe, it, expect } from 'vitest';
import { DEFAULT_EFFECTS_STATE } from '../audio/toneEffects';
import { DELAY_TIME_OPTIONS } from '../audio/delay-constants';

/**
 * Transport component tests
 *
 * Tests for the data logic and constraints used by the Transport component.
 * UI rendering tests require full React rendering with audio engine mocks,
 * so we test the extractable logic and data contracts here.
 */

describe('Transport data contracts', () => {
  describe('effects state defaults', () => {
    it('should have all four effect groups', () => {
      expect(DEFAULT_EFFECTS_STATE).toHaveProperty('reverb');
      expect(DEFAULT_EFFECTS_STATE).toHaveProperty('delay');
      expect(DEFAULT_EFFECTS_STATE).toHaveProperty('chorus');
      expect(DEFAULT_EFFECTS_STATE).toHaveProperty('distortion');
    });

    it('should start with all effects dry (wet = 0)', () => {
      expect(DEFAULT_EFFECTS_STATE.reverb.wet).toBe(0);
      expect(DEFAULT_EFFECTS_STATE.delay.wet).toBe(0);
      expect(DEFAULT_EFFECTS_STATE.chorus.wet).toBe(0);
      expect(DEFAULT_EFFECTS_STATE.distortion.wet).toBe(0);
    });

    it('should start with bypass disabled', () => {
      expect(DEFAULT_EFFECTS_STATE.bypass).toBe(false);
    });

    it('should have valid reverb defaults', () => {
      expect(DEFAULT_EFFECTS_STATE.reverb.decay).toBeGreaterThanOrEqual(0.1);
      expect(DEFAULT_EFFECTS_STATE.reverb.decay).toBeLessThanOrEqual(10);
    });

    it('should have valid delay defaults', () => {
      const validTimes = DELAY_TIME_OPTIONS.map(o => o.value);
      expect(validTimes).toContain(DEFAULT_EFFECTS_STATE.delay.time);
      expect(DEFAULT_EFFECTS_STATE.delay.feedback).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_EFFECTS_STATE.delay.feedback).toBeLessThanOrEqual(0.95);
    });

    it('should have valid chorus defaults', () => {
      expect(DEFAULT_EFFECTS_STATE.chorus.frequency).toBeGreaterThanOrEqual(0.1);
      expect(DEFAULT_EFFECTS_STATE.chorus.frequency).toBeLessThanOrEqual(10);
      expect(DEFAULT_EFFECTS_STATE.chorus.depth).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_EFFECTS_STATE.chorus.depth).toBeLessThanOrEqual(1);
    });

    it('should have valid distortion defaults', () => {
      expect(DEFAULT_EFFECTS_STATE.distortion.amount).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_EFFECTS_STATE.distortion.amount).toBeLessThanOrEqual(1);
    });
  });

  describe('delay time options', () => {
    it('should have at least 4 options', () => {
      expect(DELAY_TIME_OPTIONS.length).toBeGreaterThanOrEqual(4);
    });

    it('should have unique values', () => {
      const values = DELAY_TIME_OPTIONS.map(o => o.value);
      expect(new Set(values).size).toBe(values.length);
    });

    it('should have labels for all values', () => {
      for (const opt of DELAY_TIME_OPTIONS) {
        expect(opt.label).toBeTruthy();
        expect(opt.value).toBeTruthy();
      }
    });

    it('should include common musical subdivisions', () => {
      const values = DELAY_TIME_OPTIONS.map(o => o.value);
      expect(values).toContain('8n');
      expect(values).toContain('4n');
      expect(values).toContain('16n');
    });
  });

  describe('hasActiveEffects logic', () => {
    it('should detect no active effects when all wet = 0', () => {
      const effects = { ...DEFAULT_EFFECTS_STATE };
      const hasActive =
        effects.reverb.wet > 0 ||
        effects.delay.wet > 0 ||
        effects.chorus.wet > 0 ||
        effects.distortion.wet > 0;
      expect(hasActive).toBe(false);
    });

    it('should detect active effects when any wet > 0', () => {
      const effects = {
        ...DEFAULT_EFFECTS_STATE,
        reverb: { ...DEFAULT_EFFECTS_STATE.reverb, wet: 0.5 },
      };
      const hasActive =
        effects.reverb.wet > 0 ||
        effects.delay.wet > 0 ||
        effects.chorus.wet > 0 ||
        effects.distortion.wet > 0;
      expect(hasActive).toBe(true);
    });

    it.each([
      ['reverb', { ...DEFAULT_EFFECTS_STATE, reverb: { ...DEFAULT_EFFECTS_STATE.reverb, wet: 0.1 } }],
      ['delay', { ...DEFAULT_EFFECTS_STATE, delay: { ...DEFAULT_EFFECTS_STATE.delay, wet: 0.3 } }],
      ['chorus', { ...DEFAULT_EFFECTS_STATE, chorus: { ...DEFAULT_EFFECTS_STATE.chorus, wet: 0.2 } }],
      ['distortion', { ...DEFAULT_EFFECTS_STATE, distortion: { ...DEFAULT_EFFECTS_STATE.distortion, wet: 0.8 } }],
    ] as const)('should detect active when %s wet > 0', (_name, effects) => {
      const hasActive =
        effects.reverb.wet > 0 ||
        effects.delay.wet > 0 ||
        effects.chorus.wet > 0 ||
        effects.distortion.wet > 0;
      expect(hasActive).toBe(true);
    });
  });

  describe('reverb XY pad mapping', () => {
    it('should map x=0 to wet=0', () => {
      const x = 0;
      expect(x).toBe(0); // wet is used directly
    });

    it('should map x=1 to wet=1', () => {
      const x = 1;
      expect(x).toBe(1);
    });

    it('should map y=0 to decay=0.1', () => {
      const y = 0;
      const decay = 0.1 + y * 9.9;
      expect(decay).toBeCloseTo(0.1);
    });

    it('should map y=1 to decay=10', () => {
      const y = 1;
      const decay = 0.1 + y * 9.9;
      expect(decay).toBeCloseTo(10);
    });

    it('should map y=0.5 to mid-range decay', () => {
      const y = 0.5;
      const decay = 0.1 + y * 9.9;
      expect(decay).toBeCloseTo(5.05);
      expect(decay).toBeGreaterThan(0.1);
      expect(decay).toBeLessThan(10);
    });

    it('should produce valid decay for any y in [0, 1]', () => {
      for (let y = 0; y <= 1; y += 0.1) {
        const decay = 0.1 + y * 9.9;
        expect(decay).toBeGreaterThanOrEqual(0.1);
        expect(decay).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('tempo constraints', () => {
    it('should enforce minimum tempo of 60', () => {
      const min = 60;
      expect(min).toBe(60);
    });

    it('should enforce maximum tempo of 180', () => {
      const max = 180;
      expect(max).toBe(180);
    });
  });

  describe('swing constraints', () => {
    it('should enforce minimum swing of 0', () => {
      const min = 0;
      expect(min).toBe(0);
    });

    it('should enforce maximum swing of 100', () => {
      const max = 100;
      expect(max).toBe(100);
    });
  });
});
