/**
 * Shared Player Types
 *
 * Canonical definitions for player identity and presence, shared between
 * frontend (sync/multiplayer.ts) and worker (worker/types.ts).
 *
 * IMPORTANT: Changes here affect both client and server. Run full test suite.
 */

/**
 * Player info for multiplayer sessions.
 * Identity is generated server-side on connection.
 */
export interface PlayerInfo {
  id: string;
  connectedAt: number;
  lastMessageAt: number;
  messageCount: number;
  // Identity (Phase 11)
  color: string;       // Hex color like '#E53935'
  colorIndex: number;  // Index into color array for consistent styling
  animal: string;      // Animal name like 'Fox'
  name: string;        // Full name like 'Red Fox'
}

/**
 * Cursor position for multiplayer presence.
 * Coordinates are percentages relative to the grid container.
 */
export interface CursorPosition {
  x: number;       // Percentage (0-100) relative to grid container
  y: number;       // Percentage (0-100) relative to grid container
  trackId?: string;  // Optional: which track the cursor is over
  step?: number;     // Optional: which step the cursor is over
}

/**
 * Remote cursor display state.
 * Used for rendering other players' cursors in the UI.
 */
export interface RemoteCursor {
  playerId: string;
  position: CursorPosition;
  color: string;
  name: string;
  lastUpdate: number;  // Timestamp for fade-out
}
