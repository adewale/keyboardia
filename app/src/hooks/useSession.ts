/**
 * React hook for session persistence
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { GridState, LoadedSessionState } from '../types';
import {
  getSessionIdFromUrl,
  loadSession,
  createSession,
  saveSession,
  saveSessionNow,
  flushPendingSessionSave,
  remixSession,
  sendCopy,
  publishSession,
  updateUrlWithSession,
  getCurrentSessionId,
  sessionToGridState,
  updateSessionNameViaApi,
} from '../sync/session';
import { sendSessionName, multiplayer } from '../sync/multiplayer';
import { useDebug } from '../debug/DebugContext';
import { logger } from '../utils/logger';

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
  isPublished: boolean;
  setIsPublished: (value: boolean) => void;  // Phase 21: For WebSocket sync
  share: () => Promise<string>;
  sendCopy: () => Promise<string>;
  publish: () => Promise<string>;
  remix: () => Promise<string>;
  createNew: () => Promise<void>;
}

// 90 days in milliseconds
const ORPHAN_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;

export function useSession(
  state: GridState,
  loadState: (loaded: LoadedSessionState) => void,
  resetState: () => void
): UseSessionResult {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [remixedFrom, setRemixedFrom] = useState<string | null>(null);
  const [remixedFromName, setRemixedFromName] = useState<string | null>(null);
  const [remixCount, setRemixCount] = useState<number>(0);
  const [lastAccessedAt, setLastAccessedAt] = useState<number | null>(null);
  const [isOrphanedState, setIsOrphanedState] = useState<boolean>(false);
  const [isPublished, setIsPublished] = useState<boolean>(false);
  const initializedRef = useRef(false);
  const lastStateRef = useRef<string>('');
  const latestStateRef = useRef(state);
  const stateRevisionRef = useRef(0);
  if (latestStateRef.current !== state) {
    latestStateRef.current = state;
    stateRevisionRef.current += 1;
  }

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
              // Old sessions omit extended fields. Hash and dispatch the actual
              // backwards-compatible state that LOAD_STATE will apply.
              const loadedEffects = gridState.effects ?? state.effects;
              const loadedScale = gridState.scale ?? state.scale;
              const loadedLoopRegion = gridState.loopRegion ?? null;
              expectedStateHashRef.current = JSON.stringify({
                tracks: gridState.tracks,
                tempo: gridState.tempo,
                swing: gridState.swing,
                effects: loadedEffects,
                scale: loadedScale,
                loopRegion: loadedLoopRegion,
              });
              loadingStateRef.current = 'applying';

              loadState({
                tracks: gridState.tracks,
                tempo: gridState.tempo,
                swing: gridState.swing,
                effects: loadedEffects,
                scale: loadedScale,
                loopRegion: loadedLoopRegion,
              });
            } else {
              // No valid state to load, go directly to ready
              loadingStateRef.current = 'ready';
            }
            setSessionName(session.name ?? null);
            setRemixedFrom(session.remixedFrom);
            setRemixedFromName(session.remixedFromName ?? null);
            setRemixCount(session.remixCount ?? 0);
            setLastAccessedAt(session.lastAccessedAt ?? null);
            setIsPublished(session.immutable ?? false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: init only on mount, deps are stable
  }, []);

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

  // Calculate orphaned status when lastAccessedAt changes (pure: Date.now() only in effect)
  useEffect(() => {
    if (lastAccessedAt === null) {
      setIsOrphanedState(false);
    } else {
      setIsOrphanedState((Date.now() - lastAccessedAt) >= ORPHAN_THRESHOLD_MS);
    }
  }, [lastAccessedAt]);

  // Auto-save on state changes (debounced in saveSession)
  // Phase 13B: Use state machine to prevent race condition
  useEffect(() => {
    if (status !== 'ready') return;

    const stateJson = JSON.stringify({
      tracks: state.tracks,
      tempo: state.tempo,
      swing: state.swing,
      effects: state.effects,
      scale: state.scale,
      loopRegion: state.loopRegion ?? null,
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

    // Debounced save (state object reference changes with each update but we only care about specific fields)
    saveSession(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentional: only trigger on specific state fields
  }, [state.tracks, state.tempo, state.swing, state.effects, state.scale, state.loopRegion, status]);

  // Rename the current session (synced to other players via WebSocket)
  // Falls back to REST API when WebSocket is not connected (single-player mode)
  const renameSession = useCallback(async (name: string | null): Promise<void> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      throw new Error('No active session');
    }

    const sanitizedName = name ? name.trim().slice(0, 100) || null : null;

    // Check if WebSocket is connected
    const isConnected = multiplayer.isConnected();

    if (isConnected) {
      // Send via WebSocket to sync with other players
      // This triggers set_session_name → server updates KV → broadcasts session_name_changed
      sendSessionName(sanitizedName ?? '');
    } else {
      // Fall back to REST API when disconnected (single-player mode)
      // This persists the name to KV storage without WebSocket sync
      await updateSessionNameViaApi(sessionId, sanitizedName);
    }

    // Update local state optimistically
    setSessionName(sanitizedName);
  }, []);

  // Subscribe to session name changes from other players
  useEffect(() => {
    const unsubscribe = multiplayer.subscribe((state) => {
      // Only update if we have a session name from multiplayer
      if (state.sessionName !== undefined) {
        setSessionName(state.sessionName);
      }
    });
    return unsubscribe;
  }, []);

  const persistBeforeTransition = useCallback(async (sessionId: string | null): Promise<void> => {
    const flushed = await flushPendingSessionSave();
    if (!flushed) throw new Error('Could not flush the current session before continuing');
    // Missing and published sessions have no editable destination to save.
    if (!sessionId || isPublished) return;
    // Save until one request spans a stable revision. This includes edits made
    // during either the flush or an immediate save, not merely the state from
    // the render in which the transition was clicked.
    for (;;) {
      const revision = stateRevisionRef.current;
      const saved = await saveSessionNow(sessionId, latestStateRef.current);
      if (!saved) throw new Error('Could not save the current session before continuing');
      if (revision === stateRevisionRef.current) return;
    }
  }, [isPublished]);

  // Sharing is also a persistence boundary: a recipient can open the URL
  // immediately, before the normal five-second debounce fires.
  const share = useCallback(async (): Promise<string> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) throw new Error('No active session');
    await persistBeforeTransition(sessionId);
    return `${window.location.origin}/s/${sessionId}`;
  }, [persistBeforeTransition]);

  // Send a copy (create remix, copy URL, stay here)
  const handleSendCopy = useCallback(async (): Promise<string> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      throw new Error('No active session');
    }
    await persistBeforeTransition(sessionId);
    return sendCopy(sessionId);
  }, [persistBeforeTransition]);

  // Phase 21: Publish current session (creates immutable copy)
  // Per spec: User stays on their editable session, gets URL to published copy
  const handlePublish = useCallback(async (): Promise<string> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      throw new Error('No active session');
    }

    await persistBeforeTransition(sessionId);
    const result = await publishSession(sessionId);
    // Note: We do NOT set isPublished(true) here!
    // The user stays on their original editable session.
    // isPublished only becomes true when loading a session that has immutable: true.
    return `${window.location.origin}${result.url}`;
  }, [persistBeforeTransition]);

  // Remix current session (create a copy and navigate to it)
  const handleRemix = useCallback(async (): Promise<string> => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      throw new Error('No active session');
    }

    setStatus('saving');
    try {
      await persistBeforeTransition(sessionId);
      const remixed = await remixSession(sessionId);
      updateUrlWithSession(remixed.id);
      setRemixedFrom(sessionId);
      setRemixedFromName(remixed.remixedFromName ?? null);
      setRemixCount(0);
      setLastAccessedAt(Date.now());
      setIsPublished(false);  // Remixes are always editable
      setStatus('ready');
      return `${window.location.origin}/s/${remixed.id}`;
    } catch (error) {
      setStatus('error');
      throw error;
    }
  }, [persistBeforeTransition]);

  // Create a new empty session (used from not_found state or New button)
  const createNew = useCallback(async (): Promise<void> => {
    const sourceSessionId = getCurrentSessionId();
    setStatus('loading');
    try {
      await persistBeforeTransition(sourceSessionId);
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
      setSessionName(null);  // Reset session name to empty (fix: was missing)
      setRemixedFrom(null);
      setRemixedFromName(null);
      setRemixCount(0);
      setLastAccessedAt(Date.now());
      setIsPublished(false);  // New sessions are always editable
      setStatus('ready');
    } catch (error) {
      logger.session.error('Failed to create session:', error);
      setStatus('error');
    }
  }, [persistBeforeTransition, resetState]);

  // Flush captured writes on teardown. The write retains its original session
  // ID, so cleanup can never target a later session.
  useEffect(() => () => {
    void flushPendingSessionSave();
  }, []);

  return {
    status,
    sessionId: getCurrentSessionId(),
    sessionName,
    renameSession,
    remixedFrom,
    remixedFromName,
    remixCount,
    lastAccessedAt,
    isOrphaned: isOrphanedState,
    isPublished,
    setIsPublished,  // Phase 21: For WebSocket sync
    share,
    sendCopy: handleSendCopy,
    publish: handlePublish,
    remix: handleRemix,
    createNew,
  };
}
