import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Track, ParameterLock, FMParams, ScaleState, LoopRegion } from '../types';
import { STEPS_PER_PAGE, STEP_COUNT_OPTIONS, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { StepCell } from './StepCell';
import { Add, ChevronDown, ChevronUp, Minus } from '../icons';
import { ChromaticGrid, PitchContour } from './ChromaticGrid';
import { PianoRoll } from './PianoRoll';
import { VelocityLane } from './VelocityLane';
import { InlineDrawer } from './InlineDrawer';
import { TrackDrawer } from './TrackDrawer';
import { StepCountDropdown } from './StepCountDropdown';
import { TransposeDropdown } from './TransposeDropdown';
import { ParameterLockEditor } from './ParameterLockEditor';
import { TrackNameEditor } from './TrackNameEditor';
import { PatternToolsPanel } from './PatternToolsPanel';
import { SamplePicker } from './SamplePicker';
import { previewInstrument } from '../audio/audioTriggers';
import { clamp } from '../shared/validation';
import { useRemoteChanges } from '../context/RemoteChangeContext';
import { getInstrumentCategory, getInstrumentName, TONE_SYNTH_CATEGORIES, SAMPLED_CATEGORIES } from './sample-constants';
import { getTransposedRoot, type NoteName } from '../music/music-theory';
import { isInRange, isInOptimalRange } from '../audio/instrument-ranges';
import { features } from '../config/features';
import './TrackRow.css';
import './ChromaticGrid.css';
import './PianoRoll.css';
import './VelocityLane.css';
import './InlineDrawer.css';
import './TrackDrawer.css';
import './StepCountDropdown.css';
import './TransposeDropdown.css';

/**
 * Check if an instrument is melodic (should show chromatic/keyboard view)
 * Melodic instruments can play different pitches, percussive instruments cannot
 */
function isMelodicInstrument(sampleId: string): boolean {
  // All synth: prefixed instruments are melodic
  if (sampleId.startsWith('synth:')) return true;
  // All advanced: prefixed instruments are melodic
  if (sampleId.startsWith('advanced:')) return true;
  // Sampled instruments - melodic unless in drums category
  if (sampleId.startsWith('sampled:')) {
    // Use shared drum list from sample-constants
    return !SAMPLED_CATEGORIES.drums.includes(sampleId as typeof SAMPLED_CATEGORIES.drums[number]);
  }
  // Tone.js synths - some are melodic, some are drums
  if (sampleId.startsWith('tone:')) {
    // Use shared drum synth list from sample-constants
    return !TONE_SYNTH_CATEGORIES.drum.some((d: string) => sampleId === `tone:${d}`);
  }
  // Regular samples (kick, snare, etc.) are percussive, not melodic
  return false;
}

/**
 * Check if an instrument is an FM synth (has harmonicity/modulationIndex params)
 */
function isFMSynth(sampleId: string): boolean {
  return sampleId.startsWith('tone:fm-');
}

/**
 * Default FM params for each FM preset (based on toneSynths.ts presets)
 */
const FM_PRESET_DEFAULTS: Record<string, FMParams> = {
  'tone:fm-epiano': { harmonicity: 3.01, modulationIndex: 10 },
  'tone:fm-bass': { harmonicity: 2, modulationIndex: 8 },
  'tone:fm-bell': { harmonicity: 5.01, modulationIndex: 14 },
};

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
  onSetFMParams?: (fmParams: FMParams) => void;
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
   * what hides the control — the same mechanism that hides Delete.
   */
  onSetInstrument?: (sampleId: string) => void;
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
  onSetFMParams,
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
}: TrackRowProps) {
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  // Phase 31H: Toggle between chromatic grid and full piano roll view
  const [pitchViewMode, setPitchViewMode] = useState<'chromatic' | 'piano-roll'>('chromatic');
  // Phase 31G: Velocity lane visibility
  const [isVelocityExpanded, setIsVelocityExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showPatternTools, setShowPatternTools] = useState(false);
  // Change instrument (issue #63): the picker panel below this row.
  const [showInstrumentPicker, setShowInstrumentPicker] = useState(false);
  // Phase 31F: Drag-to-paint state
  // 'on' = painting active steps, 'off' = painting inactive steps, null = not painting
  const [paintMode, setPaintMode] = useState<'on' | 'off' | null>(null);
  // BUG FIX: Use ref to avoid stale closures in global listener
  const paintModeRef = useRef<'on' | 'off' | null>(null);
  useEffect(() => { paintModeRef.current = paintMode; }, [paintMode]);
  // Track last painted step to avoid duplicate toggles during fast drag
  const lastPaintedStepRef = useRef<number | null>(null);
  // NOTE: Track name editing state moved to TrackNameEditor component
  // Phase 31G FIX: Track if pointerdown originated on drag handle
  // HTML5 DnD e.target is always the [draggable] element, not the clicked child
  const dragHandleClickedRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const remoteChanges = useRemoteChanges();

  // Phase 31B: Calculate active step count for Euclidean slider
  const activeStepCount = useMemo(() => {
    const stepCount = track.stepCount ?? STEPS_PER_PAGE;
    return track.steps.slice(0, stepCount).filter(Boolean).length;
  }, [track.steps, track.stepCount]);

  // Check if this is a melodic track (can use chromatic/keyboard view)
  const isMelodicTrack = isMelodicInstrument(track.sampleId);

  // Phase 31C: Get instrument category for color coding
  const instrumentCategory = useMemo(() => {
    return getInstrumentCategory(track.sampleId) || 'fx';
  }, [track.sampleId]);

  // Phase 31H: Calculate effective key for Per-Track Key Display
  const effectiveKey = useMemo(() => {
    if (!scale || !isMelodicInstrument(track.sampleId)) return null;
    const transpose = track.transpose ?? 0;
    if (transpose === 0) return null; // Don't show badge if no transpose
    return getTransposedRoot(scale.root as NoteName, transpose);
  }, [scale, track.sampleId, track.transpose]);

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

  // Get current p-lock for selected step
  const selectedLock = selectedStep !== null ? track.parameterLocks[selectedStep] : null;

  // NOTE: Click-outside handling for p-lock editor moved to ParameterLockEditor component

  const handleStepSelect = useCallback((step: number) => {
    if (!track.steps[step]) return;
    setSelectedStep(prev => prev === step ? null : step);
  }, [track.steps]);

  // Memoized step click handlers to prevent StepCell re-renders
  const stepClickHandlers = useMemo(() => {
    const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
    return Array.from({ length: trackStepCount }, (_, i) => () => onToggleStep(i));
  }, [track.stepCount, onToggleStep]);

  const stepSelectHandlers = useMemo(() => {
    const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
    return Array.from({ length: trackStepCount }, (_, i) => () => handleStepSelect(i));
  }, [track.stepCount, handleStepSelect]);

  const handlePitchChange = useCallback(async (pitch: number) => {
    if (selectedStep === null || !onSetParameterLock) return;
    const currentLock = track.parameterLocks[selectedStep];
    onSetParameterLock(selectedStep, { ...currentLock, pitch: pitch === 0 ? undefined : pitch });

    // Preview sound (only if audio already loaded - don't block for slider)
    await previewInstrument('preview_pitch', {
      sampleId: track.sampleId,
      previewId: `preview-${track.id}`,
      pitch,
    });
  }, [selectedStep, track.parameterLocks, track.sampleId, track.id, onSetParameterLock]);

  const handleVolumeChange = useCallback((volume: number) => {
    if (selectedStep === null || !onSetParameterLock) return;
    const currentLock = track.parameterLocks[selectedStep];
    onSetParameterLock(selectedStep, { ...currentLock, volume: volume === 1 ? undefined : volume });
  }, [selectedStep, track.parameterLocks, onSetParameterLock]);

  const dismissParameterLockEditor = useCallback((restoreFocus: boolean) => {
    const stepToRestore = selectedStep;
    setSelectedStep(null);

    // Clear is an editor-owned action, so its caller explicitly requests
    // restoration. Do not infer this from activeElement: Safari may blur a
    // button before dispatching click.
    if (restoreFocus && stepToRestore !== null) {
      requestAnimationFrame(() => {
        wrapperRef.current
          ?.querySelector<HTMLButtonElement>(`[data-step-index="${stepToRestore}"]`)
          ?.focus();
      });
    }
  }, [selectedStep]);

  const handleDismissParameterLockEditor = useCallback(() => {
    // Outside pointer dismissal must leave focus on the newly selected control.
    dismissParameterLockEditor(false);
  }, [dismissParameterLockEditor]);

  const handleClearLock = useCallback(() => {
    if (selectedStep === null || !onSetParameterLock) return;
    onSetParameterLock(selectedStep, null);
    dismissParameterLockEditor(true);
  }, [selectedStep, onSetParameterLock, dismissParameterLockEditor]);

  // Phase 29B: Handle tie toggle
  const handleTieToggle = useCallback(() => {
    if (selectedStep === null || !onSetParameterLock) return;
    const currentLock = track.parameterLocks[selectedStep];
    const newTie = !currentLock?.tie;
    onSetParameterLock(selectedStep, { ...currentLock, tie: newTie || undefined });
  }, [selectedStep, track.parameterLocks, onSetParameterLock]);

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

  // Get current FM params (use preset defaults if not set)
  const currentFMParams = useMemo(() => {
    return track.fmParams ?? FM_PRESET_DEFAULTS[track.sampleId] ?? { harmonicity: 3, modulationIndex: 10 };
  }, [track.fmParams, track.sampleId]);

  const handleHarmonicityChange = useCallback((harmonicity: number) => {
    if (!onSetFMParams) return;
    onSetFMParams({ ...currentFMParams, harmonicity });
  }, [onSetFMParams, currentFMParams]);

  const handleModulationIndexChange = useCallback((modulationIndex: number) => {
    if (!onSetFMParams) return;
    onSetFMParams({ ...currentFMParams, modulationIndex });
  }, [onSetFMParams, currentFMParams]);

  // Check if this is an FM synth track
  const showFMControls = isFMSynth(track.sampleId);

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

  // Change instrument (issue #63). Committing closes the picker and every
  // drawer that could have opened it, so the person sees the result.
  const canChangeInstrument = !!onSetInstrument && !readOnly;

  const handleToggleInstrumentPicker = useCallback(() => {
    setShowInstrumentPicker(open => !open);
  }, []);

  const handleSelectInstrument = useCallback((sampleId: string) => {
    onSetInstrument?.(sampleId);
    setShowInstrumentPicker(false);
    setIsMenuOpen(false);
  }, [onSetInstrument]);

  // Derived rather than stored, so a session that becomes read-only while the
  // picker is open closes it without an effect that re-renders to catch up.
  const isInstrumentPickerOpen = canChangeInstrument && showInstrumentPicker;

  // Phase 31F: Drag-to-paint handlers
  // Start painting: determine paint mode from first step's toggled state
  const handlePaintStart = useCallback((stepIndex: number) => {
    const wasActive = track.steps[stepIndex];
    const newState = !wasActive;

    // Always toggle the clicked step
    onToggleStep(stepIndex);
    lastPaintedStepRef.current = stepIndex;

    // Only enable drag continuation if advanced input is on
    if (features.advancedStepInput) {
      setPaintMode(newState ? 'on' : 'off');
    }
  }, [track.steps, onToggleStep]);

  // Continue painting: apply paint mode to entered step
  // Uses paintModeRef to avoid stale closure issues with paint mode
  const handlePaintEnter = useCallback((stepIndex: number) => {
    // No drag painting when advanced input is disabled
    if (!features.advancedStepInput) return;

    const currentPaintMode = paintModeRef.current;
    if (currentPaintMode === null) return;

    // Skip if we already painted this step (fast drag protection)
    if (stepIndex === lastPaintedStepRef.current) return;

    const isActive = track.steps[stepIndex];
    const shouldBeActive = currentPaintMode === 'on';
    if (isActive !== shouldBeActive) {
      onToggleStep(stepIndex);
      lastPaintedStepRef.current = stepIndex;
    }
  }, [track.steps, onToggleStep]);

  // Container-level pointer move for fast drag detection
  // Fallback in case individual pointerenter events are missed during fast dragging
  const handleStepsPointerMove = useCallback((e: React.PointerEvent) => {
    const currentPaintMode = paintModeRef.current;
    if (currentPaintMode === null) return;
    if (!features.advancedStepInput) return;

    // Hit-test to find which step we're over
    const target = e.target as HTMLElement;
    const stepCell = target.closest('.step-cell') as HTMLElement | null;
    if (!stepCell) return;

    // Get step index from data attribute
    const stepIndex = parseInt(stepCell.getAttribute('data-step-index') || '-1', 10);
    if (stepIndex < 0 || stepIndex === lastPaintedStepRef.current) return;

    const isActive = track.steps[stepIndex];
    const shouldBeActive = currentPaintMode === 'on';
    if (isActive !== shouldBeActive) {
      onToggleStep(stepIndex);
      lastPaintedStepRef.current = stepIndex;
    }
  }, [track.steps, onToggleStep]);

  // Phase 31F: Memoized paint handlers for each step (must be after callback definitions)
  const stepPaintStartHandlers = useMemo(() => {
    const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
    return Array.from({ length: trackStepCount }, (_, i) => () => handlePaintStart(i));
  }, [track.stepCount, handlePaintStart]);

  const stepPaintEnterHandlers = useMemo(() => {
    const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
    return Array.from({ length: trackStepCount }, (_, i) => () => handlePaintEnter(i));
  }, [track.stepCount, handlePaintEnter]);

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

  // Phase 31F: Global pointer up listener to end drag-to-paint
  // BUG FIX: Register listener once on mount, not on each paintMode change
  // This prevents listener accumulation and race conditions
  useEffect(() => {
    const handlePointerUp = () => {
      // Only clear if we're actually painting (use ref to avoid stale closure)
      if (paintModeRef.current !== null) {
        setPaintMode(null);
        lastPaintedStepRef.current = null; // Reset on paint end
      }
    };

    // Listen on document to catch pointer up anywhere
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    return () => {
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []); // Empty deps - register once on mount

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
  ].filter(Boolean).join(' ');

  return (
    <div
      className={wrapperClasses}
      ref={wrapperRef}
      draggable
      onDragStart={handleDragStart}
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
        {/* LEFT STICKY: Controls that stay fixed during horizontal scroll */}
        <div className="track-left">
          {/* Phase 31G: Drag handle for track reordering */}
          <span
            className="track-drag-handle"
            title="Drag to reorder"
            aria-label="Drag to reorder track"
            onPointerDown={handleDragHandlePointerDown}
          >
            ⠿
          </span>
          {/* Track name - click to preview, double-click to rename */}
          <TrackNameEditor
            name={track.name}
            instrumentName={getInstrumentName(track.sampleId)}
            sampleId={track.sampleId}
            canRename={!!onSetName}
            onSave={(name) => onSetName?.(name)}
            onPreview={handleNamePreview}
            onClickOverride={orientationMode === 'landscape' ? onToggleLandscapeDrawer : undefined}
            disclosureExpanded={orientationMode === 'landscape' ? !!isLandscapeDrawerOpen : undefined}
            // TrackDrawer unmounts while closed, so only point aria-controls at
            // it while it actually exists.
            disclosureControls={orientationMode === 'landscape' && isLandscapeDrawerOpen ? `track-drawer-${track.id}` : undefined}
          />
          {/* Mute + Solo buttons (directly in grid) */}
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

          {/* Pitch/Step control group: [Transpose] [Key] [Steps] - logically grouped */}
          <div className="track-pitch-step-group">
            <TransposeDropdown
              value={track.transpose ?? 0}
              onChange={handleTransposeChange}
              disabled={!onSetTranspose}
            />
            {/* Key badge - render for melodic tracks, empty placeholder for percussion */}
            {isMelodicTrack ? (
              <span
                className={`track-key-badge ${effectiveKey ? 'active' : 'placeholder'}`}
                title={effectiveKey
                  ? `Effective root: ${effectiveKey} (transposed ${(track.transpose ?? 0) > 0 ? '+' : ''}${track.transpose ?? 0} from ${scale?.root})`
                  : 'Key badge (shows effective root when transposed)'
                }
              >
                {effectiveKey || '—'}
              </span>
            ) : (
              /* Empty placeholder to maintain grid regularity for non-melodic tracks */
              <span className="track-key-badge placeholder-empty" aria-hidden="true" />
            )}
            <StepCountDropdown
              value={track.stepCount ?? STEPS_PER_PAGE}
              onChange={(value) => onSetStepCount?.(value)}
              disabled={!onSetStepCount}
            />
          </div>

          {/* Expand toggle (directly in grid - cell exists even when empty) */}
          {isMelodicTrack && (
            <button
              className={`expand-toggle ${isExpanded ? 'expanded' : ''}`}
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? 'Collapse pitch view' : 'Expand pitch view'}
              aria-label={isExpanded ? 'Collapse pitch view' : 'Expand pitch view'}
              aria-expanded={isExpanded}
              aria-controls={`pitch-panel-${track.id}`}
            >
              {isExpanded ? <ChevronDown size={16} aria-hidden="true" /> : (
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  {/* Piano keys icon - 3 white keys with 2 black keys */}
                  <rect x="2" y="6" width="6" height="12" fill="#aaa" stroke="#666" strokeWidth="0.5" rx="1"/>
                  <rect x="9" y="6" width="6" height="12" fill="#aaa" stroke="#666" strokeWidth="0.5" rx="1"/>
                  <rect x="16" y="6" width="6" height="12" fill="#aaa" stroke="#666" strokeWidth="0.5" rx="1"/>
                  <rect x="6" y="6" width="4" height="7" fill="#333" rx="1"/>
                  <rect x="14" y="6" width="4" height="7" fill="#333" rx="1"/>
                </svg>
              )}
            </button>
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
            ▎
          </button>
          {/* Change instrument toggle (issue #63). Hidden in landscape by CSS;
              that mode opens the same panel from the TrackDrawer instead. */}
          {canChangeInstrument && (
            <button
              className={`instrument-toggle ${isInstrumentPickerOpen ? 'active' : ''}`}
              onClick={handleToggleInstrumentPicker}
              title={`Change instrument (currently ${getInstrumentName(track.sampleId)})`}
              aria-label="Change instrument"
              aria-expanded={isInstrumentPickerOpen}
              aria-controls={isInstrumentPickerOpen ? `instrument-panel-${track.id}` : undefined}
              data-testid={`change-instrument-${track.id}`}
            >
              ♪
            </button>
          )}
          {/* Pattern tools toggle (directly in grid) */}
          <button
            className={`pattern-tools-toggle ${showPatternTools ? 'active' : ''}`}
            onClick={() => setShowPatternTools(!showPatternTools)}
            title="Pattern tools (rotate, invert, reverse, smart mirror, Euclidean)"
            aria-label="Pattern tools"
            aria-expanded={showPatternTools}
            aria-controls={`pattern-tools-panel-${track.id}`}
          >
            ⚙
          </button>
        </div>

        {/* MIDDLE: Step grid - scrolls horizontally */}
        <div
          className={`steps ${isMelodicTrack && !isExpanded ? 'steps-with-contour' : ''}`}
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
                  swing={swing}
                  selected={selectedStep === index || (selectedSteps?.has(index) ?? false)}
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
          {isMelodicTrack && !isExpanded && (
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
          isPitchExpanded={isExpanded}
          isVelocityExpanded={isVelocityExpanded}
          arePatternToolsVisible={showPatternTools}
          onTransposeChange={handleTransposeChange}
          onStepCountChange={(stepCount) => onSetStepCount?.(stepCount)}
          onVolumeChange={(volume) => onSetVolume?.(volume)}
          onExpandPitch={isMelodicTrack ? () => setIsExpanded(!isExpanded) : undefined}
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

      {/* Change instrument panel (issue #63) - appears below the track row.
          Shared by desktop (♪ toggle), the mobile drawer's Instrument row, and
          the landscape TrackDrawer's Instrument button, so all three surfaces
          browse one picker over one catalog. */}
      {canChangeInstrument && (
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

      {/* Phase 31B: Pattern tools panel - appears below track row when toggled */}
      <div
        id={`pattern-tools-panel-${track.id}`}
        className={`panel-animation-container ${showPatternTools ? 'expanded' : ''}`}
        aria-hidden={!showPatternTools}
        inert={!showPatternTools}
      >
        <div className="panel-animation-content">
          <PatternToolsPanel
            hasSteps={hasSteps}
            stepCount={track.stepCount ?? STEPS_PER_PAGE}
            activeStepCount={activeStepCount}
            swing={track.swing ?? 0}
            onRotate={onRotatePattern}
            onInvert={onInvertPattern}
            onReverse={onReversePattern}
            onMirror={onMirrorPattern}
            onEuclideanFill={onEuclideanFill}
            onSwingChange={onSetTrackSwing}
          />
        </div>
      </div>

      {/* Phase 31G: Velocity lane panel - appears below pattern tools when toggled */}
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

        {/* Change instrument (issue #63) - opens the shared picker panel */}
        {canChangeInstrument && (
          <div className="drawer-row">
            <span className="drawer-label">Instrument</span>
            <button
              className={`drawer-instrument-btn ${isInstrumentPickerOpen ? 'active' : ''}`}
              onClick={handleToggleInstrumentPicker}
              aria-expanded={isInstrumentPickerOpen}
              aria-controls={isInstrumentPickerOpen ? `instrument-panel-${track.id}` : undefined}
              data-testid={`drawer-change-instrument-${track.id}`}
            >
              {getInstrumentName(track.sampleId)}
              {isInstrumentPickerOpen
                ? <ChevronUp size={12} aria-hidden="true" />
                : <ChevronDown size={12} aria-hidden="true" />}
            </button>
          </div>
        )}

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

      {/* FM Synthesis controls - shown for FM synth tracks */}
      {showFMControls && onSetFMParams && (
        <div className="fm-controls-panel">
          <div className="fm-control">
            <span className="fm-label">Harmonicity</span>
            <input
              type="range"
              min="0.5"
              max="10"
              step="0.1"
              value={currentFMParams.harmonicity}
              onChange={(e) => handleHarmonicityChange(Number(e.target.value))}
              className="fm-slider"
            />
            <span className="fm-value">{currentFMParams.harmonicity.toFixed(1)}×</span>
          </div>
          <div className="fm-control">
            <span className="fm-label">Mod Index</span>
            <input
              type="range"
              min="0"
              max="20"
              step="0.5"
              value={currentFMParams.modulationIndex}
              onChange={(e) => handleModulationIndexChange(Number(e.target.value))}
              className="fm-slider"
            />
            <span className="fm-value">{currentFMParams.modulationIndex.toFixed(1)}</span>
          </div>
        </div>
      )}

      {/* Pitch view - expanded chromatic grid or piano roll for synth tracks */}
      {isMelodicTrack && onSetParameterLock && (
        <div
          id={`pitch-panel-${track.id}`}
          className={`panel-animation-container ${isExpanded ? 'expanded' : ''}`}
          aria-hidden={!isExpanded}
          inert={!isExpanded}
        >
          <div className="panel-animation-content">
            {/* View mode toggle */}
            <div className="pitch-view-header">
              <div className="pitch-view-tabs">
                <button
                  className={`pitch-view-tab ${pitchViewMode === 'chromatic' ? 'active' : ''}`}
                  onClick={() => setPitchViewMode('chromatic')}
                  title="Chromatic Grid - compact pitch offset view"
                >
                  Grid
                </button>
                <button
                  className={`pitch-view-tab ${pitchViewMode === 'piano-roll' ? 'active' : ''}`}
                  onClick={() => setPitchViewMode('piano-roll')}
                  title="Piano Roll - full MIDI note view"
                >
                  Piano Roll
                </button>
              </div>
            </div>

            {/* Render the selected view */}
            {pitchViewMode === 'chromatic' ? (
              <ChromaticGrid
                track={track}
                currentStep={currentStep}
                anySoloed={anySoloed}
                onSetParameterLock={onSetParameterLock}
                onToggleStep={onToggleStep}
                scale={scale}
              />
            ) : (
              <PianoRoll
                track={track}
                currentStep={currentStep}
                anySoloed={anySoloed}
                onSetParameterLock={onSetParameterLock}
                onToggleStep={onToggleStep}
                scale={scale}
              />
            )}
          </div>
        </div>
      )}

      {/* Inline parameter lock editor - appears when step selected */}
      {selectedStep !== null && track.steps[selectedStep] && (
        <ParameterLockEditor
          step={selectedStep}
          lock={selectedLock}
          onPitchChange={handlePitchChange}
          onVolumeChange={handleVolumeChange}
          onTieToggle={handleTieToggle}
          onClearLock={handleClearLock}
          onDismiss={handleDismissParameterLockEditor}
          sampleId={track.sampleId}
          transpose={track.transpose ?? 0}
        />
      )}
    </div>
  );
});
