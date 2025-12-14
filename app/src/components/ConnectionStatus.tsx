/**
 * Phase 12: Connection status indicator
 *
 * Shows the current WebSocket connection state:
 * - Connected (green dot)
 * - Connecting (yellow pulsing dot)
 * - Disconnected (red dot)
 * - Single Player (gray dot with retry button)
 *
 * Also shows reconnection info and queued message count when applicable.
 */

import type { ConnectionStatus as Status } from '../sync/multiplayer';
import './ConnectionStatus.css';

interface ConnectionStatusProps {
  status: Status;
  reconnectAttempts?: number;
  queueSize?: number;
  playerCount?: number;
  onRetry?: () => void;
}

export function ConnectionStatus({ status, reconnectAttempts, queueSize, playerCount, onRetry }: ConnectionStatusProps) {
  const getStatusText = () => {
    switch (status) {
      case 'connected':
        if (playerCount && playerCount > 1) {
          return `You + ${playerCount - 1} other${playerCount > 2 ? 's' : ''}`;
        }
        return 'You (Connected)';
      case 'connecting':
        return reconnectAttempts && reconnectAttempts > 1
          ? `Reconnecting (${reconnectAttempts})...`
          : 'Connecting...';
      case 'disconnected':
        return 'Offline';
      case 'single_player':
        return 'Single Player';
    }
  };

  const getStatusTitle = () => {
    switch (status) {
      case 'connected':
        return 'Connected to multiplayer session';
      case 'connecting':
        return reconnectAttempts
          ? `Reconnecting... Attempt ${reconnectAttempts}`
          : 'Connecting to session...';
      case 'disconnected':
        return 'Disconnected from multiplayer. Changes are saved locally.';
      case 'single_player':
        return 'Unable to connect to multiplayer. Working in single-player mode - your changes are saved locally.';
    }
  };

  return (
    <div className={`connection-status connection-status--${status}`} title={getStatusTitle()}>
      <span className="connection-status__dot" />
      <span className="connection-status__text">{getStatusText()}</span>
      {queueSize !== undefined && queueSize > 0 && (
        <span className="connection-status__queue" title={`${queueSize} changes queued for sync`}>
          ({queueSize} queued)
        </span>
      )}
      {status === 'single_player' && onRetry && (
        <button
          className="connection-status__retry"
          onClick={onRetry}
          title="Try to reconnect to multiplayer"
        >
          Retry
        </button>
      )}
    </div>
  );
}
