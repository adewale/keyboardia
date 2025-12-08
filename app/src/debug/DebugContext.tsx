/**
 * Debug mode context for client-side observability
 * Enable with ?debug=1 in the URL
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

interface DebugLog {
  timestamp: string;
  type: 'request' | 'response' | 'state' | 'error';
  method?: string;
  path?: string;
  status?: number;
  duration?: number;
  data?: unknown;
  error?: string;
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
  logRequest: (method: string, path: string) => () => void;
  logState: (data: unknown) => void;
  logError: (error: string, data?: unknown) => void;
  setSessionInfo: (id: string | null, state: { trackCount: number; tempo: number; swing: number } | null) => void;
}

const DebugContext = createContext<DebugContextValue | null>(null);

const MAX_LOGS = 100;

export function DebugProvider({ children }: { children: ReactNode }) {
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<DebugContextValue['sessionState']>(null);

  // Check for debug mode on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const debug = params.get('debug') === '1';
    setIsDebugMode(debug);

    if (debug) {
      console.log('[DEBUG MODE ENABLED] Session operations will be logged');
    }
  }, []);

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

    // Also log to console in debug mode
    const prefix = `[DEBUG ${entry.type.toUpperCase()}]`;
    if (entry.error) {
      console.error(prefix, entry.error, entry.data);
    } else if (entry.type === 'request') {
      console.log(prefix, entry.method, entry.path);
    } else if (entry.type === 'response') {
      console.log(prefix, entry.method, entry.path, `-> ${entry.status} (${entry.duration}ms)`);
    } else {
      console.log(prefix, entry.data);
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

  const setSessionInfo = useCallback((id: string | null, state: DebugContextValue['sessionState']) => {
    setSessionId(id);
    setSessionState(state);
  }, []);

  return (
    <DebugContext.Provider value={{
      isDebugMode,
      logs,
      sessionId,
      sessionState,
      logRequest,
      logState,
      logError,
      setSessionInfo,
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
