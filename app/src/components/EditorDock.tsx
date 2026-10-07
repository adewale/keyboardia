/**
 * Editor dock (specs/PIANO-ROLL-DOCK.md).
 *
 * One editor under the sea of cells, inside the same horizontal scroller as
 * the track rows and pinned to that scroller's bottom edge. It shows one track
 * at a time: a header (track tabs, pane chips, title), a toolbar for the
 * active pane, and the roll, which stays visible under every pane.
 *
 * - Notes: the roll's own controls (Grid / Piano Roll, ghost toggles).
 * - Step: the selected step's lock (phase 6).
 * - Track: transpose, steps, instrument, pattern tools, FM, actions (phase 7).
 *
 * Every track can be docked; a drum track has no pitch, so its Notes chip is
 * disabled and the roll area says so.
 *
 * In mobile landscape (phase 8) the same dock is a bottom sheet about 45% of
 * the viewport tall (EditorDock.css): header and toolbar share one strip of
 * 44px targets and the roll scrolls on its own, synced with the docked row. Which track, pane and step are docked
 * lives in StepSequencer (see editor-dock-state.ts); this component only
 * renders them and reports intent.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import type { LoopRegion, ParameterLock, ScaleState, Track } from '../types';
import { ChromaticGrid } from './ChromaticGrid';
import { PianoRollEditor } from './PianoRollEditor';
import { DockStepPane, DockTrackPane, type DockTrackActions } from './DockPanes';
import { syncHorizontalScroll } from './scroll-sync';
import { getInstrumentCategory, getInstrumentCategoryColor, getInstrumentName } from './sample-constants';
import { EDITOR_DOCK_ID, type DockDetent, type DockPane, type DockViewMode } from './editor-dock-state';
import { isDrumInstrument } from '../shared/instrument-classification';
import { Close } from '../icons';
import './EditorDock.css';

/** Matches the .dock grid-template-rows transition in EditorDock.css. */
export const DOCK_TRANSITION_MS = 200;

const noop = () => {};

const PANES: ReadonlyArray<{ id: DockPane; label: string }> = [
  { id: 'notes', label: 'Notes' },
  { id: 'step', label: 'Step' },
  { id: 'track', label: 'Track' },
];

/**
 * Space kept between the dock's top edge and the scroller's: the dock's top
 * border plus a little slack, so a tall roll never pushes the header out.
 */
const DOCK_HEAD_SLACK_PX = 4;

interface EditorDockProps {
  open: boolean;
  /** The docked track. Still passed while closing so the content collapses with the dock. */
  track: Track | null;
  /** Every track, in row order, for the dock's track tabs. */
  tracks: Track[];
  /** Every melodic track, in row order, for the ghost notes. */
  melodicTracks: Track[];
  /** The pane to show (already resolved: a drum track never gets 'notes'). */
  pane: DockPane;
  /** The step the Step pane edits, on the docked track. */
  selectedStep: number | null;
  /** The Track pane's instrument picker is showing. */
  instrumentPickerOpen: boolean;
  /** The track a copy started from, so the Track pane offers Paste elsewhere. */
  copySourceId: string | null;
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
  /** The `.tracks` scroller, used to size the sticky header and toolbar to its visible width. */
  scrollerRef: RefObject<HTMLElement | null>;
  /**
   * Mobile landscape: the dock is a bottom sheet over the page rather than
   * the pinned bottom of `.tracks`, and its roll scrolls with the docked row.
   */
  landscape?: boolean;
  onSelectTrack: (trackId: string) => void;
  onSetPane: (pane: DockPane) => void;
  /** Shift+click or long-press on a bar in the roll. */
  onSelectStep: (trackId: string, step: number) => void;
  onSetViewMode: (viewMode: DockViewMode) => void;
  onToggleDetent: () => void;
  onToggleGhost: (trackId: string) => void;
  /** `restoreFocus` is true when focus was inside the dock (close button). */
  onClose: (options: { restoreFocus: boolean }) => void;
  /** Escape inside the dock: leave the pane for Notes, or close from Notes. */
  onDismissPane: () => void;
  onToggleStep: (trackId: string, step: number) => void;
  onSetParameterLock: (trackId: string, step: number, lock: ParameterLock | null) => void;
  /** The Step pane's Clear lock. */
  onClearStepLock: (trackId: string, step: number) => void;
  /** The Track pane's edits. */
  trackActions: DockTrackActions;
  onToggleInstrumentPicker: (trackId: string, opener: HTMLElement) => void;
}

export const EditorDock = memo(function EditorDock({
  open,
  track,
  tracks,
  melodicTracks,
  pane,
  selectedStep,
  instrumentPickerOpen,
  copySourceId,
  viewMode,
  detent,
  ghostVisibility,
  loopRegion = null,
  currentStep,
  anySoloed,
  scale,
  readOnly = false,
  scrollerRef,
  landscape = false,
  onSelectTrack,
  onSetPane,
  onSelectStep,
  onSetViewMode,
  onToggleDetent,
  onToggleGhost,
  onClose,
  onDismissPane,
  onToggleStep,
  onSetParameterLock,
  onClearStepLock,
  trackActions,
  onToggleInstrumentPicker,
}: EditorDockProps) {
  const dockRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Keep the roll mounted while the dock collapses, then unmount it so a
  // closed dock does not re-render a hidden grid on every playback step.
  const [collapsed, setCollapsed] = useState(!open);
  if (open && collapsed) setCollapsed(false);
  useEffect(() => {
    if (open || collapsed) return;
    const timer = setTimeout(() => setCollapsed(true), DOCK_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [open, collapsed]);

  // The header and toolbar are sticky-left inside a dock as wide as the grid;
  // size them to the scroller's visible width so their controls stay on
  // screen. The roll is the dock's only vertical scroller and the dock pins
  // to the bottom of .tracks, so a roll taller than the room under the header
  // and toolbar would push the header above the scroller. --dock-roll-max
  // caps the roll's height to the scroller's largest scrollport less both.
  //
  // In landscape the dock is fixed to the bottom of the viewport instead, so
  // it is placed over the scroller's visible box: its keyboard then starts on
  // the rows' left edge and its step columns can line up with the docked row.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const dockElement = dockRef.current;
    const head = headRef.current;
    const tools = toolsRef.current;
    if (!scroller || !dockElement || !head || !tools) return;
    const fit = () => {
      if (landscape) {
        head.style.width = '';
        tools.style.width = '';
        dockElement.style.removeProperty('--dock-roll-max');
        const box = scroller.getBoundingClientRect();
        dockElement.style.left = `${box.left + scroller.clientLeft}px`;
        dockElement.style.width = `${scroller.clientWidth}px`;
        return;
      }
      dockElement.style.left = '';
      dockElement.style.width = '';
      const width = `${scroller.clientWidth}px`;
      head.style.width = width;
      tools.style.width = width;
      const maxHeight = parseFloat(getComputedStyle(scroller).maxHeight);
      if (Number.isFinite(maxHeight)) {
        // Borders and a horizontal scrollbar are not part of the scrollport.
        const chrome = scroller.offsetHeight - scroller.clientHeight;
        const room = maxHeight - chrome - head.offsetHeight - tools.offsetHeight - DOCK_HEAD_SLACK_PX;
        dockElement.style.setProperty('--dock-roll-max', `${Math.max(0, Math.floor(room))}px`);
      } else {
        dockElement.style.removeProperty('--dock-roll-max');
      }
    };
    fit();
    // The scroller's left edge moves with the viewport, not only with its size.
    window.addEventListener('resize', fit);
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', fit);
    }
    const observer = new ResizeObserver(fit);
    observer.observe(scroller);
    observer.observe(head);
    observer.observe(tools);
    return () => {
      window.removeEventListener('resize', fit);
      observer.disconnect();
    };
  }, [scrollerRef, landscape]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    // An open dropdown menu owns its own Escape (it may be portalled, but
    // React still bubbles its keydown through the dock).
    const target = event.target as Element | null;
    if (target?.closest?.('.dropdown-menu, [aria-haspopup][aria-expanded="true"]')) return;
    // Escape acts only with focus inside the dock, and stops here so the
    // global handler does not also cancel copy mode or clear a selection.
    event.preventDefault();
    event.stopPropagation();
    onDismissPane();
    // Leaving a pane for Notes unmounts the focused control: keep focus in
    // the dock, on the pane now showing, so a second Escape closes it.
    requestAnimationFrame(() => {
      const dockElement = dockRef.current;
      if (!dockElement?.classList.contains('open')) return;
      if (dockElement.contains(document.activeElement)) return;
      dockElement.querySelector<HTMLElement>('.dock-pane-chip.active')?.focus();
    });
  }, [open, onDismissPane]);

  const trackId = track?.id;
  const showBody = !collapsed && track !== null;

  // Landscape only. On desktop the rows and the dock share one horizontal
  // scroller (.tracks), so every row lines up with the roll. Below 768px wide,
  // and in every landscape layout, each row's .steps scrolls on its own, so
  // the dock cannot align with every row at once: it aligns with the docked
  // row only, by syncing the roll's horizontal scroll with that row's .steps
  // scroll in both directions. Both sit on the same step geometry with the
  // same 134 + 8px offset, so equal scroll positions mean aligned columns.
  useEffect(() => {
    if (!landscape || !open || !showBody || !trackId) return;
    const body = bodyRef.current;
    const wrapper = Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>('[data-track-id]') ?? [])
      .find(element => element.dataset.trackId === trackId);
    const steps = wrapper?.querySelector<HTMLElement>('.steps');
    if (!body || !steps) return;
    return syncHorizontalScroll(steps, body);
  }, [landscape, open, showBody, trackId, scrollerRef]);

  const handleToggleStep = useCallback((step: number) => {
    if (trackId) onToggleStep(trackId, step);
  }, [trackId, onToggleStep]);
  const handleSetParameterLock = useCallback((step: number, lock: ParameterLock | null) => {
    if (trackId) onSetParameterLock(trackId, step, lock);
  }, [trackId, onSetParameterLock]);
  const handleSelectStep = useCallback((step: number) => {
    if (trackId) onSelectStep(trackId, step);
  }, [trackId, onSelectStep]);

  // Every other melodic track, as ghost notes in its category colour.
  const ghostTracks = useMemo(() => melodicTracks
    .filter(other => other.id !== trackId)
    .map(other => ({
      track: other,
      color: getInstrumentCategoryColor(other.sampleId),
      visible: ghostVisibility[other.id] ?? false,
    })), [melodicTracks, trackId, ghostVisibility]);

  const hasPitch = track !== null && !isDrumInstrument(track.sampleId);
  const isRoll = viewMode === 'piano-roll';
  const rollProps = track ? {
    track,
    currentStep,
    anySoloed,
    scale,
    onSetParameterLock: readOnly ? noop : handleSetParameterLock,
    onToggleStep: readOnly ? noop : handleToggleStep,
  } : null;

  const renderPane = () => {
    if (!track) return null;
    if (pane === 'step') {
      return (
        <div className="dock-pane dock-pane-step">
          <DockStepPane
            track={track}
            step={selectedStep}
            readOnly={readOnly}
            onSetParameterLock={onSetParameterLock}
            onClearLock={onClearStepLock}
          />
        </div>
      );
    }
    if (pane === 'track') {
      return (
        <DockTrackPane
          track={track}
          readOnly={readOnly}
          copySourceId={copySourceId}
          instrumentPickerOpen={instrumentPickerOpen}
          actions={trackActions}
          onToggleInstrumentPicker={onToggleInstrumentPicker}
        />
      );
    }
    return (
      <div className="dock-pane dock-pane-notes">
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
        {isRoll && ghostTracks.length > 0 && (
          <div className="dock-tool-group">
            <span className="dock-tool-label" aria-hidden="true">Ghosts</span>
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
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={dockRef}
      id={EDITOR_DOCK_ID}
      className={`dock${open ? ' open' : ''}${readOnly ? ' read-only' : ''}`}
      data-testid="editor-dock"
      data-pane={pane}
      role="region"
      aria-label="Track editor"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={handleKeyDown}
    >
      <div className="dock-inner">
        <div className="dock-panel">
          <div className="dock-head" ref={headRef}>
            <div className="dock-chips dock-track-tabs" role="group" aria-label="Docked track">
              {tracks.map(tab => {
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
            <div className="dock-chips dock-pane-chips" role="group" aria-label="Dock pane">
              {PANES.map(({ id, label }) => {
                const active = pane === id;
                const unavailable = id === 'notes' && !hasPitch;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`dock-chip dock-pane-chip${active ? ' active' : ''}`}
                    aria-pressed={active}
                    disabled={unavailable}
                    title={unavailable ? 'No pitch for drum tracks' : undefined}
                    onClick={() => onSetPane(id)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {track && (
              <span className="dock-title">
                <b>{track.name}</b>
                <span className="dock-title-instrument" aria-hidden="true">·</span>
                <span className="dock-title-instrument">{getInstrumentName(track.sampleId)}</span>
                {pane === 'step' && selectedStep !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>step {selectedStep + 1}</span>
                  </>
                )}
              </span>
            )}
            <div className="dock-head-end">
              {/* Landscape has one height, about 45% of the viewport. */}
              {isRoll && hasPitch && !landscape && (
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
          <div className="dock-tools" ref={toolsRef}>
            {showBody && renderPane()}
          </div>
          <div className="dock-body" ref={bodyRef} data-view={hasPitch ? viewMode : 'none'}>
            {showBody && !hasPitch && (
              <p className="dock-no-pitch">No pitch for drum tracks</p>
            )}
            {showBody && hasPitch && rollProps && (isRoll
              ? (
                <PianoRollEditor
                  {...rollProps}
                  ghostTracks={ghostTracks}
                  loopRegion={loopRegion}
                  detent={detent}
                  readOnly={readOnly}
                  selectedStep={pane === 'step' ? selectedStep : null}
                  onSelectStep={handleSelectStep}
                />
              )
              : <ChromaticGrid {...rollProps} />)}
          </div>
        </div>
      </div>
    </div>
  );
});
