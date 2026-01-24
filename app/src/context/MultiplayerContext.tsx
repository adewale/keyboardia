/**
 * Multiplayer context - provides WebSocket connection state and dispatch wrapper
 * Separated into its own file to avoid circular imports
 */

import { createContext, useContext } from 'react';
import type { GridAction, Track, ParameterLock } from '../types';
import type { RemoteCursor, CursorPosition } from '../sync/multiplayer';

export type SessionStatus = 'loading' | 'ready' | 'error' | 'not_found';

export interface MultiplayerContextValue {
  isConnected: boolean;
  playerCount: number;
  dispatch: (action: GridAction) => void;
  handleMuteChange: (trackId: string, muted: boolean) => void;
  handleSoloChange: (trackId: string, soloed: boolean) => void;
  handleTrackAdded: (track: Track) => void;
  // Phase 31F: Batch operations for multi-select sync
  handleBatchClearSteps: (trackId: string, steps: number[]) => void;
  handleBatchSetParameterLocks: (trackId: string, locks: { step: number; lock: ParameterLock }[]) => void;
  // Phase 31G: Track reorder (drag and drop)
  handleTrackReorder: (fromIndex: number, toIndex: number) => void;
  // Phase 11: Cursors
  cursors: Map<string, RemoteCursor>;
  sendCursor: (position: CursorPosition) => void;
  // Phase 21: Published sessions are read-only
  isPublished: boolean;
  // Phase 22: Per-player playback tracking
  playingPlayerIds: Set<string>;
  // Phase 34: Session loading status for skeleton screens
  sessionStatus: SessionStatus;
  // Session info for portrait mode display
  sessionId: string | null;
  sessionName: string | null;
}

export const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

export function useMultiplayerContext() {
  return useContext(MultiplayerContext);
}
