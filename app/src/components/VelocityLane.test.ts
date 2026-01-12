/**
 * VelocityLane Unit Tests
 *
 * Tests for velocity editing logic that was previously only covered by
 * E2E tests (which are skipped due to Playwright mouse event limitations).
 *
 * These tests cover:
 * - Velocity level classification (visual feedback coloring)
 * - Velocity calculation from mouse position
 * - Parameter lock creation/clearing for velocity changes
 * - Velocity defaults and p-lock reading
 *
 * @see e2e/velocity-lane.spec.ts for E2E tests (skipped in CI)
 */

import { describe, it, expect } from 'vitest';
import { clampVelocity } from '../shared/validation';

// ============================================================================
// Pure Functions (extracted from VelocityLane.tsx for testability)
// ============================================================================

// Max height of velocity bars in pixels (from component)
const BAR_HEIGHT = 40;

/**
 * Get velocity level class for coloring
 * - extreme-low: < 20% (purple warning)
 * - normal: 20-80% (neutral gray)
 * - extreme-high: > 80% (red warning)
 */
function getVelocityLevel(velocity: number): 'extreme-low' | 'normal' | 'extreme-high' {
  if (velocity < 20) return 'extreme-low';
  if (velocity > 80) return 'extreme-high';
  return 'normal';
}

/**
 * Calculate velocity from mouse Y position within a step element
 * Top = 100%, Bottom = 0%
 */
function calculateVelocityFromY(y: number, elementHeight: number = BAR_HEIGHT): number {
  // Invert: top = 100%, bottom = 0%
  const velocity = Math.round((1 - y / elementHeight) * 100);
  return clampVelocity(velocity);
}

/**
 * Get velocity from parameter lock or default
 */
function getVelocityFromLock(lock: { volume?: number } | null): number {
  if (lock?.volume !== undefined) {
    return Math.round(lock.volume * 100);
  }
  return 100; // Default full velocity
}

/**
 * Determine what parameter lock should be set when changing velocity
 * - Returns null if velocity is 100% AND no pitch/tie lock (clear lock entirely)
 * - Otherwise returns merged lock with new volume
 */
function computeVelocityLock(
  velocity: number,
  existingLock: { volume?: number; pitch?: number; tie?: boolean } | null
): { volume: number; pitch?: number; tie?: boolean } | null {
  const clampedVel = clampVelocity(velocity);

  // If velocity is 100% and no pitch lock or tie, clear the lock entirely
  if (clampedVel === 100 && !existingLock?.pitch && !existingLock?.tie) {
    return null;
  }

  // Preserve pitch and tie if they exist, update volume
  return {
    ...existingLock,
    volume: clampedVel / 100,
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('VelocityLane: Velocity Level Classification', () => {
  describe('getVelocityLevel', () => {
    it('returns extreme-low for velocity < 20%', () => {
      expect(getVelocityLevel(0)).toBe('extreme-low');
      expect(getVelocityLevel(10)).toBe('extreme-low');
      expect(getVelocityLevel(19)).toBe('extreme-low');
    });

    it('returns normal for velocity 20-80%', () => {
      expect(getVelocityLevel(20)).toBe('normal');
      expect(getVelocityLevel(50)).toBe('normal');
      expect(getVelocityLevel(80)).toBe('normal');
    });

    it('returns extreme-high for velocity > 80%', () => {
      expect(getVelocityLevel(81)).toBe('extreme-high');
      expect(getVelocityLevel(90)).toBe('extreme-high');
      expect(getVelocityLevel(100)).toBe('extreme-high');
    });

    it('handles boundary values correctly', () => {
      expect(getVelocityLevel(19)).toBe('extreme-low');
      expect(getVelocityLevel(20)).toBe('normal');
      expect(getVelocityLevel(80)).toBe('normal');
      expect(getVelocityLevel(81)).toBe('extreme-high');
    });
  });
});

describe('VelocityLane: Velocity Calculation from Mouse Position', () => {
  describe('calculateVelocityFromY', () => {
    it('returns 100% at top of element (y=0)', () => {
      expect(calculateVelocityFromY(0, BAR_HEIGHT)).toBe(100);
    });

    it('returns 0% at bottom of element (y=height)', () => {
      expect(calculateVelocityFromY(BAR_HEIGHT, BAR_HEIGHT)).toBe(0);
    });

    it('returns 50% at middle of element', () => {
      expect(calculateVelocityFromY(BAR_HEIGHT / 2, BAR_HEIGHT)).toBe(50);
    });

    it('returns ~20% near bottom (80% down)', () => {
      // At 80% down: (1 - 0.8) * 100 = 20%
      const y = BAR_HEIGHT * 0.8;
      expect(calculateVelocityFromY(y, BAR_HEIGHT)).toBe(20);
    });

    it('returns ~80% near top (20% down)', () => {
      // At 20% down: (1 - 0.2) * 100 = 80%
      const y = BAR_HEIGHT * 0.2;
      expect(calculateVelocityFromY(y, BAR_HEIGHT)).toBe(80);
    });

    it('clamps negative Y (above element) to 100%', () => {
      // Y above element would give > 100%, should clamp
      expect(calculateVelocityFromY(-10, BAR_HEIGHT)).toBe(100);
    });

    it('clamps Y below element to 0%', () => {
      // Y below element would give < 0%, should clamp
      expect(calculateVelocityFromY(BAR_HEIGHT + 10, BAR_HEIGHT)).toBe(0);
    });

    it('rounds to nearest integer', () => {
      // 33.33% position
      const y = BAR_HEIGHT * 0.6667;
      const velocity = calculateVelocityFromY(y, BAR_HEIGHT);
      expect(Number.isInteger(velocity)).toBe(true);
    });
  });
});

describe('VelocityLane: Reading Velocity from Parameter Locks', () => {
  describe('getVelocityFromLock', () => {
    it('returns 100% when no lock exists', () => {
      expect(getVelocityFromLock(null)).toBe(100);
    });

    it('returns 100% when lock exists but has no volume', () => {
      expect(getVelocityFromLock({ pitch: 2 } as { volume?: number })).toBe(100);
    });

    it('converts volume 0.5 to 50%', () => {
      expect(getVelocityFromLock({ volume: 0.5 })).toBe(50);
    });

    it('converts volume 0.75 to 75%', () => {
      expect(getVelocityFromLock({ volume: 0.75 })).toBe(75);
    });

    it('converts volume 0.2 to 20%', () => {
      expect(getVelocityFromLock({ volume: 0.2 })).toBe(20);
    });

    it('rounds to nearest integer', () => {
      expect(getVelocityFromLock({ volume: 0.333 })).toBe(33);
      expect(getVelocityFromLock({ volume: 0.666 })).toBe(67);
    });
  });
});

describe('VelocityLane: Setting Velocity (Parameter Lock Logic)', () => {
  describe('computeVelocityLock', () => {
    it('returns null when setting velocity to 100% with no existing lock', () => {
      expect(computeVelocityLock(100, null)).toBe(null);
    });

    it('returns null when setting velocity to 100% with only volume lock', () => {
      expect(computeVelocityLock(100, { volume: 0.5 })).toBe(null);
    });

    it('preserves pitch when setting velocity to 100%', () => {
      const result = computeVelocityLock(100, { volume: 0.5, pitch: 2 });
      expect(result).not.toBe(null);
      expect(result?.pitch).toBe(2);
      expect(result?.volume).toBe(1); // 100% = 1.0
    });

    it('preserves tie when setting velocity to 100%', () => {
      const result = computeVelocityLock(100, { volume: 0.5, tie: true });
      expect(result).not.toBe(null);
      expect(result?.tie).toBe(true);
      expect(result?.volume).toBe(1); // 100% = 1.0
    });

    it('creates lock with volume when setting velocity < 100%', () => {
      const result = computeVelocityLock(50, null);
      expect(result).toEqual({ volume: 0.5 });
    });

    it('updates existing lock volume while preserving other properties', () => {
      const result = computeVelocityLock(75, { volume: 0.5, pitch: 3, tie: false });
      expect(result).toEqual({ volume: 0.75, pitch: 3, tie: false });
    });

    it('clamps velocity to valid range', () => {
      // Velocity > 100 should clamp to 100
      expect(computeVelocityLock(150, null)).toBe(null);

      // Velocity < 0 should clamp to 0
      const result = computeVelocityLock(-10, null);
      expect(result?.volume).toBe(0);
    });

    it('converts percentage to decimal (50% -> 0.5)', () => {
      const result = computeVelocityLock(50, null);
      expect(result?.volume).toBe(0.5);
    });

    it('converts percentage to decimal (25% -> 0.25)', () => {
      const result = computeVelocityLock(25, null);
      expect(result?.volume).toBe(0.25);
    });
  });
});

describe('VelocityLane: Velocity Curve Drawing (Multi-Step)', () => {
  /**
   * Tests the logic for drawing a velocity curve across multiple steps.
   * This covers the behavior of drag-to-paint velocity editing.
   */

  it('can compute velocities for a linear ramp from low to high', () => {
    // Simulate dragging from bottom-left to top-right
    const positions = [
      { y: BAR_HEIGHT * 0.9, step: 0 },  // ~10%
      { y: BAR_HEIGHT * 0.7, step: 1 },  // ~30%
      { y: BAR_HEIGHT * 0.5, step: 2 },  // ~50%
      { y: BAR_HEIGHT * 0.3, step: 3 },  // ~70%
    ];

    const velocities = positions.map(p => calculateVelocityFromY(p.y));

    // Each velocity should be higher than the previous
    for (let i = 1; i < velocities.length; i++) {
      expect(velocities[i]).toBeGreaterThan(velocities[i - 1]);
    }

    // First should be around 10%
    expect(velocities[0]).toBeCloseTo(10, 0);
    // Last should be around 70%
    expect(velocities[3]).toBeCloseTo(70, 0);
  });

  it('can compute velocities for a decreasing curve', () => {
    // Simulate dragging from top-left to bottom-right
    const positions = [
      { y: BAR_HEIGHT * 0.1, step: 0 },  // ~90%
      { y: BAR_HEIGHT * 0.3, step: 1 },  // ~70%
      { y: BAR_HEIGHT * 0.5, step: 2 },  // ~50%
      { y: BAR_HEIGHT * 0.7, step: 3 },  // ~30%
    ];

    const velocities = positions.map(p => calculateVelocityFromY(p.y));

    // Each velocity should be lower than the previous
    for (let i = 1; i < velocities.length; i++) {
      expect(velocities[i]).toBeLessThan(velocities[i - 1]);
    }
  });

  it('handles setting same velocity across all steps', () => {
    // Simulate horizontal drag (constant Y)
    const y = BAR_HEIGHT * 0.5; // 50%
    const velocities = [0, 1, 2, 3].map(() => calculateVelocityFromY(y));

    // All should be 50%
    velocities.forEach(v => {
      expect(v).toBe(50);
    });
  });
});

describe('VelocityLane: Reset to 100% Behavior', () => {
  /**
   * Tests the "reset to 100%" behavior that the skipped E2E test
   * "should reset velocity to 100% when setting full height" was testing.
   */

  it('clicking at top (y=0) sets velocity to 100%', () => {
    const velocity = calculateVelocityFromY(0, BAR_HEIGHT);
    expect(velocity).toBe(100);
  });

  it('setting velocity to 100% clears the lock entirely', () => {
    const result = computeVelocityLock(100, { volume: 0.5 });
    expect(result).toBe(null);
  });

  it('resetting velocity preserves pitch lock at 100%', () => {
    const result = computeVelocityLock(100, { volume: 0.5, pitch: 5 });
    expect(result).not.toBe(null);
    expect(result?.pitch).toBe(5);
    expect(result?.volume).toBe(1);
  });

  it('full reset workflow: low velocity -> drag to top -> lock cleared', () => {
    // Start with 50% velocity
    const initialLock = computeVelocityLock(50, null);
    expect(initialLock?.volume).toBe(0.5);

    // Drag to top (100%)
    const velocity = calculateVelocityFromY(0, BAR_HEIGHT);
    expect(velocity).toBe(100);

    // Apply reset
    const finalLock = computeVelocityLock(velocity, initialLock);
    expect(finalLock).toBe(null);
  });
});

describe('VelocityLane: Edge Cases', () => {
  it('handles extremely small bar heights', () => {
    // Even with a 1px bar, calculations should work
    const velocity = calculateVelocityFromY(0.5, 1);
    expect(velocity).toBe(50);
  });

  it('handles velocity at exactly 80% boundary', () => {
    expect(getVelocityLevel(80)).toBe('normal');
  });

  it('handles velocity at exactly 20% boundary', () => {
    expect(getVelocityLevel(20)).toBe('normal');
  });

  it('preserves all existing lock properties when updating volume', () => {
    const existingLock = {
      volume: 0.5,
      pitch: 3,
      tie: true,
    };

    const result = computeVelocityLock(75, existingLock);

    expect(result?.volume).toBe(0.75);
    expect(result?.pitch).toBe(3);
    expect(result?.tie).toBe(true);
  });
});
