import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Track, ParameterLock, FMParams, ScaleState, LoopRegion } from '../types';
import { STEPS_PER_PAGE, STEP_COUNT_OPTIONS, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { StepCell } from './StepCell';
import { ChromaticGrid, PitchContour } from './ChromaticGrid';
import { PianoRoll } from './PianoRoll';
import { InlineDrawer } from './InlineDrawer';
import { StepCountDropdown } from './StepCountDropdown';
import { TransposeDropdown } from './TransposeDropdown';
import { tryGetEngineForPreview } from '../audio/audioTriggers';
import { useRemoteChanges } from '../context/RemoteChangeContext';
import { getInstrumentCategory, getInstrumentName, TONE_SYNTH_CATEGORIES, SAMPLED_CATEGORIES } from './sample-constants';
import { getTransposedRoot, type NoteName } from '../music/music-theory';
import './TrackRow.css';
import './ChromaticGrid.css';
import './PianoRoll.css';
import './InlineDrawer.css';
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
  currentStep: number;
  swing: number;
  anySoloed: boolean;
  hasSteps: boolean;
  canDelete: boolean;
  isCopySource: boolean;
  isCopyTarget: boolean;
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
  // Phase 31F: Multi-select support
  selectedSteps?: Set<number>; // Set of selected step indices for this track
  selectionAnchor?: number | null; // Anchor step for Shift+extend
  hasSelection?: boolean; // Whether any selection exists (affects Shift+click behavior)
  onSelectStep?: (step: number, mode: 'toggle' | 'extend') => void;
  // Phase 31G: Loop region support
  loopRegion?: LoopRegion | null; // Current loop region (steps outside are dimmed)
}

// Phase 21.5: Wrap in React.memo for performance optimization
// TrackRow receives many callbacks that are stable (useCallback in parent),
// so memo will skip re-renders when only sibling tracks change
export const TrackRow = React.memo(function TrackRow({
  track,
  currentStep,
  swing,
  anySoloed,
  hasSteps,
  canDelete,
  isCopySource,
  isCopyTarget,
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
  selectedSteps,
  selectionAnchor,
  hasSelection,
  onSelectStep,
  loopRegion,
}: TrackRowProps) {
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  // Phase 31H: Toggle between chromatic grid and full piano roll view
  const [pitchViewMode, setPitchViewMode] = useState<'chromatic' | 'piano-roll'>('chromatic');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showPatternTools, setShowPatternTools] = useState(false);
  // Phase 31F: Drag-to-paint state
  // 'on' = painting active steps, 'off' = painting inactive steps, null = not painting
  const [paintMode, setPaintMode] = useState<'on' | 'off' | null>(null);
  // BUG FIX: Use ref to avoid stale closures in global listener
  const paintModeRef = useRef<'on' | 'off' | null>(null);
  useEffect(() => { paintModeRef.current = paintMode; }, [paintMode]);
  // Phase 31D: Track name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const nameClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const plockRef = useRef<HTMLDivElement>(null);
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

  // Get current p-lock for selected step
  const selectedLock = selectedStep !== null ? track.parameterLocks[selectedStep] : null;

  // Auto-dismiss p-lock editor when clicking outside
  // Use a ref to store the handler so cleanup always has access to the correct function
  const clickOutsideHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);

  useEffect(() => {
    if (selectedStep === null) {
      // Clean up any existing listener when deselecting
      if (clickOutsideHandlerRef.current) {
        document.removeEventListener('mousedown', clickOutsideHandlerRef.current);
        clickOutsideHandlerRef.current = null;
      }
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (plockRef.current && !plockRef.current.contains(e.target as Node)) {
        setSelectedStep(null);
      }
    };

    clickOutsideHandlerRef.current = handleClickOutside;

    // Delay to avoid immediate dismissal when opening (the shift+click that opens it)
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      clickOutsideHandlerRef.current = null;
    };
  }, [selectedStep]);

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
    const audioEngine = await tryGetEngineForPreview('preview_pitch');
    if (audioEngine) {
      const time = audioEngine.getCurrentTime();
      audioEngine.playSample(track.sampleId, `preview-${track.id}`, time, undefined, pitch);
    }
  }, [selectedStep, track.parameterLocks, track.sampleId, track.id, onSetParameterLock]);

  const handleVolumeChange = useCallback((volume: number) => {
    if (selectedStep === null || !onSetParameterLock) return;
    const currentLock = track.parameterLocks[selectedStep];
    onSetParameterLock(selectedStep, { ...currentLock, volume: volume === 1 ? undefined : volume });
  }, [selectedStep, track.parameterLocks, onSetParameterLock]);

  const handleClearLock = useCallback(() => {
    if (selectedStep === null || !onSetParameterLock) return;
    onSetParameterLock(selectedStep, null);
    setSelectedStep(null); // Close the panel after clearing
  }, [selectedStep, onSetParameterLock]);

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
    const audioEngine = await tryGetEngineForPreview('preview_transpose');
    if (audioEngine) {
      const time = audioEngine.getCurrentTime();
      const isSynth = track.sampleId.startsWith('synth:');
      if (isSynth) {
        const preset = track.sampleId.replace('synth:', '');
        audioEngine.playSynthNote(`preview-${track.id}`, preset, safeTranspose, time, 0.2);
      } else {
        audioEngine.playSample(track.sampleId, `preview-${track.id}`, time, undefined, safeTranspose);
      }
    }
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
    onSetVolume(Math.max(0, Math.min(1, volume)));
  }, [onSetVolume]);

  // Phase 31D: Handle per-track swing changes
  const handleTrackSwingChange = useCallback((trackSwing: number) => {
    if (!onSetTrackSwing) return;
    onSetTrackSwing(Math.max(0, Math.min(100, trackSwing)));
  }, [onSetTrackSwing]);

  // Phase 31F: Drag-to-paint handlers
  // Start painting: determine paint mode from first step's toggled state
  const handlePaintStart = useCallback((stepIndex: number) => {
    const wasActive = track.steps[stepIndex];
    const newState = !wasActive;
    setPaintMode(newState ? 'on' : 'off');
    onToggleStep(stepIndex);
  }, [track.steps, onToggleStep]);

  // Continue painting: apply paint mode to entered step
  // Uses paintModeRef to avoid stale closure issues with paint mode
  const handlePaintEnter = useCallback((stepIndex: number) => {
    const currentPaintMode = paintModeRef.current;
    if (currentPaintMode === null) return;
    const isActive = track.steps[stepIndex];
    const shouldBeActive = currentPaintMode === 'on';
    if (isActive !== shouldBeActive) {
      onToggleStep(stepIndex);
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

  // Phase 31D: Preview sound on single click (desktop)
  // TODO: This preview is broken for synth instruments (calls playSample instead of playSynthNote).
  // Clicking a track name should play that track's instrument in isolation.
  // See transpose preview (lines ~252) for the correct pattern that distinguishes synth vs sample.
  const handleNameClick = useCallback(async () => {
    // Clear any pending double-click timer
    if (nameClickTimerRef.current) {
      clearTimeout(nameClickTimerRef.current);
      nameClickTimerRef.current = null;
    }

    // 200ms delay to distinguish from double-click
    nameClickTimerRef.current = setTimeout(async () => {
      nameClickTimerRef.current = null;
      // Preview the track sound
      const audioEngine = await tryGetEngineForPreview('preview_transpose');
      if (audioEngine) {
        const time = audioEngine.getCurrentTime();
        // Determine preview behavior based on instrument type
        const isSustained = track.sampleId.startsWith('synth:') ||
                          track.sampleId.startsWith('advanced:') ||
                          track.sampleId.includes('pad') ||
                          track.sampleId.includes('string') ||
                          track.sampleId.includes('rhodes');
        const duration = isSustained ? 0.3 : undefined;
        audioEngine.playSample(track.sampleId, `preview-${track.id}`, time, duration, track.transpose ?? 0);
      }
    }, 200);
  }, [track.sampleId, track.id, track.transpose]);

  // Phase 31D: Start rename on double-click (desktop)
  const handleNameDoubleClick = useCallback(() => {
    // Cancel preview timer
    if (nameClickTimerRef.current) {
      clearTimeout(nameClickTimerRef.current);
      nameClickTimerRef.current = null;
    }
    // Start editing
    setEditingName(track.name);
    setIsEditingName(true);
  }, [track.name]);

  // Phase 31D: Save name on Enter or blur
  const handleNameSave = useCallback(() => {
    if (onSetName && editingName.trim()) {
      onSetName(editingName.trim());
    }
    setIsEditingName(false);
    setEditingName('');
  }, [editingName, onSetName]);

  // Phase 31D: Cancel edit on Escape
  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNameSave();
    } else if (e.key === 'Escape') {
      setIsEditingName(false);
      setEditingName('');
    }
  }, [handleNameSave]);

  // Phase 31D: Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (nameClickTimerRef.current) {
        clearTimeout(nameClickTimerRef.current);
      }
    };
  }, []);

  // Phase 31F: Global pointer up listener to end drag-to-paint
  // BUG FIX: Register listener once on mount, not on each paintMode change
  // This prevents listener accumulation and race conditions
  useEffect(() => {
    const handlePointerUp = () => {
      // Only clear if we're actually painting (use ref to avoid stale closure)
      if (paintModeRef.current !== null) {
        setPaintMode(null);
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

  return (
    <div className="track-row-wrapper">
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
          {/* Track name - click to preview, double-click to rename */}
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              className="track-name-input"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
              maxLength={32}
            />
          ) : (
            <span
              className="track-name"
              title={(() => {
                const instrumentName = getInstrumentName(track.sampleId);
                const isRenamed = track.name !== instrumentName;
                return isRenamed
                  ? `Instrument: ${instrumentName} · Double-click to rename`
                  : 'Double-click to rename';
              })()}
              onClick={handleNameClick}
              onDoubleClick={onSetName ? handleNameDoubleClick : undefined}
              role="button"
              tabIndex={0}
            >
              {track.name}
            </span>
          )}
          {/* Mute + Solo buttons (directly in grid) */}
          <button
            className={`mute-button ${track.muted ? 'active' : ''}`}
            onClick={onToggleMute}
            title="Mute track"
            aria-label={track.muted ? 'Unmute' : 'Mute'}
          >
            M
          </button>
          <button
            className={`solo-button ${track.soloed ? 'active' : ''}`}
            onClick={onToggleSolo}
            title="Solo track (hear only this)"
            aria-label={track.soloed ? 'Unsolo' : 'Solo'}
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
            {/* Key badge - only render for melodic tracks */}
            {isMelodicTrack && (
              <span
                className={`track-key-badge ${effectiveKey ? 'active' : 'placeholder'}`}
                title={effectiveKey
                  ? `Effective root: ${effectiveKey} (transposed ${(track.transpose ?? 0) > 0 ? '+' : ''}${track.transpose ?? 0} from ${scale?.root})`
                  : 'Key badge (shows effective root when transposed)'
                }
              >
                {effectiveKey || '—'}
              </span>
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
            >
              {isExpanded ? '▼' : (
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
          {/* Pattern tools toggle (directly in grid) */}
          <button
            className={`pattern-tools-toggle ${showPatternTools ? 'active' : ''}`}
            onClick={() => setShowPatternTools(!showPatternTools)}
            title="Pattern tools (rotate, invert, reverse, mirror, Euclidean)"
          >
            ⚙
          </button>
        </div>

        {/* MIDDLE: Step grid - scrolls horizontally */}
        <div className={`steps ${isMelodicTrack && !isExpanded ? 'steps-with-contour' : ''}`}>
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

      {/* Phase 31B: Pattern tools panel - appears below track row when toggled */}
      <div className={`panel-animation-container ${showPatternTools ? 'expanded' : ''}`}>
        <div className="panel-animation-content">
          <div className="pattern-tools-panel">
            <div className="pattern-tools-group">
              <span className="pattern-tools-label">Rotate</span>
              <button
                className="pattern-tool-btn"
                onClick={() => onRotatePattern?.('left')}
                title="Rotate pattern left (wrap)"
                disabled={!hasSteps}
              >
                ←
              </button>
              <button
                className="pattern-tool-btn"
                onClick={() => onRotatePattern?.('right')}
                title="Rotate pattern right (wrap)"
                disabled={!hasSteps}
              >
                →
              </button>
            </div>

            <div className="pattern-tools-group">
              <button
                className="pattern-tool-btn"
                onClick={() => onInvertPattern?.()}
                title="Invert pattern (toggle all steps)"
              >
                ⊘
              </button>
              <button
                className="pattern-tool-btn"
                onClick={() => onReversePattern?.()}
                title="Reverse pattern"
                disabled={!hasSteps}
              >
                ⇆
              </button>
              <button
                className="pattern-tool-btn"
                onClick={() => onMirrorPattern?.()}
                title="Mirror pattern (ABCD → ABBA)"
                disabled={!hasSteps || (track.stepCount ?? STEPS_PER_PAGE) <= 2}
              >
                ◇
              </button>
            </div>

            <div className="pattern-tools-group euclidean-group">
              <span className="pattern-tools-label">Euclidean</span>
              <input
                type="range"
                className="euclidean-slider"
                min="0"
                max={track.stepCount ?? STEPS_PER_PAGE}
                value={activeStepCount}
                onChange={(e) => onEuclideanFill?.(Number(e.target.value))}
                title={`Euclidean rhythm: distribute ${activeStepCount} hits across ${track.stepCount ?? STEPS_PER_PAGE} steps`}
              />
              <span className="euclidean-value">{activeStepCount}/{track.stepCount ?? STEPS_PER_PAGE}</span>
            </div>

            {/* Phase 31D: Per-track swing - now visible on desktop */}
            <div className="pattern-tools-group swing-group">
              <span className="pattern-tools-label">Swing</span>
              <input
                type="range"
                className="track-swing-slider"
                min="0"
                max="100"
                value={track.swing ?? 0}
                onChange={(e) => handleTrackSwingChange(Number(e.target.value))}
                title={`Track swing: ${(track.swing ?? 0) === 0 ? 'uses global' : `${track.swing}%`}`}
              />
              <span className="swing-value">{`${track.swing ?? 0}%`}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: Edit panel toggle (always visible, expands on tap) */}
      <div
        className={`mobile-edit-panel ${isMenuOpen ? 'expanded' : ''}`}
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        role="button"
        tabIndex={0}
      >
        <span className="mobile-edit-hint">
          {isMenuOpen ? '▲ collapse' : '▼ tap to edit'}
        </span>
      </div>

      {/* Inline drawer - expands below track row (mobile swim lanes pattern) */}
      <InlineDrawer
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
              aria-label={track.muted ? 'Unmute track' : 'Mute track'}
            >
              M
            </button>
            <button
              className={`drawer-toggle-btn ${track.soloed ? 'active soloed' : ''}`}
              onClick={onToggleSolo}
              title="Solo track"
              aria-label={track.soloed ? 'Unsolo track' : 'Solo track'}
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
            >
              −
            </button>
            <span className={`drawer-stepper-value ${(track.transpose ?? 0) !== 0 ? 'active' : ''}`}>
              {(track.transpose ?? 0) > 0 ? '+' : ''}{track.transpose ?? 0}
            </span>
            <button
              className="drawer-stepper-btn"
              onClick={() => handleTransposeChange((track.transpose ?? 0) + 1)}
              disabled={(track.transpose ?? 0) >= 24}
            >
              +
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
              disabled={!hasSteps}
            >
              ←
            </button>
            <button
              className="drawer-pattern-btn"
              onClick={() => onRotatePattern?.('right')}
              title="Rotate right"
              disabled={!hasSteps}
            >
              →
            </button>
            <button
              className="drawer-pattern-btn"
              onClick={() => onInvertPattern?.()}
              title="Invert"
            >
              ⊘
            </button>
            <button
              className="drawer-pattern-btn"
              onClick={() => onReversePattern?.()}
              title="Reverse"
              disabled={!hasSteps}
            >
              ⇆
            </button>
            <button
              className="drawer-pattern-btn"
              onClick={() => onMirrorPattern?.()}
              title="Mirror"
              disabled={!hasSteps || (track.stepCount ?? STEPS_PER_PAGE) <= 2}
            >
              ◇
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
        <div className={`panel-animation-container ${isExpanded ? 'expanded' : ''}`}>
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
        <div className="plock-inline" ref={plockRef}>
          <span className="plock-step">Step {selectedStep + 1}</span>

          <div className="plock-control">
            <span className="plock-label pitch">Pitch</span>
            <input
              type="range"
              min="-24"
              max="24"
              value={selectedLock?.pitch ?? 0}
              onChange={(e) => handlePitchChange(Number(e.target.value))}
              className="plock-slider pitch"
            />
            <span className="plock-value">{(selectedLock?.pitch ?? 0) > 0 ? '+' : ''}{selectedLock?.pitch ?? 0}</span>
          </div>

          <div className="plock-control">
            <span className="plock-label volume">Vol</span>
            <input
              type="range"
              min="0"
              max="200"
              value={(selectedLock?.volume ?? 1) * 100}
              onChange={(e) => handleVolumeChange(Number(e.target.value) / 100)}
              className="plock-slider volume"
            />
            <span className="plock-value">{Math.round((selectedLock?.volume ?? 1) * 100)}%</span>
          </div>

          {/* Phase 29B: Tie toggle - only show if not the first step */}
          {selectedStep > 0 && (
            <button
              className={`plock-tie ${selectedLock?.tie ? 'active' : ''}`}
              onClick={handleTieToggle}
              title="Tie: Continue note from previous step (no new attack)"
            >
              ⌒
            </button>
          )}

          {(selectedLock?.pitch !== undefined || selectedLock?.volume !== undefined || selectedLock?.tie) && (
            <button className="plock-clear" onClick={handleClearLock}>✕</button>
          )}
        </div>
      )}
    </div>
  );
});
