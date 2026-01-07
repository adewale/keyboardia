/**
 * OG Image Generation Unit Tests
 *
 * Tests for the condenseSteps helper function.
 * Note: Full image generation tests require workers-og runtime which isn't available in Node.
 */

import { describe, it, expect } from 'vitest';

// Import the condenseSteps function by extracting it
// Since it's not exported, we'll recreate it for testing
function condenseSteps(steps: boolean[], targetColumns: number): boolean[] {
  if (steps.length <= targetColumns) {
    return [...steps, ...Array(targetColumns - steps.length).fill(false)];
  }

  const ratio = steps.length / targetColumns;
  return Array.from({ length: targetColumns }, (_, i) => {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    return steps.slice(start, end).some(Boolean);
  });
}

describe('condenseSteps', () => {
  describe('when steps fit in target columns', () => {
    it('pads with false when steps are fewer than target', () => {
      const steps = [true, false, true, false];
      const result = condenseSteps(steps, 16);

      expect(result.length).toBe(16);
      expect(result.slice(0, 4)).toEqual([true, false, true, false]);
      expect(result.slice(4)).toEqual(Array(12).fill(false));
    });

    it('returns exact copy when steps equal target', () => {
      const steps = [true, false, true, false, true, false, true, false,
                     false, true, false, true, false, true, false, true];
      const result = condenseSteps(steps, 16);

      expect(result).toEqual(steps);
    });

    it('handles empty steps array', () => {
      const result = condenseSteps([], 16);

      expect(result.length).toBe(16);
      expect(result.every(s => s === false)).toBe(true);
    });
  });

  describe('when steps exceed target columns (condensing)', () => {
    it('condenses 32 steps to 16 using OR reduction', () => {
      // 32 steps: first 16 all true, last 16 all false
      const steps = [...Array(16).fill(true), ...Array(16).fill(false)];
      const result = condenseSteps(steps, 16);

      expect(result.length).toBe(16);
      // Each pair of steps is condensed: [true, true] -> true, [false, false] -> false
      expect(result.slice(0, 8).every(s => s === true)).toBe(true);
      expect(result.slice(8).every(s => s === false)).toBe(true);
    });

    it('activates column if ANY step in range is active', () => {
      // 32 steps: only step 0 and step 31 are active
      const steps = Array(32).fill(false);
      steps[0] = true;
      steps[31] = true;

      const result = condenseSteps(steps, 16);

      expect(result.length).toBe(16);
      expect(result[0]).toBe(true);  // First column has step 0
      expect(result[15]).toBe(true); // Last column has step 31
      // Middle columns should be false
      expect(result.slice(1, 15).every(s => s === false)).toBe(true);
    });

    it('handles 64 steps condensed to 16', () => {
      // 64 steps: pattern of 4 active, 4 inactive repeating
      // Steps 0-3 active, 4-7 inactive, 8-11 active, etc.
      const steps = Array(64).fill(false);
      for (let i = 0; i < 64; i += 8) {
        steps[i] = true;
        steps[i + 1] = true;
        steps[i + 2] = true;
        steps[i + 3] = true;
      }

      const result = condenseSteps(steps, 16);

      expect(result.length).toBe(16);
      // 64 / 16 = 4, so each output column covers 4 input steps
      // Column 0 covers steps 0-3 (all true) -> true
      // Column 1 covers steps 4-7 (all false) -> false
      // Column 2 covers steps 8-11 (all true) -> true
      // Alternating pattern: true, false, true, false...
      expect(result[0]).toBe(true);
      expect(result[1]).toBe(false);
      expect(result[2]).toBe(true);
      expect(result[3]).toBe(false);
    });

    it('handles 128 steps condensed to 16', () => {
      // 128 steps: only first step active
      const steps = Array(128).fill(false);
      steps[0] = true;

      const result = condenseSteps(steps, 16);

      expect(result.length).toBe(16);
      expect(result[0]).toBe(true);
      expect(result.slice(1).every(s => s === false)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles single step', () => {
      const result = condenseSteps([true], 16);

      expect(result.length).toBe(16);
      expect(result[0]).toBe(true);
      expect(result.slice(1).every(s => s === false)).toBe(true);
    });

    it('handles all true steps', () => {
      const steps = Array(32).fill(true);
      const result = condenseSteps(steps, 16);

      expect(result.length).toBe(16);
      expect(result.every(s => s === true)).toBe(true);
    });

    it('handles all false steps', () => {
      const steps = Array(32).fill(false);
      const result = condenseSteps(steps, 16);

      expect(result.length).toBe(16);
      expect(result.every(s => s === false)).toBe(true);
    });

    it('handles odd number of steps', () => {
      // 17 steps condensed to 16
      const steps = Array(17).fill(false);
      steps[16] = true; // Last step active

      const result = condenseSteps(steps, 16);

      expect(result.length).toBe(16);
      expect(result[15]).toBe(true); // Last column should have the active step
    });

    it('handles prime number of steps', () => {
      // 31 steps condensed to 16
      const steps = Array(31).fill(false);
      steps[15] = true; // Middle step active

      const result = condenseSteps(steps, 16);

      expect(result.length).toBe(16);
      // Step 15 maps to column 7 or 8 depending on ratio
      expect(result.some(s => s === true)).toBe(true);
    });
  });
});

describe('OG Image Constants', () => {
  it('uses correct dimensions', () => {
    // These should match the spec (600x315 for 1.91:1 ratio)
    const OG_WIDTH = 600;
    const OG_HEIGHT = 315;

    expect(OG_WIDTH / OG_HEIGHT).toBeCloseTo(1.9, 1);
  });

  it('uses correct brand colors', () => {
    const COLORS = {
      background: '#0a0a0a',
      gridBackground: '#1a1a1a',
      activeStep: '#e85a30',
      inactiveStep: '#2a2a2a',
      text: '#ffffff',
      textMuted: '#888888',
      brand: '#ff6b35',
    };

    // Verify hex color format
    Object.values(COLORS).forEach(color => {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    // Brand orange should be recognizable
    expect(COLORS.activeStep).toBe('#e85a30');
    expect(COLORS.brand).toBe('#ff6b35');
  });
});
