/**
 * React hook for per-track audio metering.
 *
 * Usage:
 *   const level = useTrackMeter('track-1');
 *   // level?.rms, level?.peak, level?.clipping
 */

import { useState, useEffect } from 'react';
import { meteringHost, type TrackMeterLevel } from './metering-host';

/**
 * Subscribe to real-time meter levels for a specific track.
 * Returns null if metering is not available or no data yet.
 */
export function useTrackMeter(trackId: string): TrackMeterLevel | null {
  const [level, setLevel] = useState<TrackMeterLevel | null>(null);

  useEffect(() => {
    if (!meteringHost.isAvailable()) return;

    const unsubscribe = meteringHost.onLevels((levels) => {
      const trackLevel = levels.get(trackId);
      if (trackLevel) {
        setLevel(trackLevel);
      }
    });

    return unsubscribe;
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
