import { useCallback, useRef, useMemo } from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  delay?: number;
}

interface UseLongPressReturn {
  // Pointer Events (modern, unified) - preferred
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

/**
 * Hook for detecting long press using the Pointer Events API.
 *
 * - Short tap/click triggers onClick
 * - Hold for `delay` ms triggers onLongPress
 * - Shift+Click or Meta+Click immediately triggers onLongPress (desktop power user shortcut)
 *
 * ## Why Pointer Events?
 *
 * The Pointer Events API unifies mouse, touch, and stylus input into a single event system.
 * This eliminates the "ghost click" problem where mobile browsers fire synthesized mouse
 * events after touch events, causing double-fires.
 *
 * Previously we used separate onTouchStart/onTouchEnd AND onMouseDown/onMouseUp handlers,
 * which required timestamp-based deduplication to prevent ghost clicks.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
 * @see https://web.dev/mobile-touchandmouse/
 * @see https://caniuse.com/pointer (96%+ browser support)
 */
export function useLongPress({
  onLongPress,
  onClick,
  delay = 400,
}: UseLongPressOptions): UseLongPressReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const isActiveRef = useRef(false);
  // Track which pointer started the interaction (for multi-touch scenarios)
  const activePointerIdRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback((pointerId: number, shiftKey: boolean) => {
    // If shift/meta is held, trigger long press immediately (power user shortcut)
    if (shiftKey) {
      isLongPressRef.current = true;
      isActiveRef.current = true;
      activePointerIdRef.current = pointerId;
      onLongPress();
      return;
    }

    isLongPressRef.current = false;
    isActiveRef.current = true;
    activePointerIdRef.current = pointerId;

    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      onLongPress();
    }, delay);
  }, [delay, onLongPress]);

  const end = useCallback((pointerId: number) => {
    // Only process end if this is the pointer that started the interaction
    if (!isActiveRef.current || activePointerIdRef.current !== pointerId) return;

    clear();
    if (!isLongPressRef.current && onClick) {
      onClick();
    }
    isLongPressRef.current = false;
    isActiveRef.current = false;
    activePointerIdRef.current = null;
  }, [clear, onClick]);

  const cancel = useCallback(() => {
    clear();
    isLongPressRef.current = false;
    isActiveRef.current = false;
    activePointerIdRef.current = null;
  }, [clear]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only primary button (left click / single touch)
    if (e.button !== 0) return;
    // Ignore if already tracking a pointer (prevents multi-touch issues)
    if (isActiveRef.current) return;

    start(e.pointerId, e.shiftKey || e.metaKey);
  }, [start]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    end(e.pointerId);
  }, [end]);

  const onPointerLeave = useCallback((e: React.PointerEvent) => {
    // Only cancel if this is our active pointer
    if (activePointerIdRef.current === e.pointerId) {
      cancel();
    }
  }, [cancel]);

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    // Pointer was cancelled (e.g., palm rejection, system gesture)
    if (activePointerIdRef.current === e.pointerId) {
      cancel();
    }
  }, [cancel]);

  // BUG FIX: Memoize return object to prevent recreating handlers in consumers
  // Without this, components using useLongPress would get a new object reference
  // on every render, causing their own useCallback deps to invalidate
  return useMemo(() => ({
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
  }), [onPointerDown, onPointerUp, onPointerLeave, onPointerCancel]);
}
