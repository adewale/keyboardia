// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '../shared/player';
import { AvatarStack } from './AvatarStack';

const player: PlayerInfo = {
  id: 'player-1',
  connectedAt: 0,
  lastMessageAt: 0,
  messageCount: 0,
  color: '#E53935',
  colorIndex: 0,
  animal: 'Fox',
  name: 'Red Fox',
};

afterEach(cleanup);

describe('AvatarStack playing indicator', () => {
  it('exposes the playing state to assistive technology', () => {
    render(
      <AvatarStack
        players={[player]}
        currentPlayerId="player-1"
        playingPlayerIds={new Set(['player-1'])}
      />,
    );

    // The indicator's only content is an aria-hidden SVG, so the label has to
    // hang off a role that permits name-from-author. A bare span (role=generic)
    // would silently drop it.
    expect(screen.getByRole('img', { name: 'Playing' })).toBeDefined();
  });

  it('renders no playing indicator for idle players', () => {
    render(<AvatarStack players={[player]} currentPlayerId="player-1" />);

    expect(screen.queryByRole('img', { name: 'Playing' })).toBeNull();
  });
});
