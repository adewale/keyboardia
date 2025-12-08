/**
 * React hook for session persistence
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { GridState } from '../types';
import {
  getSessionIdFromUrl,
  loadSession,
  createSession,
  saveSession,
  remixSession,
  sendCopy,
  updateUrlWithSession,
  getCurrentSessionId,
  sessionToGridState,
} from '../sync/session';
import { useDebug } from '../debug/DebugContext';

export type SessionStatus = 'loading' | 'ready' | 'error' | 'saving' | 'not_found';

interface UseSessionResult {
  status: SessionStatus;
  sessionId: string | null;
  remixedFrom: string | null;
  remixedFromName: string | null;
  remixCount: number;
  lastAccessedAt: number | null;
  isOrphaned: boolean;
  share: () => Promise<string>;
  sendCopy: () => Promise<string>;
  remix: () => Promise<string>;
  createNew: () => Promise<void>;
}

// 90 days in milliseconds
const ORPHAN_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;

export function useSession(
  state: GridState,
  loadState: (tracks: GridState['tracks'], tempo: number, swing: number) => void,
  resetState: () => void
): UseSessionResult {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [remixedFrom, setRemixedFrom] = useState<string | null>(null);
  const [remixedFromName, setRemixedFromName] = useState<string | null>(null);
  const [remixCount, setRemixCount] = useState<number>(0);
  const [lastAccessedAt, setLastAccessedAt] = useState<number | null>(null);
  const initializedRef = useRef(false);
  const lastStateRef = useRef<string>('');
  const skipNextSaveRef = useRef(false);

  // Debug logging
  const { isDebugMode, logState, logError, setSessionInfo } = useDebug();

  // Initialize session on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    async function init() {
      try {
        const urlSessionId = getSessionIdFromUrl();

        if (urlSessionId) {
          // Try to load existing session from URL
          if (isDebugMode) logState({ action: 'loading', sessionId: urlSessionId });

          const session = await loadSession(urlSessionId);
          if (session) {
            const gridState = sessionToGridState(session);
            if (gridState.tracks && gridState.tempo !== undefined && gridState.swing !== undefined) {
              loadState(gridState.tracks, gridState.tempo, gridState.swing);
              // Skip the next auto-save to prevent race condition where empty state
              // gets saved before React re-renders with the loaded state
              skipNextSaveRef.current = true;
            }
            setRemixedFrom(session.remixedFrom);
            setRemixedFromName(session.remixedFromName ?? null);
            setRemixCount(session.remixCount ?? 0);
            setLastAccessedAt(session.lastAccessedAt ?? null);
            setStatus('ready');

            // Update debug info
            setSessionInfo(session.id, {
              trackCount: session.state.tracks.length,
              tempo: session.state.tempo,
              swing: session.state.swing,
            });
            if (isDebugMode) logState({ action: 'loaded', trackCount: session.state.tracks.length });
            return;
          }
          // Session not found - show error, don't auto-create
          if (isDebugMode) logError('Session not found', { sessionId: urlSessionId });
          setStatus('not_found');
          return;
        }

        // No session in URL - create new empty session
        resetState(); // Clear local state to empty
        if (isDebugMode) logState({ action: 'creating', tracks: 0 });

        const session = await createSession({
          tracks: [],
          tempo: 120,
          swing: 0,
          version: 1,
        });
        updateUrlWithSession(session.id);
        setStatus('ready');

        // Update debug info
        setSessionInfo(session.id, { trackCount: 0, tempo: 120, swing: 0 });
        if (isDebugMode) logState({ action: 'created', sessionId: session.id });
      } catch (error) {
        console.error('Failed to initialize session:', error);
        if (isDebugMode) logError('Failed to initialize session', error);
        setStatus('error');
      }
    }

    init();
  }, []); // Only run once on mount

  // Update debug info when state changes
  useEffect(() => {
    if (status === 'ready') {
      setSessionInfo(getCurrentSessionId(), {
        trackCount: state.tracks.length,
        tempo: state.tempo,
        swing: state.swing,
      });
    }
  }, [state.tracks.length, state.tempo, state.swing, status, setSessionInfo]);

  // Auto-save on state changes (debounced in saveSession)
  useEffect(() => {
    if (status !== 'ready') return;

    // Skip save after loading a session to prevent race condition
    // The first render after load still has empty state, but the loaded
    // state is coming in the next render
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      // Initialize lastStateRef with current state to track future changes
      lastStateRef.current = JSON.stringify({
        tracks: state.tracks,
        tempo: state.tempo,
        swing: state.swing,
      });
      return;
    }

    const stateJson = JSON.stringify({
      tracks: state.tracks,
      tempo: state.tempo,
      swing: state.swing,
    });

    // Skip if state hasn't changed
    if (stateJson === lastStateRef.current) return;
    lastStateRef.current = stateJson;

    // Debounced save
    saveSession(state);
  }, [state.tracks, state.tempo, state.swing, status]);

  // Share current session (just return URL since session is always saved)
  const share = useCallback(async (): Promise<string> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      throw new Error('No active session');
    }
    return `${window.location.origin}/s/${sessionId}`;
  }, []);

  // Send a copy (create remix, copy URL, stay here)
  const handleSendCopy = useCallback(async (): Promise<string> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      throw new Error('No active session');
    }
    return sendCopy(sessionId);
  }, []);

  // Remix current session (create a copy and navigate to it)
  const handleRemix = useCallback(async (): Promise<string> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      throw new Error('No active session');
    }

    setStatus('saving');
    try {
      const remixed = await remixSession(sessionId);
      updateUrlWithSession(remixed.id);
      setRemixedFrom(sessionId);
      setRemixedFromName(remixed.remixedFromName ?? null);
      setRemixCount(0);
      setLastAccessedAt(Date.now());
      setStatus('ready');
      return `${window.location.origin}/s/${remixed.id}`;
    } catch (error) {
      setStatus('error');
      throw error;
    }
  }, []);

  // Create a new empty session (used from not_found state or New button)
  const createNew = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      // Reset local state to empty
      resetState();

      // Create empty session on server (no tracks, default tempo/swing)
      const session = await createSession({
        tracks: [],
        tempo: 120,
        swing: 0,
        version: 1,
      });
      updateUrlWithSession(session.id);
      setRemixedFrom(null);
      setRemixedFromName(null);
      setRemixCount(0);
      setLastAccessedAt(Date.now());
      setStatus('ready');
    } catch (error) {
      console.error('Failed to create session:', error);
      setStatus('error');
    }
  }, [resetState]);

  // Calculate if session is orphaned (inactive for 90+ days)
  const isOrphaned = lastAccessedAt !== null &&
    (Date.now() - lastAccessedAt) >= ORPHAN_THRESHOLD_MS;

  return {
    status,
    sessionId: getCurrentSessionId(),
    remixedFrom,
    remixedFromName,
    remixCount,
    lastAccessedAt,
    isOrphaned,
    share,
    sendCopy: handleSendCopy,
    remix: handleRemix,
    createNew,
  };
}
