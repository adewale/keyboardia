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

/** The roll's two heights: a 252px or a 432px grid viewport. */
export type DockDetent = 'compact' | 'tall';

/** How many melodic tracks nearest the docked one show as ghosts by default. */
export const GHOST_DEFAULT_COUNT = 2;

export interface DockState {
  open: boolean;
  /**
   * The docked track. Kept after a close so the dock can collapse with its
   * content still rendered; cleared when that track goes away.
   */
  trackId: string | null;
  viewMode: DockViewMode;
  detent: DockDetent;
  /**
   * Ghost toggles the person has pressed, keyed by the ghost's track id. A
   * track with no entry (including one added later) follows the default:
   * visible when it is one of the GHOST_DEFAULT_COUNT melodic tracks nearest
   * the docked track in row order.
   */
  ghostVisibility: Record<string, boolean>;
}

export const DOCK_CLOSED: DockState = {
  open: false,
  trackId: null,
  viewMode: 'chromatic',
  detent: 'compact',
  ghostVisibility: {},
};

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

export function setDockDetent(state: DockState, detent: DockDetent): DockState {
  return state.detent === detent ? state : { ...state, detent };
}

export function toggleDockDetent(state: DockState): DockState {
  return setDockDetent(state, state.detent === 'tall' ? 'compact' : 'tall');
}

/**
 * The melodic tracks whose ghosts show by default with `dockedId` docked: the
 * GHOST_DEFAULT_COUNT nearest it in row order, the row above winning a tie.
 * `melodicIds` lists every melodic track in row order.
 */
export function defaultGhostIds(melodicIds: readonly string[], dockedId: string | null): Set<string> {
  const docked = dockedId === null ? -1 : melodicIds.indexOf(dockedId);
  if (docked < 0) return new Set();
  const nearest = melodicIds
    .map((id, index) => ({ id, index }))
    .filter(entry => entry.index !== docked)
    .sort((a, b) => (Math.abs(a.index - docked) - Math.abs(b.index - docked)) || a.index - b.index)
    .slice(0, GHOST_DEFAULT_COUNT);
  return new Set(nearest.map(entry => entry.id));
}

/**
 * Whether each other melodic track's ghost shows: the person's toggle when
 * there is one, the nearest-tracks default otherwise. The docked track is
 * never its own ghost.
 */
export function resolveGhostVisibility(state: DockState, melodicIds: readonly string[]): Record<string, boolean> {
  const defaults = defaultGhostIds(melodicIds, state.trackId);
  const visibility: Record<string, boolean> = {};
  for (const id of melodicIds) {
    if (id === state.trackId) continue;
    visibility[id] = state.ghostVisibility[id] ?? defaults.has(id);
  }
  return visibility;
}

/** Show or hide `ghostId`'s ghosts, recording the choice. */
export function toggleGhost(state: DockState, ghostId: string, melodicIds: readonly string[]): DockState {
  const visible = resolveGhostVisibility(state, melodicIds)[ghostId] ?? false;
  return { ...state, ghostVisibility: { ...state.ghostVisibility, [ghostId]: !visible } };
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
