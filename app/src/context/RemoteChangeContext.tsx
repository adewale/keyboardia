/**
 * Phase 11: Remote Change Attribution Context
 *
 * Tracks recent remote changes to show colored flash animations.
 * Changes expire after 500ms (flash animation duration).
 */

import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from 'react';

export interface StepChange {
  trackId: string;
  step: number;
  color: string;
  timestamp: number;
}

interface RemoteChangeContextValue {
  /** Check if a step has a recent flash */
  getFlashColor: (trackId: string, step: number) => string | null;
  /** Record a remote step change */
  recordChange: (trackId: string, step: number, color: string) => void;
}

const RemoteChangeContext = createContext<RemoteChangeContextValue | null>(null);

const FLASH_DURATION_MS = 600;

export function RemoteChangeProvider({ children }: { children: ReactNode }) {
  // Use ref for the map to avoid re-renders on every change
  const changesRef = useRef<Map<string, StepChange>>(new Map());
  // Trigger re-render when changes are added
  const [, setTrigger] = useState(0);

  const makeKey = (trackId: string, step: number) => `${trackId}:${step}`;

  const recordChange = useCallback((trackId: string, step: number, color: string) => {
    const key = makeKey(trackId, step);
    const change: StepChange = {
      trackId,
      step,
      color,
      timestamp: Date.now(),
    };
    changesRef.current.set(key, change);
    setTrigger(t => t + 1);

    // Auto-cleanup after flash duration
    setTimeout(() => {
      const existing = changesRef.current.get(key);
      if (existing && existing.timestamp === change.timestamp) {
        changesRef.current.delete(key);
        setTrigger(t => t + 1);
      }
    }, FLASH_DURATION_MS);
  }, []);

  const getFlashColor = useCallback((trackId: string, step: number): string | null => {
    const key = makeKey(trackId, step);
    const change = changesRef.current.get(key);
    if (!change) return null;

    // Check if still within flash duration
    const age = Date.now() - change.timestamp;
    if (age > FLASH_DURATION_MS) {
      changesRef.current.delete(key);
      return null;
    }

    return change.color;
  }, []);

  return (
    <RemoteChangeContext.Provider value={{ getFlashColor, recordChange }}>
      {children}
    </RemoteChangeContext.Provider>
  );
}

export function useRemoteChanges() {
  return useContext(RemoteChangeContext);
}
