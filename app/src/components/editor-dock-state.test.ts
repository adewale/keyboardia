import { describe, expect, it } from 'vitest';
import {
  DOCK_CLOSED,
  closeDock,
  isTrackDocked,
  openDock,
  reconcileDock,
  releaseDockedTrack,
  setDockViewMode,
  toggleDock,
} from './editor-dock-state';

describe('editor dock state', () => {
  it('starts closed with nothing docked', () => {
    expect(DOCK_CLOSED).toEqual({ open: false, trackId: null, viewMode: 'chromatic' });
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
    const open = setDockViewMode(openDock(DOCK_CLOSED, 'lead'), 'piano-roll');
    const closed = closeDock(open);
    expect(closed).toEqual({ open: false, trackId: 'lead', viewMode: 'piano-roll' });
    expect(closeDock(closed)).toBe(closed);
    expect(openDock(closed, 'lead')).toMatchObject({ open: true, viewMode: 'piano-roll' });
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
});
