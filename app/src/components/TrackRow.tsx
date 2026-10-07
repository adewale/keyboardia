import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Track, ParameterLock, ScaleState, LoopRegion } from '../types';
import { STEPS_PER_PAGE, STEP_COUNT_OPTIONS, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { StepCell } from './StepCell';
import { computeStepContours } from './step-contour';
import { Add, ChevronDown, ChevronUp, Minus } from '../icons';
import { PitchContour } from './ChromaticGrid';
import { EDITOR_DOCK_ID } from './editor-dock-state';
import { DOCK_INSTRUMENT_PICKER_ID } from './DockPanes';
import { VelocityLane } from './VelocityLane';
import { InlineDrawer } from './InlineDrawer';
import { TrackDrawer } from './TrackDrawer';
import { TrackNameEditor } from './TrackNameEditor';
import { SamplePicker } from './SamplePicker';
import { previewInstrument } from '../audio/audioTriggers';
import { clamp } from '../shared/validation';
import { useRemoteChanges } from '../context/RemoteChangeContext';
import {
  getInstrumentCategory,
  getInstrumentCategoryColor,
  getInstrumentName,
} from './sample-constants';
import { isDrumInstrument } from '../shared/instrument-classification';
import { getTransposedRoot, type NoteName } from '../music/music-theory';
import { isInRange, isInOptimalRange } from '../audio/instrument-ranges';
import { features } from '../config/features';
import { useDragToPaint } from './useDragToPaint';
import './TrackRow.css';
// ChromaticGrid now renders in the EditorDock; its styles stay imported here
// so the production stylesheet order does not change (lesson 63).
import './ChromaticGrid.css';
import './VelocityLane.css';
import './InlineDrawer.css';
import './TrackDrawer.css';
// The transpose and step-count dropdowns moved to the dock's Track pane; their
// styles (and the shared dropdown recipe, first) stay imported here so the
// production stylesheet order does not depend on when the dock loads
// (lesson 63).
import './Dropdown.css';
import './StepCountDropdown.css';
import './TransposeDropdown.css';

/**
 * The short engine label on line two of the control block: what kind of
 * instrument plays this track. The full name is in the badge's tooltip.
 */
function getInstrumentBadge(sampleId: string): string {
  if (sampleId.startsWith('tone:fm-')) return 'FM';
  if (sampleId.startsWith('tone:')) return 'TON';
  if (sampleId.startsWith('advanced:')) return 'ADV';
  if (sampleId.startsWith('synth:')) return 'SYN';
  if (/^(mic:|recording-|slice-)/.test(sampleId)) return 'REC';
  return 'SMP';
}

/** Line one's transpose readout: blank at 0, otherwise signed semitones. */
function formatTransposeReadout(transpose: number): string | null {
  if (!Number.isFinite(transpose) || transpose === 0) return null;
  return transpose > 0 ? `+${transpose}` : `${transpose}`;
}

interface TrackRowProps {
  track: Track;
  trackIndex: number; // Phase 31G: Index in tracks array for drag & drop
  currentStep: number;
  swing: number;
  anySoloed: boolean;
  hasSteps: boolean;
  canDelete: boolean;
  isCopySource: boolean;
  isCopyTarget: boolean;
  readOnly?: boolean;
  onToggleStep: (step: number) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onClear: () => void;
  onDelete: () => void;
  onStartCopy: () => void;
  onCopyTo: () => void;
  onSetParameterLock?: (step: number, lock: ParameterLock | null) => void;
  onSetTranspose?: (transpose: number) => void;
  onSetStepCount?: (stepCount: number) => void;
  onSetVolume?: (volume: number) => void;
  scale?: ScaleState; // Phase 29E: Scale state for Key Assistant
  // Phase 31B: Pattern manipulation
  onRotatePattern?: (direction: 'left' | 'right') => void;
  onInvertPattern?: () => void;
  onReversePattern?: () => void;
  onMirrorPattern?: () => void;
  onEuclideanFill?: (hits: number) => void;
  // Phase 31D: Editing conveniences
  onSetName?: (name: string) => void;
  onSetTrackSwing?: (swing: number) => void;
  /**
   * Change instrument (issue #63). Absent for a published session, which is
   * what hides the control — the same mechanism that hides Delete. On
   * desktop the badge opens the picker in the dock (onToggleInstrumentPicker);
   * the landscape TrackDrawer still opens one under the row until phase 8.
   */
  onSetInstrument?: (sampleId: string) => void;
  /** True while the dock's Track pane shows this track's instrument picker. */
  isInstrumentPickerOpen?: boolean;
  /** The badge: open (or close) this track's instrument picker in the dock. */
  onToggleInstrumentPicker?: (opener: HTMLElement) => void;
  // Phase 31F: Multi-select support
  selectedSteps?: Set<number>; // Set of selected step indices for this track
  selectionAnchor?: number | null; // Anchor step for Shift+extend
  hasSelection?: boolean; // Whether any selection exists (affects Shift+click behavior)
  onSelectStep?: (step: number, mode: 'toggle' | 'extend') => void;
  // Phase 31G: Loop region support
  loopRegion?: LoopRegion | null; // Current loop region (steps outside are dimmed)
  // Phase 31G: Track reorder (drag & drop)
  isDragTarget?: boolean; // Whether this track is the current drop target
  isDragging?: boolean; // LOW-1: Whether this track is being dragged
  onDragStart?: () => void; // HIGH-2: Now uses track ID from callback closure
  onDragOver?: () => void; // HIGH-2: Now uses track ID from callback closure
  onDragEnd?: (droppedTrackId?: string, targetTrackId?: string) => void; // BUG3-FIX: Pass both source and target IDs
  onDragLeave?: () => void; // BUG2-FIX: Clear target when cursor leaves track
  // Landscape drawer support
  orientationMode?: 'portrait' | 'landscape' | 'desktop';
  isLandscapeDrawerOpen?: boolean;
  onToggleLandscapeDrawer?: () => void;
  /**
   * Editor dock (specs/PIANO-ROLL-DOCK.md). The pitch editor no longer opens
   * under the row: the row asks StepSequencer to dock it.
   * `isDocked` is true while the open dock shows this track.
   */
  isDocked?: boolean;
  /** The pitch toggle: dock this track, or close the dock if it already shows it. */
  onToggleDock?: () => void;
  /** Clicking a track's name: dock this track (never closes). */
  onOpenDock?: () => void;
  /**
   * The step the dock's Step pane edits on this track, or null. The cell
   * keeps its selection ring while the pane shows it.
   */
  dockSelectedStep?: number | null;
  /** Shift+click or long-press on an active cell: the dock's Step pane for it. */
  onSelectDockStep?: (step: number) => void;
}

// Phase 21.5: Wrap in React.memo for performance optimization
// TrackRow receives many callbacks that are stable (useCallback in parent),
// so memo will skip re-renders when only sibling tracks change
export const TrackRow = React.memo(function TrackRow({
  track,
  trackIndex: _trackIndex, // Reserved for future use (currently using track.id for stability)
  currentStep,
  swing,
  anySoloed,
  hasSteps,
  canDelete,
  isCopySource,
  isCopyTarget,
  readOnly = false,
  onToggleStep,
  onToggleMute,
  onToggleSolo,
  onClear,
  onDelete,
  onStartCopy,
  onCopyTo,
  onSetParameterLock,
  onSetTranspose,
  onSetStepCount,
  onSetVolume,
  scale,
  onRotatePattern,
  onInvertPattern,
  onReversePattern,
  onMirrorPattern,
  onEuclideanFill,
  onSetName,
  onSetTrackSwing,
  onSetInstrument,
  isInstrumentPickerOpen: isDockInstrumentPickerOpen = false,
  onToggleInstrumentPicker,
  selectedSteps,
  selectionAnchor,
  hasSelection,
  onSelectStep,
  loopRegion,
  isDragTarget,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragLeave,
  orientationMode,
  isLandscapeDrawerOpen,
  onToggleLandscapeDrawer,
  isDocked = false,
  onToggleDock,
  onOpenDock,
  dockSelectedStep = null,
  onSelectDockStep,
}: TrackRowProps) {
  // Phase 31G: Velocity lane visibility
  const [isVelocityExpanded, setIsVelocityExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // The landscape TrackDrawer's pattern tools button keeps its pressed state;
  // the tools themselves are in the dock's Track pane, which landscape gets
  // in phase 8.
  const [showPatternTools, setShowPatternTools] = useState(false);
  // Change instrument (issue #63): the landscape picker panel below this row.
  const [showInstrumentPicker, setShowInstrumentPicker] = useState(false);
  // NOTE: Track name editing state moved to TrackNameEditor component
  // Phase 31G FIX: Track if pointerdown originated on drag handle
  // HTML5 DnD e.target is always the [draggable] element, not the clicked child
  const dragHandleClickedRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instrumentOpenerRef = useRef<HTMLElement | null>(null);
  const remoteChanges = useRemoteChanges();

  // Phase 31B: Calculate active step count for Euclidean slider
  const activeStepCount = useMemo(() => {
    const stepCount = track.stepCount ?? STEPS_PER_PAGE;
    return track.steps.slice(0, stepCount).filter(Boolean).length;
  }, [track.steps, track.stepCount]);

  // Check if this is a melodic track (can use chromatic/keyboard view)
  const isMelodicTrack = !isDrumInstrument(track.sampleId);

  // Phase 31C: Get instrument category for color coding
  const instrumentCategory = useMemo(() => {
    return getInstrumentCategory(track.sampleId) || 'fx';
  }, [track.sampleId]);

  // Phase 31H: Calculate effective key for Per-Track Key Display
  const effectiveKey = useMemo(() => {
    if (!scale || isDrumInstrument(track.sampleId)) return null;
    const transpose = track.transpose ?? 0;
    if (transpose === 0) return null; // Don't show badge if no transpose
    return getTransposedRoot(scale.root as NoteName, transpose);
  }, [scale, track.sampleId, track.transpose]);

  const transposeReadout = formatTransposeReadout(track.transpose ?? 0);
  const instrumentBadge = getInstrumentBadge(track.sampleId);

  // Phase 31H: Pre-compute range warnings for all steps
  // This avoids recalculating inside the render map function
  const rangeWarnings = useMemo(() => {
    if (!isMelodicTrack) return null;

    const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
    const baseMidi = 60; // C4
    const transpose = track.transpose ?? 0;

    return track.steps.slice(0, trackStepCount).map((active, index) => {
      if (!active) return null;

      const pitchLock = track.parameterLocks[index]?.pitch ?? 0;
      const midiNote = baseMidi + transpose + pitchLock;

      if (!isInRange(midiNote, track.sampleId)) {
        return 'out-of-range' as const;
      } else if (!isInOptimalRange(midiNote, track.sampleId)) {
        return 'suboptimal-range' as const;
      }
      return null;
    });
  }, [isMelodicTrack, track.steps, track.parameterLocks, track.transpose, track.sampleId, track.stepCount]);

  // Pitch contour marks: each active melodic step's pitch within the track's
  // own active range. Drum tracks get none.
  const { steps, parameterLocks, transpose, stepCount } = track;
  const stepContours = useMemo(() => {
    if (!isMelodicTrack) return null;
    return computeStepContours({ steps, parameterLocks, transpose, stepCount });
  }, [isMelodicTrack, steps, parameterLocks, transpose, stepCount]);

  // Shift+click or long-press on an active cell asks for the dock's Step pane.
  const handleStepSelect = useCallback((step: number) => {
    if (!track.steps[step]) return;
    onSelectDockStep?.(step);
  }, [track.steps, onSelectDockStep]);

  // Memoized step click handlers to prevent StepCell re-renders
  const stepClickHandlers = useMemo(() => {
    const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
    return Array.from({ length: trackStepCount }, (_, i) => () => onToggleStep(i));
  }, [track.stepCount, onToggleStep]);

  const stepSelectHandlers = useMemo(() => {
    const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
    return Array.from({ length: trackStepCount }, (_, i) => () => handleStepSelect(i));
  }, [track.stepCount, handleStepSelect]);

  const handleTransposeChange = useCallback(async (transpose: number) => {
    if (!onSetTranspose) return;

    // Guard against NaN (can happen with undefined track.transpose from old sessions)
    const safeTranspose = Number.isFinite(transpose) ? transpose : 0;
    onSetTranspose(safeTranspose);

    // Preview sound (only if audio already loaded - don't block for button click)
    await previewInstrument('preview_transpose', {
      sampleId: track.sampleId,
      previewId: `preview-${track.id}`,
      pitch: safeTranspose,
    });
  }, [onSetTranspose, track.sampleId, track.id]);

  // Phase 25: Handle track volume changes
  const handleTrackVolumeChange = useCallback((volume: number) => {
    if (!onSetVolume) return;
    onSetVolume(clamp(volume, 0, 1));
  }, [onSetVolume]);

  // Phase 31D: Handle per-track swing changes
  const handleTrackSwingChange = useCallback((trackSwing: number) => {
    if (!onSetTrackSwing) return;
    onSetTrackSwing(clamp(trackSwing, 0, 100));
  }, [onSetTrackSwing]);

  // Change instrument (issue #63). On desktop the badge opens the picker in
  // the dock. In landscape the TrackDrawer opens the panel under this row;
  // committing there closes the picker and the drawer, so the person sees the
  // result.
  const canChangeInstrument = !!onSetInstrument && !readOnly;
  const isLandscape = orientationMode === 'landscape';

  const handleToggleInstrumentPicker = useCallback((opener?: HTMLElement) => {
    setShowInstrumentPicker(open => {
      if (!open && opener) instrumentOpenerRef.current = opener;
      return !open;
    });
  }, []);

  const handleSelectInstrument = useCallback((sampleId: string) => {
    const opener = instrumentOpenerRef.current;
    onSetInstrument?.(sampleId);
    setShowInstrumentPicker(false);
    setIsMenuOpen(false);
    requestAnimationFrame(() => {
      const focusIfVisible = (element: HTMLElement | null | undefined): boolean => {
        if (!element?.isConnected) return false;
        const style = window.getComputedStyle(element);
        if (element.hidden || style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }
        element.focus();
        return document.activeElement === element;
      };
      const landscapeOpener = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid^="landscape-change-instrument-"]'),
      ).find(element => element.dataset.testid === `landscape-change-instrument-${track.id}`);
      const fallbackCandidates = [
        opener,
        landscapeOpener,
        wrapperRef.current?.querySelector<HTMLElement>('.track-name'),
      ];
      for (const candidate of fallbackCandidates) {
        if (focusIfVisible(candidate)) return;
      }
    });
  }, [onSetInstrument, track.id]);

  // Derived rather than stored, so a session that becomes read-only (or a row
  // that leaves landscape) while the picker is open closes it without an
  // effect that re-renders to catch up.
  const isInstrumentPickerOpen = canChangeInstrument && isLandscape && showInstrumentPicker;

  const { handleStepsPointerMove, stepPaintStartHandlers, stepPaintEnterHandlers } = useDragToPaint({
    steps: track.steps,
    stepCount: track.stepCount ?? STEPS_PER_PAGE,
    enabled: features.advancedStepInput,
    onToggleStep,
  });

  // Phase 31F: Memoized selection toggle handlers (Ctrl+Click)
  const stepSelectToggleHandlers = useMemo(() => {
    const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
    return Array.from({ length: trackStepCount }, (_, i) => () => onSelectStep?.(i, 'toggle'));
  }, [track.stepCount, onSelectStep]);

  // Phase 31F: Memoized selection extend handlers (Shift+Click when selection exists)
  const stepSelectExtendHandlers = useMemo(() => {
    const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
    return Array.from({ length: trackStepCount }, (_, i) => () => onSelectStep?.(i, 'extend'));
  }, [track.stepCount, onSelectStep]);

  // Phase 31D: Preview sound on track name click
  // NOTE: Double-click to edit and state management moved to TrackNameEditor
  const handleNamePreview = useCallback(async () => {
    // Determine if instrument needs longer sustain for preview
    const isSustained = track.sampleId.includes('pad') ||
                        track.sampleId.includes('string') ||
                        track.sampleId.includes('rhodes');

    await previewInstrument('preview_transpose', {
      sampleId: track.sampleId,
      previewId: `preview-${track.id}`,
      pitch: track.transpose ?? 0,
      duration: isSustained ? 0.3 : undefined,
    });
  }, [track.sampleId, track.id, track.transpose]);

  // Editor dock: clicking a track's name previews it and docks it. A drum
  // track docks too: its Step and Track panes apply, only Notes does not.
  const handleNameClick = useCallback(() => {
    void handleNamePreview();
    onOpenDock?.();
  }, [handleNamePreview, onOpenDock]);

  // Phase 31G: Drag handlers for track reordering
  // HIGH-2: Use track.id instead of trackIndex for stable references
  const handleDragStart = useCallback((e: React.DragEvent) => {
    // FIX: Check ref instead of closest() - in HTML5 DnD, e.target is always
    // the [draggable] wrapper, not the child element that was clicked
    if (!dragHandleClickedRef.current) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    // Store track ID instead of index for stability during remote changes
    e.dataTransfer.setData('text/plain', track.id);
    onDragStart?.();
  }, [track.id, onDragStart]);

  // Phase 31G FIX: Track pointerdown on drag handle
  const handleDragHandlePointerDown = useCallback(() => {
    dragHandleClickedRef.current = true;
  }, []);

  // Phase 31G FIX: Reset ref on pointerup anywhere (capture phase)
  useEffect(() => {
    const resetDragHandleFlag = () => {
      dragHandleClickedRef.current = false;
    };
    // Use capture phase to reset before any other handlers
    document.addEventListener('pointerup', resetDragHandleFlag, true);
    document.addEventListener('pointercancel', resetDragHandleFlag, true);
    return () => {
      document.removeEventListener('pointerup', resetDragHandleFlag, true);
      document.removeEventListener('pointercancel', resetDragHandleFlag, true);
    };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragOver?.();
  }, [onDragOver]);

  // Lesson 62: accept the drag on dragenter as well as dragover. When the
  // element under a still cursor changes (the playhead indicator appearing in
  // or leaving the cell under it), the browser re-targets the drag with
  // dragenter and dragleave only. An uncancelled dragenter sets the drop
  // operation to none, so a release in that instant ended the drag with no
  // drop: "reorder during playback" failed whenever the drop point sat inside
  // a cell's indicator, which is why it depended on the row's width.
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // BUG3-FIX: Read track ID from dataTransfer and pass BOTH source and target IDs
  // This ensures the target is from the actual drop event, not potentially stale state
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedTrackId = e.dataTransfer.getData('text/plain');
    // Pass both: droppedTrackId (source) and track.id (target where drop occurred)
    onDragEnd?.(droppedTrackId || undefined, track.id);
  }, [onDragEnd, track.id]);

  const handleDragEndEvent = useCallback(() => {
    // Called on the dragged element - no target ID available here
    // The actual reorder happens in handleDrop above
    onDragEnd?.();
  }, [onDragEnd]);

  // BUG2-FIX: Handle drag leave to clear target highlight
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only trigger if actually leaving this element (not entering a child)
    // relatedTarget is the element being entered
    const wrapper = e.currentTarget;
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && wrapper.contains(relatedTarget)) {
      return; // Still within this wrapper, don't clear
    }
    onDragLeave?.();
  }, [onDragLeave]);

  const handleCloseLandscapeDrawer = useCallback((reason: 'outside' | 'escape') => {
    setShowInstrumentPicker(false);
    onToggleLandscapeDrawer?.();
    if (reason === 'escape') {
      requestAnimationFrame(() => {
        wrapperRef.current?.querySelector<HTMLElement>('.track-name')?.focus();
      });
    }
  }, [onToggleLandscapeDrawer]);

  // LOW-1: Build class names including dragging state
  const wrapperClasses = [
    'track-row-wrapper',
    isDragTarget ? 'drag-target' : '',
    isDragging ? 'dragging' : '',
    isDocked ? 'docked' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={wrapperClasses}
      ref={wrapperRef}
      data-track-id={track.id}
      draggable
      onDragStart={handleDragStart}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEndEvent}
    >
      {/* Mobile: Track header row with name only */}
      <div className={`track-header-mobile ${track.muted ? 'muted' : ''} ${track.soloed ? 'soloed' : ''}`}>
        <span className="track-name-mobile">
          {track.name}
          {isMelodicTrack && <span className="track-type-badge">♪</span>}
          {track.muted && <span className="track-status-badge muted">M</span>}
          {track.soloed && <span className="track-status-badge soloed">S</span>}
        </span>
      </div>

      <div
        className={`track-row ${track.muted ? 'muted' : ''} ${track.soloed ? 'soloed' : ''} ${isCopySource ? 'copy-source' : ''} ${isCopyTarget ? 'copy-target' : ''}`}
        data-category={instrumentCategory}
      >
        {/* LEFT STICKY: the two-line control block (specs/PIANO-ROLL-DOCK.md).
            Three children, each placed explicitly by TrackRow.css (lesson 61):
            the grip spans both lines, line one is identity, line two is
            state and disclosure. */}
        <div className={`track-left${canChangeInstrument ? ' has-instrument-toggle' : ''}`}>
          {/* Phase 31G: Drag handle for track reordering */}
          <span
            className="track-drag-handle"
            title="Drag to reorder"
            aria-label="Drag to reorder track"
            onPointerDown={handleDragHandlePointerDown}
          >
            ⠿
          </span>

          {/* Line one, identity: category tick, name, transpose readout */}
          <div className="track-identity">
            <span
              className="track-category-tick"
              style={{ '--track-category-color': getInstrumentCategoryColor(track.sampleId) } as React.CSSProperties}
              aria-hidden="true"
            />
            {/* Track name - click to preview, double-click to rename */}
            <TrackNameEditor
              name={track.name}
              instrumentName={getInstrumentName(track.sampleId)}
              sampleId={track.sampleId}
              canRename={!!onSetName}
              onSave={(name) => onSetName?.(name)}
              onPreview={handleNameClick}
              onClickOverride={orientationMode === 'landscape' ? onToggleLandscapeDrawer : undefined}
              disclosureExpanded={orientationMode === 'landscape' ? !!isLandscapeDrawerOpen : undefined}
              // TrackDrawer unmounts while closed, so only point aria-controls at
              // it while it actually exists.
              disclosureControls={orientationMode === 'landscape' && isLandscapeDrawerOpen ? `track-drawer-${track.id}` : undefined}
            />
            {transposeReadout && (
              <span
                className="track-transpose-readout"
                title={effectiveKey
                  ? `Transposed ${transposeReadout} semitones (effective root ${effectiveKey}, from ${scale?.root})`
                  : `Transposed ${transposeReadout} semitones`}
                data-testid={`track-transpose-${track.id}`}
              >
                {transposeReadout}
              </span>
            )}
          </div>

          {/* Line two: the state group, then the disclosure group */}
          <div className="track-controls">
            <div className="track-control-group track-state-group">
              <button
                className={`mute-button ${track.muted ? 'active' : ''}`}
                onClick={onToggleMute}
                title="Mute track"
                aria-label="Mute"
                aria-pressed={track.muted}
              >
                M
              </button>
              <button
                className={`solo-button ${track.soloed ? 'active' : ''}`}
                onClick={onToggleSolo}
                title="Solo track (hear only this)"
                aria-label="Solo"
                aria-pressed={track.soloed}
              >
                S
              </button>
            </div>

            <div className="track-control-group track-disclosure-group">
              {/* The badge slot. An editable row puts the change-instrument
                  toggle (issue #63) here, so both variants are one width. */}
              {canChangeInstrument ? (
                <button
                  className={`instrument-toggle track-instrument-badge${isMelodicTrack ? '' : ' unpitched'}${isDockInstrumentPickerOpen ? ' active' : ''}`}
                  onClick={(event) => onToggleInstrumentPicker?.(event.currentTarget)}
                  title={`Change instrument (currently ${getInstrumentName(track.sampleId)})`}
                  aria-label="Change instrument"
                  aria-expanded={isDockInstrumentPickerOpen}
                  aria-controls={isDockInstrumentPickerOpen ? DOCK_INSTRUMENT_PICKER_ID : undefined}
                  data-testid={`change-instrument-${track.id}`}
                >
                  {instrumentBadge}
                </button>
              ) : (
                <span
                  className={`track-instrument-badge${isMelodicTrack ? '' : ' unpitched'}`}
                  title={getInstrumentName(track.sampleId)}
                >
                  {instrumentBadge}
                </span>
              )}

              {/* Pitch toggle: docks this track in the editor dock under the
                  grid. A drum row keeps the slot so the lane toggle lines up. */}
              {isMelodicTrack ? (
                <button
                  className={`expand-toggle ${isDocked ? 'expanded' : ''}`}
                  onClick={onToggleDock}
                  title={isDocked ? 'Close pitch editor' : 'Edit pitch in the dock'}
                  aria-label={isDocked ? 'Close pitch editor' : 'Open pitch editor'}
                  aria-expanded={isDocked}
                  aria-controls={EDITOR_DOCK_ID}
                  data-dock-toggle={track.id}
                >
                  <span aria-hidden="true">♪</span>
                </button>
              ) : (
                <span className="track-control-slot" aria-hidden="true" />
              )}

              {/* Phase 31G: Velocity lane toggle */}
              <button
                className={`velocity-toggle ${isVelocityExpanded ? 'expanded' : ''}`}
                onClick={() => setIsVelocityExpanded(!isVelocityExpanded)}
                title="Velocity lane (visual dynamics editing)"
                aria-label="Velocity lane"
                aria-expanded={isVelocityExpanded}
                aria-controls={`velocity-panel-${track.id}`}
              >
                V
              </button>
            </div>
          </div>
        </div>

        {/* MIDDLE: Step grid - scrolls horizontally */}
        <div
          className={`steps ${isMelodicTrack && !isDocked ? 'steps-with-contour' : ''}`}
          onPointerMove={handleStepsPointerMove}
        >
          {(() => {
            // Calculate trackPlayingStep ONCE outside the map
            const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
            const trackPlayingStep = currentStep >= 0 ? currentStep % trackStepCount : -1;

            // Determine if track is audible (for playhead visibility)
            // Track is audible if: (no tracks soloed AND not muted) OR (some tracks soloed AND this one is soloed)
            const isAudible = anySoloed ? track.soloed : !track.muted;
            const showPlayhead = !HIDE_PLAYHEAD_ON_SILENT_TRACKS || isAudible;

            return track.steps.slice(0, trackStepCount).map((active, index) => {
              // Phase 31G: Dim steps outside loop region
              const isOutOfLoop = loopRegion != null && (index < loopRegion.start || index > loopRegion.end);

              return (
                <StepCell
                  key={index}
                  active={active}
                  playing={showPlayhead && trackPlayingStep === index}
                  stepIndex={index}
                  parameterLock={track.parameterLocks[index]}
                  disabled={readOnly}
                  rangeWarning={rangeWarnings?.[index] ?? null}
                  contour={stepContours?.[index] ?? null}
                  swing={swing}
                  selected={dockSelectedStep === index || (selectedSteps?.has(index) ?? false)}
                  isAnchor={selectionAnchor === index}
                  hasSelection={hasSelection}
                  dimmed={isOutOfLoop}
                  isPageEnd={(index + 1) % STEPS_PER_PAGE === 0 && index < trackStepCount - 1}
                  flashColor={remoteChanges?.getFlashColor(track.id, index)}
                  onClick={stepClickHandlers[index]}
                  onSelect={stepSelectHandlers[index]}
                  onSelectToggle={stepSelectToggleHandlers[index]}
                  onSelectExtend={stepSelectExtendHandlers[index]}
                  onPaintStart={stepPaintStartHandlers[index]}
                  onPaintEnter={stepPaintEnterHandlers[index]}
                />
              );
            });
          })()}
          {/* Pitch contour overlay for collapsed synth tracks */}
          {isMelodicTrack && !isDocked && (
            <PitchContour track={track} currentStep={currentStep} anySoloed={anySoloed} />
          )}
        </div>

        {/* RIGHT STICKY: Action buttons that stay fixed during horizontal scroll */}
        <div className="track-right">
          <div className="track-actions">
            {isCopyTarget ? (
              <button className="action-btn paste" onClick={onCopyTo} title="Paste pattern here">
                Paste
              </button>
            ) : (
              <>
                <button
                  className="action-btn"
                  onClick={onStartCopy}
                  disabled={!hasSteps}
                  title="Copy pattern"
                >
                  Copy
                </button>
                <button
                  className="action-btn"
                  onClick={onClear}
                  disabled={!hasSteps}
                  title="Clear all steps"
                >
                  Clear
                </button>
                {canDelete && (
                  <button
                    className="action-btn delete"
                    onClick={onDelete}
                    title="Delete track"
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        </div>

      </div>

      {/* Landscape mobile: TrackDrawer with Copy/Clear/Delete (accordion pattern) */}
      {orientationMode === 'landscape' && (
        <TrackDrawer
          isOpen={!!isLandscapeDrawerOpen}
          onClose={handleCloseLandscapeDrawer}
          trackId={track.id}
          trackName={track.name}
          transpose={track.transpose ?? 0}
          stepCount={track.stepCount ?? STEPS_PER_PAGE}
          volume={track.volume ?? 1}
          isMelodicTrack={isMelodicTrack}
          hasSteps={hasSteps}
          isPitchExpanded={isDocked}
          isVelocityExpanded={isVelocityExpanded}
          arePatternToolsVisible={showPatternTools}
          onTransposeChange={handleTransposeChange}
          onStepCountChange={(stepCount) => onSetStepCount?.(stepCount)}
          onVolumeChange={(volume) => onSetVolume?.(volume)}
          onExpandPitch={isMelodicTrack ? onToggleDock : undefined}
          onExpandVelocity={() => setIsVelocityExpanded(!isVelocityExpanded)}
          onShowPatternTools={() => setShowPatternTools(!showPatternTools)}
          instrumentName={getInstrumentName(track.sampleId)}
          isInstrumentPickerVisible={isInstrumentPickerOpen}
          onChangeInstrument={canChangeInstrument ? handleToggleInstrumentPicker : undefined}
          onCopy={onStartCopy}
          onClear={onClear}
          onDelete={onDelete}
          isCopyTarget={isCopyTarget}
          onPaste={isCopyTarget ? onCopyTo : undefined}
        />
      )}

      {/* Change instrument panel (issue #63), landscape only: the TrackDrawer's
          Instrument button opens it under the row. Desktop opens the same
          picker in the dock's Track pane. */}
      {canChangeInstrument && isLandscape && (
        <div
          id={`instrument-panel-${track.id}`}
          className={`panel-animation-container instrument-panel-container ${isInstrumentPickerOpen ? 'expanded' : ''}`}
          aria-hidden={!isInstrumentPickerOpen}
          inert={!isInstrumentPickerOpen}
        >
          <div className="panel-animation-content">
            {/* Mounted only while open. A closed panel must not leave ~100
                instrument buttons in the document: they would duplicate the
                Add Track picker's accessible names, so any query for an
                instrument by name would resolve into a zero-height panel
                instead of the add-track control. It also keeps a session with
                many tracks from rendering the whole catalog per track. */}
            {isInstrumentPickerOpen && (
              <SamplePicker
                variant="change"
                selectedSampleId={track.sampleId}
                onSelectSample={handleSelectInstrument}
                disabled={readOnly}
                previewsDisabled={readOnly}
              />
            )}
          </div>
        </div>
      )}

      {/* Phase 31G: Velocity lane panel - a row of cells, so it stays inline */}
      <div
        id={`velocity-panel-${track.id}`}
        className={`panel-animation-container ${isVelocityExpanded ? 'expanded' : ''}`}
        aria-hidden={!isVelocityExpanded}
        inert={!isVelocityExpanded}
      >
        <div className="panel-animation-content">
          <VelocityLane
            track={track}
            onSetParameterLock={onSetParameterLock ? onSetParameterLock : () => {}}
          />
        </div>
      </div>

      {/* Mobile: Edit panel toggle (always visible, expands on tap) */}
      <div
        className={`mobile-edit-panel ${isMenuOpen ? 'expanded' : ''}`}
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setIsMenuOpen(!isMenuOpen);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isMenuOpen}
        // InlineDrawer unmounts while closed; aria-controls must reference an
        // element that exists.
        aria-controls={isMenuOpen ? `inline-drawer-${track.id}` : undefined}
      >
        <span className="mobile-edit-hint">
          {isMenuOpen
            ? <><ChevronUp size={12} aria-hidden="true" /> collapse</>
            : <><ChevronDown size={12} aria-hidden="true" /> tap to edit</>}
        </span>
      </div>

      {/* Inline drawer - expands below track row (mobile swim lanes pattern) */}
      <InlineDrawer
        id={`inline-drawer-${track.id}`}
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
      >
        {/* Row 1: Mute/Solo buttons */}
        <div className="drawer-row">
          <span className="drawer-label">Track</span>
          <div className="drawer-toggle-group">
            <button
              className={`drawer-toggle-btn ${track.muted ? 'active muted' : ''}`}
              onClick={onToggleMute}
              title="Mute track"
              aria-label="Mute track"
              aria-pressed={track.muted}
            >
              M
            </button>
            <button
              className={`drawer-toggle-btn ${track.soloed ? 'active soloed' : ''}`}
              onClick={onToggleSolo}
              title="Solo track"
              aria-label="Solo track"
              aria-pressed={track.soloed}
            >
              S
            </button>
          </div>
        </div>

        {/* Row 2: Transpose */}
        <div className="drawer-row">
          <span className="drawer-label">Transpose</span>
          <div className="drawer-stepper">
            <button
              className="drawer-stepper-btn"
              onClick={() => handleTransposeChange((track.transpose ?? 0) - 1)}
              disabled={(track.transpose ?? 0) <= -24}
              aria-label="Transpose down"
            >
              <Minus size={14} aria-hidden="true" />
            </button>
            <span className={`drawer-stepper-value ${(track.transpose ?? 0) !== 0 ? 'active' : ''}`}>
              {(track.transpose ?? 0) > 0 ? '+' : ''}{track.transpose ?? 0}
            </span>
            <button
              className="drawer-stepper-btn"
              onClick={() => handleTransposeChange((track.transpose ?? 0) + 1)}
              disabled={(track.transpose ?? 0) >= 24}
              aria-label="Transpose up"
            >
              <Add size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Row 3: Step count */}
        <div className="drawer-row">
          <span className="drawer-label">Steps</span>
          <select
            className="drawer-select"
            value={track.stepCount ?? STEPS_PER_PAGE}
            onChange={(e) => onSetStepCount?.(Number(e.target.value))}
          >
            {STEP_COUNT_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>

        {/* Row 4: Volume */}
        <div className="drawer-row">
          <span className="drawer-label">Volume</span>
          <div className="drawer-slider-group">
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round((track.volume ?? 1) * 100)}
              onChange={(e) => handleTrackVolumeChange(Number(e.target.value) / 100)}
              className="drawer-volume-slider"
            />
            <span className="drawer-slider-value">{Math.round((track.volume ?? 1) * 100)}%</span>
          </div>
        </div>

        {/* Phase 31D: Per-track swing */}
        <div className="drawer-row">
          <span className="drawer-label">Swing</span>
          <div className="drawer-slider-group">
            <input
              type="range"
              min="0"
              max="100"
              value={track.swing ?? 0}
              onChange={(e) => handleTrackSwingChange(Number(e.target.value))}
              className="drawer-swing-slider"
            />
            <span className="drawer-slider-value">
              {`${track.swing ?? 0}%`}
            </span>
          </div>
        </div>

        <div className="drawer-divider" />

        {/* Phase 31B: Pattern Tools in mobile drawer */}
        <div className="drawer-row">
          <span className="drawer-label">Pattern</span>
          <div className="drawer-pattern-tools">
            <button
              className="drawer-pattern-btn"
              onClick={() => onRotatePattern?.('left')}
              title="Rotate left"
              aria-label="Rotate pattern left"
              disabled={!hasSteps}
            >
              ←
            </button>
            <button
              className="drawer-pattern-btn"
              onClick={() => onRotatePattern?.('right')}
              title="Rotate right"
              aria-label="Rotate pattern right"
              disabled={!hasSteps}
            >
              →
            </button>
            <button
              className="drawer-pattern-btn"
              onClick={() => onInvertPattern?.()}
              title="Invert"
              aria-label="Invert pattern"
            >
              Invert
            </button>
            <button
              className="drawer-pattern-btn"
              onClick={() => onReversePattern?.()}
              title="Reverse"
              aria-label="Reverse pattern"
              disabled={!hasSteps}
            >
              Reverse
            </button>
            <button
              className="drawer-pattern-btn"
              onClick={() => onMirrorPattern?.()}
              title="Smart Mirror"
              aria-label="Smart mirror pattern"
              disabled={!hasSteps || (track.stepCount ?? STEPS_PER_PAGE) <= 2}
            >
              Mirror
            </button>
          </div>
        </div>

        {/* Phase 31B: Euclidean slider in mobile drawer */}
        <div className="drawer-row">
          <span className="drawer-label">Euclidean</span>
          <div className="drawer-slider-group">
            <input
              type="range"
              className="drawer-euclidean-slider"
              min="0"
              max={track.stepCount ?? STEPS_PER_PAGE}
              value={activeStepCount}
              onChange={(e) => onEuclideanFill?.(Number(e.target.value))}
            />
            <span className="drawer-slider-value">{activeStepCount}/{track.stepCount ?? STEPS_PER_PAGE}</span>
          </div>
        </div>

        <div className="drawer-divider" />

        {/* Actions */}
        <div className="drawer-actions">
          {isCopyTarget ? (
            <button
              className="drawer-action-btn primary"
              onClick={() => {
                onCopyTo();
                setIsMenuOpen(false);
              }}
            >
              Paste
            </button>
          ) : (
            <>
              <button
                className="drawer-action-btn"
                onClick={() => {
                  onStartCopy();
                  setIsMenuOpen(false);
                }}
                disabled={!hasSteps}
              >
                Copy
              </button>
              <button
                className="drawer-action-btn"
                onClick={() => {
                  onClear();
                  setIsMenuOpen(false);
                }}
                disabled={!hasSteps}
              >
                Clear
              </button>
              {canDelete && (
                <button
                  className="drawer-action-btn destructive"
                  onClick={() => {
                    onDelete();
                    setIsMenuOpen(false);
                  }}
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </InlineDrawer>
    </div>
  );
});
