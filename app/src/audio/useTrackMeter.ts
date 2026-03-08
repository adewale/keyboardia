/**
 * React hook for per-track audio metering.
 *
 * Usage:
 *   const level = useTrackMeter('track-1');
 *   // level?.rms, level?.peak, level?.clipping
 */

import { useState, useEffect, useRef } from 'react';
import { meteringHost, type TrackMeterLevel } from './metering-host';

/**
 * Subscribe to real-time meter levels for a specific track.
 * Returns null if metering is not available or no data yet.
 *
 * Uses rAF coalescing and value-change thresholds to limit re-renders
 * to at most once per animation frame, and skips entirely during silence.
 */
export function useTrackMeter(trackId: string): TrackMeterLevel | null {
  const [level, setLevel] = useState<TrackMeterLevel | null>(null);
  const lastRef = useRef<TrackMeterLevel | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!meteringHost.isAvailable()) return;

    const unsubscribe = meteringHost.onLevels((levels) => {
      const trackLevel = levels.get(trackId);
      if (!trackLevel) return;

      // Skip update if values haven't changed meaningfully
      const prev = lastRef.current;
      if (prev &&
          Math.abs(prev.rms - trackLevel.rms) < 0.005 &&
          Math.abs(prev.peak - trackLevel.peak) < 0.005 &&
          prev.clipping === trackLevel.clipping) {
        return;
      }

      lastRef.current = trackLevel;

      // Coalesce to rAF — at most one React render per frame
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          setLevel(lastRef.current);
        });
      }
    });

    return () => {
      unsubscribe();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [trackId]);

  return level;
}

/**
 * Subscribe to real-time meter levels for all tracks.
 * Returns an empty map if metering is not available.
 */
export function useAllTrackMeters(): Map<string, TrackMeterLevel> {
  const [levels, setLevels] = useState<Map<string, TrackMeterLevel>>(new Map());

  useEffect(() => {
    if (!meteringHost.isAvailable()) return;

    const unsubscribe = meteringHost.onLevels((newLevels) => {
      setLevels(new Map(newLevels));
    });

    return unsubscribe;
  }, []);

  return levels;
}
