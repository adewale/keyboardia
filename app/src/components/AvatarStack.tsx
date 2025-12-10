/**
 * Phase 11: Avatar Stack Component
 *
 * Displays stacked circular avatars for online players.
 * Google Docs-style anonymous animal identities with colored backgrounds.
 */

import type { PlayerInfo } from '../sync/multiplayer';
import './AvatarStack.css';

interface AvatarStackProps {
  players: PlayerInfo[];
  currentPlayerId: string | null;
  maxVisible?: number;
}

export function AvatarStack({ players, currentPlayerId, maxVisible = 5 }: AvatarStackProps) {
  if (players.length === 0) return null;

  // Put current player first, then sort by connection time
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.id === currentPlayerId) return -1;
    if (b.id === currentPlayerId) return 1;
    return a.connectedAt - b.connectedAt;
  });

  const visiblePlayers = sortedPlayers.slice(0, maxVisible);
  const overflowCount = players.length - maxVisible;

  return (
    <div className="avatar-stack" title={`${players.length} player${players.length > 1 ? 's' : ''} online`}>
      {visiblePlayers.map((player, index) => (
        <div
          key={player.id}
          className={`avatar ${player.id === currentPlayerId ? 'avatar-current' : ''}`}
          style={{
            backgroundColor: player.color,
            zIndex: visiblePlayers.length - index,
          }}
          title={`${player.name}${player.id === currentPlayerId ? ' (you)' : ''}`}
        >
          <span className="avatar-letter">{player.animal[0]}</span>
        </div>
      ))}
      {overflowCount > 0 && (
        <div
          className="avatar avatar-overflow"
          style={{ zIndex: 0 }}
          title={`+${overflowCount} more player${overflowCount > 1 ? 's' : ''}`}
        >
          <span className="avatar-count">+{overflowCount}</span>
        </div>
      )}
    </div>
  );
}
