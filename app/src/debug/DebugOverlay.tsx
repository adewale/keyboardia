/**
 * Debug overlay component
 * Displays session info and recent logs when debug mode is enabled
 *
 * Phase 7 additions: Multiplayer, clock sync, and state hash sections
 */

import { useState, useEffect, useCallback } from 'react';
import { useDebug } from './DebugContext';
import './DebugOverlay.css';

export function DebugOverlay() {
  const {
    isDebugMode,
    logs,
    sessionId,
    sessionState,
    // Phase 7: Multiplayer debug state
    multiplayerState,
    clockSyncState,
    stateHashState,
    // Phase 26: Mutation tracking
    mutationState,
  } = useDebug();
  const [isExpanded, setIsExpanded] = useState(false);

  // Store current time in state to make formatTimeAgo pure
  // Update every 10s when panel is expanded
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    if (!isDebugMode || !isExpanded) return;

    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 10000);

    return () => clearInterval(interval);
  }, [isDebugMode, isExpanded]);

  // Format time ago for last sync (now pure - uses currentTime from state)
  // Must be declared before early return to satisfy rules-of-hooks
  const formatTimeAgo = useCallback((timestamp: number) => {
    if (!timestamp) return 'never';
    const seconds = Math.round((currentTime - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return `${minutes}m ago`;
  }, [currentTime]);

  if (!isDebugMode) return null;

  return (
    <div className={`debug-overlay ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="debug-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        title={isExpanded ? 'Collapse debug panel' : 'Expand debug panel'}
      >
        {isExpanded ? 'DEBUG' : 'DBG'}
      </button>

      {isExpanded && (
        <div className="debug-content">
          <div className="debug-section">
            <h4>Session</h4>
            <div className="debug-info">
              <span className="debug-label">ID:</span>
              <code className="debug-value">{sessionId ?? 'None'}</code>
            </div>
            {sessionState && (
              <>
                <div className="debug-info">
                  <span className="debug-label">Tracks:</span>
                  <span className="debug-value">{sessionState.trackCount}</span>
                </div>
                <div className="debug-info">
                  <span className="debug-label">Tempo:</span>
                  <span className="debug-value">{sessionState.tempo} BPM</span>
                </div>
                <div className="debug-info">
                  <span className="debug-label">Swing:</span>
                  <span className="debug-value">{sessionState.swing}%</span>
                </div>
              </>
            )}
          </div>

          {/* Phase 7: Multiplayer section */}
          <div className="debug-section">
            <h4>Multiplayer</h4>
            <div className="debug-info">
              <span className="debug-label">Status:</span>
              <span className={`debug-value debug-status-${multiplayerState.status}`}>
                {multiplayerState.status}
              </span>
            </div>
            {multiplayerState.playerId && (
              <div className="debug-info">
                <span className="debug-label">Player ID:</span>
                <code className="debug-value">{multiplayerState.playerId}</code>
              </div>
            )}
            <div className="debug-info">
              <span className="debug-label">Players:</span>
              <span className="debug-value">{multiplayerState.playerCount}</span>
            </div>
            <div className="debug-info">
              <span className="debug-label">Messages:</span>
              <span className="debug-value">
                {multiplayerState.messagesSent} sent / {multiplayerState.messagesReceived} recv
              </span>
            </div>
            {/* Connection storm detection */}
            <div className="debug-info">
              <span className="debug-label">Connections:</span>
              <span className="debug-value">
                {multiplayerState.connectionCount} total, {multiplayerState.uniquePlayerIdsSeen.size} unique IDs
              </span>
            </div>
            {multiplayerState.uniquePlayerIdsSeen.size > 5 && (
              <div className="debug-warning">
                <strong>CONNECTION STORM DETECTED</strong>
                <br />
                {multiplayerState.uniquePlayerIdsSeen.size} unique player IDs is abnormally high.
                <br />
                Expected: 1-2 per browser window.
                <br />
                This indicates rapid disconnect/reconnect cycles.
                <br />
                Check for unstable callback dependencies in useEffect.
              </div>
            )}
          </div>

          {/* Phase 7: Clock Sync section */}
          <div className="debug-section">
            <h4>Clock Sync</h4>
            <div className="debug-info">
              <span className="debug-label">Offset:</span>
              <span className="debug-value">
                {clockSyncState.offset > 0 ? '+' : ''}{clockSyncState.offset}ms
              </span>
            </div>
            <div className="debug-info">
              <span className="debug-label">RTT:</span>
              <span className="debug-value">{clockSyncState.rtt}ms</span>
            </div>
            <div className="debug-info">
              <span className="debug-label">Quality:</span>
              <span className={`debug-value debug-quality-${clockSyncState.quality}`}>
                {clockSyncState.quality}
              </span>
            </div>
          </div>

          {/* Phase 7: State Hash section */}
          <div className="debug-section">
            <h4>State Hash</h4>
            <div className="debug-info">
              <span className="debug-label">Hash:</span>
              <code className="debug-value">{stateHashState.localHash || 'none'}</code>
            </div>
            <div className="debug-info">
              <span className="debug-label">Last sync:</span>
              <span className="debug-value">{formatTimeAgo(stateHashState.lastSync)}</span>
            </div>
          </div>

          {/* Phase 26: Mutation Tracking section */}
          <div className="debug-section">
            <h4>Mutations</h4>
            <div className="debug-info">
              <span className="debug-label">Pending:</span>
              <span className={`debug-value ${mutationState.pending > 0 ? 'debug-warning-text' : ''}`}>
                {mutationState.pending}
                {mutationState.pending > 0 && mutationState.oldestPendingAge > 0 && (
                  <span className="debug-age"> ({Math.round(mutationState.oldestPendingAge / 1000)}s old)</span>
                )}
              </span>
            </div>
            <div className="debug-info">
              <span className="debug-label">Confirmed:</span>
              <span className="debug-value debug-success-text">{mutationState.confirmed}</span>
            </div>
            <div className="debug-info">
              <span className="debug-label">Superseded:</span>
              <span className="debug-value">{mutationState.superseded}</span>
            </div>
            <div className="debug-info">
              <span className="debug-label">Lost:</span>
              <span className={`debug-value ${mutationState.lost > 0 ? 'debug-error-text' : ''}`}>
                {mutationState.lost}
              </span>
            </div>
            {mutationState.lost > 0 && (
              <div className="debug-warning">
                <strong>MUTATIONS LOST</strong>
                <br />
                {mutationState.lost} mutation(s) were not confirmed by server.
                <br />
                Check console for [INVARIANT VIOLATION] logs.
              </div>
            )}
            {mutationState.pending > 5 && (
              <div className="debug-warning">
                <strong>HIGH PENDING COUNT</strong>
                <br />
                {mutationState.pending} mutations awaiting confirmation.
                <br />
                Possible network issue or server backlog.
              </div>
            )}
          </div>

          <div className="debug-section">
            <h4>Recent Logs ({logs.length})</h4>
            <div className="debug-logs">
              {logs.slice(-20).reverse().map((log, i) => (
                <div key={i} className={`debug-log debug-log-${log.type}`}>
                  <span className="debug-log-time">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="debug-log-type">{log.type}</span>
                  {log.method && <span className="debug-log-method">{log.method}</span>}
                  {log.path && <span className="debug-log-path">{log.path}</span>}
                  {log.status && <span className="debug-log-status">{log.status}</span>}
                  {log.duration !== undefined && (
                    <span className="debug-log-duration">{log.duration}ms</span>
                  )}
                  {log.error && <span className="debug-log-error">{log.error}</span>}
                  {/* Phase 7: WebSocket log fields */}
                  {log.wsType && <span className="debug-log-ws-type">[{log.wsType}]</span>}
                  {log.playerId && <span className="debug-log-player">{log.playerId}</span>}
                  {log.messageType && <span className="debug-log-msg-type">{log.messageType}</span>}
                </div>
              ))}
              {logs.length === 0 && (
                <div className="debug-log-empty">No logs yet</div>
              )}
            </div>
          </div>

          <div className="debug-section">
            <h4>API Endpoints</h4>
            <div className="debug-endpoints">
              <a href="/api/metrics" target="_blank" rel="noopener">
                /api/metrics
              </a>
              {sessionId && (
                <>
                  <a href={`/api/debug/session/${sessionId}`} target="_blank" rel="noopener">
                    /api/debug/session/{sessionId.slice(0, 8)}...
                  </a>
                  {/* Phase 7: Multiplayer debug endpoints */}
                  <a href={`/api/debug/session/${sessionId}/connections`} target="_blank" rel="noopener">
                    .../connections
                  </a>
                  <a href={`/api/debug/session/${sessionId}/clock`} target="_blank" rel="noopener">
                    .../clock
                  </a>
                  <a href={`/api/debug/session/${sessionId}/state-sync`} target="_blank" rel="noopener">
                    .../state-sync
                  </a>
                  <a href={`/api/debug/session/${sessionId}/ws-logs`} target="_blank" rel="noopener">
                    .../ws-logs
                  </a>
                  <a href={`/api/debug/durable-object/${sessionId}`} target="_blank" rel="noopener">
                    /api/debug/durable-object/...
                  </a>
                </>
              )}
              <a href="/api/debug/logs" target="_blank" rel="noopener">
                /api/debug/logs
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
