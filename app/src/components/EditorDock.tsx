/**
 * Editor dock (specs/PIANO-ROLL-DOCK.md, phase 2: dock shell).
 *
 * One pitch editor under the sea of cells, inside the same horizontal scroller
 * as the track rows and pinned to that scroller's bottom edge. It shows one
 * melodic track at a time, as the PianoRollEditor (bars, ghosts of the other
 * melodic tracks, two detents) or the legacy ChromaticGrid.
 *
 * Which track is docked lives in StepSequencer (see editor-dock-state.ts);
 * this component only renders it and reports intent.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import type { LoopRegion, ParameterLock, ScaleState, Track } from '../types';
import { ChromaticGrid } from './ChromaticGrid';
import { PianoRollEditor } from './PianoRollEditor';
import { getInstrumentCategory, getInstrumentCategoryColor, getInstrumentName } from './sample-constants';
import { EDITOR_DOCK_ID, type DockDetent, type DockViewMode } from './editor-dock-state';
import { Close } from '../icons';
import './EditorDock.css';

/** Matches the .dock grid-template-rows transition in EditorDock.css. */
export const DOCK_TRANSITION_MS = 200;

const noop = () => {};

/**
 * Space kept between the dock's top edge and the scroller's: the dock's top
 * border plus a little slack, so a tall roll never pushes the header out.
 */
const DOCK_HEAD_SLACK_PX = 4;

interface EditorDockProps {
  open: boolean;
  /** The docked track. Still passed while closing so the content collapses with the dock. */
  track: Track | null;
  /** Every melodic track, in row order, for the dock's track tabs. */
  melodicTracks: Track[];
  viewMode: DockViewMode;
  detent: DockDetent;
  /** Resolved ghost visibility for every other melodic track, by track id. */
  ghostVisibility: Record<string, boolean>;
  loopRegion?: LoopRegion | null;
  currentStep: number;
  anySoloed: boolean;
  scale?: ScaleState;
  /** Published session: the dock opens and plays but accepts no edits. */
  readOnly?: boolean;
  /** The `.tracks` scroller, used to size the sticky header to its visible width. */
  scrollerRef: RefObject<HTMLElement | null>;
  onSelectTrack: (trackId: string) => void;
  onSetViewMode: (viewMode: DockViewMode) => void;
  onToggleDetent: () => void;
  onToggleGhost: (trackId: string) => void;
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
  detent,
  ghostVisibility,
  loopRegion = null,
  currentStep,
  anySoloed,
  scale,
  readOnly = false,
  scrollerRef,
  onSelectTrack,
  onSetViewMode,
  onToggleDetent,
  onToggleGhost,
  onClose,
  onToggleStep,
  onSetParameterLock,
}: EditorDockProps) {
  const dockRef = useRef<HTMLDivElement>(null);
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
  // The roll is the dock's only vertical scroller and the dock pins to the
  // bottom of .tracks, so a roll taller than the room under the header would
  // push the header above the scroller. --dock-roll-max caps the roll's
  // height to the scroller's largest scrollport less the header.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const dockElement = dockRef.current;
    const head = headRef.current;
    if (!scroller || !dockElement || !head) return;
    const fit = () => {
      head.style.width = `${scroller.clientWidth}px`;
      const maxHeight = parseFloat(getComputedStyle(scroller).maxHeight);
      if (Number.isFinite(maxHeight)) {
        // Borders and a horizontal scrollbar are not part of the scrollport.
        const chrome = scroller.offsetHeight - scroller.clientHeight;
        const room = maxHeight - chrome - head.offsetHeight - DOCK_HEAD_SLACK_PX;
        dockElement.style.setProperty('--dock-roll-max', `${Math.max(0, Math.floor(room))}px`);
      } else {
        dockElement.style.removeProperty('--dock-roll-max');
      }
    };
    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const observer = new ResizeObserver(fit);
    observer.observe(scroller);
    observer.observe(head);
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

  // Every other melodic track, as ghost notes in its category colour.
  const ghostTracks = useMemo(() => melodicTracks
    .filter(other => other.id !== trackId)
    .map(other => ({
      track: other,
      color: getInstrumentCategoryColor(other.sampleId),
      visible: ghostVisibility[other.id] ?? false,
    })), [melodicTracks, trackId, ghostVisibility]);

  const isRoll = viewMode === 'piano-roll';
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
      ref={dockRef}
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
            {isRoll && ghostTracks.length > 0 && (
              <div className="dock-chips dock-ghost-toggles" role="group" aria-label="Ghost notes">
                {ghostTracks.map(ghost => (
                  <button
                    key={ghost.track.id}
                    type="button"
                    className="dock-chip dock-ghost-toggle"
                    style={{ '--gc': ghost.color } as CSSProperties}
                    aria-pressed={ghost.visible}
                    title={`${ghost.visible ? 'Hide' : 'Show'} ${ghost.track.name} as ghost notes`}
                    onClick={() => onToggleGhost(ghost.track.id)}
                  >
                    <span className="dock-ghost-swatch" aria-hidden="true" />
                    {ghost.track.name}
                  </button>
                ))}
              </div>
            )}
            <div className="dock-head-end">
              {isRoll && (
                <button
                  type="button"
                  className="dock-icon-button dock-detent"
                  aria-pressed={detent === 'tall'}
                  onClick={onToggleDetent}
                  title="Toggle compact / tall"
                >
                  <span aria-hidden="true">⇕</span> {detent === 'tall' ? 'Compact' : 'Tall'}
                </button>
              )}
              <button
                type="button"
                className="dock-icon-button dock-close"
                onClick={() => onClose({ restoreFocus: true })}
                title="Close (Esc)"
                aria-label="Close pitch editor"
              >
                <Close size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="dock-body" data-view={viewMode}>
            {showBody && rollProps && (isRoll
              ? (
                <PianoRollEditor
                  {...rollProps}
                  ghostTracks={ghostTracks}
                  loopRegion={loopRegion}
                  detent={detent}
                  readOnly={readOnly}
                />
              )
              : <ChromaticGrid {...rollProps} />)}
          </div>
        </div>
      </div>
    </div>
  );
});
