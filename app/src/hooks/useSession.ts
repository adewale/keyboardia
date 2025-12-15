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
import { logger } from '../utils/logger';
import { audioEngine } from '../audio/engine';

export type SessionStatus = 'loading' | 'ready' | 'error' | 'saving' | 'not_found';

/**
 * Phase 13B: Session loading state machine
 *
 * Prevents race condition where auto-save could overwrite just-loaded state.
 *
 * State transitions:
 * - 'idle' → Initial state, no session loaded
 * - 'loading' → Fetching session from server
 * - 'applying' → Session loaded, waiting for React to apply state update
 * - 'ready' → State applied, auto-save enabled
 *
 * The key insight is that loadState() dispatches a reducer action, but React
 * doesn't immediately update the state. We need to wait for the state update
 * to propagate before enabling auto-save.
 */
type LoadingState = 'idle' | 'loading' | 'applying' | 'ready';

interface UseSessionResult {
  status: SessionStatus;
  sessionId: string | null;
  sessionName: string | null;
  renameSession: (name: string | null) => Promise<void>;
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
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [remixedFrom, setRemixedFrom] = useState<string | null>(null);
  const [remixedFromName, setRemixedFromName] = useState<string | null>(null);
  const [remixCount, setRemixCount] = useState<number>(0);
  const [lastAccessedAt, setLastAccessedAt] = useState<number | null>(null);
  const initializedRef = useRef(false);
  const lastStateRef = useRef<string>('');

  // Phase 13B: Loading state machine to prevent race condition
  const loadingStateRef = useRef<LoadingState>('idle');
  // Store the expected state hash after load to verify state was applied
  const expectedStateHashRef = useRef<string | null>(null);

  // Debug logging
  const { isDebugMode, logState, logError, setSessionInfo } = useDebug();

  // Initialize session on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    async function init() {
      try {
        loadingStateRef.current = 'loading';
        const urlSessionId = getSessionIdFromUrl();

        if (urlSessionId) {
          // Try to load existing session from URL
          if (isDebugMode) logState({ action: 'loading', sessionId: urlSessionId });

          const session = await loadSession(urlSessionId);
          if (session) {
            const gridState = sessionToGridState(session);
            if (gridState.tracks && gridState.tempo !== undefined && gridState.swing !== undefined) {
              // Phase 13B: Calculate expected state hash BEFORE calling loadState
              // This ensures we can verify the state update was applied
              expectedStateHashRef.current = JSON.stringify({
                tracks: gridState.tracks,
                tempo: gridState.tempo,
                swing: gridState.swing,
              });
              loadingStateRef.current = 'applying';

              loadState(gridState.tracks, gridState.tempo, gridState.swing);

              // Preload any sampled instruments used by tracks (e.g., piano)
              // AWAIT this to ensure piano is ready before user can hit play
              // Without this, first piano notes may be silent (race condition)
              await audioEngine.preloadInstrumentsForTracks(gridState.tracks);
            } else {
              // No valid state to load, go directly to ready
              loadingStateRef.current = 'ready';
            }
            setSessionName(session.name ?? null);
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
          loadingStateRef.current = 'idle';
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
        loadingStateRef.current = 'ready';
        setStatus('ready');

        // Update debug info
        setSessionInfo(session.id, { trackCount: 0, tempo: 120, swing: 0 });
        if (isDebugMode) logState({ action: 'created', sessionId: session.id });
      } catch (error) {
        logger.session.error('Failed to initialize session:', error);
        if (isDebugMode) logError('Failed to initialize session', error);
        loadingStateRef.current = 'idle';
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
  // Phase 13B: Use state machine to prevent race condition
  useEffect(() => {
    if (status !== 'ready') return;

    const stateJson = JSON.stringify({
      tracks: state.tracks,
      tempo: state.tempo,
      swing: state.swing,
    });

    // Phase 13B: Handle 'applying' state - verify loaded state was applied
    if (loadingStateRef.current === 'applying') {
      if (stateJson === expectedStateHashRef.current) {
        // State was successfully applied, transition to ready
        loadingStateRef.current = 'ready';
        lastStateRef.current = stateJson;
        expectedStateHashRef.current = null;
        logger.session.log('State machine: applying → ready');
      }
      // Don't save yet - either state hasn't propagated or we just confirmed it
      return;
    }

    // Only allow saves when state machine is in 'ready' state
    if (loadingStateRef.current !== 'ready') {
      return;
    }

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

  // Rename the current session
  const renameSession = useCallback(async (name: string | null): Promise<void> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      throw new Error('No active session');
    }

    const response = await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      throw new Error('Failed to rename session');
    }

    setSessionName(name ? name.trim().slice(0, 100) || null : null);
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
      logger.session.error('Failed to create session:', error);
      setStatus('error');
    }
  }, [resetState]);

  // Calculate if session is orphaned (inactive for 90+ days)
  const isOrphaned = lastAccessedAt !== null &&
    (Date.now() - lastAccessedAt) >= ORPHAN_THRESHOLD_MS;

  return {
    status,
    sessionId: getCurrentSessionId(),
    sessionName,
    renameSession,
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
