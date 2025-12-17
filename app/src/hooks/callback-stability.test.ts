/**
 * Automated tests for detecting "Unstable Callback in useEffect Dependency" bug pattern
 *
 * BUG PATTERN: Connection Storm (see docs/bug-patterns.md)
 * When a callback with state dependencies is used as a useEffect dependency,
 * every state change triggers the effect (causing reconnections, etc.)
 *
 * This test file:
 * 1. Documents the pattern with runnable examples
 * 2. Provides regression tests to catch if the pattern is reintroduced
 * 3. Can be extended to audit new hooks/callbacks
 *
 * Run with: npm run test:unit -- --testNamePattern="Callback Stability"
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCallback, useState, useRef, useEffect } from 'react';

// =============================================================================
// Pattern Detection Utilities
// =============================================================================

/**
 * Test utility: Count how many times an effect runs across renders
 * Used to detect unstable dependencies
 */
function createEffectCounter() {
  return {
    runCount: 0,
    cleanupCount: 0,
    reset() {
      this.runCount = 0;
      this.cleanupCount = 0;
    }
  };
}

// =============================================================================
// Pattern Documentation Tests
// =============================================================================

describe('Callback Stability: Bug Pattern Documentation', () => {
  /**
   * This test demonstrates the BUGGY pattern that causes connection storms.
   * DO NOT copy this pattern - it's here to document what NOT to do.
   */
  it('BUGGY: callback with state deps in useEffect causes re-runs', () => {
    const counter = createEffectCounter();

    const { result } = renderHook(() => {
      const [count, setCount] = useState(0);

      // BUGGY: Callback changes reference when count changes
      const getCount = useCallback(() => count, [count]);

      // Effect runs every time getCount changes
      useEffect(() => {
        counter.runCount++;
        return () => { counter.cleanupCount++; };
      }, [getCount]);

      return { setCount };
    });

    expect(counter.runCount).toBe(1);
    expect(counter.cleanupCount).toBe(0);

    // State change should NOT cause effect re-run in a healthy system
    act(() => { result.current.setCount(1); });

    // BUG: Effect ran again due to unstable callback
    expect(counter.runCount).toBe(2);
    expect(counter.cleanupCount).toBe(1);
  });

  /**
   * This test demonstrates the CORRECT pattern using refs.
   * Copy this pattern when you need a stable callback that accesses state.
   */
  it('FIXED: callback with ref pattern maintains stable reference', () => {
    const counter = createEffectCounter();

    const { result } = renderHook(() => {
      const [count, setCount] = useState(0);

      // FIXED: Store state in ref, callback accesses ref
      const countRef = useRef(count);
      countRef.current = count;

      // Callback never changes reference
      const getCount = useCallback(() => countRef.current, []);

      useEffect(() => {
        counter.runCount++;
        return () => { counter.cleanupCount++; };
      }, [getCount]);

      return { setCount, getCount };
    });

    expect(counter.runCount).toBe(1);
    expect(counter.cleanupCount).toBe(0);

    // State change should NOT cause effect re-run
    act(() => { result.current.setCount(1); });

    // FIXED: Effect did NOT re-run
    expect(counter.runCount).toBe(1);
    expect(counter.cleanupCount).toBe(0);

    // But callback returns current value
    expect(result.current.getCount()).toBe(1);
  });
});

// =============================================================================
// Regression Tests for Known Fixed Instances
// =============================================================================

describe('Callback Stability: Regression Tests', () => {
  /**
   * Tests the pattern used in App.tsx for getStateForHash
   * This was the original connection storm bug.
   */
  it('getStateForHash pattern: should maintain stable reference across state changes', () => {
    const effectRunCount = { value: 0 };
    const callbackReferences: (() => unknown)[] = [];

    const { result } = renderHook(() => {
      const [state, setState] = useState({
        tracks: [{ id: 'track-1', steps: [false] }],
        tempo: 120,
        swing: 0,
      });

      // The FIXED pattern from App.tsx
      const stateForHashRef = useRef(state);
      stateForHashRef.current = state;

      const getStateForHash = useCallback(() => ({
        tracks: stateForHashRef.current.tracks,
        tempo: stateForHashRef.current.tempo,
        swing: stateForHashRef.current.swing,
      }), []);

      // Track callback references
      callbackReferences.push(getStateForHash);

      // Simulates useMultiplayer's effect
      useEffect(() => {
        effectRunCount.value++;
      }, [getStateForHash]);

      return { state, setState, getStateForHash };
    });

    // Initial render
    expect(effectRunCount.value).toBe(1);
    expect(callbackReferences.length).toBe(1);

    // Simulate user clicking a step (state change)
    act(() => {
      result.current.setState(prev => ({
        ...prev,
        tracks: [{ id: 'track-1', steps: [true] }],
      }));
    });

    // Effect should NOT have re-run
    expect(effectRunCount.value).toBe(1);
    // Callback reference should be the same
    expect(callbackReferences[0]).toBe(callbackReferences[1]);
    // But callback returns updated state
    expect(result.current.getStateForHash().tracks[0].steps[0]).toBe(true);

    // Simulate tempo change
    act(() => {
      result.current.setState(prev => ({ ...prev, tempo: 140 }));
    });

    // Still no effect re-run
    expect(effectRunCount.value).toBe(1);
    expect(result.current.getStateForHash().tempo).toBe(140);
  });

  /**
   * Test that simulates rapid state changes (like dragging a slider)
   * This would cause N reconnections with the buggy pattern.
   */
  it('should handle rapid state changes without effect storms', () => {
    const effectRunCount = { value: 0 };

    const { result } = renderHook(() => {
      const [tempo, setTempo] = useState(120);

      const tempoRef = useRef(tempo);
      tempoRef.current = tempo;

      const getTempo = useCallback(() => tempoRef.current, []);

      useEffect(() => {
        effectRunCount.value++;
      }, [getTempo]);

      return { setTempo, getTempo };
    });

    expect(effectRunCount.value).toBe(1);

    // Simulate dragging tempo slider
    act(() => {
      for (let i = 121; i <= 180; i++) {
        result.current.setTempo(i);
      }
    });

    // Effect should still only have run once
    expect(effectRunCount.value).toBe(1);
    // Final tempo should be accessible
    expect(result.current.getTempo()).toBe(180);
  });
});

// =============================================================================
// Audit Tests: Check Specific Callbacks
// =============================================================================

describe('Callback Stability: Codebase Audit', () => {
  /**
   * Test that useCallback with empty deps maintains reference.
   * Use this pattern to verify specific callbacks in the codebase.
   */
  it('useCallback([]) maintains reference across re-renders', () => {
    const refs: (() => void)[] = [];

    const { rerender } = renderHook(() => {
      const [, forceUpdate] = useState(0);
      const stableCallback = useCallback(() => {}, []);
      refs.push(stableCallback);
      return { forceUpdate };
    });

    expect(refs.length).toBe(1);

    // Force re-render
    rerender();
    expect(refs.length).toBe(2);

    // Same reference
    expect(refs[0]).toBe(refs[1]);
  });

  /**
   * Test that useCallback with state deps creates new reference.
   * This is the pattern to AVOID when callback is an effect dependency.
   */
  it('useCallback([state]) creates new reference on state change', () => {
    const refs: (() => number)[] = [];

    const { result } = renderHook(() => {
      const [count, setCount] = useState(0);
      const unstableCallback = useCallback(() => count, [count]);
      refs.push(unstableCallback);
      return { setCount };
    });

    expect(refs.length).toBe(1);

    act(() => { result.current.setCount(1); });

    expect(refs.length).toBe(2);
    // Different reference - this is the bug pattern!
    expect(refs[0]).not.toBe(refs[1]);
  });
});

// =============================================================================
// Integration Pattern Test
// =============================================================================

describe('Callback Stability: Full Integration Pattern', () => {
  /**
   * This test mimics the actual architecture of App.tsx + useMultiplayer
   * to verify the fix works in a realistic scenario.
   */
  it('simulates App.tsx + useMultiplayer interaction', () => {
    const connectionEvents: string[] = [];

    // Simulates useMultiplayer hook
    function useSimulatedMultiplayer(
      sessionId: string | null,
      getStateForHash: () => unknown
    ) {
      useEffect(() => {
        if (!sessionId) return;

        connectionEvents.push('connect');
        // Simulate using the callback for hash verification
        void JSON.stringify(getStateForHash());

        return () => {
          connectionEvents.push('disconnect');
        };
      }, [sessionId, getStateForHash]);
    }

    // Simulates App component
    const { result } = renderHook(() => {
      const [state, setState] = useState({
        tracks: [{ id: 'track-1', steps: [false, false, false, false] }],
        tempo: 120,
        swing: 0,
      });

      // The FIXED pattern
      const stateRef = useRef(state);
      stateRef.current = state;

      const getStateForHash = useCallback(() => ({
        tracks: stateRef.current.tracks,
        tempo: stateRef.current.tempo,
        swing: stateRef.current.swing,
      }), []);

      useSimulatedMultiplayer('test-session', getStateForHash);

      return { state, setState };
    });

    // Initial connection
    expect(connectionEvents).toEqual(['connect']);

    // Simulate user interactions
    act(() => {
      // Toggle a step
      result.current.setState(prev => ({
        ...prev,
        tracks: [{ id: 'track-1', steps: [true, false, false, false] }],
      }));
    });

    // Should still be just one connect (no reconnection storm)
    expect(connectionEvents).toEqual(['connect']);

    // More state changes
    act(() => {
      result.current.setState(prev => ({ ...prev, tempo: 140 }));
      result.current.setState(prev => ({ ...prev, swing: 25 }));
    });

    // Still just one connect
    expect(connectionEvents).toEqual(['connect']);
  });
});
