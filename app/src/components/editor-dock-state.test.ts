import { describe, expect, it } from 'vitest';
import {
  DOCK_CLOSED,
  closeDock,
  closeDockInstrumentPicker,
  defaultGhostIds,
  dismissDockPane,
  dockSelectedStep,
  effectiveDockPane,
  isDockInstrumentPickerOpen,
  isTrackDocked,
  openDock,
  reconcileDock,
  releaseDockedTrack,
  resolveGhostVisibility,
  selectDockStep,
  setDockDetent,
  setDockPane,
  toggleDock,
  toggleDockDetent,
  toggleDockInstrumentPicker,
  toggleDockStep,
  toggleDockTrackPane,
  toggleGhost,
} from './editor-dock-state';

describe('editor dock state', () => {
  it('starts closed with nothing docked', () => {
    expect(DOCK_CLOSED).toEqual({
      open: false, trackId: null, detent: 'compact', ghostVisibility: {},
      pane: 'notes', selectedStep: null, instrumentPickerOpen: false,
    });
    expect(isTrackDocked(DOCK_CLOSED, 'lead')).toBe(false);
  });

  it('opens on a track and switches to another without closing', () => {
    const lead = openDock(DOCK_CLOSED, 'lead');
    expect(lead).toMatchObject({ open: true, trackId: 'lead' });
    const bass = openDock(lead, 'bass');
    expect(bass).toMatchObject({ open: true, trackId: 'bass' });
    expect(isTrackDocked(bass, 'lead')).toBe(false);
    expect(isTrackDocked(bass, 'bass')).toBe(true);
  });

  it('opening the docked track again is a no-op', () => {
    const lead = openDock(DOCK_CLOSED, 'lead');
    expect(openDock(lead, 'lead')).toBe(lead);
  });

  it('toggle closes only when that track is the docked one', () => {
    const lead = toggleDock(DOCK_CLOSED, 'lead');
    expect(lead.open).toBe(true);
    expect(toggleDock(lead, 'bass')).toMatchObject({ open: true, trackId: 'bass' });
    const closed = toggleDock(lead, 'lead');
    expect(closed.open).toBe(false);
    expect(isTrackDocked(closed, 'lead')).toBe(false);
  });

  it('keeps the track and pane across close so the dock can collapse with content', () => {
    const open = setDockPane(openDock(DOCK_CLOSED, 'lead'), 'track');
    const closed = closeDock(open);
    expect(closed).toMatchObject({ open: false, trackId: 'lead', pane: 'track' });
    expect(closeDock(closed)).toBe(closed);
    // The next open starts on Notes.
    expect(openDock(closed, 'lead')).toMatchObject({ open: true, pane: 'notes' });
  });

  it('a landscape name tap shows that track\'s Track pane, and closes it on a second tap', () => {
    const lead = toggleDockTrackPane(DOCK_CLOSED, 'lead', true);
    expect(lead).toMatchObject({ open: true, trackId: 'lead', pane: 'track', instrumentPickerOpen: false });

    // Another name switches the docked track and keeps the Track pane.
    const bass = toggleDockTrackPane(lead, 'bass', true);
    expect(bass).toMatchObject({ open: true, trackId: 'bass', pane: 'track' });

    // The same name again closes the dock, as the drawer it replaces did.
    expect(toggleDockTrackPane(bass, 'bass', true).open).toBe(false);

    // From Notes (the ♪ toggle), the name moves to the Track pane rather than closing.
    const notes = openDock(DOCK_CLOSED, 'lead');
    expect(toggleDockTrackPane(notes, 'lead', true)).toMatchObject({ open: true, pane: 'track' });
    // A drum docked on Notes is showing Track already, so its name closes it.
    expect(toggleDockTrackPane(openDock(DOCK_CLOSED, 'kick'), 'kick', false).open).toBe(false);
    // An open picker belongs to the previous visit; the pane opens without it.
    const picker = toggleDockInstrumentPicker(DOCK_CLOSED, 'lead');
    expect(toggleDockTrackPane(picker, 'bass', true)).toMatchObject({ trackId: 'bass', pane: 'track', instrumentPickerOpen: false });
  });

  it('forgets a deleted docked track and ignores other deletions', () => {
    const lead = openDock(DOCK_CLOSED, 'lead');
    expect(releaseDockedTrack(lead, 'bass')).toBe(lead);
    expect(releaseDockedTrack(lead, 'lead')).toMatchObject({ open: false, trackId: null });
  });

  it('reconciles against the tracks that can still be docked', () => {
    const lead = openDock(DOCK_CLOSED, 'lead');
    expect(reconcileDock(lead, new Set(['lead', 'bass']))).toBe(lead);
    expect(reconcileDock(lead, new Set(['bass']))).toMatchObject({ open: false, trackId: null });
    expect(reconcileDock(DOCK_CLOSED, new Set())).toBe(DOCK_CLOSED);
  });

  it('toggles the detent between compact and tall and keeps it across close', () => {
    const open = openDock(DOCK_CLOSED, 'lead');
    expect(open.detent).toBe('compact');
    const tall = toggleDockDetent(open);
    expect(tall.detent).toBe('tall');
    expect(toggleDockDetent(tall).detent).toBe('compact');
    expect(setDockDetent(tall, 'tall')).toBe(tall);
    expect(openDock(closeDock(tall), 'bass').detent).toBe('tall');
  });

  it('shows ghosts for the two melodic tracks nearest the docked one by default', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    expect(defaultGhostIds(order, 'a')).toEqual(new Set(['b', 'c']));
    expect(defaultGhostIds(order, 'c')).toEqual(new Set(['b', 'd']));
    expect(defaultGhostIds(order, 'e')).toEqual(new Set(['d', 'c']));
    expect(defaultGhostIds(order, null)).toEqual(new Set());
    expect(defaultGhostIds(['a'], 'a')).toEqual(new Set());

    const docked = openDock(DOCK_CLOSED, 'a');
    expect(resolveGhostVisibility(docked, order)).toEqual({ b: true, c: true, d: false, e: false });
  });

  it('records a ghost toggle and lets later tracks follow the default', () => {
    const order = ['a', 'b', 'c'];
    const docked = openDock(DOCK_CLOSED, 'b');
    expect(resolveGhostVisibility(docked, order)).toEqual({ a: true, c: true });

    const hidden = toggleGhost(docked, 'a', order);
    expect(hidden.ghostVisibility).toEqual({ a: false });
    expect(resolveGhostVisibility(hidden, order)).toEqual({ a: false, c: true });
    expect(toggleGhost(hidden, 'a', order).ghostVisibility).toEqual({ a: true });

    // Tracks added later follow the rule (d is third nearest, so hidden), and
    // a far track shows once toggled on.
    const later = ['a', 'b', 'c', 'd', 'e'];
    expect(resolveGhostVisibility(hidden, later)).toEqual({ a: false, c: true, d: false, e: false });
    const shown = toggleGhost(hidden, 'e', later);
    expect(resolveGhostVisibility(shown, later)).toEqual({ a: false, c: true, d: false, e: true });
    // The choice survives a close and reopen.
    expect(resolveGhostVisibility(openDock(closeDock(shown), 'b'), later).a).toBe(false);
  });

  it('opens on Notes, keeps the pane when switching track, and starts on Notes again after a close', () => {
    const lead = openDock(DOCK_CLOSED, 'lead');
    expect(lead.pane).toBe('notes');
    const track = setDockPane(lead, 'track');
    expect(track.pane).toBe('track');
    expect(setDockPane(track, 'track')).toBe(track);
    expect(openDock(track, 'bass')).toMatchObject({ trackId: 'bass', pane: 'track' });
    expect(openDock(closeDock(track), 'lead')).toMatchObject({ open: true, pane: 'notes', selectedStep: null });
  });

  it('shows Track in place of Notes for a track without pitch', () => {
    const lead = openDock(DOCK_CLOSED, 'kick');
    expect(effectiveDockPane(lead, true)).toBe('notes');
    expect(effectiveDockPane(lead, false)).toBe('track');
    expect(effectiveDockPane(setDockPane(lead, 'step'), false)).toBe('step');
  });

  it('selecting a step opens the Step pane on that track, closed or open', () => {
    const selected = selectDockStep(DOCK_CLOSED, 'kick', 4);
    expect(selected).toMatchObject({ open: true, trackId: 'kick', pane: 'step', selectedStep: 4 });
    expect(dockSelectedStep(selected, 'kick')).toBe(4);
    expect(dockSelectedStep(selected, 'lead')).toBeNull();
    expect(selectDockStep(selected, 'kick', 4)).toBe(selected);

    // Another step, on this or another track, replaces the selection.
    expect(selectDockStep(selected, 'kick', 8)).toMatchObject({ trackId: 'kick', selectedStep: 8 });
    expect(selectDockStep(selected, 'lead', 2)).toMatchObject({ trackId: 'lead', pane: 'step', selectedStep: 2 });

    // The ring belongs to the Step pane: another pane or a closed dock shows none.
    expect(dockSelectedStep(setDockPane(selected, 'track'), 'kick')).toBeNull();
    expect(dockSelectedStep(closeDock(selected), 'kick')).toBeNull();
  });

  it('selecting the edited step again leaves the Step pane, as the strip toggled closed', () => {
    const lead = selectDockStep(DOCK_CLOSED, 'lead', 3);
    expect(toggleDockStep(lead, 'lead', 3, true)).toMatchObject({ open: true, pane: 'notes' });
    expect(toggleDockStep(lead, 'lead', 5, true)).toMatchObject({ pane: 'step', selectedStep: 5 });

    const kick = selectDockStep(DOCK_CLOSED, 'kick', 0);
    expect(toggleDockStep(kick, 'kick', 0, false).open).toBe(false);
  });

  it('dismisses a pane back to Notes, and closes from Notes or without pitch', () => {
    const step = selectDockStep(DOCK_CLOSED, 'lead', 3);
    const notes = dismissDockPane(step, true);
    expect(notes).toMatchObject({ open: true, pane: 'notes' });
    expect(dismissDockPane(setDockPane(notes, 'track'), true)).toMatchObject({ open: true, pane: 'notes' });
    expect(dismissDockPane(notes, true).open).toBe(false);
    expect(dismissDockPane(step, false).open).toBe(false);
    expect(dismissDockPane(DOCK_CLOSED, true)).toBe(DOCK_CLOSED);
  });

  it('opens the instrument picker on the Track pane and closes it on the way out', () => {
    const picker = toggleDockInstrumentPicker(DOCK_CLOSED, 'lead');
    expect(picker).toMatchObject({ open: true, trackId: 'lead', pane: 'track', instrumentPickerOpen: true });
    expect(isDockInstrumentPickerOpen(picker, 'lead')).toBe(true);
    expect(isDockInstrumentPickerOpen(picker, 'bass')).toBe(false);

    // The same control again closes the picker and keeps the dock.
    expect(toggleDockInstrumentPicker(picker, 'lead')).toMatchObject({ open: true, pane: 'track', instrumentPickerOpen: false });
    // Another track's control moves the picker to that track.
    expect(toggleDockInstrumentPicker(picker, 'bass')).toMatchObject({ trackId: 'bass', instrumentPickerOpen: true });

    // Leaving the pane, switching track or closing puts it away.
    expect(setDockPane(picker, 'notes').instrumentPickerOpen).toBe(false);
    expect(openDock(picker, 'bass').instrumentPickerOpen).toBe(false);
    expect(closeDock(picker).instrumentPickerOpen).toBe(false);
    expect(closeDockInstrumentPicker(picker).instrumentPickerOpen).toBe(false);
    const closed = closeDockInstrumentPicker(DOCK_CLOSED);
    expect(closed).toBe(DOCK_CLOSED);
  });

  it('reconciles drum tracks like any other: every track can be docked', () => {
    const kick = selectDockStep(DOCK_CLOSED, 'kick', 0);
    expect(reconcileDock(kick, new Set(['kick', 'lead']))).toBe(kick);
    expect(reconcileDock(kick, new Set(['lead']))).toMatchObject({ open: false, trackId: null });
  });
});
