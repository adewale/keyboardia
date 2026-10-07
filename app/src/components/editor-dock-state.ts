/**
 * Editor dock state (specs/PIANO-ROLL-DOCK.md, phase 2).
 *
 * Which track the dock edits is local UI state: never synced, never persisted,
 * and closed on load. These are pure transitions so StepSequencer and its
 * tests share one definition of "open", "switch", "toggle" and "close".
 */

/** DOM id of the dock, for the pitch toggles' aria-controls. */
export const EDITOR_DOCK_ID = 'editor-dock';

export type DockViewMode = 'chromatic' | 'piano-roll';

export interface DockState {
  open: boolean;
  /**
   * The docked track. Kept after a close so the dock can collapse with its
   * content still rendered; cleared when that track goes away.
   */
  trackId: string | null;
  viewMode: DockViewMode;
}

export const DOCK_CLOSED: DockState = { open: false, trackId: null, viewMode: 'chromatic' };

/** Show `trackId` in the dock, opening it if needed. */
export function openDock(state: DockState, trackId: string): DockState {
  if (state.open && state.trackId === trackId) return state;
  return { ...state, open: true, trackId };
}

/** The pitch toggle: dock this track, or close if it is already docked. */
export function toggleDock(state: DockState, trackId: string): DockState {
  return state.open && state.trackId === trackId
    ? closeDock(state)
    : openDock(state, trackId);
}

export function closeDock(state: DockState): DockState {
  return state.open ? { ...state, open: false } : state;
}

export function setDockViewMode(state: DockState, viewMode: DockViewMode): DockState {
  return state.viewMode === viewMode ? state : { ...state, viewMode };
}

/**
 * Drop the docked track when it can no longer be docked (deleted locally or
 * remotely, or its instrument is no longer melodic). Returns the same object
 * when nothing changes so callers can compare by identity.
 */
export function reconcileDock(state: DockState, dockableTrackIds: ReadonlySet<string>): DockState {
  if (state.trackId === null || dockableTrackIds.has(state.trackId)) return state;
  return { ...state, open: false, trackId: null };
}

/** Forget `trackId` if it is the docked track (it was deleted). */
export function releaseDockedTrack(state: DockState, trackId: string): DockState {
  return state.trackId === trackId ? { ...state, open: false, trackId: null } : state;
}

/** True when `trackId` is the track the open dock is showing. */
export function isTrackDocked(state: DockState, trackId: string): boolean {
  return state.open && state.trackId === trackId;
}
