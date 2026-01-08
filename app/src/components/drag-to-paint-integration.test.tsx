/**
 * Drag-to-Paint Integration Tests
 *
 * These tests render actual React components (StepCell, TrackRow simulation)
 * and verify the drag-to-paint behavior through simulated pointer events.
 *
 * Unlike unit tests that test logic in isolation, these tests verify
 * that the components work together correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';

// ============================================================
// Test Harness: Minimal TrackRow Implementation
// ============================================================
// This mirrors the paint logic from TrackRow.tsx without the full component

interface MinimalTrackRowProps {
  initialSteps: boolean[];
  onStepsChange?: (steps: boolean[]) => void;
}

function MinimalTrackRow({ initialSteps, onStepsChange }: MinimalTrackRowProps) {
  const [steps, setSteps] = useState(initialSteps);
  const [paintMode, setPaintMode] = useState<'on' | 'off' | null>(null);
  const paintModeRef = useRef<'on' | 'off' | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    paintModeRef.current = paintMode;
  }, [paintMode]);

  // Notify parent of step changes
  useEffect(() => {
    onStepsChange?.(steps);
  }, [steps, onStepsChange]);

  // Global pointerup listener
  useEffect(() => {
    const handlePointerUp = () => {
      if (paintModeRef.current !== null) {
        setPaintMode(null);
      }
    };

    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    return () => {
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const onToggleStep = useCallback((index: number) => {
    setSteps((prev) => {
      const newSteps = [...prev];
      newSteps[index] = !newSteps[index];
      return newSteps;
    });
  }, []);

  const handlePaintStart = useCallback(
    (stepIndex: number) => {
      const wasActive = steps[stepIndex];
      const newState = !wasActive;
      setPaintMode(newState ? 'on' : 'off');
      onToggleStep(stepIndex);
    },
    [steps, onToggleStep]
  );

  const handlePaintEnter = useCallback(
    (stepIndex: number) => {
      const currentPaintMode = paintModeRef.current;
      if (currentPaintMode === null) return;
      const isActive = steps[stepIndex];
      const shouldBeActive = currentPaintMode === 'on';
      if (isActive !== shouldBeActive) {
        onToggleStep(stepIndex);
      }
    },
    [steps, onToggleStep]
  );

  // Memoized handlers for each step
  const stepPaintStartHandlers = useMemo(
    () => steps.map((_, i) => () => handlePaintStart(i)),
    [steps, handlePaintStart]
  );

  const stepPaintEnterHandlers = useMemo(
    () => steps.map((_, i) => () => handlePaintEnter(i)),
    [steps, handlePaintEnter]
  );

  return (
    <div data-testid="track-row" data-paint-mode={paintMode || 'none'}>
      {steps.map((active, index) => (
        <MinimalStepCell
          key={index}
          stepIndex={index}
          active={active}
          onPaintStart={stepPaintStartHandlers[index]}
          onPaintEnter={stepPaintEnterHandlers[index]}
        />
      ))}
    </div>
  );
}

interface MinimalStepCellProps {
  stepIndex: number;
  active: boolean;
  onPaintStart: () => void;
  onPaintEnter: () => void;
}

function MinimalStepCell({
  stepIndex,
  active,
  onPaintStart,
  onPaintEnter,
}: MinimalStepCellProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // Skip if Ctrl or Shift is held (those have different behaviors)
      if (e.ctrlKey || e.shiftKey || e.metaKey) return;
      onPaintStart();
    },
    [onPaintStart]
  );

  const handlePointerEnter = useCallback(() => {
    onPaintEnter();
  }, [onPaintEnter]);

  return (
    <button
      data-testid={`step-${stepIndex}`}
      data-active={active}
      className={active ? 'active' : ''}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
    >
      Step {stepIndex}
    </button>
  );
}

// ============================================================
// Integration Tests
// ============================================================

describe('Drag-to-Paint Integration', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Basic Paint Operations', () => {
    it('should activate step on pointer down', async () => {
      const onStepsChange = vi.fn();
      const { getByTestId } = render(
        <MinimalTrackRow
          initialSteps={[false, false, false, false]}
          onStepsChange={onStepsChange}
        />
      );

      // Pointer down on step 0
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      // Verify step is now active
      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('true');
      });
    });

    it('should deactivate step when starting from active', async () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[true, false, false, false]} />
      );

      // Verify step 0 starts active
      expect(getByTestId('step-0').getAttribute('data-active')).toBe('true');

      // Pointer down on step 0 (active) should deactivate it
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('false');
      });
    });

    it('should set paint mode correctly based on initial step', () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // Click inactive step - paint mode should be 'on'
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      expect(getByTestId('track-row').getAttribute('data-paint-mode')).toBe('on');
    });
  });

  describe('Drag Paint Flow', () => {
    it('should paint multiple steps when dragging', async () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // Start paint on step 0
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      // Enter step 1
      fireEvent.pointerEnter(getByTestId('step-1'));

      // Enter step 2
      fireEvent.pointerEnter(getByTestId('step-2'));

      // Verify all steps are active
      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-1').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-2').getAttribute('data-active')).toBe('true');
      });

      // Step 3 should still be inactive (not entered)
      expect(getByTestId('step-3').getAttribute('data-active')).toBe('false');
    });

    it('should erase multiple steps when starting from active', async () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[true, true, true, true]} />
      );

      // Start erase on step 0 (active)
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      // Enter step 1
      fireEvent.pointerEnter(getByTestId('step-1'));

      // Enter step 2
      fireEvent.pointerEnter(getByTestId('step-2'));

      // Verify steps are now inactive
      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('false');
        expect(getByTestId('step-1').getAttribute('data-active')).toBe('false');
        expect(getByTestId('step-2').getAttribute('data-active')).toBe('false');
      });

      // Step 3 should still be active
      expect(getByTestId('step-3').getAttribute('data-active')).toBe('true');
    });

    it('should end paint mode on global pointerup', async () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // Start paint
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      expect(getByTestId('track-row').getAttribute('data-paint-mode')).toBe('on');

      // Global pointerup
      await act(async () => {
        document.dispatchEvent(new PointerEvent('pointerup'));
      });

      // Paint mode should be cleared
      await waitFor(() => {
        expect(getByTestId('track-row').getAttribute('data-paint-mode')).toBe('none');
      });
    });

    it('should not continue painting after pointerup', async () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // Start paint
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      // Paint step 1
      fireEvent.pointerEnter(getByTestId('step-1'));

      // Release
      await act(async () => {
        document.dispatchEvent(new PointerEvent('pointerup'));
      });

      // Now enter step 2 - should NOT be painted
      fireEvent.pointerEnter(getByTestId('step-2'));

      // Step 2 should still be inactive
      expect(getByTestId('step-2').getAttribute('data-active')).toBe('false');
    });
  });

  describe('Mixed Step Patterns', () => {
    it('should only paint inactive steps when in "on" mode', async () => {
      // Checkerboard: 0=inactive, 1=active, 2=inactive, 3=active
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, true, false, true]} />
      );

      // Start on inactive step 0 -> paint mode = 'on'
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      // Enter step 1 (already active) - should NOT toggle
      fireEvent.pointerEnter(getByTestId('step-1'));

      // Enter step 2 (inactive) - should activate
      fireEvent.pointerEnter(getByTestId('step-2'));

      // Enter step 3 (already active) - should NOT toggle
      fireEvent.pointerEnter(getByTestId('step-3'));

      // Final state: all active
      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-1').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-2').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-3').getAttribute('data-active')).toBe('true');
      });
    });

    it('should only erase active steps when in "off" mode', async () => {
      // Checkerboard: 0=active, 1=inactive, 2=active, 3=inactive
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[true, false, true, false]} />
      );

      // Start on active step 0 -> paint mode = 'off'
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      // Enter step 1 (already inactive) - should NOT toggle
      fireEvent.pointerEnter(getByTestId('step-1'));

      // Enter step 2 (active) - should deactivate
      fireEvent.pointerEnter(getByTestId('step-2'));

      // Enter step 3 (already inactive) - should NOT toggle
      fireEvent.pointerEnter(getByTestId('step-3'));

      // Final state: all inactive
      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('false');
        expect(getByTestId('step-1').getAttribute('data-active')).toBe('false');
        expect(getByTestId('step-2').getAttribute('data-active')).toBe('false');
        expect(getByTestId('step-3').getAttribute('data-active')).toBe('false');
      });
    });
  });

  describe('Re-entry Behavior', () => {
    it('should not toggle step when re-entering during same paint', async () => {
      const onStepsChange = vi.fn();
      const { getByTestId } = render(
        <MinimalTrackRow
          initialSteps={[false, false, false, false]}
          onStepsChange={onStepsChange}
        />
      );

      // Reset call count after initial render
      onStepsChange.mockClear();

      // Start paint
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      // Enter step 1
      fireEvent.pointerEnter(getByTestId('step-1'));

      // Re-enter step 0 (already painted to active)
      fireEvent.pointerEnter(getByTestId('step-0'));

      // Step 0 should still be active, not toggled back off
      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('true');
      });
    });

    it('should handle back-and-forth dragging correctly', async () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // Start on step 1
      fireEvent.pointerDown(getByTestId('step-1'), { button: 0 });

      // Move right to step 2
      fireEvent.pointerEnter(getByTestId('step-2'));

      // Move back to step 1
      fireEvent.pointerEnter(getByTestId('step-1'));

      // Move left to step 0
      fireEvent.pointerEnter(getByTestId('step-0'));

      // Move right again to step 1
      fireEvent.pointerEnter(getByTestId('step-1'));

      // Move to step 2
      fireEvent.pointerEnter(getByTestId('step-2'));

      // Move to step 3
      fireEvent.pointerEnter(getByTestId('step-3'));

      // All steps should be active (no double-toggles)
      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-1').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-2').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-3').getAttribute('data-active')).toBe('true');
      });
    });
  });

  describe('Modifier Keys', () => {
    it('should not start painting when Ctrl is held', () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // Ctrl+pointer down
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0, ctrlKey: true });

      // Step should remain inactive
      expect(getByTestId('step-0').getAttribute('data-active')).toBe('false');

      // Paint mode should not be set
      expect(getByTestId('track-row').getAttribute('data-paint-mode')).toBe('none');
    });

    it('should not start painting when Shift is held', () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // Shift+pointer down
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0, shiftKey: true });

      // Step should remain inactive
      expect(getByTestId('step-0').getAttribute('data-active')).toBe('false');
    });

    it('should not start painting on right click', () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // Right click (button 2)
      fireEvent.pointerDown(getByTestId('step-0'), { button: 2 });

      // Step should remain inactive
      expect(getByTestId('step-0').getAttribute('data-active')).toBe('false');
    });
  });

  describe('Sequential Operations', () => {
    it('should handle multiple paint/erase cycles correctly', async () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // First paint cycle
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });
      fireEvent.pointerEnter(getByTestId('step-1'));
      await act(async () => {
        document.dispatchEvent(new PointerEvent('pointerup'));
      });

      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-1').getAttribute('data-active')).toBe('true');
      });

      // Erase cycle (start from active step)
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });
      fireEvent.pointerEnter(getByTestId('step-1'));
      await act(async () => {
        document.dispatchEvent(new PointerEvent('pointerup'));
      });

      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('false');
        expect(getByTestId('step-1').getAttribute('data-active')).toBe('false');
      });

      // Another paint cycle
      fireEvent.pointerDown(getByTestId('step-2'), { button: 0 });
      fireEvent.pointerEnter(getByTestId('step-3'));
      await act(async () => {
        document.dispatchEvent(new PointerEvent('pointerup'));
      });

      await waitFor(() => {
        expect(getByTestId('step-2').getAttribute('data-active')).toBe('true');
        expect(getByTestId('step-3').getAttribute('data-active')).toBe('true');
      });

      // Final state: [false, false, true, true]
      expect(getByTestId('step-0').getAttribute('data-active')).toBe('false');
      expect(getByTestId('step-1').getAttribute('data-active')).toBe('false');
    });
  });

  describe('Edge Cases', () => {
    it('should handle 16-step pattern', async () => {
      const steps = new Array(16).fill(false);
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={steps} />
      );

      // Paint all 16 steps
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });
      for (let i = 1; i < 16; i++) {
        fireEvent.pointerEnter(getByTestId(`step-${i}`));
      }

      // Verify all steps active
      await waitFor(() => {
        for (let i = 0; i < 16; i++) {
          expect(getByTestId(`step-${i}`).getAttribute('data-active')).toBe('true');
        }
      });
    });

    it('should handle single step pattern', async () => {
      const { getByTestId } = render(<MinimalTrackRow initialSteps={[false]} />);

      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      await waitFor(() => {
        expect(getByTestId('step-0').getAttribute('data-active')).toBe('true');
      });
    });

    it('should handle pointercancel event', async () => {
      const { getByTestId } = render(
        <MinimalTrackRow initialSteps={[false, false, false, false]} />
      );

      // Start paint
      fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

      expect(getByTestId('track-row').getAttribute('data-paint-mode')).toBe('on');

      // Pointer cancelled (e.g., palm rejection)
      await act(async () => {
        document.dispatchEvent(new PointerEvent('pointercancel'));
      });

      // Paint mode should be cleared
      await waitFor(() => {
        expect(getByTestId('track-row').getAttribute('data-paint-mode')).toBe('none');
      });
    });
  });
});

// ============================================================
// Stale Closure Bug Detection Tests
// ============================================================
// These tests specifically target the stale closure issue where
// paintMode state could be stale in callbacks.

describe('Stale Closure Detection', () => {
  it('should use current paint mode when entering steps', async () => {
    // This test verifies that paintModeRef correctly provides
    // the current value, not a stale closure value

    const paintModeLog: Array<'on' | 'off' | null> = [];

    function TestComponent() {
      const [steps, setSteps] = useState([false, false, false, false]);
      const [paintMode, setPaintMode] = useState<'on' | 'off' | null>(null);
      const paintModeRef = useRef<'on' | 'off' | null>(null);

      useEffect(() => {
        paintModeRef.current = paintMode;
      }, [paintMode]);

      const handlePaintStart = useCallback(
        (index: number) => {
          const wasActive = steps[index];
          const newMode = !wasActive ? 'on' : 'off';
          setPaintMode(newMode);
          setSteps((prev) => {
            const next = [...prev];
            next[index] = !prev[index];
            return next;
          });
        },
        [steps]
      );

      const handlePaintEnter = useCallback(
        (index: number) => {
          // Log what paintModeRef sees at this moment
          paintModeLog.push(paintModeRef.current);

          const currentPaintMode = paintModeRef.current;
          if (currentPaintMode === null) return;
          const isActive = steps[index];
          const shouldBeActive = currentPaintMode === 'on';
          if (isActive !== shouldBeActive) {
            setSteps((prev) => {
              const next = [...prev];
              next[index] = !prev[index];
              return next;
            });
          }
        },
        [steps]
      );

      return (
        <div>
          {steps.map((active, i) => (
            <button
              key={i}
              data-testid={`step-${i}`}
              data-active={active}
              onPointerDown={() => handlePaintStart(i)}
              onPointerEnter={() => handlePaintEnter(i)}
            >
              {i}
            </button>
          ))}
        </div>
      );
    }

    const { getByTestId } = render(<TestComponent />);

    // Start paint on step 0
    fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

    // After the next tick, ref should be updated
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Enter step 1
    fireEvent.pointerEnter(getByTestId('step-1'));

    // The paintModeRef should have been 'on' when entering step 1
    // If there's a stale closure bug, it might be null
    expect(paintModeLog[paintModeLog.length - 1]).toBe('on');

    cleanup();
  });
});
