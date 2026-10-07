/**
 * Editor dock state (specs/PIANO-ROLL-DOCK.md, phases 2, 6, 7 and 8).
 *
 * Which track the dock edits, and which pane it shows, is local UI state:
 * never synced, never persisted, and closed on load. These are pure
 * transitions so StepSequencer and its tests share one definition of "open",
 * "switch", "toggle", "select a step" and "close".
 */

/** DOM id of the dock, for the pitch toggles' aria-controls. */
export const EDITOR_DOCK_ID = 'editor-dock';

export type DockViewMode = 'chromatic' | 'piano-roll';

/** The roll's two heights: a 252px or a 432px grid viewport. */
export type DockDetent = 'compact' | 'tall';

/**
 * The dock's three panes over one grid: Notes (the roll's own controls), Step
 * (the selected step's lock) and Track (transpose, steps, instrument, pattern
 * tools, FM, actions).
 */
export type DockPane = 'notes' | 'step' | 'track';

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
  /**
   * The pane the person chose. A track with no pitch (drums) cannot show
   * Notes, so it shows Track instead; see effectiveDockPane.
   */
  pane: DockPane;
  /** The step the Step pane edits, on the docked track. */
  selectedStep: number | null;
  /** The Track pane's instrument picker, for the docked track. */
  instrumentPickerOpen: boolean;
}

export const DOCK_CLOSED: DockState = {
  open: false,
  trackId: null,
  // Piano Roll is the default view; Grid (the legacy ChromaticGrid) stays one tab away.
  viewMode: 'piano-roll',
  detent: 'compact',
  ghostVisibility: {},
  pane: 'notes',
  selectedStep: null,
  instrumentPickerOpen: false,
};

/**
 * Show `trackId` in the dock, opening it if needed. A fresh open starts on the
 * Notes pane; switching track keeps the pane (and the selected step's column)
 * but closes the instrument picker, which belongs to the previous track.
 */
export function openDock(state: DockState, trackId: string): DockState {
  if (state.open && state.trackId === trackId) return state;
  if (!state.open) {
    return { ...state, open: true, trackId, pane: 'notes', selectedStep: null, instrumentPickerOpen: false };
  }
  return { ...state, trackId, instrumentPickerOpen: false };
}

/** The pitch toggle: dock this track, or close if it is already docked. */
export function toggleDock(state: DockState, trackId: string): DockState {
  return state.open && state.trackId === trackId
    ? closeDock(state)
    : openDock(state, trackId);
}

/**
 * Close the dock. The track, pane and step stay so the content collapses with
 * the dock; the next open starts on Notes.
 */
export function closeDock(state: DockState): DockState {
  return state.open ? { ...state, open: false, instrumentPickerOpen: false } : state;
}

/**
 * A track name in landscape: show that track's Track pane (the controls the
 * landscape drawer used to hold), or close the dock when it already shows it.
 * A track without pitch (`notesAvailable` false) shows Track in place of
 * Notes, so for a drum that counts as showing it.
 */
export function toggleDockTrackPane(state: DockState, trackId: string, notesAvailable: boolean): DockState {
  if (isTrackDocked(state, trackId) && effectiveDockPane(state, notesAvailable) === 'track') {
    return closeDock(state);
  }
  return { ...openDock(state, trackId), pane: 'track', instrumentPickerOpen: false };
}

/** Choose a pane. Leaving the Track pane closes its instrument picker. */
export function setDockPane(state: DockState, pane: DockPane): DockState {
  if (state.pane === pane) return state;
  return { ...state, pane, instrumentPickerOpen: pane === 'track' && state.instrumentPickerOpen };
}

/**
 * The pane the dock shows: the chosen one, except that a track without pitch
 * (`notesAvailable` false) shows Track in place of Notes.
 */
export function effectiveDockPane(state: DockState, notesAvailable: boolean): DockPane {
  return state.pane === 'notes' && !notesAvailable ? 'track' : state.pane;
}

/**
 * Shift+click or long-press on a step: open the dock on that track with the
 * Step pane for that step.
 */
export function selectDockStep(state: DockState, trackId: string, step: number): DockState {
  const opened = openDock(state, trackId);
  if (opened.pane === 'step' && opened.selectedStep === step) return opened;
  return { ...opened, pane: 'step', selectedStep: step, instrumentPickerOpen: false };
}

/** The step the open dock's Step pane edits on `trackId`, or null. */
export function dockSelectedStep(state: DockState, trackId: string): number | null {
  return state.open && state.trackId === trackId && state.pane === 'step' ? state.selectedStep : null;
}

/**
 * Leave the current pane (Escape, or selecting the edited step again): back
 * to Notes, or close the dock when Notes is already showing or the track has
 * no pitch to show there.
 */
export function dismissDockPane(state: DockState, notesAvailable: boolean): DockState {
  if (!state.open) return state;
  if (state.pane !== 'notes' && notesAvailable) {
    return { ...state, pane: 'notes', instrumentPickerOpen: false };
  }
  return closeDock(state);
}

/**
 * Shift+click on a step: select it, or, when it is already the step being
 * edited, leave the Step pane (the old strip's toggle).
 */
export function toggleDockStep(state: DockState, trackId: string, step: number, notesAvailable: boolean): DockState {
  return dockSelectedStep(state, trackId) === step
    ? dismissDockPane(state, notesAvailable)
    : selectDockStep(state, trackId, step);
}

/**
 * The instrument control (the row's badge or the Track pane's Instrument
 * button): open the dock on that track's Track pane with the picker showing,
 * or close the picker when it already shows for that track.
 */
export function toggleDockInstrumentPicker(state: DockState, trackId: string): DockState {
  if (isDockInstrumentPickerOpen(state, trackId)) {
    return { ...state, instrumentPickerOpen: false };
  }
  return { ...openDock(state, trackId), pane: 'track', instrumentPickerOpen: true };
}

export function closeDockInstrumentPicker(state: DockState): DockState {
  return state.instrumentPickerOpen ? { ...state, instrumentPickerOpen: false } : state;
}

/** True when the open dock shows `trackId`'s instrument picker. */
export function isDockInstrumentPickerOpen(state: DockState, trackId: string): boolean {
  return state.open && state.trackId === trackId && state.pane === 'track' && state.instrumentPickerOpen;
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
 * remotely). Every track is dockable, since Step and Track apply to drums too.
 * Returns the same object when nothing changes so callers can compare by
 * identity.
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
