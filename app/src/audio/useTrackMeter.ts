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
 * Handles the case where the metering worklet loads after the component
 * mounts by subscribing to meteringHost.onReady() and retrying.
 *
 * Uses rAF coalescing and value-change thresholds to limit re-renders
 * to at most once per animation frame, and skips entirely during silence.
 */
export function useTrackMeter(trackId: string): TrackMeterLevel | null {
  const [level, setLevel] = useState<TrackMeterLevel | null>(null);
  const lastRef = useRef<TrackMeterLevel | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let unsubscribeLevels: (() => void) | null = null;

    function subscribe() {
      unsubscribeLevels = meteringHost.onLevels((levels) => {
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
    }

    // Subscribe immediately if available, otherwise wait for ready
    const unsubscribeReady = meteringHost.onReady(() => {
      subscribe();
    });

    return () => {
      unsubscribeReady();
      unsubscribeLevels?.();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [trackId]);

  return level;
}

/**
 * Subscribe to real-time meter levels for all tracks.
 * Returns an empty map if metering is not available.
 *
 * Only triggers a re-render when at least one track's values have changed.
 */
export function useAllTrackMeters(): Map<string, TrackMeterLevel> {
  const [levels, setLevels] = useState<Map<string, TrackMeterLevel>>(new Map());

  useEffect(() => {
    let unsubscribeLevels: (() => void) | null = null;

    function subscribe() {
      unsubscribeLevels = meteringHost.onLevels((newLevels) => {
        setLevels(prev => {
          if (prev.size !== newLevels.size) return new Map(newLevels);
          for (const [id, level] of newLevels) {
            const old = prev.get(id);
            if (!old || old.rms !== level.rms || old.peak !== level.peak || old.clipping !== level.clipping) {
              return new Map(newLevels);
            }
          }
          return prev;
        });
      });
    }

    const unsubscribeReady = meteringHost.onReady(() => {
      subscribe();
    });

    return () => {
      unsubscribeReady();
      unsubscribeLevels?.();
    };
  }, []);

  return levels;
}
