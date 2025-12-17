/**
 * Tests for useStableCallback and useStableGetter hooks.
 *
 * These hooks prevent the "Unstable Callback in useEffect Dependency" bug pattern.
 * See docs/bug-patterns.md for details.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useEffect, useCallback } from 'react';
import { useStableCallback, useStableGetter } from './useStableCallback';

describe('useStableCallback', () => {
  it('should maintain stable reference across renders', () => {
    const callbackRefs: ((...args: unknown[]) => unknown)[] = [];

    const { result, rerender } = renderHook(() => {
      const [count, setCount] = useState(0);

      const callback = useStableCallback(() => count);
      callbackRefs.push(callback);

      return { setCount, callback };
    });

    expect(callbackRefs.length).toBe(1);

    // Trigger state change
    act(() => {
      result.current.setCount(1);
    });

    expect(callbackRefs.length).toBe(2);

    // Callback reference should be the same
    expect(callbackRefs[0]).toBe(callbackRefs[1]);

    // But calling it returns current value
    expect(result.current.callback()).toBe(1);

    // Rerender without state change
    rerender();
    expect(callbackRefs.length).toBe(3);
    expect(callbackRefs[0]).toBe(callbackRefs[2]);
  });

  it('should always call the latest function version', () => {
    const { result } = renderHook(() => {
      const [multiplier, setMultiplier] = useState(1);

      const calculate = useStableCallback((value: number) => value * multiplier);

      return { setMultiplier, calculate };
    });

    expect(result.current.calculate(10)).toBe(10);

    act(() => {
      result.current.setMultiplier(5);
    });

    // Same callback reference, but uses latest multiplier
    expect(result.current.calculate(10)).toBe(50);
  });

  it('should not cause useEffect to re-run on state changes', () => {
    const effectRunCount = { value: 0 };

    const { result } = renderHook(() => {
      const [count, setCount] = useState(0);

      const getCount = useStableCallback(() => count);

      useEffect(() => {
        effectRunCount.value++;
      }, [getCount]);

      return { setCount, getCount };
    });

    expect(effectRunCount.value).toBe(1);

    // Multiple state changes
    act(() => {
      result.current.setCount(1);
      result.current.setCount(2);
      result.current.setCount(3);
    });

    // Effect should still only have run once
    expect(effectRunCount.value).toBe(1);

    // But callback returns latest value
    expect(result.current.getCount()).toBe(3);
  });

  it('should prevent connection storm pattern', () => {
    const connectionEvents: string[] = [];

    const { result } = renderHook(() => {
      const [state, setState] = useState({
        tempo: 120,
        tracks: [{ id: '1', steps: [false] }],
      });

      // Using useStableCallback instead of the buggy pattern
      const getStateForHash = useStableCallback(() => ({
        tempo: state.tempo,
        tracks: state.tracks,
      }));

      // Simulates useMultiplayer's effect
      useEffect(() => {
        connectionEvents.push('connect');
        return () => {
          connectionEvents.push('disconnect');
        };
      }, [getStateForHash]);

      return { setState, getStateForHash };
    });

    expect(connectionEvents).toEqual(['connect']);

    // Simulate rapid state changes (like during user interaction)
    act(() => {
      result.current.setState(prev => ({ ...prev, tempo: 130 }));
      result.current.setState(prev => ({ ...prev, tempo: 140 }));
      result.current.setState(prev => ({
        ...prev,
        tracks: [{ id: '1', steps: [true] }],
      }));
    });

    // Still only one connect (no connection storm!)
    expect(connectionEvents).toEqual(['connect']);

    // But getter returns latest state
    expect(result.current.getStateForHash().tempo).toBe(140);
  });

  it('should compare to buggy useCallback pattern', () => {
    const stableEffectRuns = { value: 0 };
    const unstableEffectRuns = { value: 0 };

    // Stable version using useStableCallback
    const { result: stableResult } = renderHook(() => {
      const [count, setCount] = useState(0);
      const getCount = useStableCallback(() => count);

      useEffect(() => {
        stableEffectRuns.value++;
      }, [getCount]);

      return { setCount };
    });

    // Buggy version using useCallback with state deps
    const { result: unstableResult } = renderHook(() => {
      const [count, setCount] = useState(0);
      const getCount = useCallback(() => count, [count]);

      useEffect(() => {
        unstableEffectRuns.value++;
      }, [getCount]);

      return { setCount };
    });

    expect(stableEffectRuns.value).toBe(1);
    expect(unstableEffectRuns.value).toBe(1);

    // State change
    act(() => {
      stableResult.current.setCount(1);
      unstableResult.current.setCount(1);
    });

    // Stable: effect did NOT re-run
    expect(stableEffectRuns.value).toBe(1);

    // Unstable (buggy): effect DID re-run
    expect(unstableEffectRuns.value).toBe(2);
  });
});

describe('useStableGetter', () => {
  it('should maintain stable reference across renders', () => {
    const getterRefs: (() => number)[] = [];

    const { result } = renderHook(() => {
      const [count, setCount] = useState(0);
      const getCount = useStableGetter(count);
      getterRefs.push(getCount);

      return { setCount, getCount };
    });

    expect(getterRefs.length).toBe(1);

    act(() => {
      result.current.setCount(5);
    });

    expect(getterRefs.length).toBe(2);
    expect(getterRefs[0]).toBe(getterRefs[1]);
    expect(result.current.getCount()).toBe(5);
  });

  it('should work with complex objects', () => {
    const { result } = renderHook(() => {
      const [state, setState] = useState({
        tempo: 120,
        tracks: ['a', 'b', 'c'],
      });

      const getState = useStableGetter(state);

      return { setState, getState };
    });

    const initialGetter = result.current.getState;

    act(() => {
      result.current.setState({ tempo: 180, tracks: ['x', 'y'] });
    });

    // Same reference
    expect(result.current.getState).toBe(initialGetter);

    // Returns latest value
    expect(result.current.getState()).toEqual({
      tempo: 180,
      tracks: ['x', 'y'],
    });
  });

  it('should be usable as effect dependency without re-runs', () => {
    const effectRuns = { value: 0 };

    const { result } = renderHook(() => {
      const [value, setValue] = useState('initial');
      const getValue = useStableGetter(value);

      useEffect(() => {
        effectRuns.value++;
        // Use the getter
        void getValue();
      }, [getValue]);

      return { setValue, getValue };
    });

    expect(effectRuns.value).toBe(1);

    act(() => {
      result.current.setValue('updated');
    });

    // Effect did not re-run
    expect(effectRuns.value).toBe(1);

    // But getter returns updated value
    expect(result.current.getValue()).toBe('updated');
  });
});

describe('Integration: Preventing Connection Storm', () => {
  /**
   * This test mimics the actual App.tsx + useMultiplayer architecture
   * to verify useStableCallback prevents the connection storm bug.
   */
  it('should prevent WebSocket reconnection on every state change', () => {
    const wsEvents: string[] = [];
    let connectionCount = 0;

    // Simulates useMultiplayer hook
    function useSimulatedMultiplayer(
      sessionId: string | null,
      getStateForHash: () => unknown
    ) {
      useEffect(() => {
        if (!sessionId) return;

        connectionCount++;
        wsEvents.push(`connect-${connectionCount}`);

        // Would normally use getStateForHash for state sync
        void getStateForHash();

        return () => {
          wsEvents.push(`disconnect-${connectionCount}`);
        };
      }, [sessionId, getStateForHash]);
    }

    // Simulates App component using useStableCallback
    const { result } = renderHook(() => {
      const [state, setState] = useState({
        tracks: [{ id: 'track-1', steps: [false, false, false, false] }],
        tempo: 120,
        swing: 0,
      });

      // FIXED pattern using useStableCallback
      const getStateForHash = useStableCallback(() => ({
        tracks: state.tracks,
        tempo: state.tempo,
        swing: state.swing,
      }));

      useSimulatedMultiplayer('test-session', getStateForHash);

      return { state, setState };
    });

    // Initial connection
    expect(wsEvents).toEqual(['connect-1']);
    expect(connectionCount).toBe(1);

    // Simulate extensive user interaction (would cause 100+ reconnects with bug)
    act(() => {
      for (let i = 0; i < 100; i++) {
        result.current.setState(prev => ({
          ...prev,
          tempo: 120 + i,
        }));
      }
    });

    // Still only one connection!
    expect(wsEvents).toEqual(['connect-1']);
    expect(connectionCount).toBe(1);
  });
});
