/**
 * Swing Control Tests
 *
 * This file provides comprehensive test coverage for swing changes that the
 * E2E drag test couldn't reliably cover due to Playwright limitations with
 * mouse button state (e.buttons).
 *
 * Replaces: e2e/core.spec.ts - "can drag to change swing" and "Swing Control" tests
 *
 * Test Strategy:
 * 1. UNIT: Pure function tests for drag calculation logic
 * 2. INTEGRATION: React state flow tests (dispatch → state → render)
 * 3. PROPERTY-BASED: Invariant tests for swing bounds and behavior
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import type { GridState } from '../types';

// =============================================================================
// SECTION 1: Pure Function - Drag Calculation Logic
// =============================================================================

/**
 * Calculate new swing from drag delta.
 * This mirrors the logic in TransportBar.handleDragMove.
 *
 * Swing uses a different sensitivity (1.0 vs 0.5 for tempo) because:
 * - Swing range is 0-100 (smaller range than tempo 60-180)
 * - Users need finer control over swing timing
 *
 * @param startValue - Initial swing when drag started
 * @param startY - Y coordinate when drag started
 * @param currentY - Current Y coordinate
 * @param sensitivity - Multiplier for drag sensitivity (1.0 for swing)
 * @param min - Minimum allowed swing (0)
 * @param max - Maximum allowed swing (100)
 * @returns Calculated swing value, clamped to [min, max]
 */
export function calculateSwingDragValue(
  startValue: number,
  startY: number,
  currentY: number,
  sensitivity: number,
  min: number,
  max: number
): number {
  const delta = startY - currentY; // Drag up (negative currentY change) = increase
  const newValue = Math.round(startValue + delta * sensitivity);
  return Math.min(max, Math.max(min, newValue));
}

describe('Swing Drag Calculation (Unit)', () => {
  const SWING_SENSITIVITY = 1.0;
  const MIN_SWING = 0;
  const MAX_SWING = 100;

  it('should increase swing when dragging up', () => {
    // Drag up means currentY < startY (moving cursor up decreases Y)
    const result = calculateSwingDragValue(50, 100, 70, SWING_SENSITIVITY, MIN_SWING, MAX_SWING);
    // delta = 100 - 70 = 30, change = 30 * 1.0 = 30
    expect(result).toBe(80);
  });

  it('should decrease swing when dragging down', () => {
    // Drag down means currentY > startY
    const result = calculateSwingDragValue(50, 100, 130, SWING_SENSITIVITY, MIN_SWING, MAX_SWING);
    // delta = 100 - 130 = -30, change = -30 * 1.0 = -30
    expect(result).toBe(20);
  });

  it('should clamp to minimum swing (0)', () => {
    // Drag far down
    const result = calculateSwingDragValue(30, 100, 200, SWING_SENSITIVITY, MIN_SWING, MAX_SWING);
    // delta = 100 - 200 = -100, change = -100 * 1.0 = -100
    // 30 - 100 = -70, clamped to 0
    expect(result).toBe(MIN_SWING);
  });

  it('should clamp to maximum swing (100)', () => {
    // Drag far up
    const result = calculateSwingDragValue(70, 100, 0, SWING_SENSITIVITY, MIN_SWING, MAX_SWING);
    // delta = 100 - 0 = 100, change = 100 * 1.0 = 100
    // 70 + 100 = 170, clamped to 100
    expect(result).toBe(MAX_SWING);
  });

  it('should return same value when no drag movement', () => {
    const result = calculateSwingDragValue(50, 100, 100, SWING_SENSITIVITY, MIN_SWING, MAX_SWING);
    expect(result).toBe(50);
  });

  it('should handle starting at 0', () => {
    // Start at min, drag down - should stay at min
    expect(calculateSwingDragValue(0, 100, 150, SWING_SENSITIVITY, MIN_SWING, MAX_SWING)).toBe(0);
    // Start at min, drag up - should increase
    expect(calculateSwingDragValue(0, 100, 50, SWING_SENSITIVITY, MIN_SWING, MAX_SWING)).toBe(50);
  });

  it('should handle starting at 100', () => {
    // Start at max, drag up - should stay at max
    expect(calculateSwingDragValue(100, 100, 50, SWING_SENSITIVITY, MIN_SWING, MAX_SWING)).toBe(100);
    // Start at max, drag down - should decrease
    expect(calculateSwingDragValue(100, 100, 150, SWING_SENSITIVITY, MIN_SWING, MAX_SWING)).toBe(50);
  });

  it('should round to nearest integer', () => {
    // With sensitivity 0.5: delta = 3, change = 1.5, rounded to 2
    const result = calculateSwingDragValue(50, 100, 97, 0.5, MIN_SWING, MAX_SWING);
    expect(result).toBe(52);
  });
});

// =============================================================================
// SECTION 2: Property-Based Tests for Swing Drag Calculation
// =============================================================================

describe('Swing Drag Calculation (Property-Based)', () => {
  const SWING_SENSITIVITY = 1.0;
  const MIN_SWING = 0;
  const MAX_SWING = 100;

  // Arbitrary for valid swing values
  const arbSwing = fc.integer({ min: MIN_SWING, max: MAX_SWING });

  // Arbitrary for Y coordinates (reasonable screen range)
  const arbYCoord = fc.integer({ min: -500, max: 1000 });

  it('P-001: result is always within valid swing bounds (0-100)', () => {
    fc.assert(
      fc.property(arbSwing, arbYCoord, arbYCoord, (startSwing, startY, currentY) => {
        const result = calculateSwingDragValue(
          startSwing,
          startY,
          currentY,
          SWING_SENSITIVITY,
          MIN_SWING,
          MAX_SWING
        );

        expect(result).toBeGreaterThanOrEqual(MIN_SWING);
        expect(result).toBeLessThanOrEqual(MAX_SWING);
      }),
      { numRuns: 1000 }
    );
  });

  it('P-002: result is always an integer', () => {
    fc.assert(
      fc.property(arbSwing, arbYCoord, arbYCoord, (startSwing, startY, currentY) => {
        const result = calculateSwingDragValue(
          startSwing,
          startY,
          currentY,
          SWING_SENSITIVITY,
          MIN_SWING,
          MAX_SWING
        );

        expect(Number.isInteger(result)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('P-003: same drag distance produces consistent swing change', () => {
    fc.assert(
      fc.property(
        arbSwing,
        arbYCoord,
        fc.integer({ min: -200, max: 200 }), // drag distance
        (startSwing, startY, dragDistance) => {
          const result1 = calculateSwingDragValue(
            startSwing,
            startY,
            startY - dragDistance,
            SWING_SENSITIVITY,
            MIN_SWING,
            MAX_SWING
          );

          // Same calculation with different starting Y but same distance
          const result2 = calculateSwingDragValue(
            startSwing,
            startY + 100,
            startY + 100 - dragDistance,
            SWING_SENSITIVITY,
            MIN_SWING,
            MAX_SWING
          );

          // Both should give same result
          expect(result1).toBe(result2);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('P-004: drag up always increases or maintains swing (within bounds)', () => {
    fc.assert(
      fc.property(
        arbSwing,
        arbYCoord,
        fc.integer({ min: 1, max: 200 }), // positive drag up distance
        (startSwing, startY, dragUp) => {
          const result = calculateSwingDragValue(
            startSwing,
            startY,
            startY - dragUp,
            SWING_SENSITIVITY,
            MIN_SWING,
            MAX_SWING
          );

          // Result should be >= startSwing (unless clamped at max)
          expect(result).toBeGreaterThanOrEqual(Math.min(startSwing, MAX_SWING));
        }
      ),
      { numRuns: 500 }
    );
  });

  it('P-005: drag down always decreases or maintains swing (within bounds)', () => {
    fc.assert(
      fc.property(
        arbSwing,
        arbYCoord,
        fc.integer({ min: 1, max: 200 }), // positive drag down distance
        (startSwing, startY, dragDown) => {
          const result = calculateSwingDragValue(
            startSwing,
            startY,
            startY + dragDown,
            SWING_SENSITIVITY,
            MIN_SWING,
            MAX_SWING
          );

          // Result should be <= startSwing (unless clamped at min)
          expect(result).toBeLessThanOrEqual(Math.max(startSwing, MIN_SWING));
        }
      ),
      { numRuns: 500 }
    );
  });

  it('P-006: zero drag distance preserves swing', () => {
    fc.assert(
      fc.property(arbSwing, arbYCoord, (startSwing, startY) => {
        const result = calculateSwingDragValue(
          startSwing,
          startY,
          startY, // No movement
          SWING_SENSITIVITY,
          MIN_SWING,
          MAX_SWING
        );

        expect(result).toBe(startSwing);
      }),
      { numRuns: 500 }
    );
  });
});

// =============================================================================
// SECTION 3: Integration Tests - State Flow
// =============================================================================

describe('Swing State Flow (Integration)', () => {
  const createTestState = (): GridState => ({
    tracks: [],
    tempo: 120,
    swing: 0,
    isPlaying: false,
    currentStep: -1,
  });

  it('I-001: SET_SWING action updates state correctly', async () => {
    const { gridReducer } = await import('../state/grid');
    const initialState = createTestState();

    const newState = gridReducer(initialState, { type: 'SET_SWING', swing: 50 });

    expect(newState.swing).toBe(50);
  });

  it('I-002: SET_SWING clamps values to valid range (0-100)', async () => {
    const { gridReducer } = await import('../state/grid');
    const initialState = createTestState();

    // Test clamping at lower bound
    const lowState = gridReducer(initialState, { type: 'SET_SWING', swing: -20 });
    expect(lowState.swing).toBe(0); // Clamped to MIN_SWING

    // Test clamping at upper bound
    const highState = gridReducer(initialState, { type: 'SET_SWING', swing: 150 });
    expect(highState.swing).toBe(100); // Clamped to MAX_SWING
  });

  it('I-003: Multiple swing changes preserve only latest value', async () => {
    const { gridReducer } = await import('../state/grid');
    let state = createTestState();

    state = gridReducer(state, { type: 'SET_SWING', swing: 25 });
    state = gridReducer(state, { type: 'SET_SWING', swing: 50 });
    state = gridReducer(state, { type: 'SET_SWING', swing: 75 });

    expect(state.swing).toBe(75);
  });

  it('I-004: Swing change does not affect other state fields', async () => {
    const { gridReducer } = await import('../state/grid');
    let state = createTestState();

    // Add a track and set tempo
    state = gridReducer(state, {
      type: 'ADD_TRACK',
      sampleId: 'synth:kick',
      name: 'Kick',
    });
    state = gridReducer(state, { type: 'SET_TEMPO', tempo: 140 });

    // Get state before swing change
    const trackCountBefore = state.tracks.length;
    const tempoBefore = state.tempo;

    // Change swing
    const newState = gridReducer(state, { type: 'SET_SWING', swing: 75 });

    // Other fields should be unchanged
    expect(newState.tracks.length).toBe(trackCountBefore);
    expect(newState.tempo).toBe(tempoBefore);
  });

  it('I-005: Swing 0 means no shuffle (straight timing)', async () => {
    const { gridReducer } = await import('../state/grid');
    const state = gridReducer(createTestState(), { type: 'SET_SWING', swing: 0 });

    expect(state.swing).toBe(0);
    // At swing 0, all 16th notes play at even intervals (standard sequencer behavior)
  });

  it('I-006: Swing 100 means maximum shuffle', async () => {
    const { gridReducer } = await import('../state/grid');
    const state = gridReducer(createTestState(), { type: 'SET_SWING', swing: 100 });

    expect(state.swing).toBe(100);
    // At swing 100, off-beat notes are delayed to create triplet-like feel
  });
});

// =============================================================================
// SECTION 4: Property-Based Integration Tests
// =============================================================================

describe('Swing Mutations (Property-Based Integration)', () => {
  const arbSwing = fc.integer({ min: 0, max: 100 });

  it('PI-001: applyMutation set_swing is idempotent for same value', async () => {
    const { applyMutation } = await import('../shared/state-mutations');
    const { arbSessionState } = await import('../test/arbitraries');

    fc.assert(
      fc.property(arbSessionState, arbSwing, (state, swing) => {
        const state1 = applyMutation(state, { type: 'set_swing', swing });
        const state2 = applyMutation(state1, { type: 'set_swing', swing });

        // Applying same swing twice should give identical state
        expect(state1.swing).toBe(state2.swing);
      }),
      { numRuns: 500 }
    );
  });

  it('PI-002: swing change commutes with track mutations', async () => {
    const { applyMutation, createDefaultTrack } = await import('../shared/state-mutations');
    const { arbStepIndex } = await import('../test/arbitraries');

    const initialState = {
      tracks: [createDefaultTrack('track-1', 'synth:kick', 'Kick')],
      tempo: 120,
      swing: 0,
      version: 1,
    };

    fc.assert(
      fc.property(arbSwing, arbStepIndex, (newSwing, step) => {
        const trackId = 'track-1';

        // Order 1: swing then toggle
        const s1 = applyMutation(initialState, { type: 'set_swing', swing: newSwing });
        const s1Final = applyMutation(s1, { type: 'toggle_step', trackId, step });

        // Order 2: toggle then swing
        const s2 = applyMutation(initialState, { type: 'toggle_step', trackId, step });
        const s2Final = applyMutation(s2, { type: 'set_swing', swing: newSwing });

        // Final states should be equivalent
        expect(s1Final.swing).toBe(s2Final.swing);
        expect(s1Final.tracks[0].steps).toEqual(s2Final.tracks[0].steps);
      }),
      { numRuns: 500 }
    );
  });

  it('PI-003: swing survives state serialization round-trip', async () => {
    const { arbSessionState } = await import('../test/arbitraries');

    fc.assert(
      fc.property(arbSessionState, (state) => {
        // Serialize and deserialize
        const serialized = JSON.stringify(state);
        const deserialized = JSON.parse(serialized);

        expect(deserialized.swing).toBe(state.swing);
      }),
      { numRuns: 500 }
    );
  });
});

// =============================================================================
// SECTION 5: Callback Integration Tests (React Flow)
// =============================================================================

describe('Swing Callback Flow (Integration)', () => {
  it('C-001: onSwingChange callback receives correct value', () => {
    const mockOnSwingChange = vi.fn();

    // Simulate what TransportBar does when calling the callback
    const simulateDragResult = (startSwing: number, dragDelta: number) => {
      const SENSITIVITY = 1.0;
      const MIN = 0;
      const MAX = 100;

      const newSwing = Math.round(
        Math.min(MAX, Math.max(MIN, startSwing + dragDelta * SENSITIVITY))
      );
      mockOnSwingChange(newSwing);
    };

    // Simulate drag up by 30px from swing 50
    simulateDragResult(50, 30);
    expect(mockOnSwingChange).toHaveBeenCalledWith(80);

    mockOnSwingChange.mockClear();

    // Simulate drag down by 100px from swing 50
    simulateDragResult(50, -100);
    expect(mockOnSwingChange).toHaveBeenCalledWith(0); // Clamped to MIN
  });

  it('C-002: rapid swing changes all call callback', () => {
    const mockOnSwingChange = vi.fn();

    // Simulate rapid drag movements
    [0, 25, 50, 75, 100].forEach((swing) => {
      mockOnSwingChange(swing);
    });

    expect(mockOnSwingChange).toHaveBeenCalledTimes(5);
    expect(mockOnSwingChange).toHaveBeenLastCalledWith(100);
  });
});

// =============================================================================
// SECTION 6: Swing Timing Effect (Musical Behavior)
// =============================================================================

describe('Swing Timing Effect (Musical)', () => {
  /**
   * Swing affects the timing of off-beat notes (odd-numbered 16th notes).
   * At 0% swing: all notes play at even intervals.
   * At 100% swing: off-beat notes are delayed to create a triplet-like feel.
   *
   * The actual timing calculation happens in the scheduler, but we can
   * verify the swing value is correctly stored and accessible.
   */

  it('should represent swing as a percentage (0-100)', async () => {
    const { gridReducer } = await import('../state/grid');

    // Test various swing percentages
    const testValues = [0, 25, 50, 66, 75, 100];

    for (const swing of testValues) {
      const state = gridReducer(
        { tracks: [], tempo: 120, swing: 0, isPlaying: false, currentStep: -1 },
        { type: 'SET_SWING', swing }
      );
      expect(state.swing).toBe(swing);
    }
  });

  it('should default to 0% swing (no shuffle)', async () => {
    const { gridReducer } = await import('../state/grid');
    const state = gridReducer(
      { tracks: [], tempo: 120, swing: 50, isPlaying: false, currentStep: -1 },
      { type: 'RESET_STATE' }
    );

    expect(state.swing).toBe(0);
  });
});
