/**
 * Debug overlay component
 * Displays session info and recent logs when debug mode is enabled
 */

import { useState } from 'react';
import { useDebug } from './DebugContext';
import './DebugOverlay.css';

export function DebugOverlay() {
  const { isDebugMode, logs, sessionId, sessionState } = useDebug();
  const [isExpanded, setIsExpanded] = useState(false);

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
                <a href={`/api/debug/session/${sessionId}`} target="_blank" rel="noopener">
                  /api/debug/session/{sessionId.slice(0, 8)}...
                </a>
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
