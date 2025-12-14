/**
 * Debug mode context for client-side observability
 * Enable with ?debug=1 in the URL
 *
 * Phase 7 additions: Multiplayer debug info (connections, clock sync, state hash)
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { isDev } from '../utils/logger';

interface DebugLog {
  timestamp: string;
  type: 'request' | 'response' | 'state' | 'error' | 'ws';
  method?: string;
  path?: string;
  status?: number;
  duration?: number;
  data?: unknown;
  error?: string;
  // WebSocket-specific fields
  wsType?: 'connect' | 'message' | 'disconnect';
  playerId?: string;
  messageType?: string;
}

/**
 * Multiplayer debug state (Phase 7)
 */
interface MultiplayerDebugState {
  status: 'disconnected' | 'connecting' | 'connected' | 'single_player';
  playerId: string | null;
  playerCount: number;
  messagesSent: number;
  messagesReceived: number;
}

/**
 * Clock sync debug state (Phase 7)
 */
interface ClockSyncDebugState {
  offset: number; // milliseconds
  rtt: number; // round-trip time
  quality: 'good' | 'fair' | 'poor';
  lastSync: number; // timestamp
}

/**
 * State hash debug state (Phase 7)
 */
interface StateHashDebugState {
  localHash: string;
  lastSync: number; // timestamp
}

interface DebugContextValue {
  isDebugMode: boolean;
  logs: DebugLog[];
  sessionId: string | null;
  sessionState: {
    trackCount: number;
    tempo: number;
    swing: number;
  } | null;
  // Phase 7: Multiplayer debug info
  multiplayerState: MultiplayerDebugState;
  clockSyncState: ClockSyncDebugState;
  stateHashState: StateHashDebugState;
  // Logging functions
  logRequest: (method: string, path: string) => () => void;
  logState: (data: unknown) => void;
  logError: (error: string, data?: unknown) => void;
  logWebSocket: (wsType: DebugLog['wsType'], playerId: string, messageType?: string, data?: unknown) => void;
  setSessionInfo: (id: string | null, state: { trackCount: number; tempo: number; swing: number } | null) => void;
  // Phase 7: Update functions
  updateMultiplayerState: (update: Partial<MultiplayerDebugState>) => void;
  updateClockSyncState: (update: Partial<ClockSyncDebugState>) => void;
  updateStateHash: (hash: string) => void;
}

const DebugContext = createContext<DebugContextValue | null>(null);

const MAX_LOGS = 100;

// Initial state for Phase 7 multiplayer debug
const INITIAL_MULTIPLAYER_STATE: MultiplayerDebugState = {
  status: 'disconnected',
  playerId: null,
  playerCount: 0,
  messagesSent: 0,
  messagesReceived: 0,
};

const INITIAL_CLOCK_SYNC_STATE: ClockSyncDebugState = {
  offset: 0,
  rtt: 0,
  quality: 'good',
  lastSync: 0,
};

const INITIAL_STATE_HASH_STATE: StateHashDebugState = {
  localHash: '',
  lastSync: 0,
};

// Check for debug mode from URL (computed once at module load)
function getInitialDebugMode(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('debug') === '1';
}

export function DebugProvider({ children }: { children: ReactNode }) {
  // Initialize debug mode from URL (avoids useEffect setState)
  // _setIsDebugMode reserved for future dynamic toggle feature
  const [isDebugMode, _setIsDebugMode] = useState(getInitialDebugMode);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<DebugContextValue['sessionState']>(null);

  // Phase 7: Multiplayer debug state
  const [multiplayerState, setMultiplayerState] = useState<MultiplayerDebugState>(INITIAL_MULTIPLAYER_STATE);
  const [clockSyncState, setClockSyncState] = useState<ClockSyncDebugState>(INITIAL_CLOCK_SYNC_STATE);
  const [stateHashState, setStateHashState] = useState<StateHashDebugState>(INITIAL_STATE_HASH_STATE);

  // Log debug mode activation on mount
  useEffect(() => {
    if (isDebugMode && isDev) {
      console.log('[DEBUG MODE ENABLED] Session operations will be logged');
      console.log('[DEBUG] Phase 7: Multiplayer observability enabled');
    }
  }, [isDebugMode]);

  const addLog = useCallback((log: Omit<DebugLog, 'timestamp'>) => {
    const entry: DebugLog = {
      ...log,
      timestamp: new Date().toISOString(),
    };

    setLogs(prev => {
      const next = [...prev, entry];
      if (next.length > MAX_LOGS) {
        return next.slice(-MAX_LOGS);
      }
      return next;
    });

    // Also log to console in debug mode (only in dev)
    if (isDev) {
      const prefix = `[DEBUG ${entry.type.toUpperCase()}]`;
      if (entry.error) {
        console.error(prefix, entry.error, entry.data);
      } else if (entry.type === 'request') {
        console.log(prefix, entry.method, entry.path);
      } else if (entry.type === 'response') {
        console.log(prefix, entry.method, entry.path, `-> ${entry.status} (${entry.duration}ms)`);
      } else if (entry.type === 'ws') {
        // Phase 7: WebSocket logging
        console.log(prefix, `[${entry.wsType}] player=${entry.playerId}`, entry.messageType ?? '', entry.data ?? '');
      } else {
        console.log(prefix, entry.data);
      }
    }
  }, []);

  const logRequest = useCallback((method: string, path: string) => {
    const startTime = Date.now();

    addLog({ type: 'request', method, path });

    // Return a function to log the response
    return (status?: number, data?: unknown, error?: string) => {
      const duration = Date.now() - startTime;
      if (error) {
        addLog({ type: 'error', method, path, error, data });
      } else {
        addLog({ type: 'response', method, path, status, duration, data });
      }
    };
  }, [addLog]);

  const logState = useCallback((data: unknown) => {
    addLog({ type: 'state', data });
  }, [addLog]);

  const logError = useCallback((error: string, data?: unknown) => {
    addLog({ type: 'error', error, data });
  }, [addLog]);

  // Phase 7: WebSocket logging
  const logWebSocket = useCallback((
    wsType: DebugLog['wsType'],
    playerId: string,
    messageType?: string,
    data?: unknown
  ) => {
    addLog({ type: 'ws', wsType, playerId, messageType, data });
  }, [addLog]);

  const setSessionInfo = useCallback((id: string | null, state: DebugContextValue['sessionState']) => {
    setSessionId(id);
    setSessionState(state);
  }, []);

  // Phase 7: Multiplayer state update functions
  const updateMultiplayerState = useCallback((update: Partial<MultiplayerDebugState>) => {
    setMultiplayerState(prev => ({ ...prev, ...update }));
  }, []);

  const updateClockSyncState = useCallback((update: Partial<ClockSyncDebugState>) => {
    setClockSyncState(prev => ({ ...prev, ...update }));
  }, []);

  const updateStateHash = useCallback((hash: string) => {
    setStateHashState({ localHash: hash, lastSync: Date.now() });
  }, []);

  return (
    <DebugContext.Provider value={{
      isDebugMode,
      logs,
      sessionId,
      sessionState,
      // Phase 7: Multiplayer debug info
      multiplayerState,
      clockSyncState,
      stateHashState,
      // Logging functions
      logRequest,
      logState,
      logError,
      logWebSocket,
      setSessionInfo,
      // Phase 7: Update functions
      updateMultiplayerState,
      updateClockSyncState,
      updateStateHash,
    }}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug(): DebugContextValue {
  const context = useContext(DebugContext);
  if (!context) {
    throw new Error('useDebug must be used within a DebugProvider');
  }
  return context;
}
