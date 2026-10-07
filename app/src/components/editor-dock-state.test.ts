import { describe, expect, it } from 'vitest';
import {
  DOCK_CLOSED,
  closeDock,
  defaultGhostIds,
  isTrackDocked,
  openDock,
  reconcileDock,
  releaseDockedTrack,
  resolveGhostVisibility,
  setDockDetent,
  setDockViewMode,
  toggleDock,
  toggleDockDetent,
  toggleGhost,
} from './editor-dock-state';

describe('editor dock state', () => {
  it('starts closed with nothing docked', () => {
    expect(DOCK_CLOSED).toEqual({
      open: false, trackId: null, viewMode: 'piano-roll', detent: 'compact', ghostVisibility: {},
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

  it('keeps the track and view mode across close so the dock can collapse with content', () => {
    const open = setDockViewMode(openDock(DOCK_CLOSED, 'lead'), 'chromatic');
    const closed = closeDock(open);
    expect(closed).toMatchObject({ open: false, trackId: 'lead', viewMode: 'chromatic' });
    expect(closeDock(closed)).toBe(closed);
    expect(openDock(closed, 'lead')).toMatchObject({ open: true, viewMode: 'chromatic' });
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
});
