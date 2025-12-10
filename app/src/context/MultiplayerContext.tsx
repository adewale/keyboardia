/**
 * Multiplayer context - provides WebSocket connection state and dispatch wrapper
 * Separated into its own file to avoid circular imports
 */

import { createContext, useContext } from 'react';
import type { GridAction, Track } from '../types';

export interface MultiplayerContextValue {
  isConnected: boolean;
  playerCount: number;
  dispatch: (action: GridAction) => void;
  handleMuteChange: (trackId: string, muted: boolean) => void;
  handleSoloChange: (trackId: string, soloed: boolean) => void;
  handleTrackAdded: (track: Track) => void;
}

export const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

export function useMultiplayerContext() {
  return useContext(MultiplayerContext);
}
