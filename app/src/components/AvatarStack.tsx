/**
 * Phase 11: Avatar Stack Component
 *
 * Displays stacked circular avatars for online players.
 * Google Docs-style anonymous animal identities with colored backgrounds.
 *
 * Phase 22: Shows play indicator when a player is currently playing.
 */

import type { PlayerInfo } from '../sync/multiplayer';
import './AvatarStack.css';

interface AvatarStackProps {
  players: PlayerInfo[];
  currentPlayerId: string | null;
  maxVisible?: number;
  /** Phase 22: Set of player IDs that are currently playing */
  playingPlayerIds?: Set<string>;
}

export function AvatarStack({ players, currentPlayerId, maxVisible = 5, playingPlayerIds }: AvatarStackProps) {
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
      {visiblePlayers.map((player, index) => {
        const isPlaying = playingPlayerIds?.has(player.id) ?? false;
        const isCurrent = player.id === currentPlayerId;

        return (
          <div
            key={player.id}
            className={`avatar ${isCurrent ? 'avatar-current' : ''} ${isPlaying ? 'avatar-playing' : ''}`}
            style={{
              backgroundColor: player.color,
              zIndex: visiblePlayers.length - index,
            }}
            title={`${player.name}${isCurrent ? ' (you)' : ''}${isPlaying ? ' - playing' : ''}`}
          >
            <span className="avatar-letter">{player.animal[0]}</span>
            {isPlaying && (
              <span className="avatar-play-indicator" aria-label="Playing">
                ▶
              </span>
            )}
          </div>
        );
      })}
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
