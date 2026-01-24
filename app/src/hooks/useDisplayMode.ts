/**
 * Hook for detecting display mode based on viewport dimensions
 *
 * Used by QR overlay to adapt layout:
 * - large (≥1024px width): Side panel that pushes content
 * - medium (768px - 1023px width, AND height ≥500px): Floating card in bottom-right
 * - small (<768px width, OR height <500px): Fullscreen modal with backdrop
 *
 * The height check ensures mobile landscape uses fullscreen modal (small),
 * not floating card (medium), since landscape mobile has limited vertical space.
 *
 * Also exports orientation detection:
 * - portrait: Mobile portrait (consumption mode)
 * - landscape: Mobile landscape (creation mode)
 * - desktop: Full desktop interface
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export type DisplayMode = 'large' | 'medium' | 'small';
export type OrientationMode = 'portrait' | 'landscape' | 'desktop';

const BREAKPOINTS = {
  large: 1024,
  medium: 768,
  // If height is below this, treat as mobile (use fullscreen modal)
  mobileMaxHeight: 500,
} as const;

const DEBOUNCE_MS = 100;

function getDisplayMode(width: number, height: number): DisplayMode {
  // Mobile landscape: width may be 800+, but height is ~300-400px
  // Use fullscreen modal for better UX
  if (height < BREAKPOINTS.mobileMaxHeight) return 'small';

  if (width >= BREAKPOINTS.large) return 'large';
  if (width >= BREAKPOINTS.medium) return 'medium';
  return 'small';
}

function getOrientationMode(width: number, height: number): OrientationMode {
  // Desktop: width >= 768px AND height >= 500px
  if (width >= BREAKPOINTS.medium && height >= BREAKPOINTS.mobileMaxHeight) {
    return 'desktop';
  }

  // Mobile landscape: height < 500px (always landscape) OR width > height
  // This handles the case where a phone in landscape has width >= 768 but height < 500
  if (height < BREAKPOINTS.mobileMaxHeight || width > height) {
    return 'landscape';
  }

  // Mobile portrait: height >= width (tall screen)
  return 'portrait';
}

export function useDisplayMode(): DisplayMode {
  const [mode, setMode] = useState<DisplayMode>(() =>
    getDisplayMode(window.innerWidth, window.innerHeight)
  );

  useEffect(() => {
    const handleResize = () => {
      setMode(getDisplayMode(window.innerWidth, window.innerHeight));
    };

    // Use ResizeObserver for better performance if available
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        handleResize();
      });
      observer.observe(document.documentElement);
      return () => observer.disconnect();
    }

    // Fallback to window resize event
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return mode;
}

/**
 * Hook for detecting device orientation mode with debouncing
 * Used for mobile interface simplification (portrait consumption vs landscape creation)
 */
export function useOrientationMode(): OrientationMode {
  const [mode, setMode] = useState<OrientationMode>(() =>
    getOrientationMode(window.innerWidth, window.innerHeight)
  );

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      const newMode = getOrientationMode(window.innerWidth, window.innerHeight);
      setMode(newMode);
      timeoutRef.current = null;
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    window.addEventListener('resize', handleChange);
    window.addEventListener('orientationchange', handleChange);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(handleChange);
      observer.observe(document.documentElement);
    }

    return () => {
      window.removeEventListener('resize', handleChange);
      window.removeEventListener('orientationchange', handleChange);
      if (observer) observer.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
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
