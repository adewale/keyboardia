/**
 * Tests for useLongPress hook
 *
 * This hook uses the Pointer Events API to unify mouse, touch, and stylus input.
 * This eliminates the "ghost click" problem that plagued the old touch+mouse implementation.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLongPress } from '../../src/hooks/useLongPress';

// Helper to create mock pointer events
function createPointerEvent(
  type: 'pointerdown' | 'pointerup' | 'pointerleave' | 'pointercancel',
  options: {
    pointerId?: number;
    pointerType?: 'mouse' | 'touch' | 'pen';
    button?: number;
    shiftKey?: boolean;
    metaKey?: boolean;
  } = {}
): React.PointerEvent {
  const {
    pointerId = 1,
    pointerType = 'mouse',
    button = 0,
    shiftKey = false,
    metaKey = false,
  } = options;

  return {
    type,
    pointerId,
    pointerType,
    button,
    shiftKey,
    metaKey,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.PointerEvent;
}

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic click behavior', () => {
    it('should call onClick on short click', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown'));
      });

      act(() => {
        vi.advanceTimersByTime(100); // Short press
      });

      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup'));
      });

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onLongPress).not.toHaveBeenCalled();
    });

    it('should call onLongPress on long press (400ms default)', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress, delay: 400 })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown'));
      });

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(onLongPress).toHaveBeenCalledTimes(1);
      expect(onClick).not.toHaveBeenCalled();

      // pointerUp should NOT trigger onClick after long press
      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup'));
      });

      expect(onClick).not.toHaveBeenCalled();
    });

    it('should call onLongPress immediately with Shift+Click', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { shiftKey: true }));
      });

      expect(onLongPress).toHaveBeenCalledTimes(1);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('should call onLongPress immediately with Meta+Click', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { metaKey: true }));
      });

      expect(onLongPress).toHaveBeenCalledTimes(1);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('pointer types', () => {
    it('should work with mouse pointer', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { pointerType: 'mouse' }));
      });

      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup', { pointerType: 'mouse' }));
      });

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should work with touch pointer', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { pointerType: 'touch' }));
      });

      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup', { pointerType: 'touch' }));
      });

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should work with pen/stylus pointer', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { pointerType: 'pen' }));
      });

      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup', { pointerType: 'pen' }));
      });

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('pointer ID tracking (multi-touch safety)', () => {
    it('should ignore pointerUp from different pointer ID', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      // Start with pointer 1
      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { pointerId: 1 }));
      });

      // End with different pointer (2) - should be ignored
      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup', { pointerId: 2 }));
      });

      expect(onClick).not.toHaveBeenCalled();

      // End with correct pointer - should work
      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup', { pointerId: 1 }));
      });

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should ignore second pointer while first is active', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      // First pointer down
      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { pointerId: 1 }));
      });

      // Second pointer down - should be ignored
      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { pointerId: 2 }));
      });

      // Release first pointer
      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup', { pointerId: 1 }));
      });

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancellation', () => {
    it('should cancel on pointerLeave during long press', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress, delay: 400 })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { pointerId: 1 }));
      });

      act(() => {
        vi.advanceTimersByTime(200); // Halfway through
        result.current.onPointerLeave(createPointerEvent('pointerleave', { pointerId: 1 }));
      });

      act(() => {
        vi.advanceTimersByTime(300); // Would have been long press
      });

      expect(onLongPress).not.toHaveBeenCalled();
      expect(onClick).not.toHaveBeenCalled();
    });

    it('should cancel on pointerCancel', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress, delay: 400 })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { pointerId: 1 }));
      });

      act(() => {
        vi.advanceTimersByTime(200);
        result.current.onPointerCancel(createPointerEvent('pointercancel', { pointerId: 1 }));
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onLongPress).not.toHaveBeenCalled();
      expect(onClick).not.toHaveBeenCalled();
    });

    it('should ignore right-clicks', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', { button: 2 })); // Right click
      });

      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup', { button: 2 }));
      });

      expect(onClick).not.toHaveBeenCalled();
      expect(onLongPress).not.toHaveBeenCalled();
    });
  });

  describe('why Pointer Events are better than touch+mouse', () => {
    /**
     * HISTORICAL CONTEXT:
     *
     * The old implementation used separate onTouchStart/onTouchEnd AND onMouseDown/onMouseUp.
     * On mobile browsers, a single tap would fire:
     *   touchstart -> touchend -> onClick() #1
     *   mousedown -> mouseup -> onClick() #2 (synthesized "ghost click")
     *
     * With Pointer Events, there's only ONE event stream regardless of input type.
     * The browser handles the abstraction, so we never see ghost clicks.
     *
     * This test documents the architectural decision.
     */
    it('uses single event system - no ghost click handling needed', () => {
      const onClick = vi.fn();
      const onLongPress = vi.fn();

      const { result } = renderHook(() =>
        useLongPress({ onClick, onLongPress })
      );

      // Simulate touch interaction via Pointer Events
      act(() => {
        result.current.onPointerDown(createPointerEvent('pointerdown', {
          pointerId: 1,
          pointerType: 'touch',
        }));
      });

      act(() => {
        result.current.onPointerUp(createPointerEvent('pointerup', {
          pointerId: 1,
          pointerType: 'touch',
        }));
      });

      // Only ONE click - no ghost click possible because there's only one event system
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
