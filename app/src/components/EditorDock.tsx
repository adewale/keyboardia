/**
 * Editor dock (specs/PIANO-ROLL-DOCK.md, phase 2: dock shell).
 *
 * One pitch editor under the sea of cells, inside the same horizontal scroller
 * as the track rows and pinned to that scroller's bottom edge. It shows one
 * melodic track at a time through the existing ChromaticGrid or PianoRoll,
 * whose props are wired exactly as TrackRow wired them before the move.
 *
 * Which track is docked lives in StepSequencer (see editor-dock-state.ts);
 * this component only renders it and reports intent.
 */

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { ParameterLock, ScaleState, Track } from '../types';
import { ChromaticGrid } from './ChromaticGrid';
import { PianoRoll } from './PianoRoll';
import { getInstrumentCategory, getInstrumentName } from './sample-constants';
import { EDITOR_DOCK_ID, type DockViewMode } from './editor-dock-state';
import { Close } from '../icons';
import './EditorDock.css';

/** Matches the .dock grid-template-rows transition in EditorDock.css. */
export const DOCK_TRANSITION_MS = 200;

const noop = () => {};

interface EditorDockProps {
  open: boolean;
  /** The docked track. Still passed while closing so the content collapses with the dock. */
  track: Track | null;
  /** Every melodic track, in row order, for the dock's track tabs. */
  melodicTracks: Track[];
  viewMode: DockViewMode;
  currentStep: number;
  anySoloed: boolean;
  scale?: ScaleState;
  /** Published session: the dock opens and plays but accepts no edits. */
  readOnly?: boolean;
  /** The `.tracks` scroller, used to size the sticky header to its visible width. */
  scrollerRef: RefObject<HTMLElement | null>;
  onSelectTrack: (trackId: string) => void;
  onSetViewMode: (viewMode: DockViewMode) => void;
  /** `restoreFocus` is true when focus was inside the dock (close button, Escape). */
  onClose: (options: { restoreFocus: boolean }) => void;
  onToggleStep: (trackId: string, step: number) => void;
  onSetParameterLock: (trackId: string, step: number, lock: ParameterLock | null) => void;
}

export const EditorDock = memo(function EditorDock({
  open,
  track,
  melodicTracks,
  viewMode,
  currentStep,
  anySoloed,
  scale,
  readOnly = false,
  scrollerRef,
  onSelectTrack,
  onSetViewMode,
  onClose,
  onToggleStep,
  onSetParameterLock,
}: EditorDockProps) {
  const headRef = useRef<HTMLDivElement>(null);

  // Keep the roll mounted while the dock collapses, then unmount it so a
  // closed dock does not re-render a hidden grid on every playback step.
  const [collapsed, setCollapsed] = useState(!open);
  if (open && collapsed) setCollapsed(false);
  useEffect(() => {
    if (open || collapsed) return;
    const timer = setTimeout(() => setCollapsed(true), DOCK_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [open, collapsed]);

  // The header is sticky-left inside a dock as wide as the grid; size it to
  // the scroller's visible width so the close button stays on screen.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const head = headRef.current;
    if (!scroller || !head) return;
    const fit = () => {
      head.style.width = `${scroller.clientWidth}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const observer = new ResizeObserver(fit);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollerRef]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    // Escape closes the dock only with focus inside it, and stops here so the
    // global handler does not also cancel copy mode or clear a selection.
    event.preventDefault();
    event.stopPropagation();
    onClose({ restoreFocus: true });
  }, [open, onClose]);

  const trackId = track?.id;
  const handleToggleStep = useCallback((step: number) => {
    if (trackId) onToggleStep(trackId, step);
  }, [trackId, onToggleStep]);
  const handleSetParameterLock = useCallback((step: number, lock: ParameterLock | null) => {
    if (trackId) onSetParameterLock(trackId, step, lock);
  }, [trackId, onSetParameterLock]);

  const showBody = !collapsed && track !== null;
  const rollProps = track ? {
    track,
    currentStep,
    anySoloed,
    scale,
    onSetParameterLock: readOnly ? noop : handleSetParameterLock,
    onToggleStep: readOnly ? noop : handleToggleStep,
  } : null;

  return (
    <div
      id={EDITOR_DOCK_ID}
      className={`dock${open ? ' open' : ''}${readOnly ? ' read-only' : ''}`}
      data-testid="editor-dock"
      role="region"
      aria-label="Pitch editor"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={handleKeyDown}
    >
      <div className="dock-inner">
        <div className="dock-panel">
          <div className="dock-head" ref={headRef}>
            <div className="dock-chips dock-track-tabs" role="group" aria-label="Docked track">
              {melodicTracks.map(tab => {
                const active = tab.id === track?.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`dock-chip dock-track-tab${active ? ' active' : ''}`}
                    data-category={getInstrumentCategory(tab.sampleId) || 'fx'}
                    aria-pressed={active}
                    onClick={() => onSelectTrack(tab.id)}
                  >
                    <span className="dock-tick" aria-hidden="true" />
                    {tab.name}
                  </button>
                );
              })}
            </div>
            <div className="dock-chips dock-view-tabs" role="group" aria-label="Pitch view">
              <button
                type="button"
                className={`dock-chip dock-view-tab${viewMode === 'chromatic' ? ' active' : ''}`}
                aria-pressed={viewMode === 'chromatic'}
                onClick={() => onSetViewMode('chromatic')}
                title="Chromatic Grid - compact pitch offset view"
              >
                Grid
              </button>
              <button
                type="button"
                className={`dock-chip dock-view-tab${viewMode === 'piano-roll' ? ' active' : ''}`}
                aria-pressed={viewMode === 'piano-roll'}
                onClick={() => onSetViewMode('piano-roll')}
                title="Piano Roll - full MIDI note view"
              >
                Piano Roll
              </button>
            </div>
            {track && (
              <span className="dock-title">
                <b>{track.name}</b>
                <span aria-hidden="true">·</span>
                <span>{getInstrumentName(track.sampleId)}</span>
              </span>
            )}
            <button
              type="button"
              className="dock-close"
              onClick={() => onClose({ restoreFocus: true })}
              title="Close (Esc)"
              aria-label="Close pitch editor"
            >
              <Close size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="dock-body">
            {showBody && rollProps && (viewMode === 'chromatic'
              ? <ChromaticGrid {...rollProps} />
              : <PianoRoll {...rollProps} />)}
          </div>
        </div>
      </div>
    </div>
  );
});
