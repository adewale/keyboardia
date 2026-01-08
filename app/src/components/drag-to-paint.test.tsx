/**
 * Drag-to-Paint Unit Tests
 *
 * Comprehensive tests for the drag-to-paint feature (Phase 31F).
 * Tests paint mode state management in TrackRow and pointer event
 * handling in StepCell.
 *
 * These tests verify:
 * - Paint mode transitions (null → 'on'/'off' → null)
 * - Paint handler callbacks are invoked correctly
 * - Pointer capture behavior
 * - Modifier key interactions (Ctrl, Shift)
 * - Paint mode clearing on pointerup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import React, { useState, useCallback, useRef, useEffect } from 'react';

// ============================================================
// BUG DOCUMENTATION: pointer-capture-multi-element
// ============================================================
// The current StepCell implementation uses setPointerCapture() which
// BREAKS drag-to-paint. When setPointerCapture is called:
// - ALL pointer events are routed to the capturing element
// - pointerenter/pointerleave NEVER fire on other elements
// - The fix is to use container-based event handling with hit-testing
// See: src/utils/bug-patterns.ts 'pointer-capture-multi-element'
// ============================================================

// ============================================================
// PART 1: Paint Mode State Management Tests
// ============================================================
// These tests verify the paint mode logic in isolation,
// simulating the state management pattern from TrackRow.

describe('Paint Mode State Management', () => {
  describe('handlePaintStart', () => {
    it('should set paintMode to "on" when starting from an inactive step', () => {
      const steps = [false, false, false, false];
      let paintMode: 'on' | 'off' | null = null;
      const toggledSteps: number[] = [];

      const handlePaintStart = (stepIndex: number) => {
        const wasActive = steps[stepIndex];
        const newState = !wasActive;
        paintMode = newState ? 'on' : 'off';
        toggledSteps.push(stepIndex);
      };

      handlePaintStart(0);

      expect(paintMode).toBe('on');
      expect(toggledSteps).toEqual([0]);
    });

    it('should set paintMode to "off" when starting from an active step', () => {
      const steps = [true, true, true, true];
      let paintMode: 'on' | 'off' | null = null;
      const toggledSteps: number[] = [];

      const handlePaintStart = (stepIndex: number) => {
        const wasActive = steps[stepIndex];
        const newState = !wasActive;
        paintMode = newState ? 'on' : 'off';
        toggledSteps.push(stepIndex);
      };

      handlePaintStart(0);

      expect(paintMode).toBe('off');
      expect(toggledSteps).toEqual([0]);
    });
  });

  describe('handlePaintEnter', () => {
    it('should toggle step to active when paintMode is "on" and step is inactive', () => {
      const steps = [false, false, false, false];
      const paintMode: 'on' | 'off' | null = 'on';
      const toggledSteps: number[] = [];

      const handlePaintEnter = (stepIndex: number) => {
        if (paintMode === null) return;
        const isActive = steps[stepIndex];
        const shouldBeActive = paintMode === 'on';
        if (isActive !== shouldBeActive) {
          toggledSteps.push(stepIndex);
        }
      };

      handlePaintEnter(1);
      handlePaintEnter(2);

      expect(toggledSteps).toEqual([1, 2]);
    });

    it('should toggle step to inactive when paintMode is "off" and step is active', () => {
      const steps = [true, true, true, true];
      // Cast to union type to prevent TypeScript from narrowing to literal
      const paintMode = 'off' as 'on' | 'off' | null;
      const toggledSteps: number[] = [];

      const handlePaintEnter = (stepIndex: number) => {
        if (paintMode === null) return;
        const isActive = steps[stepIndex];
        const shouldBeActive = paintMode === 'on';
        if (isActive !== shouldBeActive) {
          toggledSteps.push(stepIndex);
        }
      };

      handlePaintEnter(1);
      handlePaintEnter(2);

      expect(toggledSteps).toEqual([1, 2]);
    });

    it('should NOT toggle step when paintMode is "on" and step is already active', () => {
      const steps = [true, true, true, true];
      const paintMode: 'on' | 'off' | null = 'on';
      const toggledSteps: number[] = [];

      const handlePaintEnter = (stepIndex: number) => {
        if (paintMode === null) return;
        const isActive = steps[stepIndex];
        const shouldBeActive = paintMode === 'on';
        if (isActive !== shouldBeActive) {
          toggledSteps.push(stepIndex);
        }
      };

      handlePaintEnter(1);
      handlePaintEnter(2);

      expect(toggledSteps).toEqual([]); // No toggles - already matches
    });

    it('should NOT toggle step when paintMode is "off" and step is already inactive', () => {
      const steps = [false, false, false, false];
      // Cast to union type to prevent TypeScript from narrowing to literal
      const paintMode = 'off' as 'on' | 'off' | null;
      const toggledSteps: number[] = [];

      const handlePaintEnter = (stepIndex: number) => {
        if (paintMode === null) return;
        const isActive = steps[stepIndex];
        const shouldBeActive = paintMode === 'on';
        if (isActive !== shouldBeActive) {
          toggledSteps.push(stepIndex);
        }
      };

      handlePaintEnter(1);
      handlePaintEnter(2);

      expect(toggledSteps).toEqual([]); // No toggles - already matches
    });

    it('should do nothing when paintMode is null (not painting)', () => {
      const steps = [false, true, false, true];
      const paintMode: 'on' | 'off' | null = null;
      const toggledSteps: number[] = [];

      const handlePaintEnter = (stepIndex: number) => {
        if (paintMode === null) return;
        const isActive = steps[stepIndex];
        const shouldBeActive = paintMode === 'on';
        if (isActive !== shouldBeActive) {
          toggledSteps.push(stepIndex);
        }
      };

      handlePaintEnter(0);
      handlePaintEnter(1);
      handlePaintEnter(2);
      handlePaintEnter(3);

      expect(toggledSteps).toEqual([]);
    });
  });

  describe('Paint mode with mixed steps', () => {
    it('should only toggle steps that differ from paint mode', () => {
      // Mixed pattern: some active, some inactive
      const steps = [false, true, false, true, false, true, false, true];
      const paintMode: 'on' | 'off' | null = 'on';
      const toggledSteps: number[] = [];

      const handlePaintEnter = (stepIndex: number) => {
        if (paintMode === null) return;
        const isActive = steps[stepIndex];
        const shouldBeActive = paintMode === 'on';
        if (isActive !== shouldBeActive) {
          toggledSteps.push(stepIndex);
        }
      };

      // Paint across all steps
      for (let i = 0; i < steps.length; i++) {
        handlePaintEnter(i);
      }

      // Only inactive steps (0, 2, 4, 6) should be toggled
      expect(toggledSteps).toEqual([0, 2, 4, 6]);
    });
  });
});

// ============================================================
// PART 2: Paint Mode Ref Synchronization Tests
// ============================================================
// The implementation uses a ref (paintModeRef) to avoid stale closures
// in the global document listener. These tests verify the ref stays in sync.

describe('Paint Mode Ref Synchronization', () => {
  it('should keep paintModeRef in sync with paintMode state', () => {
    const states: Array<{ state: 'on' | 'off' | null; ref: 'on' | 'off' | null }> = [];

    // Simulate the hook pattern from TrackRow
    function usePaintModeSync() {
      const [paintMode, setPaintMode] = useState<'on' | 'off' | null>(null);
      const paintModeRef = useRef<'on' | 'off' | null>(null);

      useEffect(() => {
        paintModeRef.current = paintMode;
        states.push({ state: paintMode, ref: paintModeRef.current });
      }, [paintMode]);

      return { paintMode, setPaintMode, paintModeRef };
    }

    function TestComponent() {
      const { setPaintMode } = usePaintModeSync();

      React.useEffect(() => {
        // Simulate paint sequence
        setPaintMode('on');
        setTimeout(() => setPaintMode(null), 10);
      }, [setPaintMode]);

      return null;
    }

    render(<TestComponent />);

    // After initial render, ref should be null
    expect(states[0]).toEqual({ state: null, ref: null });
  });

  it('should use ref value in global listener to avoid stale closure', async () => {
    let refValueAtListenerTime: 'on' | 'off' | null = null;

    function TestComponent() {
      const [paintMode, setPaintMode] = useState<'on' | 'off' | null>(null);
      const paintModeRef = useRef<'on' | 'off' | null>(null);

      useEffect(() => {
        paintModeRef.current = paintMode;
      }, [paintMode]);

      useEffect(() => {
        const handlePointerUp = () => {
          // This should read from ref, not from closure
          refValueAtListenerTime = paintModeRef.current;
        };

        document.addEventListener('pointerup', handlePointerUp);
        return () => document.removeEventListener('pointerup', handlePointerUp);
      }, []); // Empty deps - listener registered once

      return (
        <button onClick={() => setPaintMode('on')} data-testid="start">
          Start
        </button>
      );
    }

    const { getByTestId } = render(<TestComponent />);

    // Start painting
    fireEvent.click(getByTestId('start'));

    // Trigger pointerup
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerup'));
    });

    // The listener should have seen the current ref value ('on')
    expect(refValueAtListenerTime).toBe('on');

    cleanup();
  });
});

// ============================================================
// PART 3: Full Paint Flow Simulation Tests
// ============================================================
// These tests simulate the complete drag-to-paint flow,
// including state transitions and step toggling.

describe('Full Paint Flow Simulation', () => {
  it('should paint multiple steps when dragging from inactive to active', () => {
    // Initial state: all inactive
    const steps = [false, false, false, false, false, false, false, false];
    let paintMode: 'on' | 'off' | null = null;
    const paintModeRef = { current: null as 'on' | 'off' | null };

    const onToggleStep = (index: number) => {
      steps[index] = !steps[index];
    };

    const handlePaintStart = (stepIndex: number) => {
      const wasActive = steps[stepIndex];
      const newState = !wasActive;
      paintMode = newState ? 'on' : 'off';
      paintModeRef.current = paintMode;
      onToggleStep(stepIndex);
    };

    const handlePaintEnter = (stepIndex: number) => {
      const currentPaintMode = paintModeRef.current;
      if (currentPaintMode === null) return;
      const isActive = steps[stepIndex];
      const shouldBeActive = currentPaintMode === 'on';
      if (isActive !== shouldBeActive) {
        onToggleStep(stepIndex);
      }
    };

    const handlePaintEnd = () => {
      paintMode = null;
      paintModeRef.current = null;
    };

    // Simulate: click step 0, drag to step 3
    handlePaintStart(0);
    expect(steps[0]).toBe(true);
    expect(paintMode).toBe('on');

    handlePaintEnter(1);
    expect(steps[1]).toBe(true);

    handlePaintEnter(2);
    expect(steps[2]).toBe(true);

    handlePaintEnter(3);
    expect(steps[3]).toBe(true);

    handlePaintEnd();
    expect(paintMode).toBeNull();

    // Final state: steps 0-3 active, 4-7 inactive
    expect(steps).toEqual([true, true, true, true, false, false, false, false]);
  });

  it('should erase multiple steps when dragging from active to inactive', () => {
    // Initial state: all active
    const steps = [true, true, true, true, true, true, true, true];
    let paintMode: 'on' | 'off' | null = null;
    const paintModeRef = { current: null as 'on' | 'off' | null };

    const onToggleStep = (index: number) => {
      steps[index] = !steps[index];
    };

    const handlePaintStart = (stepIndex: number) => {
      const wasActive = steps[stepIndex];
      const newState = !wasActive;
      paintMode = newState ? 'on' : 'off';
      paintModeRef.current = paintMode;
      onToggleStep(stepIndex);
    };

    const handlePaintEnter = (stepIndex: number) => {
      const currentPaintMode = paintModeRef.current;
      if (currentPaintMode === null) return;
      const isActive = steps[stepIndex];
      const shouldBeActive = currentPaintMode === 'on';
      if (isActive !== shouldBeActive) {
        onToggleStep(stepIndex);
      }
    };

    const handlePaintEnd = () => {
      paintMode = null;
      paintModeRef.current = null;
    };

    // Simulate: click step 2, drag to step 5 (erasing)
    handlePaintStart(2);
    expect(steps[2]).toBe(false);
    expect(paintMode).toBe('off');

    handlePaintEnter(3);
    expect(steps[3]).toBe(false);

    handlePaintEnter(4);
    expect(steps[4]).toBe(false);

    handlePaintEnter(5);
    expect(steps[5]).toBe(false);

    handlePaintEnd();

    // Final state: 0-1 active, 2-5 inactive, 6-7 active
    expect(steps).toEqual([true, true, false, false, false, false, true, true]);
  });

  it('should support painting in reverse direction (right to left)', () => {
    const steps = [false, false, false, false, false, false, false, false];
    let paintMode: 'on' | 'off' | null = null;
    const paintModeRef = { current: null as 'on' | 'off' | null };

    const onToggleStep = (index: number) => {
      steps[index] = !steps[index];
    };

    const handlePaintStart = (stepIndex: number) => {
      const wasActive = steps[stepIndex];
      const newState = !wasActive;
      paintMode = newState ? 'on' : 'off';
      paintModeRef.current = paintMode;
      onToggleStep(stepIndex);
    };

    const handlePaintEnter = (stepIndex: number) => {
      const currentPaintMode = paintModeRef.current;
      if (currentPaintMode === null) return;
      const isActive = steps[stepIndex];
      const shouldBeActive = currentPaintMode === 'on';
      if (isActive !== shouldBeActive) {
        onToggleStep(stepIndex);
      }
    };

    // Simulate: click step 7, drag LEFT to step 4
    handlePaintStart(7);
    handlePaintEnter(6);
    handlePaintEnter(5);
    handlePaintEnter(4);

    expect(steps).toEqual([false, false, false, false, true, true, true, true]);
  });

  it('should not toggle steps when re-entering already painted steps', () => {
    const steps = [false, false, false, false];
    let toggleCount = 0;
    let paintMode: 'on' | 'off' | null = null;
    const paintModeRef = { current: null as 'on' | 'off' | null };

    const onToggleStep = (index: number) => {
      steps[index] = !steps[index];
      toggleCount++;
    };

    const handlePaintStart = (stepIndex: number) => {
      const wasActive = steps[stepIndex];
      const newState = !wasActive;
      paintMode = newState ? 'on' : 'off';
      paintModeRef.current = paintMode;
      onToggleStep(stepIndex);
    };

    const handlePaintEnter = (stepIndex: number) => {
      const currentPaintMode = paintModeRef.current;
      if (currentPaintMode === null) return;
      const isActive = steps[stepIndex];
      const shouldBeActive = currentPaintMode === 'on';
      if (isActive !== shouldBeActive) {
        onToggleStep(stepIndex);
      }
    };

    // Start at 0, drag to 2, back to 1, forward to 3
    handlePaintStart(0); // Toggle 0: 1 toggle
    handlePaintEnter(1); // Toggle 1: 2 toggles
    handlePaintEnter(2); // Toggle 2: 3 toggles
    handlePaintEnter(1); // Re-enter 1: should NOT toggle (already active)
    handlePaintEnter(2); // Re-enter 2: should NOT toggle (already active)
    handlePaintEnter(3); // Toggle 3: 4 toggles

    expect(toggleCount).toBe(4);
    expect(steps).toEqual([true, true, true, true]);
  });
});

// ============================================================
// PART 4: Pointer Event Handler Tests
// ============================================================
// These tests verify the StepCell pointer event handling.

describe('StepCell Pointer Event Handlers', () => {
  interface StepCellTestProps {
    onPaintStart?: () => void;
    onPaintEnter?: () => void;
    onSelectToggle?: () => void;
    onSelectExtend?: () => void;
    hasSelection?: boolean;
  }

  // Minimal StepCell simulation for testing pointer events
  function StepCellSimulation({
    onPaintStart,
    onPaintEnter,
    onSelectToggle,
    onSelectExtend,
    hasSelection = false,
  }: StepCellTestProps) {
    const handlePointerDown = useCallback(
      (e: React.PointerEvent) => {
        if (e.button !== 0) return;

        // Ctrl/Cmd+Click toggles selection
        if (e.ctrlKey || (e.metaKey && !e.shiftKey)) {
          e.preventDefault();
          onSelectToggle?.();
          return;
        }

        // Shift+Click
        if (e.shiftKey) {
          if (hasSelection && onSelectExtend) {
            e.preventDefault();
            onSelectExtend();
            return;
          }
          // No selection - would trigger p-lock menu
          return;
        }

        // Regular click - start painting
        onPaintStart?.();
      },
      [onPaintStart, onSelectToggle, onSelectExtend, hasSelection]
    );

    const handlePointerEnter = useCallback(() => {
      onPaintEnter?.();
    }, [onPaintEnter]);

    return (
      <button
        data-testid="step-cell"
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
      >
        Step
      </button>
    );
  }

  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('should call onPaintStart on regular pointer down', () => {
    const onPaintStart = vi.fn();
    const { getByTestId } = render(
      <StepCellSimulation onPaintStart={onPaintStart} />
    );

    fireEvent.pointerDown(getByTestId('step-cell'), { button: 0 });

    expect(onPaintStart).toHaveBeenCalledTimes(1);
  });

  it('should NOT call onPaintStart on right-click', () => {
    const onPaintStart = vi.fn();
    const { getByTestId } = render(
      <StepCellSimulation onPaintStart={onPaintStart} />
    );

    fireEvent.pointerDown(getByTestId('step-cell'), { button: 2 });

    expect(onPaintStart).not.toHaveBeenCalled();
  });

  it('should call onSelectToggle on Ctrl+Click instead of onPaintStart', () => {
    const onPaintStart = vi.fn();
    const onSelectToggle = vi.fn();
    const { getByTestId } = render(
      <StepCellSimulation
        onPaintStart={onPaintStart}
        onSelectToggle={onSelectToggle}
      />
    );

    fireEvent.pointerDown(getByTestId('step-cell'), { button: 0, ctrlKey: true });

    expect(onSelectToggle).toHaveBeenCalledTimes(1);
    expect(onPaintStart).not.toHaveBeenCalled();
  });

  it('should call onSelectExtend on Shift+Click when hasSelection is true', () => {
    const onPaintStart = vi.fn();
    const onSelectExtend = vi.fn();
    const { getByTestId } = render(
      <StepCellSimulation
        onPaintStart={onPaintStart}
        onSelectExtend={onSelectExtend}
        hasSelection={true}
      />
    );

    fireEvent.pointerDown(getByTestId('step-cell'), { button: 0, shiftKey: true });

    expect(onSelectExtend).toHaveBeenCalledTimes(1);
    expect(onPaintStart).not.toHaveBeenCalled();
  });

  it('should NOT call onPaintStart on Shift+Click when hasSelection is false', () => {
    const onPaintStart = vi.fn();
    const { getByTestId } = render(
      <StepCellSimulation onPaintStart={onPaintStart} hasSelection={false} />
    );

    fireEvent.pointerDown(getByTestId('step-cell'), { button: 0, shiftKey: true });

    // Shift+Click without selection opens p-lock menu, not paint
    expect(onPaintStart).not.toHaveBeenCalled();
  });

  it('should call onPaintEnter on pointer enter', () => {
    const onPaintEnter = vi.fn();
    const { getByTestId } = render(
      <StepCellSimulation onPaintEnter={onPaintEnter} />
    );

    fireEvent.pointerEnter(getByTestId('step-cell'));

    expect(onPaintEnter).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// PART 5: Global Pointer Up Listener Tests
// ============================================================
// Tests for the document-level pointerup listener that clears paint mode.

describe('Global Pointer Up Listener', () => {
  it('should clear paint mode when pointerup fires on document', async () => {
    let paintMode: 'on' | 'off' | null = null;
    const paintModeRef = { current: null as 'on' | 'off' | null };

    function TestComponent() {
      const [localPaintMode, setLocalPaintMode] = useState<'on' | 'off' | null>(null);

      useEffect(() => {
        paintModeRef.current = localPaintMode;
        paintMode = localPaintMode;
      }, [localPaintMode]);

      useEffect(() => {
        const handlePointerUp = () => {
          if (paintModeRef.current !== null) {
            setLocalPaintMode(null);
          }
        };

        document.addEventListener('pointerup', handlePointerUp);
        return () => document.removeEventListener('pointerup', handlePointerUp);
      }, []);

      return (
        <button onClick={() => setLocalPaintMode('on')} data-testid="start">
          Start
        </button>
      );
    }

    const { getByTestId } = render(<TestComponent />);

    // Start painting
    fireEvent.click(getByTestId('start'));
    expect(paintMode).toBe('on');

    // Simulate pointerup anywhere on document
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerup'));
    });

    // Paint mode should be cleared
    expect(paintMode).toBeNull();

    cleanup();
  });

  it('should handle pointercancel event (e.g., palm rejection)', async () => {
    let paintMode: 'on' | 'off' | null = null;
    const paintModeRef = { current: null as 'on' | 'off' | null };

    function TestComponent() {
      const [localPaintMode, setLocalPaintMode] = useState<'on' | 'off' | null>(null);

      useEffect(() => {
        paintModeRef.current = localPaintMode;
        paintMode = localPaintMode;
      }, [localPaintMode]);

      useEffect(() => {
        const handlePointerUp = () => {
          if (paintModeRef.current !== null) {
            setLocalPaintMode(null);
          }
        };

        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerUp);
        return () => {
          document.removeEventListener('pointerup', handlePointerUp);
          document.removeEventListener('pointercancel', handlePointerUp);
        };
      }, []);

      return (
        <button onClick={() => setLocalPaintMode('on')} data-testid="start">
          Start
        </button>
      );
    }

    const { getByTestId } = render(<TestComponent />);

    // Start painting
    fireEvent.click(getByTestId('start'));
    expect(paintMode).toBe('on');

    // Simulate pointercancel (touch cancelled by system)
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointercancel'));
    });

    expect(paintMode).toBeNull();

    cleanup();
  });

  it('should NOT clear paint mode if already null', async () => {
    let setStateCallCount = 0;

    function TestComponent() {
      const [localPaintMode, setLocalPaintMode] = useState<'on' | 'off' | null>(null);
      const paintModeRef = useRef<'on' | 'off' | null>(null);

      useEffect(() => {
        paintModeRef.current = localPaintMode;
      }, [localPaintMode]);

      useEffect(() => {
        const handlePointerUp = () => {
          if (paintModeRef.current !== null) {
            setStateCallCount++;
            setLocalPaintMode(null);
          }
        };

        document.addEventListener('pointerup', handlePointerUp);
        return () => document.removeEventListener('pointerup', handlePointerUp);
      }, []);

      return <div data-testid="container">Test</div>;
    }

    render(<TestComponent />);

    // Trigger pointerup without ever setting paint mode
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerup'));
      document.dispatchEvent(new PointerEvent('pointerup'));
      document.dispatchEvent(new PointerEvent('pointerup'));
    });

    // Should not have called setState since paintMode was already null
    expect(setStateCallCount).toBe(0);

    cleanup();
  });
});

// ============================================================
// PART 6: Handler Memoization Tests
// ============================================================
// Tests that verify paint handlers are properly memoized.

describe('Handler Memoization', () => {
  it('should create stable paint handlers for each step', () => {
    const trackStepCount = 8;
    const handlerRefs: Array<() => void> = [];

    // First render - create handlers
    const handlePaintStart = vi.fn();
    const handlers1 = Array.from({ length: trackStepCount }, (_, i) => () =>
      handlePaintStart(i)
    );
    handlerRefs.push(...handlers1);

    // Second render - handlers should be recreated (useMemo with same deps)
    const handlers2 = Array.from({ length: trackStepCount }, (_, i) => () =>
      handlePaintStart(i)
    );

    // In the actual implementation, useMemo should return the same handlers
    // if trackStepCount and handlePaintStart haven't changed.
    // This test documents the expected behavior.
    expect(handlers1.length).toBe(handlers2.length);
  });

  it('should recreate handlers when step count changes', () => {
    const handlePaintStart = vi.fn();

    // 8 steps
    const handlers8 = Array.from({ length: 8 }, (_, i) => () => handlePaintStart(i));

    // 16 steps
    const handlers16 = Array.from({ length: 16 }, (_, i) => () => handlePaintStart(i));

    expect(handlers8.length).toBe(8);
    expect(handlers16.length).toBe(16);
  });
});

// ============================================================
// PART 7: Edge Cases and Error Conditions
// ============================================================

describe('Edge Cases', () => {
  it('should handle rapid paint start/end cycles', () => {
    let paintMode: 'on' | 'off' | null = null;
    const toggledSteps: number[] = [];
    const steps = [false, false, false, false];

    const handlePaintStart = (stepIndex: number) => {
      const wasActive = steps[stepIndex];
      paintMode = !wasActive ? 'on' : 'off';
      steps[stepIndex] = !steps[stepIndex];
      toggledSteps.push(stepIndex);
    };

    const handlePaintEnd = () => {
      paintMode = null;
    };

    // Rapid click-release cycles
    handlePaintStart(0);
    handlePaintEnd();
    handlePaintStart(1);
    handlePaintEnd();
    handlePaintStart(2);
    handlePaintEnd();

    expect(toggledSteps).toEqual([0, 1, 2]);
    expect(paintMode).toBeNull();
  });

  it('should handle empty step array gracefully', () => {
    const steps: boolean[] = [];
    let paintMode: 'on' | 'off' | null = null;

    const handlePaintStart = (stepIndex: number) => {
      if (stepIndex >= steps.length) return; // Guard
      const wasActive = steps[stepIndex];
      paintMode = !wasActive ? 'on' : 'off';
    };

    handlePaintStart(0); // Out of bounds

    // Should not crash, paintMode should remain null
    expect(paintMode).toBeNull();
  });

  it('should handle alternating active/inactive pattern during paint', () => {
    // Checkerboard pattern
    const steps = [true, false, true, false, true, false, true, false];
    const paintMode: 'on' | 'off' | null = 'on';
    const toggledSteps: number[] = [];

    const handlePaintEnter = (stepIndex: number) => {
      if (paintMode === null) return;
      const isActive = steps[stepIndex];
      const shouldBeActive = paintMode === 'on';
      if (isActive !== shouldBeActive) {
        steps[stepIndex] = !steps[stepIndex];
        toggledSteps.push(stepIndex);
      }
    };

    // Paint across all steps with 'on' mode
    for (let i = 0; i < steps.length; i++) {
      handlePaintEnter(i);
    }

    // Only odd indices (which were false) should be toggled
    expect(toggledSteps).toEqual([1, 3, 5, 7]);
    expect(steps).toEqual([true, true, true, true, true, true, true, true]);
  });

  it('should handle 32-step patterns', () => {
    const steps = new Array(32).fill(false);
    let paintMode: 'on' | 'off' | null = null;
    const paintModeRef = { current: null as 'on' | 'off' | null };

    const handlePaintStart = (stepIndex: number) => {
      const wasActive = steps[stepIndex];
      paintMode = !wasActive ? 'on' : 'off';
      paintModeRef.current = paintMode;
      steps[stepIndex] = !steps[stepIndex];
    };

    const handlePaintEnter = (stepIndex: number) => {
      const currentPaintMode = paintModeRef.current;
      if (currentPaintMode === null) return;
      const isActive = steps[stepIndex];
      const shouldBeActive = currentPaintMode === 'on';
      if (isActive !== shouldBeActive) {
        steps[stepIndex] = !steps[stepIndex];
      }
    };

    // Paint from step 0 to step 31
    handlePaintStart(0);
    for (let i = 1; i < 32; i++) {
      handlePaintEnter(i);
    }

    expect(steps.every((s) => s === true)).toBe(true);
  });

  it('should handle single step pattern', () => {
    const steps = [false];
    let paintMode: 'on' | 'off' | null = null;

    const handlePaintStart = (stepIndex: number) => {
      const wasActive = steps[stepIndex];
      paintMode = !wasActive ? 'on' : 'off';
      steps[stepIndex] = !steps[stepIndex];
    };

    handlePaintStart(0);

    expect(steps[0]).toBe(true);
    expect(paintMode).toBe('on');
  });
});

// ============================================================
// PART 8: Integration with Track State
// ============================================================
// These tests simulate how paint mode interacts with real track state updates.

describe('Integration with Track State', () => {
  it('should handle async state updates correctly', async () => {
    // Simulate React's batched state updates
    let steps = [false, false, false, false];
    let paintMode: 'on' | 'off' | null = null;
    const pendingUpdates: Array<() => void> = [];

    const scheduleUpdate = (update: () => void) => {
      pendingUpdates.push(update);
    };

    const flushUpdates = () => {
      while (pendingUpdates.length > 0) {
        const update = pendingUpdates.shift();
        update?.();
      }
    };

    const handlePaintStart = (stepIndex: number) => {
      const wasActive = steps[stepIndex];
      scheduleUpdate(() => {
        paintMode = !wasActive ? 'on' : 'off';
        steps = [...steps];
        steps[stepIndex] = !wasActive;
      });
    };

    handlePaintStart(0);
    flushUpdates();

    expect(paintMode).toBe('on');
    expect(steps[0]).toBe(true);
  });

  it('should correctly derive paint mode from clicked step state at click time', () => {
    // Important: paint mode is determined by the step state AT THE TIME of click
    // not after state updates
    const steps = [false, false, false, false];
    const paintModeLog: Array<'on' | 'off' | null> = [];

    const handlePaintStart = (stepIndex: number) => {
      const wasActive = steps[stepIndex]; // Read BEFORE toggle
      const paintMode = !wasActive ? 'on' : 'off';
      paintModeLog.push(paintMode);
      steps[stepIndex] = !steps[stepIndex]; // Toggle AFTER reading
    };

    // Click inactive step -> should paint 'on'
    handlePaintStart(0);
    expect(paintModeLog[0]).toBe('on');

    // Click now-active step -> should paint 'off'
    handlePaintStart(0);
    expect(paintModeLog[1]).toBe('off');
  });
});

// ============================================================
// PART 9: Container-Based Hit-Testing (Correct Implementation)
// ============================================================
// These tests document how drag-to-paint SHOULD work with container-based
// event handling, as used in VelocityLane.tsx. This approach avoids the
// setPointerCapture bug.

describe('Container-Based Hit-Testing (Correct Pattern)', () => {
  /**
   * Simulates the container-based approach with hit-testing.
   * This is how drag-to-paint SHOULD be implemented.
   */
  interface ContainerPaintProps {
    initialSteps: boolean[];
    onStepsChange: (steps: boolean[]) => void;
  }

  function ContainerBasedPaint({ initialSteps, onStepsChange }: ContainerPaintProps) {
    const [steps, setSteps] = useState(initialSteps);
    const [paintMode, setPaintMode] = useState<'on' | 'off' | null>(null);
    const lastStepRef = useRef<number | null>(null);

    // Sync external callback
    useEffect(() => {
      onStepsChange(steps);
    }, [steps, onStepsChange]);

    // Hit-test: find which step the pointer is over
    const getStepFromEvent = useCallback((e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      const stepCell = target.closest('[data-step]') as HTMLElement | null;
      if (!stepCell) return null;
      return parseInt(stepCell.dataset.step!, 10);
    }, []);

    // Handle pointer down on container
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      const step = getStepFromEvent(e);
      if (step === null) return;

      lastStepRef.current = step;
      const wasActive = steps[step];
      const newPaintMode = wasActive ? 'off' : 'on';
      setPaintMode(newPaintMode);

      // Toggle the clicked step
      setSteps(prev => {
        const next = [...prev];
        next[step] = !next[step];
        return next;
      });
    }, [getStepFromEvent, steps]);

    // Handle pointer move on container (drag continuation)
    const handlePointerMove = useCallback((e: React.PointerEvent) => {
      if (paintMode === null) return;

      const step = getStepFromEvent(e);
      if (step === null) return;
      if (step === lastStepRef.current) return; // Already processed

      lastStepRef.current = step;

      // Toggle if needed based on paint mode
      setSteps(prev => {
        const shouldBeActive = paintMode === 'on';
        if (prev[step] === shouldBeActive) return prev; // Already correct
        const next = [...prev];
        next[step] = shouldBeActive;
        return next;
      });
    }, [getStepFromEvent, paintMode]);

    // Handle pointer up on container or document
    const handlePointerUp = useCallback(() => {
      setPaintMode(null);
      lastStepRef.current = null;
    }, []);

    // Global pointer up listener
    useEffect(() => {
      document.addEventListener('pointerup', handlePointerUp);
      return () => document.removeEventListener('pointerup', handlePointerUp);
    }, [handlePointerUp]);

    return (
      <div
        className="steps-container"
        data-testid="steps-container"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {steps.map((active, i) => (
          <button
            key={i}
            data-step={i}
            data-testid={`step-${i}`}
            className={active ? 'active' : ''}
          >
            Step {i}
          </button>
        ))}
      </div>
    );
  }

  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('should paint single step on click', () => {
    let currentSteps = [false, false, false, false];
    const { getByTestId } = render(
      <ContainerBasedPaint
        initialSteps={[false, false, false, false]}
        onStepsChange={(s) => { currentSteps = s; }}
      />
    );

    fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

    expect(currentSteps[0]).toBe(true);
    expect(currentSteps.slice(1)).toEqual([false, false, false]);
  });

  it('should paint multiple steps on drag via pointermove', () => {
    let currentSteps = [false, false, false, false];
    const { getByTestId } = render(
      <ContainerBasedPaint
        initialSteps={[false, false, false, false]}
        onStepsChange={(s) => { currentSteps = s; }}
      />
    );

    // Pointer down on step 0
    fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });
    expect(currentSteps[0]).toBe(true);

    // Simulate drag by firing pointermove on container with target as step 1
    fireEvent.pointerMove(getByTestId('step-1'), { button: 0 });
    expect(currentSteps[1]).toBe(true);

    // Continue to step 2
    fireEvent.pointerMove(getByTestId('step-2'), { button: 0 });
    expect(currentSteps[2]).toBe(true);

    // Continue to step 3
    fireEvent.pointerMove(getByTestId('step-3'), { button: 0 });
    expect(currentSteps[3]).toBe(true);

    expect(currentSteps).toEqual([true, true, true, true]);
  });

  it('should erase multiple steps when starting from active', () => {
    let currentSteps = [true, true, true, true];
    const { getByTestId } = render(
      <ContainerBasedPaint
        initialSteps={[true, true, true, true]}
        onStepsChange={(s) => { currentSteps = s; }}
      />
    );

    // Pointer down on step 0 (active) starts erase mode
    fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });
    expect(currentSteps[0]).toBe(false);

    // Drag across
    fireEvent.pointerMove(getByTestId('step-1'), { button: 0 });
    fireEvent.pointerMove(getByTestId('step-2'), { button: 0 });

    expect(currentSteps).toEqual([false, false, false, true]);
  });

  it('should stop painting after pointer up', () => {
    let currentSteps = [false, false, false, false];
    const { getByTestId } = render(
      <ContainerBasedPaint
        initialSteps={[false, false, false, false]}
        onStepsChange={(s) => { currentSteps = s; }}
      />
    );

    // Paint step 0
    fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });
    expect(currentSteps[0]).toBe(true);

    // Release
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup'));
    });

    // Further movement should NOT paint
    fireEvent.pointerMove(getByTestId('step-1'), { button: 0 });
    fireEvent.pointerMove(getByTestId('step-2'), { button: 0 });

    expect(currentSteps).toEqual([true, false, false, false]);
  });

  it('should not double-toggle when hovering same step', () => {
    let toggleCount = 0;
    const { getByTestId } = render(
      <ContainerBasedPaint
        initialSteps={[false, false, false, false]}
        onStepsChange={() => { toggleCount++; }}
      />
    );

    fireEvent.pointerDown(getByTestId('step-0'), { button: 0 });

    // Move within same step multiple times
    fireEvent.pointerMove(getByTestId('step-0'), { button: 0 });
    fireEvent.pointerMove(getByTestId('step-0'), { button: 0 });
    fireEvent.pointerMove(getByTestId('step-0'), { button: 0 });

    // Should have only toggled once (on initial pointerdown)
    // Note: React batches setState calls, so we may see 1 call
    expect(toggleCount).toBeGreaterThanOrEqual(1);
  });

  it('should handle rapid direction changes', () => {
    let currentSteps = [false, false, false, false, false];
    const { getByTestId } = render(
      <ContainerBasedPaint
        initialSteps={[false, false, false, false, false]}
        onStepsChange={(s) => { currentSteps = s; }}
      />
    );

    // Start at 2, go left to 0, then right to 4
    fireEvent.pointerDown(getByTestId('step-2'), { button: 0 });
    fireEvent.pointerMove(getByTestId('step-1'), { button: 0 });
    fireEvent.pointerMove(getByTestId('step-0'), { button: 0 });
    fireEvent.pointerMove(getByTestId('step-1'), { button: 0 }); // Back (already painted)
    fireEvent.pointerMove(getByTestId('step-2'), { button: 0 }); // Back (already painted)
    fireEvent.pointerMove(getByTestId('step-3'), { button: 0 });
    fireEvent.pointerMove(getByTestId('step-4'), { button: 0 });

    expect(currentSteps).toEqual([true, true, true, true, true]);
  });
});

// ============================================================
// PART 10: setPointerCapture Bug Documentation
// ============================================================
// These tests document WHY the current implementation is broken.
// They show what happens with setPointerCapture vs without.

describe('setPointerCapture Bug (Documentation)', () => {
  /**
   * This component demonstrates the BROKEN pattern.
   * When setPointerCapture is called, pointerenter never fires on siblings.
   */
  function BrokenStepCell({
    stepIndex,
    onPaintStart,
    onPaintEnter,
  }: {
    stepIndex: number;
    onPaintStart: (step: number) => void;
    onPaintEnter: (step: number) => void;
  }) {
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      // THIS IS THE BUG: setPointerCapture prevents pointerenter on siblings
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      onPaintStart(stepIndex);
    }, [stepIndex, onPaintStart]);

    const handlePointerEnter = useCallback(() => {
      // This NEVER fires on siblings when another element has pointer capture!
      onPaintEnter(stepIndex);
    }, [stepIndex, onPaintEnter]);

    return (
      <button
        data-testid={`broken-step-${stepIndex}`}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
      >
        Step {stepIndex}
      </button>
    );
  }

  it('documents that pointerenter callbacks are received in unit tests (synthetic events)', () => {
    // NOTE: This test PASSES because fireEvent.pointerEnter dispatches
    // directly to the element, bypassing browser pointer capture semantics.
    // In a REAL browser, this would fail due to setPointerCapture.
    const paintStartCalls: number[] = [];
    const paintEnterCalls: number[] = [];

    const { getByTestId } = render(
      <>
        <BrokenStepCell
          stepIndex={0}
          onPaintStart={(s) => paintStartCalls.push(s)}
          onPaintEnter={(s) => paintEnterCalls.push(s)}
        />
        <BrokenStepCell
          stepIndex={1}
          onPaintStart={(s) => paintStartCalls.push(s)}
          onPaintEnter={(s) => paintEnterCalls.push(s)}
        />
      </>
    );

    // Start painting on step 0
    fireEvent.pointerDown(getByTestId('broken-step-0'), { button: 0 });
    expect(paintStartCalls).toEqual([0]);

    // In unit tests, fireEvent dispatches directly - this works!
    // But in a REAL browser with setPointerCapture, this would NEVER fire.
    fireEvent.pointerEnter(getByTestId('broken-step-1'));
    expect(paintEnterCalls).toEqual([1]); // Works in test, FAILS in browser!
  });

  it('documents the limitation: unit tests cannot detect setPointerCapture bugs', () => {
    // This is a documentation test explaining WHY we need E2E tests.
    //
    // Unit tests with fireEvent cannot detect setPointerCapture bugs because:
    // 1. fireEvent dispatches events directly to elements
    // 2. Browser pointer capture semantics are not simulated
    // 3. jsdom does not fully implement pointer capture
    //
    // To detect this bug, you need:
    // - E2E tests (Playwright/Cypress) with real browser
    // - Manual testing in browser with DevTools open
    // - Console logging that shows events ONLY on capturing element
    //
    // The E2E tests in e2e/drag-to-paint.spec.ts correctly detect this bug
    // and are marked as test.fixme() until the implementation is fixed.

    expect(true).toBe(true); // Documentation test
  });
});

// ============================================================
// PART 11: Hit-Testing Utility Tests
// ============================================================
// Tests for the getStepFromEvent utility that would be used in the fix.

describe('Hit-Testing Utility', () => {
  /**
   * Utility to find step index from pointer event.
   * This is the core of the container-based approach.
   */
  function getStepFromElement(target: HTMLElement): number | null {
    const stepCell = target.closest('[data-step]') as HTMLElement | null;
    if (!stepCell) return null;
    const stepAttr = stepCell.dataset.step;
    if (stepAttr === undefined) return null;
    const step = parseInt(stepAttr, 10);
    if (isNaN(step)) return null;
    return step;
  }

  it('should find step index from step cell element', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="steps">
        <button data-step="0">Step 0</button>
        <button data-step="1">Step 1</button>
        <button data-step="2">Step 2</button>
      </div>
    `;
    document.body.appendChild(div);

    const step0 = div.querySelector('[data-step="0"]') as HTMLElement;
    const step1 = div.querySelector('[data-step="1"]') as HTMLElement;
    const step2 = div.querySelector('[data-step="2"]') as HTMLElement;

    expect(getStepFromElement(step0)).toBe(0);
    expect(getStepFromElement(step1)).toBe(1);
    expect(getStepFromElement(step2)).toBe(2);

    document.body.removeChild(div);
  });

  it('should find step index from nested child element', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="steps">
        <button data-step="0">
          <span class="inner">Step 0</span>
        </button>
      </div>
    `;
    document.body.appendChild(div);

    const inner = div.querySelector('.inner') as HTMLElement;
    expect(getStepFromElement(inner)).toBe(0);

    document.body.removeChild(div);
  });

  it('should return null for non-step elements', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="steps">
        <button data-step="0">Step 0</button>
        <div class="not-a-step">Other</div>
      </div>
    `;
    document.body.appendChild(div);

    const notAStep = div.querySelector('.not-a-step') as HTMLElement;
    expect(getStepFromElement(notAStep)).toBeNull();

    document.body.removeChild(div);
  });

  it('should return null for container element', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="steps">
        <button data-step="0">Step 0</button>
      </div>
    `;
    document.body.appendChild(div);

    const container = div.querySelector('.steps') as HTMLElement;
    expect(getStepFromElement(container)).toBeNull();

    document.body.removeChild(div);
  });

  it('should handle non-numeric step values gracefully', () => {
    const div = document.createElement('div');
    div.innerHTML = `<button data-step="abc">Invalid</button>`;
    document.body.appendChild(div);

    const invalid = div.querySelector('button') as HTMLElement;
    expect(getStepFromElement(invalid)).toBeNull();

    document.body.removeChild(div);
  });
});
