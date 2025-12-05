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
  forkSession,
  updateUrlWithSession,
  getCurrentSessionId,
  sessionToGridState,
} from '../sync/session';

export type SessionStatus = 'loading' | 'ready' | 'error' | 'saving' | 'not_found';

interface UseSessionResult {
  status: SessionStatus;
  sessionId: string | null;
  forkedFrom: string | null;
  share: () => Promise<string>;
  fork: () => Promise<string>;
  createNew: () => Promise<void>;
}

export function useSession(
  state: GridState,
  loadState: (tracks: GridState['tracks'], tempo: number, swing: number) => void
): UseSessionResult {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [forkedFrom, setForkedFrom] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const lastStateRef = useRef<string>('');

  // Initialize session on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    async function init() {
      try {
        const urlSessionId = getSessionIdFromUrl();

        if (urlSessionId) {
          // Try to load existing session from URL
          const session = await loadSession(urlSessionId);
          if (session) {
            const gridState = sessionToGridState(session);
            if (gridState.tracks && gridState.tempo !== undefined && gridState.swing !== undefined) {
              loadState(gridState.tracks, gridState.tempo, gridState.swing);
            }
            setForkedFrom(session.forkedFrom);
            setStatus('ready');
            return;
          }
          // Session not found - show error, don't auto-create
          setStatus('not_found');
          return;
        }

        // No session in URL - create new
        const session = await createSession({
          tracks: state.tracks,
          tempo: state.tempo,
          swing: state.swing,
          version: 1,
        });
        updateUrlWithSession(session.id);
        setStatus('ready');
      } catch (error) {
        console.error('Failed to initialize session:', error);
        setStatus('error');
      }
    }

    init();
  }, []); // Only run once on mount

  // Auto-save on state changes (debounced in saveSession)
  useEffect(() => {
    if (status !== 'ready') return;

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

  // Fork current session
  const fork = useCallback(async (): Promise<string> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      throw new Error('No active session');
    }

    setStatus('saving');
    try {
      const forked = await forkSession(sessionId);
      updateUrlWithSession(forked.id);
      setForkedFrom(sessionId);
      setStatus('ready');
      return `${window.location.origin}/s/${forked.id}`;
    } catch (error) {
      setStatus('error');
      throw error;
    }
  }, []);

  // Create a new session (used from not_found state or New button)
  const createNew = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      const session = await createSession({
        tracks: state.tracks,
        tempo: state.tempo,
        swing: state.swing,
        version: 1,
      });
      updateUrlWithSession(session.id);
      setForkedFrom(null);
      setStatus('ready');
    } catch (error) {
      console.error('Failed to create session:', error);
      setStatus('error');
    }
  }, [state.tracks, state.tempo, state.swing]);

  return {
    status,
    sessionId: getCurrentSessionId(),
    forkedFrom,
    share,
    fork,
    createNew,
  };
}
