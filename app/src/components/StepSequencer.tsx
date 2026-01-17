import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { clamp } from '../shared/validation';
import type { ParameterLock, EffectsState, FMParams, ScaleState } from '../types';
import { useGrid } from '../state/grid';
import { useMultiplayerContext } from '../context/MultiplayerContext';
import { signalMusicIntent, requireAudioEngine } from '../audio/audioTriggers';
import { audioEngine } from '../audio/engine';
import { scheduler } from '../audio/scheduler';
import { logger } from '../utils/logger';
import { TrackRow } from './TrackRow';
import { TrackSkeleton } from './TrackSkeleton';
import { Transport } from './Transport';
import { TransportBar } from './TransportBar';
import { CursorOverlay } from './CursorOverlay';
// ScaleSidebar removed - redundant with scale selector in transport bar
import { MixerPanel } from './MixerPanel';
import { LoopRuler } from './LoopRuler';
import { PitchOverview } from './PitchOverview';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { useKeyboard } from '../hooks/useKeyboard';
import { features } from '../config/features';
import type { LoopRegion } from '../types';
import { DEFAULT_STEP_COUNT } from '../types';
import { detectMirrorDirection } from '../utils/patternOps';
import './StepSequencer.css';
import './TransportBar.css';
import './MixerPanel.css';

export function StepSequencer() {
  const { state, dispatch: gridDispatch } = useGrid();
  const multiplayer = useMultiplayerContext();

  // Use multiplayer dispatch if connected, otherwise regular dispatch
  const dispatch = multiplayer?.dispatch ?? gridDispatch;
  const stateRef = useRef(state);
  const [copySource, setCopySource] = useState<string | null>(null);
  const copySourceRef = useRef(copySource);
  // Phase 31F: Ref for delete handler to use in keyboard shortcut
  const handleDeleteSelectedStepsRef = useRef<(() => void) | null>(null);
  // Phase 36: Ref for play/pause handler to use in keyboard shortcut (Space key)
  const handlePlayPauseRef = useRef<(() => void) | null>(null);

  // Phase 11: Container ref for cursor tracking
  const containerRef = useRef<HTMLDivElement>(null);

  // Phase 31I: Mixer panel state
  const [isMixerOpen, setIsMixerOpen] = useState(false);
  const handleToggleMixer = useCallback(() => {
    setIsMixerOpen(prev => !prev);
  }, []);

  // Phase 31H: Pitch Overview panel state
  const [isPitchOpen, setIsPitchOpen] = useState(false);
  const handleTogglePitch = useCallback(() => {
    setIsPitchOpen(prev => !prev);
  }, []);

  // Phase 36: Keyboard shortcuts help panel state (desktop only)
  const [isShortcutsPanelOpen, setIsShortcutsPanelOpen] = useState(false);
  const handleToggleShortcutsPanel = useCallback(() => {
    setIsShortcutsPanelOpen(prev => !prev);
  }, []);


  // Phase 31G: Track reorder (drag & drop) state
  // HIGH-2/HIGH-3: Use track IDs instead of indices to prevent stale closure issues
  const [dragState, setDragState] = useState<{
    draggingTrackId: string | null;
    targetTrackId: string | null;
  }>({ draggingTrackId: null, targetTrackId: null });

  // BUG1-FIX: Ref to track if drag operation was already processed in this cycle
  // State updates are batched by React, so we need a ref for synchronous checks
  const dragProcessedRef = useRef(false);

  // Phase 31H: Check if any tracks are melodic (for showing Pitch button)
  const hasMelodicTracks = useMemo(() => {
    return state.tracks.some(t =>
      t.sampleId.startsWith('synth:') ||
      t.sampleId.startsWith('advanced:') ||
      t.sampleId.startsWith('sampled:') ||
      (t.sampleId.startsWith('tone:') && !t.sampleId.includes('kick') && !t.sampleId.includes('snare') && !t.sampleId.includes('hat') && !t.sampleId.includes('clap'))
    );
  }, [state.tracks]);

  // Keep ref updated for scheduler
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Keep copySource ref in sync (for stable keyboard listener)
  useEffect(() => {
    copySourceRef.current = copySource;
  }, [copySource]);

  // MEDIUM-2: Reset drag state on unmount to prevent stale state issues
  useEffect(() => {
    return () => {
      setDragState({ draggingTrackId: null, targetTrackId: null });
    };
  }, []);

  // Handle play/pause (Tier 1 - requires audio immediately)
  const handlePlayPause = useCallback(async () => {
    const audioEngine = await requireAudioEngine('play');

    // Ensure audio context is running (mobile Chrome workaround)
    const isReady = await audioEngine.ensureAudioReady();
    if (!isReady) {
      logger.audio.warn('Audio context not ready - try tapping again');
      return;
    }

    if (state.isPlaying) {
      scheduler.stop();
      dispatch({ type: 'SET_PLAYING', isPlaying: false });
      dispatch({ type: 'SET_CURRENT_STEP', step: -1 });
    } else {
      // Phase 22 pattern: Ensure Tone.js synths are initialized before playing
      // This prevents race conditions where scheduler tries to play before synths are ready
      const hasToneTracks = stateRef.current.tracks.some(
        t => t.sampleId.startsWith('tone:') || t.sampleId.startsWith('advanced:')
      );
      if (hasToneTracks && !audioEngine.isToneInitialized()) {
        logger.audio.log('Initializing Tone.js synths before playback...');
        await audioEngine.initializeTone();
      }

      // Phase 22: Preload sampled instruments (like piano) before playback
      // This ensures samples are loaded before scheduler tries to play them
      await audioEngine.preloadInstrumentsForTracks(stateRef.current.tracks);

      scheduler.setOnStepChange((step) => {
        dispatch({ type: 'SET_CURRENT_STEP', step });
      });
      scheduler.start(() => stateRef.current);
      dispatch({ type: 'SET_PLAYING', isPlaying: true });
    }
  }, [state.isPlaying, dispatch]);

  const handleTempoChange = useCallback((tempo: number) => {
    dispatch({ type: 'SET_TEMPO', tempo });
  }, [dispatch]);

  const handleSwingChange = useCallback((swing: number) => {
    dispatch({ type: 'SET_SWING', swing });
  }, [dispatch]);

  // Handle effects changes (for Transport FX panel)
  const handleEffectsChange = useCallback((effects: EffectsState) => {
    dispatch({ type: 'SET_EFFECTS', effects });
  }, [dispatch]);

  // Handle scale changes (for Transport Scale selector - Phase 29E)
  const handleScaleChange = useCallback((scale: ScaleState) => {
    dispatch({ type: 'SET_SCALE', scale });
  }, [dispatch]);

  const handleToggleStep = useCallback((trackId: string, step: number) => {
    // Tier 2 - preload audio in background, don't block UI
    signalMusicIntent('step_toggle');
    dispatch({ type: 'TOGGLE_STEP', trackId, step });
  }, [dispatch]);

  const handleToggleMute = useCallback((trackId: string) => {
    // Find current mute state to send explicit value for multiplayer
    const track = state.tracks.find(t => t.id === trackId);
    if (track) {
      const newMuted = !track.muted;
      dispatch({ type: 'TOGGLE_MUTE', trackId });
      // Send explicit state to server (toggle already happened locally)
      multiplayer?.handleMuteChange(trackId, newMuted);
    }
  }, [dispatch, state.tracks, multiplayer]);

  const handleToggleSolo = useCallback((trackId: string) => {
    // Find current solo state to send explicit value for multiplayer
    const track = state.tracks.find(t => t.id === trackId);
    if (track) {
      const newSoloed = !track.soloed;
      dispatch({ type: 'TOGGLE_SOLO', trackId });
      // Send explicit state to server (toggle already happened locally)
      multiplayer?.handleSoloChange(trackId, newSoloed);
    }
  }, [dispatch, state.tracks, multiplayer]);

  const handleClearTrack = useCallback((trackId: string) => {
    dispatch({ type: 'CLEAR_TRACK', trackId });
  }, [dispatch]);

  const handleDeleteTrack = useCallback((trackId: string) => {
    // Clean up audio engine resources (GainNode) to prevent memory leak
    audioEngine.removeTrackGain(trackId);
    dispatch({ type: 'DELETE_TRACK', trackId });
  }, [dispatch]);

  const handleSetParameterLock = useCallback((trackId: string, step: number, lock: ParameterLock | null) => {
    dispatch({ type: 'SET_PARAMETER_LOCK', trackId, step, lock });
  }, [dispatch]);

  const handleSetTranspose = useCallback((trackId: string, transpose: number) => {
    dispatch({ type: 'SET_TRACK_TRANSPOSE', trackId, transpose });
  }, [dispatch]);

  const handleSetStepCount = useCallback((trackId: string, stepCount: number) => {
    dispatch({ type: 'SET_TRACK_STEP_COUNT', trackId, stepCount });
  }, [dispatch]);

  const handleSetFMParams = useCallback((trackId: string, fmParams: FMParams) => {
    dispatch({ type: 'SET_FM_PARAMS', trackId, fmParams });
    // Also apply FM params to the audio engine immediately for real-time preview
    audioEngine.setFMParams(fmParams.harmonicity, fmParams.modulationIndex);
  }, [dispatch]);

  // Phase 25: Handle track volume changes
  const handleSetVolume = useCallback((trackId: string, volume: number) => {
    dispatch({ type: 'SET_TRACK_VOLUME', trackId, volume });
    // Also apply volume to the audio engine immediately
    audioEngine.setTrackVolume(trackId, volume);
  }, [dispatch]);

  // Phase 31B: Pattern manipulation handlers
  const handleRotatePattern = useCallback((trackId: string, direction: 'left' | 'right') => {
    dispatch({ type: 'ROTATE_PATTERN', trackId, direction });
  }, [dispatch]);

  const handleInvertPattern = useCallback((trackId: string) => {
    dispatch({ type: 'INVERT_PATTERN', trackId });
  }, [dispatch]);

  const handleReversePattern = useCallback((trackId: string) => {
    dispatch({ type: 'REVERSE_PATTERN', trackId });
  }, [dispatch]);

  const handleMirrorPattern = useCallback((trackId: string) => {
    // Compute direction before dispatching for sync (server needs explicit direction)
    const track = state.tracks.find(t => t.id === trackId);
    const stepCount = track?.stepCount ?? DEFAULT_STEP_COUNT;
    const direction = track ? detectMirrorDirection(track.steps, stepCount) : 'left-to-right';
    dispatch({ type: 'MIRROR_PATTERN', trackId, direction });
  }, [dispatch, state.tracks]);

  const handleEuclideanFill = useCallback((trackId: string, hits: number) => {
    dispatch({ type: 'EUCLIDEAN_FILL', trackId, hits });
  }, [dispatch]);

  // Phase 31D: Track name rename handler
  const handleSetName = useCallback((trackId: string, name: string) => {
    dispatch({ type: 'SET_TRACK_NAME', trackId, name });
  }, [dispatch]);

  // Phase 31D: Per-track swing handler
  const handleSetTrackSwing = useCallback((trackId: string, swing: number) => {
    dispatch({ type: 'SET_TRACK_SWING', trackId, swing });
  }, [dispatch]);

  // Phase 31D: Unmute all handler
  const handleUnmuteAll = useCallback(() => {
    dispatch({ type: 'UNMUTE_ALL' });
  }, [dispatch]);

  // Phase 31G: Track reorder (drag & drop) handlers
  // HIGH-2/HIGH-3: Use track IDs instead of indices for stable references
  const handleDragStart = useCallback((trackId: string) => {
    dragProcessedRef.current = false; // BUG1-FIX: Reset ref at start of new drag
    setDragState({ draggingTrackId: trackId, targetTrackId: null });
  }, []);

  const handleDragOver = useCallback((trackId: string) => {
    setDragState(prev => ({ ...prev, targetTrackId: trackId }));
  }, []);

  // BUG2-FIX: Clear target when cursor leaves a track
  const handleDragLeave = useCallback(() => {
    setDragState(prev => ({ ...prev, targetTrackId: null }));
  }, []);

  // BUG3-FIX: Accept both source AND target trackId from handleDrop
  // This ensures we use the actual drop target, not potentially stale state
  const handleDragEnd = useCallback((droppedTrackId?: string, targetTrackIdFromDrop?: string) => {
    // BUG1-FIX: Guard against double invocation using ref (synchronous check)
    // State is batched by React, so checking state wouldn't work within same event cycle
    if (dragProcessedRef.current) {
      return; // Already processed, this is the second call
    }
    dragProcessedRef.current = true;

    // BUG3-FIX: Use targetTrackIdFromDrop (direct from drop event) instead of dragState.targetTrackId
    // This prevents race conditions where state hasn't updated yet during rapid drags
    const targetTrackId = targetTrackIdFromDrop ?? dragState.targetTrackId;

    // Only perform reorder if droppedTrackId was provided from handleDrop.
    // This ensures reorder only happens on valid drop, not on drag cancel.
    if (droppedTrackId && targetTrackId && droppedTrackId !== targetTrackId) {
      // Calculate current indices from track IDs
      const fromIndex = state.tracks.findIndex(t => t.id === droppedTrackId);
      const toIndex = state.tracks.findIndex(t => t.id === targetTrackId);

      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        // Dispatch to local grid state
        dispatch({ type: 'REORDER_TRACKS', fromIndex, toIndex });
        // Sync to multiplayer
        multiplayer?.handleTrackReorder(fromIndex, toIndex);
      } else if (fromIndex === -1 || toIndex === -1) {
        // BUG4-FIX: Notify user when reorder fails due to track modification by remote player
        import('../utils/toastEvents').then(({ dispatchToastEvent }) => {
          dispatchToastEvent('Track reorder failed - track was modified by another player', 'error');
        });
      }
    }
    setDragState({ draggingTrackId: null, targetTrackId: null });
  }, [dragState.targetTrackId, state.tracks, dispatch, multiplayer]);

  // Phase 31D: Count muted tracks for button display
  const mutedTrackCount = useMemo(() => {
    return state.tracks.filter(t => t.muted).length;
  }, [state.tracks]);

  // Phase 31F: Selection state and handler
  const handleSelectStep = useCallback((trackId: string, step: number, mode: 'toggle' | 'extend') => {
    dispatch({ type: 'SELECT_STEP', trackId, step, mode });
  }, [dispatch]);

  // Phase 31F: Clear selection
  const handleClearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, [dispatch]);

  // Phase 31F: Delete selected steps with multiplayer sync
  const handleDeleteSelectedSteps = useCallback(() => {
    if (!state.selection || state.selection.steps.size === 0) return;

    // Capture selection data BEFORE dispatching (reducer will clear selection)
    const { trackId, steps } = state.selection;
    const stepsArray = Array.from(steps);

    // Dispatch locally
    dispatch({ type: 'DELETE_SELECTED_STEPS' });

    // Sync to multiplayer (if connected)
    multiplayer?.handleBatchClearSteps(trackId, stepsArray);
  }, [dispatch, state.selection, multiplayer]);

  // Phase 31F: Keep delete handler ref in sync (for stable keyboard listener)
  useEffect(() => {
    handleDeleteSelectedStepsRef.current = handleDeleteSelectedSteps;
  }, [handleDeleteSelectedSteps]);

  // Phase 36: Keep play/pause handler ref in sync (for Space key shortcut)
  useEffect(() => {
    handlePlayPauseRef.current = handlePlayPause;
  }, [handlePlayPause]);

  // Phase 31F: Selection count for badge display
  const selectionCount = useMemo(() => {
    return state.selection?.steps.size ?? 0;
  }, [state.selection]);

  // Phase 31G: Loop region handler
  const handleSetLoopRegion = useCallback((region: LoopRegion | null) => {
    dispatch({ type: 'SET_LOOP_REGION', region });
  }, [dispatch]);

  // Phase 31 TCG: Check if any track has adjusted volume (for Mixer button badge)
  // Note: volume is stored as 0-1 (not 0-100), default is 1.0
  const hasAdjustedVolumes = useMemo(() => {
    return state.tracks.some(t => t.volume !== undefined && t.volume !== 1);
  }, [state.tracks]);

  // Copy flow: track initiates copy, becomes source, then selects destination
  const handleStartCopy = useCallback((trackId: string) => {
    setCopySource(trackId);
  }, []);

  const handleCopyTo = useCallback((toTrackId: string) => {
    if (copySource && toTrackId !== copySource) {
      dispatch({ type: 'COPY_SEQUENCE', fromTrackId: copySource, toTrackId });
      setCopySource(null);
    }
  }, [copySource, dispatch]);


  // Phase 36: Centralized keyboard handling via useKeyboard hook
  // Handles: Space (play/pause), Escape (cancel/clear), Delete (remove selection),
  // ? (help panel), Cmd/Ctrl+Shift+M (unmute all)
  useKeyboard({
    onSpace: () => {
      handlePlayPauseRef.current?.();
    },
    onEscape: () => {
      // Cancel copy mode OR close help panel OR clear selection
      if (isShortcutsPanelOpen) {
        setIsShortcutsPanelOpen(false);
      } else if (copySourceRef.current) {
        setCopySource(null);
      } else if (stateRef.current.selection && stateRef.current.selection.steps.size > 0) {
        dispatch({ type: 'CLEAR_SELECTION' });
      }
    },
    onDelete: () => {
      // Delete selected steps if any
      if (stateRef.current.selection && stateRef.current.selection.steps.size > 0) {
        handleDeleteSelectedStepsRef.current?.();
      }
    },
    onHelp: handleToggleShortcutsPanel,
    onUnmuteAll: () => {
      dispatch({ type: 'UNMUTE_ALL' });
    },
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      scheduler.stop();
    };
  }, []);

  // Calculate if any track is soloed (for playhead visibility)
  const anySoloed = useMemo(() => state.tracks.some(t => t.soloed), [state.tracks]);

  // Phase 31A: Calculate longest track step count for progress bar
  const longestTrackStepCount = useMemo(() => {
    if (state.tracks.length === 0) return DEFAULT_STEP_COUNT;
    return Math.max(...state.tracks.map(t => t.stepCount ?? DEFAULT_STEP_COUNT));
  }, [state.tracks]);

  // Phase 31A: Calculate progress bar position (0-100%)
  const progressPosition = useMemo(() => {
    if (!state.isPlaying || state.currentStep < 0) return 0;
    return ((state.currentStep % longestTrackStepCount) / longestTrackStepCount) * 100;
  }, [state.isPlaying, state.currentStep, longestTrackStepCount]);

  // Phase 31A: Beat state for metronome pulse (resets after animation)
  const [beatPulse, setBeatPulse] = useState(false);
  const beatPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 31A: Calculate pulse duration proportional to tempo (~100ms at 120 BPM)
  // Clamped to 50-150ms range for usability at extreme tempos
  const beatPulseDuration = useMemo(() => {
    return clamp((60 / state.tempo) * 200, 50, 150);
  }, [state.tempo]);

  // Phase 31A: Set up beat callback for metronome pulse
  // Using ref-based timer tracking to prevent memory leaks on unmount
  useEffect(() => {
    const pulseDuration = beatPulseDuration;

    scheduler.setOnBeat(() => {
      // Clear any existing timer to prevent overlapping animations
      if (beatPulseTimerRef.current) {
        clearTimeout(beatPulseTimerRef.current);
      }
      setBeatPulse(true);
      beatPulseTimerRef.current = setTimeout(() => {
        setBeatPulse(false);
        beatPulseTimerRef.current = null;
      }, pulseDuration);
    });

    return () => {
      // Cleanup: clear timer and remove callback
      if (beatPulseTimerRef.current) {
        clearTimeout(beatPulseTimerRef.current);
        beatPulseTimerRef.current = null;
      }
      // Set to no-op (scheduler doesn't have a clearOnBeat method)
      scheduler.setOnBeat(() => {});
    };
  }, [beatPulseDuration]);

  // Phase 11: Handle cursor movement for multiplayer presence
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!multiplayer?.isConnected || !multiplayer?.sendCursor || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Only send if within bounds
    if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
      multiplayer.sendCursor({ x, y });
    }
  }, [multiplayer]);

  // Phase 21: Check if session is published (read-only)
  const isPublished = multiplayer?.isPublished ?? false;

  return (
    <div
      className={`step-sequencer${isPublished ? ' published' : ''}`}
      data-testid="grid"
      ref={containerRef}
      onMouseMove={handleMouseMove}
    >
      {/* Phase 11: Remote cursors overlay */}
      {multiplayer?.isConnected && multiplayer.cursors.size > 0 && (
        <CursorOverlay
          cursors={multiplayer.cursors}
          containerRef={containerRef}
        />
      )}

      {/* Desktop transport - always allow play/pause even on published */}
      <Transport
        isPlaying={state.isPlaying}
        tempo={state.tempo}
        swing={state.swing}
        onPlayPause={handlePlayPause}
        onTempoChange={isPublished ? () => {} : handleTempoChange}
        onSwingChange={isPublished ? () => {} : handleSwingChange}
        effectsState={state.effects}
        onEffectsChange={isPublished ? undefined : handleEffectsChange}
        effectsDisabled={isPublished}
        scaleState={state.scale}
        onScaleChange={isPublished ? undefined : handleScaleChange}
        beatPulse={beatPulse}
        beatPulseDuration={beatPulseDuration}
        onUnmuteAll={isPublished ? undefined : handleUnmuteAll}
        mutedTrackCount={mutedTrackCount}
        onToggleMixer={handleToggleMixer}
        isMixerOpen={isMixerOpen}
        hasAdjustedVolumes={hasAdjustedVolumes}
        hasTracks={state.tracks.length > 0}
        onTogglePitch={handleTogglePitch}
        isPitchOpen={isPitchOpen}
        hasMelodicTracks={hasMelodicTracks}
      />

      {/* Mobile transport bar - drag to adjust values (TE knob style) */}
      <TransportBar
        isPlaying={state.isPlaying}
        tempo={state.tempo}
        swing={state.swing}
        onPlayPause={handlePlayPause}
        onTempoChange={isPublished ? () => {} : handleTempoChange}
        onSwingChange={isPublished ? () => {} : handleSwingChange}
      />

      {/* Phase 31I: Mixer Panel - side-by-side view of all track volumes */}
      {/* Uses same expand/collapse animation pattern as FX panel */}
      <div className={`mixer-panel-container ${isMixerOpen ? 'expanded' : ''}`}>
        <div className="mixer-panel-content">
          <MixerPanel
            tracks={state.tracks}
            anySoloed={anySoloed}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            onSetVolume={handleSetVolume}
            onSetSwing={handleSetTrackSwing}
          />
        </div>
      </div>

      {/* Phase 31H: Pitch Overview Panel - above drag region, consistent with Mixer/FX */}
      <div className={`pitch-panel-container ${isPitchOpen ? 'expanded' : ''}`}>
        <div className="pitch-panel-content">
          <PitchOverview
            tracks={state.tracks}
            scale={state.scale}
            currentStep={state.isPlaying ? state.currentStep : -1}
            isPlaying={state.isPlaying}
          />
        </div>
      </div>

      {/* Phase 31G: Loop ruler above grid - set loop regions by dragging */}
      {features.loopRuler && (
        <LoopRuler
          totalSteps={longestTrackStepCount}
          loopRegion={state.loopRegion ?? null}
          onSetLoopRegion={isPublished ? () => {} : handleSetLoopRegion}
          currentStep={state.currentStep}
          isPlaying={state.isPlaying}
        />
      )}

      {/* Phase 31A: Progress bar above grid - shows playback position */}
      <div
        className={`progress-bar-container ${state.isPlaying ? 'visible' : ''}`}
        role="progressbar"
        aria-valuenow={progressPosition}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Playback progress"
        title="Playback progress"
      >
        <div
          className="progress-bar-fill"
          style={{ '--progress-position': `${progressPosition}%` } as React.CSSProperties}
        />
      </div>

      {/* Phase 31F: Selection indicator badge (only when advanced input enabled) */}
      {features.advancedStepInput && selectionCount > 0 && (
        <div className="selection-badge" title={`${selectionCount} step${selectionCount > 1 ? 's' : ''} selected • ESC to clear • Delete to remove`}>
          <span className="selection-count">{selectionCount}</span>
          <span className="selection-label">selected</span>
          <button
            className="selection-clear"
            onClick={handleClearSelection}
            aria-label="Clear selection"
          >
            ×
          </button>
        </div>
      )}

      {/* Phase 29E: Main content area with tracks and scale sidebar */}
      <div className="sequencer-content">
        <div className="tracks">
          <div className="tracks-inner">
            {/* Phase 34: Show skeletons during session loading to prevent CLS */}
            {multiplayer?.sessionStatus === 'loading' && state.tracks.length === 0 && (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <TrackSkeleton key={`skeleton-${i}`} index={i} />
                ))}
              </>
            )}
            {state.tracks.map((track, trackIndex) => {
              const hasSteps = track.steps.some(s => s);
              const isCopySource = copySource === track.id;
              const isCopyTarget = copySource && !isCopySource;
              // Phase 31F: Selection state for this track
              const isSelectionTrack = state.selection?.trackId === track.id;
              const selectedSteps = isSelectionTrack ? state.selection!.steps : undefined;
              const selectionAnchor = isSelectionTrack ? state.selection!.anchor : undefined;
              // Phase 31G: Drag target indicator (using track IDs for stability)
              const isDragTarget = dragState.targetTrackId === track.id && dragState.draggingTrackId !== track.id;
              // LOW-1: Visual feedback during drag
              const isDragging = dragState.draggingTrackId === track.id;

              return (
                <TrackRow
                  key={track.id}
                  track={track}
                  trackIndex={trackIndex}
                  currentStep={state.isPlaying ? state.currentStep : -1}
                  swing={state.swing}
                  anySoloed={anySoloed}
                  hasSteps={hasSteps}
                  canDelete={true}
                  isCopySource={isCopySource}
                  isCopyTarget={!!isCopyTarget}
                  onToggleStep={(step) => handleToggleStep(track.id, step)}
                  onToggleMute={() => handleToggleMute(track.id)}
                  onToggleSolo={() => handleToggleSolo(track.id)}
                  onClear={() => handleClearTrack(track.id)}
                  onDelete={() => handleDeleteTrack(track.id)}
                  onStartCopy={() => handleStartCopy(track.id)}
                  onCopyTo={() => handleCopyTo(track.id)}
                  onSetParameterLock={(step, lock) => handleSetParameterLock(track.id, step, lock)}
                  onSetTranspose={(transpose) => handleSetTranspose(track.id, transpose)}
                  onSetStepCount={(stepCount) => handleSetStepCount(track.id, stepCount)}
                  onSetFMParams={(fmParams) => handleSetFMParams(track.id, fmParams)}
                  onSetVolume={(volume) => handleSetVolume(track.id, volume)}
                  scale={state.scale}
                  onRotatePattern={(direction) => handleRotatePattern(track.id, direction)}
                  onInvertPattern={() => handleInvertPattern(track.id)}
                  onReversePattern={() => handleReversePattern(track.id)}
                  onMirrorPattern={() => handleMirrorPattern(track.id)}
                  onEuclideanFill={(hits) => handleEuclideanFill(track.id, hits)}
                  onSetName={(name) => handleSetName(track.id, name)}
                  onSetTrackSwing={(swing) => handleSetTrackSwing(track.id, swing)}
                  selectedSteps={features.advancedStepInput ? selectedSteps : undefined}
                  selectionAnchor={features.advancedStepInput ? selectionAnchor : undefined}
                  hasSelection={features.advancedStepInput && selectionCount > 0}
                  onSelectStep={features.advancedStepInput ? (step, mode) => handleSelectStep(track.id, step, mode) : undefined}
                  loopRegion={state.loopRegion}
                  isDragTarget={isDragTarget}
                  isDragging={isDragging}
                  onDragStart={() => handleDragStart(track.id)}
                  onDragOver={() => handleDragOver(track.id)}
                  onDragLeave={handleDragLeave}
                  onDragEnd={handleDragEnd}
                />
              );
            })}
          </div>
        </div>

        {/* Phase 29E: Scale Sidebar removed - redundant with scale selector in transport bar */}
      </div>

      {/* Phase 36: Keyboard shortcuts help panel (desktop only) */}
      <KeyboardShortcutsPanel
        isOpen={isShortcutsPanelOpen}
        onClose={() => setIsShortcutsPanelOpen(false)}
      />
    </div>
  );
}
