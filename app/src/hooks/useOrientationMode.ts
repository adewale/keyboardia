/**
 * Hook for detecting device orientation mode for mobile interface simplification
 *
 * Returns one of three modes:
 * - 'portrait': Mobile portrait (width < 768px AND height > width) - consumption only
 * - 'landscape': Mobile landscape (width < 768px AND (width > height OR height < 500px)) - creation mode
 * - 'desktop': Desktop (width >= 768px AND height >= 500px) - full interface
 *
 * Uses debounced orientation change detection (100ms) to avoid rapid state changes
 * during device rotation animations.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export type OrientationMode = 'portrait' | 'landscape' | 'desktop';

const BREAKPOINTS = {
  mobile: 768,
  mobileMaxHeight: 500,
} as const;

const DEBOUNCE_MS = 100;

function getOrientationMode(width: number, height: number): OrientationMode {
  // Desktop: width >= 768px AND height >= 500px
  if (width >= BREAKPOINTS.mobile && height >= BREAKPOINTS.mobileMaxHeight) {
    return 'desktop';
  }

  // Mobile landscape: width < 768px AND (width > height OR height < 500px)
  // The height < 500px check catches landscape even when width might be wider
  if (width < BREAKPOINTS.mobile && (width > height || height < BREAKPOINTS.mobileMaxHeight)) {
    return 'landscape';
  }

  // Mobile portrait: width < 768px AND height > width
  return 'portrait';
}

export function useOrientationMode(): OrientationMode {
  const [mode, setMode] = useState<OrientationMode>(() =>
    getOrientationMode(window.innerWidth, window.innerHeight)
  );

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced handler for orientation/resize changes
  const handleChange = useCallback(() => {
    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Debounce the state update
    timeoutRef.current = setTimeout(() => {
      const newMode = getOrientationMode(window.innerWidth, window.innerHeight);
      setMode(newMode);
      timeoutRef.current = null;
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    // Listen for resize events (covers orientation changes on most devices)
    window.addEventListener('resize', handleChange);

    // Also listen for orientationchange event for better mobile support
    window.addEventListener('orientationchange', handleChange);

    // Use ResizeObserver for more reliable detection
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(handleChange);
      observer.observe(document.documentElement);
    }

    return () => {
      window.removeEventListener('resize', handleChange);
      window.removeEventListener('orientationchange', handleChange);
      if (observer) {
        observer.disconnect();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [handleChange]);

  return mode;
}

/**
 * Convenience hook to check if we're in portrait consumption mode
 */
export function useIsPortraitMode(): boolean {
  const mode = useOrientationMode();
  return mode === 'portrait';
}

/**
 * Convenience hook to check if we're in landscape creation mode
 */
export function useIsLandscapeMode(): boolean {
  const mode = useOrientationMode();
  return mode === 'landscape';
}

/**
 * Convenience hook to check if we're on mobile (portrait or landscape)
 */
export function useIsMobile(): boolean {
  const mode = useOrientationMode();
  return mode !== 'desktop';
}
