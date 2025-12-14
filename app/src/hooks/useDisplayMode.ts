/**
 * Hook for detecting display mode based on viewport width
 *
 * Used by QR overlay to adapt layout:
 * - large (≥1024px): Side panel that pushes content
 * - medium (768px - 1023px): Floating card in bottom-right
 * - small (<768px): Fullscreen modal with backdrop
 */

import { useState, useEffect } from 'react';

export type DisplayMode = 'large' | 'medium' | 'small';

const BREAKPOINTS = {
  large: 1024,
  medium: 768,
} as const;

function getDisplayMode(width: number): DisplayMode {
  if (width >= BREAKPOINTS.large) return 'large';
  if (width >= BREAKPOINTS.medium) return 'medium';
  return 'small';
}

export function useDisplayMode(): DisplayMode {
  const [mode, setMode] = useState<DisplayMode>(() =>
    getDisplayMode(window.innerWidth)
  );

  useEffect(() => {
    const handleResize = () => {
      setMode(getDisplayMode(window.innerWidth));
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
