/**
 * Client Handler Factory
 *
 * Provides factory functions to create multiplayer message handlers with
 * common patterns, reducing boilerplate in multiplayer.ts.
 *
 * Pattern: Most handlers follow "skip own message, dispatch action" pattern.
 * This factory encapsulates that logic.
 */

import type { GridAction } from '../types';

/**
 * Context interface for handler factories.
 * Matches the shape of MultiplayerConnection's internal state.
 */
export interface HandlerContext {
  state: {
    playerId: string | null;
  };
  dispatch: ((action: GridAction) => void) | null;
}

/**
 * Creates a handler that:
 * 1. Skips messages from the local player (prevents echo)
 * 2. Dispatches a GridAction with isRemote: true
 *
 * @param actionCreator - Function that creates a GridAction from the message payload
 * @returns A handler function bound to the HandlerContext
 *
 * @example
 * // In MultiplayerConnection class:
 * private handleTrackVolumeSet = createRemoteHandler(
 *   (msg: { trackId: string; volume: number }) => ({
 *     type: 'SET_TRACK_VOLUME' as const,
 *     trackId: msg.trackId,
 *     volume: msg.volume,
 *   })
 * );
 */
export function createRemoteHandler<T extends { playerId: string }>(
  actionCreator: (msg: Omit<T, 'playerId'>) => Omit<GridAction, 'isRemote'>,
) {
  return function (this: HandlerContext, msg: T): void {
    // Skip own messages to prevent echo
    if (msg.playerId === this.state.playerId) return;

    // Dispatch if we have a dispatch function
    if (this.dispatch) {
       
      const { playerId: _, ...rest } = msg;
      this.dispatch({
        ...actionCreator(rest as Omit<T, 'playerId'>),
        isRemote: true,
      } as GridAction);
    }
  };
}

/**
 * Creates a handler that only skips own messages but doesn't dispatch.
 * Useful for handlers that need custom logic (e.g., playback, cursors).
 *
 * @param callback - Function to call for remote messages
 * @returns A handler function bound to the HandlerContext
 */
export function createRemoteOnlyHandler<T extends { playerId: string }>(
  callback: (msg: T) => void,
) {
  return function (this: HandlerContext, msg: T): void {
    if (msg.playerId === this.state.playerId) return;
    callback(msg);
  };
}

/**
 * Type helper: Extracts the message type from a handler created by createRemoteHandler
 */
export type HandlerMessage<T> = T extends (msg: infer M) => void ? M : never;
