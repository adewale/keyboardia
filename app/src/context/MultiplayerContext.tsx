/**
 * Multiplayer context - provides WebSocket connection state and dispatch wrapper
 * Separated into its own file to avoid circular imports
 */

import { createContext, useContext } from 'react';
import type { GridAction, Track } from '../types';
import type { RemoteCursor, CursorPosition } from '../sync/multiplayer';

export interface MultiplayerContextValue {
  isConnected: boolean;
  playerCount: number;
  dispatch: (action: GridAction) => void;
  handleMuteChange: (trackId: string, muted: boolean) => void;
  handleSoloChange: (trackId: string, soloed: boolean) => void;
  handleTrackAdded: (track: Track) => void;
  // Phase 11: Cursors
  cursors: Map<string, RemoteCursor>;
  sendCursor: (position: CursorPosition) => void;
  // Phase 21: Published sessions are read-only
  isPublished: boolean;
}

export const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

export function useMultiplayerContext() {
  return useContext(MultiplayerContext);
}
