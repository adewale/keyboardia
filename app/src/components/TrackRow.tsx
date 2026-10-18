import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Track, ParameterLock, ScaleState, LoopRegion } from '../types';
import { STEPS_PER_PAGE, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { StepCell } from './StepCell';
import { computeStepContours } from './step-contour';
import { EDITOR_DOCK_ID } from './editor-dock-state';
import { DOCK_INSTRUMENT_PICKER_ID } from './DockPanes';
import { VelocityLane } from './VelocityLane';
import { TrackNameEditor } from './TrackNameEditor';
import { previewInstrument } from '../audio/audioTriggers';
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
import './VelocityLane.css';
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
  /** Copy mode tints: the row a copy started from, and the rows it can paste to. */
  isCopySource: boolean;
  isCopyTarget: boolean;
  readOnly?: boolean;
  onToggleStep: (step: number) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onSetParameterLock?: (step: number, lock: ParameterLock | null) => void;
  scale?: ScaleState; // Phase 29E: Scale state for Key Assistant
  // Phase 31D: Editing conveniences
  onSetName?: (name: string) => void;
  /**
   * Change instrument (issue #63). Absent for a published session, which is
   * what hides the control — the same mechanism that hides Delete. The badge
   * opens the picker in the dock (onToggleInstrumentPicker); landscape hides
   * the badge and reaches the same picker from the dock's Track pane.
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
  orientationMode?: 'portrait' | 'landscape' | 'desktop';
  /**
   * Editor dock (specs/PIANO-ROLL-DOCK.md). The pitch editor no longer opens
   * under the row: the row asks StepSequencer to dock it.
   * `isDocked` is true while the open dock shows this track.
   */
  isDocked?: boolean;
  /** The pitch toggle: dock this track, or close the dock if it already shows it. */
  onToggleDock?: () => void;
  /** Clicking a track's name on desktop: dock this track (never closes). */
  onOpenDock?: () => void;
  /** True while the open dock shows this track's Track pane. */
  isTrackPaneDocked?: boolean;
  /**
   * Tapping a track's name in landscape: the dock's Track pane for this
   * track, or close it if it already shows (the landscape drawer's toggle).
   */
  onToggleTrackPane?: () => void;
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
  isCopySource,
  isCopyTarget,
  readOnly = false,
  onToggleStep,
  onToggleMute,
  onToggleSolo,
  onSetParameterLock,
  scale,
  onSetName,
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
  isDocked = false,
  onToggleDock,
  onOpenDock,
  isTrackPaneDocked = false,
  onToggleTrackPane,
  dockSelectedStep = null,
  onSelectDockStep,
}: TrackRowProps) {
  // Phase 31G: Velocity lane visibility
  const [isVelocityExpanded, setIsVelocityExpanded] = useState(false);
  // NOTE: Track name editing state moved to TrackNameEditor component
  // Phase 31G FIX: Track if pointerdown originated on drag handle
  // HTML5 DnD e.target is always the [draggable] element, not the clicked child
  const dragHandleClickedRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const remoteChanges = useRemoteChanges();

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

  // Change instrument (issue #63): the badge opens the picker in the dock.
  const canChangeInstrument = !!onSetInstrument && !readOnly;
  const isLandscape = orientationMode === 'landscape';

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
              // Landscape: the name discloses the dock's Track pane, which
              // holds the controls the row has no room for. The dock is
              // always in the document (inert while closed).
              onClickOverride={isLandscape ? onToggleTrackPane : undefined}
              disclosureExpanded={isLandscape ? isTrackPaneDocked : undefined}
              disclosureControls={isLandscape ? EDITOR_DOCK_ID : undefined}
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
          className="steps"
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
        </div>

      </div>

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

    </div>
  );
});
