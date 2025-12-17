/**
 * Tests for useMultiplayer hook - specifically the connection storm bug.
 *
 * BUG: WebSocket Connection Storm
 * ================================
 * When `getStateForHash` callback changes reference (due to state changes),
 * the useEffect in useMultiplayer triggers cleanup (disconnect) and re-runs
 * (reconnect with new player ID), causing a reconnection storm.
 *
 * Root cause: getStateForHash is a useEffect dependency but changes on every
 * state update because it's created with useCallback([state.tracks, state.tempo, state.swing]).
 *
 * Expected behavior: Connection should remain stable when state changes.
 * The getStateForHash callback should use a ref pattern to avoid triggering reconnection.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCallback, useState, useRef, useEffect } from 'react';

// ============================================================================
// Unit Tests for Callback Stability Pattern
// ============================================================================

describe('Connection Storm Bug: Callback Stability', () => {
  /**
   * This test demonstrates the BUGGY pattern:
   * A callback that changes reference on every state change will cause
   * useEffect to re-run, triggering disconnect/reconnect cycles.
   */
  it('BUGGY PATTERN: unstable callback causes effect to re-run on every state change', () => {
    const connectCount = { value: 0 };
    const disconnectCount = { value: 0 };

    // Simulate the buggy pattern from App.tsx
    const { result } = renderHook(() => {
      const [state, setState] = useState({ tempo: 120 });

      // BUGGY: This callback changes reference when state changes
      const unstableCallback = useCallback(() => ({
        tempo: state.tempo,
      }), [state.tempo]); // <-- This dependency causes instability

      // Simulate the connection effect
      useEffect(() => {
        connectCount.value++;
        return () => {
          disconnectCount.value++;
        };
      }, [unstableCallback]); // <-- Callback is a dependency

      return { state, setState, unstableCallback };
    });

    // Initial mount: 1 connect
    expect(connectCount.value).toBe(1);
    expect(disconnectCount.value).toBe(0);

    // Change state - this should NOT cause reconnection in a healthy system
    act(() => {
      result.current.setState({ tempo: 130 });
    });

    // BUG: Changing state causes reconnection!
    // This is the storm - every state change = disconnect + reconnect
    expect(connectCount.value).toBe(2); // BAD: Should still be 1
    expect(disconnectCount.value).toBe(1); // BAD: Should still be 0
  });

  /**
   * This test demonstrates the FIXED pattern:
   * Using a ref to store the callback prevents useEffect re-runs.
   */
  it('FIXED PATTERN: stable callback ref prevents effect re-runs on state change', () => {
    const connectCount = { value: 0 };
    const disconnectCount = { value: 0 };

    // Simulate the fixed pattern
    const { result } = renderHook(() => {
      const [state, setState] = useState({ tempo: 120 });

      // FIXED: Use a ref to store the current state getter
      const stateRef = useRef(state);
      stateRef.current = state; // Always update the ref

      // FIXED: The callback itself never changes reference
      const stableCallback = useCallback(() => ({
        tempo: stateRef.current.tempo,
      }), []); // <-- No dependencies, stable reference

      // The connection effect only runs once
      useEffect(() => {
        connectCount.value++;
        return () => {
          disconnectCount.value++;
        };
      }, [stableCallback]); // <-- Callback is stable, effect doesn't re-run

      return { state, setState, stableCallback };
    });

    // Initial mount: 1 connect
    expect(connectCount.value).toBe(1);
    expect(disconnectCount.value).toBe(0);

    // Change state
    act(() => {
      result.current.setState({ tempo: 130 });
    });

    // FIXED: No reconnection on state change
    expect(connectCount.value).toBe(1); // GOOD: Still 1
    expect(disconnectCount.value).toBe(0); // GOOD: Still 0

    // The callback still returns the current state when called
    expect(result.current.stableCallback()).toEqual({ tempo: 130 });
  });

  /**
   * This test verifies that the stable callback still returns current state
   * even though it doesn't trigger reconnection on state changes.
   */
  it('FIXED PATTERN: stable callback returns current state values', () => {
    const { result } = renderHook(() => {
      const [state, setState] = useState({ tempo: 120, swing: 0 });

      const stateRef = useRef(state);
      stateRef.current = state;

      const getStateForHash = useCallback(() => ({
        tempo: stateRef.current.tempo,
        swing: stateRef.current.swing,
      }), []);

      return { state, setState, getStateForHash };
    });

    // Initial state
    expect(result.current.getStateForHash()).toEqual({ tempo: 120, swing: 0 });

    // Change tempo
    act(() => {
      result.current.setState({ tempo: 140, swing: 0 });
    });
    expect(result.current.getStateForHash()).toEqual({ tempo: 140, swing: 0 });

    // Change swing
    act(() => {
      result.current.setState({ tempo: 140, swing: 50 });
    });
    expect(result.current.getStateForHash()).toEqual({ tempo: 140, swing: 50 });
  });
});

// ============================================================================
// Tests for Multiple Rapid State Changes (Storm Simulation)
// ============================================================================

describe('Connection Storm Bug: Rapid State Changes', () => {
  /**
   * Simulates the real-world scenario: multiple state changes in quick succession
   * should NOT cause multiple reconnections.
   */
  it('BUGGY PATTERN: rapid state changes cause N reconnections', () => {
    const connectCount = { value: 0 };

    const { result } = renderHook(() => {
      const [tempo, setTempo] = useState(120);

      const unstableCallback = useCallback(() => ({ tempo }), [tempo]);

      useEffect(() => {
        connectCount.value++;
      }, [unstableCallback]);

      return { setTempo };
    });

    expect(connectCount.value).toBe(1);

    // Simulate rapid tempo changes (like dragging a slider)
    act(() => {
      for (let i = 121; i <= 130; i++) {
        result.current.setTempo(i);
      }
    });

    // BUG: Each state change causes a reconnection
    // In batched updates this might be less, but the pattern is still wrong
    expect(connectCount.value).toBeGreaterThan(1); // This is the bug
  });

  /**
   * With the fix, rapid state changes should cause 0 additional reconnections.
   */
  it('FIXED PATTERN: rapid state changes cause 0 reconnections', () => {
    const connectCount = { value: 0 };

    const { result } = renderHook(() => {
      const [tempo, setTempo] = useState(120);

      const tempoRef = useRef(tempo);
      tempoRef.current = tempo;

      const stableCallback = useCallback(() => ({ tempo: tempoRef.current }), []);

      useEffect(() => {
        connectCount.value++;
      }, [stableCallback]);

      return { setTempo, getState: stableCallback };
    });

    expect(connectCount.value).toBe(1);

    // Simulate rapid tempo changes
    act(() => {
      for (let i = 121; i <= 130; i++) {
        result.current.setTempo(i);
      }
    });

    // FIXED: No additional reconnections
    expect(connectCount.value).toBe(1);

    // But the callback returns the latest value
    expect(result.current.getState()).toEqual({ tempo: 130 });
  });
});

// ============================================================================
// Tests for useEffect Dependency Stability
// ============================================================================

describe('Connection Storm Bug: Effect Dependency Stability', () => {
  /**
   * Verify that Object.is comparison detects callback reference changes.
   */
  it('Object.is returns false for different callback references', () => {
    const makeCallback = (value: number) => () => value;

    const cb1 = makeCallback(1);
    const cb2 = makeCallback(1);

    // Even with same return value, they are different references
    expect(Object.is(cb1, cb2)).toBe(false);
    expect(cb1()).toBe(cb2()); // Same value
    expect(cb1).not.toBe(cb2); // Different reference
  });

  /**
   * Verify that the same callback reference is preserved with useCallback([]).
   */
  it('useCallback with empty deps maintains reference', () => {
    const references: (() => void)[] = [];

    const { rerender } = renderHook(() => {
      const [, setCount] = useState(0);
      const stableCallback = useCallback(() => {}, []);
      references.push(stableCallback);
      return { setCount };
    });

    // Initial render
    expect(references.length).toBe(1);

    // Force re-render
    rerender();
    expect(references.length).toBe(2);

    // Same reference
    expect(references[0]).toBe(references[1]);
  });

  /**
   * Verify that useCallback with deps creates new reference when deps change.
   */
  it('useCallback with deps creates new reference when deps change', () => {
    const references: (() => number)[] = [];

    const { result } = renderHook(() => {
      const [count, setCount] = useState(0);
      const unstableCallback = useCallback(() => count, [count]);
      references.push(unstableCallback);
      return { setCount };
    });

    expect(references.length).toBe(1);

    act(() => {
      result.current.setCount(1);
    });

    expect(references.length).toBe(2);

    // Different reference after state change
    expect(references[0]).not.toBe(references[1]);
  });
});

// ============================================================================
// Integration-style Test: Full Pattern
// ============================================================================

describe('Connection Storm Bug: Full Integration Pattern', () => {
  /**
   * This test mirrors the actual useMultiplayer hook pattern and verifies
   * that the fix prevents reconnection storms.
   */
  it('mimics useMultiplayer with stable getStateForHash', () => {
    const connectionEvents: string[] = [];
    const sessionId = 'test-session';

    const { result } = renderHook(() => {
      // State (mimics grid reducer state)
      const [state, setState] = useState({
        tracks: [{ id: 'track-1', steps: [false, true, false] }],
        tempo: 120,
        swing: 0,
      });

      // FIXED: Ref pattern for state getter
      const stateRef = useRef(state);
      stateRef.current = state;

      const getStateForHash = useCallback(() => ({
        tracks: stateRef.current.tracks,
        tempo: stateRef.current.tempo,
        swing: stateRef.current.swing,
      }), []); // Empty deps = stable reference

      // Connection status
      const [isConnected, setIsConnected] = useState(false);

      // Mimic useMultiplayer's connection effect
      useEffect(() => {
        if (!sessionId) return;

        connectionEvents.push('connect');
        setIsConnected(true);

        return () => {
          connectionEvents.push('disconnect');
          setIsConnected(false);
        };
      }, [getStateForHash]); // getStateForHash is now stable (sessionId is constant)

      return {
        state,
        setState,
        isConnected,
        getStateForHash,
      };
    });

    // Initial connection
    expect(connectionEvents).toEqual(['connect']);
    expect(result.current.isConnected).toBe(true);

    // Simulate state changes (like user clicking steps)
    act(() => {
      result.current.setState(prev => ({
        ...prev,
        tracks: [{ id: 'track-1', steps: [true, true, false] }],
      }));
    });

    // NO reconnection on state change
    expect(connectionEvents).toEqual(['connect']); // Still just 1 connect

    // Simulate tempo change
    act(() => {
      result.current.setState(prev => ({ ...prev, tempo: 140 }));
    });

    // Still no reconnection
    expect(connectionEvents).toEqual(['connect']);

    // getStateForHash returns current values
    expect(result.current.getStateForHash()).toEqual({
      tracks: [{ id: 'track-1', steps: [true, true, false] }],
      tempo: 140,
      swing: 0,
    });
  });
});
