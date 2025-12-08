import { useCallback, useRef } from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  delay?: number;
}

interface UseLongPressReturn {
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

/**
 * Hook for detecting long press on both desktop (mouse) and mobile (touch)
 * - Short tap/click triggers onClick
 * - Hold for `delay` ms triggers onLongPress
 *
 * Works alongside Shift+Click: if Shift is held, immediately triggers onLongPress
 */
export function useLongPress({
  onLongPress,
  onClick,
  delay = 400,
}: UseLongPressOptions): UseLongPressReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback((x: number, y: number, shiftKey: boolean) => {
    // If shift is held, trigger immediately (backward compatible with desktop)
    if (shiftKey) {
      isLongPressRef.current = true;
      onLongPress();
      return;
    }

    startPosRef.current = { x, y };
    isLongPressRef.current = false;

    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      onLongPress();
    }, delay);
  }, [delay, onLongPress]);

  const end = useCallback(() => {
    clear();
    if (!isLongPressRef.current && onClick) {
      onClick();
    }
    isLongPressRef.current = false;
    startPosRef.current = null;
  }, [clear, onClick]);

  const cancel = useCallback(() => {
    clear();
    isLongPressRef.current = false;
    startPosRef.current = null;
  }, [clear]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left click
    if (e.button !== 0) return;
    start(e.clientX, e.clientY, e.shiftKey || e.metaKey);
  }, [start]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    start(touch.clientX, touch.clientY, false);
  }, [start]);

  return {
    onMouseDown,
    onMouseUp: end,
    onMouseLeave: cancel,
    onTouchStart,
    onTouchEnd: end,
  };
}
