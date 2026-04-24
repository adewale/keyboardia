/**
 * useSchedulerStateSync — push live grid-state changes into the scheduler.
 *
 * The main-thread scheduler reads grid state via a closure on every tick,
 * so edits are picked up implicitly. The AudioWorklet host, however, owns
 * a serialized snapshot that only refreshes when explicitly told to.
 * This hook keeps both implementations in sync with the latest state
 * during playback.
 */

import { useEffect, useRef } from 'react';
import type { GridState } from '../types';

export interface StateSyncTarget {
  updateState?: (state: GridState) => void;
}

export function useSchedulerStateSync(
  scheduler: StateSyncTarget,
  state: GridState,
  isPlaying: boolean,
): void {
  const hasSyncedInitialRef = useRef(false);

  useEffect(() => {
    if (!isPlaying) {
      // Reset the "first render while playing" guard so a later play session
      // behaves the same way.
      hasSyncedInitialRef.current = false;
      return;
    }

    if (!hasSyncedInitialRef.current) {
      // The first render while playing is right after scheduler.start(),
      // which already serialized the current state. Nothing to push.
      hasSyncedInitialRef.current = true;
      return;
    }

    scheduler.updateState?.(state);
  }, [scheduler, state, isPlaying]);
}
