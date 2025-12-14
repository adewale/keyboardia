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
 */

import { useState, useEffect } from 'react';

export type DisplayMode = 'large' | 'medium' | 'small';

const BREAKPOINTS = {
  large: 1024,
  medium: 768,
  // If height is below this, treat as mobile (use fullscreen modal)
  mobileMaxHeight: 500,
} as const;

function getDisplayMode(width: number, height: number): DisplayMode {
  // Mobile landscape: width may be 800+, but height is ~300-400px
  // Use fullscreen modal for better UX
  if (height < BREAKPOINTS.mobileMaxHeight) return 'small';

  if (width >= BREAKPOINTS.large) return 'large';
  if (width >= BREAKPOINTS.medium) return 'medium';
  return 'small';
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
