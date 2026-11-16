import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { clamp } from '../shared/validation';
import type { ParameterLock, EffectsState, FMParams, ScaleState } from '../types';
import { useGrid } from '../state/grid';
import { useStableCallback, useStableGetter } from '../hooks/useStableCallback';
import { useMultiplayerContext } from '../context/MultiplayerContext';
import { signalMusicIntent, requireAudioEngine } from '../audio/audioTriggers';
import { audioEngine } from '../audio/engine';
import { scheduler } from '../audio/scheduler';
import { useSchedulerStateSync } from '../audio/useSchedulerStateSync';
import { useTrackPrewarm } from '../audio/useTrackPrewarm';
import { useTrackInstrumentReconcile } from '../audio/useTrackInstrumentReconcile';
import { logger } from '../utils/logger';
import { TrackRow } from './TrackRow';
import { EditorDock, DOCK_TRANSITION_MS } from './EditorDock';
import type { DockTrackActions } from './DockPanes';
import {
  DOCK_CLOSED,
  EDITOR_DOCK_ID,
  closeDock,
  closeDockInstrumentPicker,
  dismissDockPane,
  dockSelectedStep,
  effectiveDockPane,
  isDockInstrumentPickerOpen,
  isTrackDocked,
  openDock,
  reconcileDock,
  releaseDockedTrack,
  resolveGhostVisibility,
  setDockPane,
  toggleDock,
  toggleDockDetent,
  toggleDockInstrumentPicker,
  toggleDockStep,
  toggleDockTrackPane,
  toggleGhost,
  type DockPane,
  type DockState,
} from './editor-dock-state';
import { isDrumInstrument } from '../shared/instrument-classification';
import { TrackSkeleton } from './TrackSkeleton';
import { Transport } from './Transport';
import { TransportBar } from './TransportBar';
import { CursorOverlay } from './CursorOverlay';
import { MixerPanel } from './MixerPanel';
import { LoopRuler } from './LoopRuler';
import { PitchOverview } from './PitchOverview';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { PortraitHeader } from './PortraitHeader';
import { PortraitGrid } from './PortraitGrid';
import { OrientationHint } from './OrientationHint';
import { Close } from '../icons';
import { useKeyboard } from '../hooks/useKeyboard';
import { useOrientationMode } from '../hooks/useDisplayMode';
import { features } from '../config/features';
import type { LoopRegion } from '../types';
import { DEFAULT_STEP_COUNT } from '../types';
import { detectMirrorDirection } from '../shared/pattern-operations';
import { AsyncActionLatch } from '../utils/AsyncActionLatch';
import { installMediaSessionActionHandlers } from '../audio/media-session';
import { resolveTrackReorder } from './track-reorder';
import './StepSequencer.css';
import './TransportBar.css';
import './MixerPanel.css';
import './PortraitHeader.css';
import './PortraitGrid.css';

/**
 * Focus the first candidate that is in the document and rendered; returns
 * whether one took focus.
 */
function focusFirstVisible(candidates: ReadonlyArray<HTMLElement | null | undefined>): boolean {
  for (const element of candidates) {
    if (!element?.isConnected || element.hidden) continue;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    element.focus();
    if (document.activeElement === element) return true;
  }
  return false;
}

export function StepSequencer() {
  const { state, dispatch: gridDispatch } = useGrid();
  const multiplayer = useMultiplayerContext();
  const orientationMode = useOrientationMode();
  const isPortraitMode = orientationMode === 'portrait';

  // Use multiplayer dispatch if connected, otherwise regular dispatch
  const dispatch = multiplayer?.dispatch ?? gridDispatch;
  // Stable getters for values the scheduler and the keyboard listener read
  // without wanting to re-subscribe. useStableGetter publishes values in the
  // commit phase, so timers cannot observe an abandoned concurrent render.
  const getState = useStableGetter(state);
  const playbackActiveRef = useRef(state.isPlaying);
  const playbackStartLatchRef = useRef(new AsyncActionLatch());
  const playbackDesiredRef = useRef(state.isPlaying);
  const playbackRestartQueuedRef = useRef(false);
  const [copySource, setCopySource] = useState<string | null>(null);
  const getCopySource = useStableGetter(copySource);

  // Phase 11: Container ref for cursor tracking
  const containerRef = useRef<HTMLDivElement>(null);

  // Editor dock (specs/PIANO-ROLL-DOCK.md): which melodic track the dock under
  // the grid edits. Local UI state: never synced, never persisted, closed on
  // load, and opened only on request.
  const [dock, setDock] = useState<DockState>(DOCK_CLOSED);
  const getDock = useStableGetter(dock);
  const tracksRef = useRef<HTMLDivElement>(null);
  // Set when a request opens a closed dock, so the docked row's cells pulse
  // once after the commit that marks the row as docked.
  const dockPulsePendingRef = useRef(false);

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

  // Keep the playback latch's view of isPlaying current.
  useEffect(() => {
    playbackActiveRef.current = state.isPlaying;
  }, [state]);

  // Push live state changes into the scheduler. The main-thread scheduler
  // reads state through getState and ignores these pushes; the
  // AudioWorklet host uses them to refresh its serialized snapshot.
  useSchedulerStateSync(scheduler, state, state.isPlaying);

  // Prewarm sampled/tone/advanced instruments when readiness-gated track
  // membership changes mid-playback. Without this, scheduler hot paths skip
  // notes until the browser-owned instrument instance becomes ready.
  // See review finding #4.
  useTrackPrewarm(state, state.isPlaying);
  // Change instrument (issue #63): dispose and rebuild a track's per-track
  // synth whenever its instrument changes, whoever changed it.
  useTrackInstrumentReconcile(state);

  // MEDIUM-2: Reset drag state on unmount to prevent stale state issues
  useEffect(() => {
    return () => {
      setDragState({ draggingTrackId: null, targetTrackId: null });
    };
  }, []);


  const stopPlayback = useCallback(() => {
    // Pause is also cancellation: an OS pause received during asynchronous
    // startup must prevent that obsolete continuation from starting later.
    playbackDesiredRef.current = false;
    playbackRestartQueuedRef.current = false;
    playbackStartLatchRef.current.cancel();
    if (!playbackActiveRef.current) return;
    playbackActiveRef.current = false;
    scheduler.stop();
    dispatch({ type: 'SET_PLAYING', isPlaying: false });
    dispatch({ type: 'SET_CURRENT_STEP', step: -1 });
  }, [dispatch]);

  const startPlayback = useCallback(async () => {
    const wasAlreadyDesired = playbackDesiredRef.current;
    playbackDesiredRef.current = true;
    // Media Session play is idempotent. If transport is already active, still
    // refresh readiness so an independently OS-paused media element is
    // restarted without toggling the sequencer off.
    if (playbackActiveRef.current) {
      const audioEngine = await requireAudioEngine('play');
      await audioEngine.ensureAudioReady();
      return;
    }
    // A repeated play action during startup keeps the original start alive.
    if (playbackStartLatchRef.current.active) {
      // play → pause → play can occur before the obsolete startup promise
      // settles. Remember the new desired state and restart once the latch is
      // idle; an ordinary repeated play while still desired remains a no-op.
      if (!wasAlreadyDesired) playbackRestartQueuedRef.current = true;
      return;
    }
    await playbackStartLatchRef.current.run(async (isCurrent) => {
      const audioEngine = await requireAudioEngine('play');
      if (!isCurrent()) return;

      // One state-machine gate owns context resume, Tone startup, sample
      // loading, and per-track renderer warming for this track snapshot.
      const isReady = await audioEngine.prepareForPlayback(getState().tracks);
      if (!isCurrent()) return;
      if (!isReady) {
        logger.audio.warn('Audio runtime not ready - try tapping again', audioEngine.getRuntimeState());
        return;
      }

      scheduler.setOnStepChange((step) => {
        if (isCurrent()) dispatch({ type: 'SET_CURRENT_STEP', step });
      });
      if (!isCurrent()) return;
      scheduler.start(getState);
      playbackActiveRef.current = true;
      dispatch({ type: 'SET_PLAYING', isPlaying: true });
    });
    if (
      playbackRestartQueuedRef.current
      && playbackDesiredRef.current
      && !playbackActiveRef.current
    ) {
      playbackRestartQueuedRef.current = false;
      await startPlayback();
    }
  }, [dispatch, getState]);

  // Handle the UI/keyboard toggle (Tier 1 - requires audio immediately).
  const handlePlayPause = useCallback(async () => {
    // Toggle the desired state while startup settles. This makes a rapid
    // play → pause → play sequence converge on the latest UI/keyboard intent
    // just as the explicit Media Session commands do.
    if (playbackStartLatchRef.current.active) {
      if (playbackDesiredRef.current) stopPlayback();
      else await startPlayback();
      return;
    }
    if (playbackActiveRef.current) {
      stopPlayback();
      return;
    }
    await startPlayback();
  }, [startPlayback, stopPlayback]);

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

  const rowWrapper = useCallback((trackId: string) => (
    Array.from(tracksRef.current?.querySelectorAll<HTMLElement>('[data-track-id]') ?? [])
      .find(element => element.dataset.trackId === trackId)
  ), []);

  // Focus a control on a track's row once the dock has rendered: the dock is
  // about to become inert, or the control that had focus has unmounted.
  const focusRowControl = useCallback((trackId: string, selectors: string[]) => {
    requestAnimationFrame(() => {
      const wrapper = rowWrapper(trackId);
      focusFirstVisible(selectors.map(selector => wrapper?.querySelector<HTMLElement>(selector)));
    });
  }, [rowWrapper]);

  const handleClearTrack = useCallback((trackId: string) => {
    dispatch({ type: 'CLEAR_TRACK', trackId });
  }, [dispatch]);

  const handleDeleteTrack = useCallback((trackId: string) => {
    // Delete is pressed in the docked track's Track pane: the dock is about to
    // close (and turn inert) and the row goes away, so focus would fall to the
    // page. Hand it to the next row, or the previous one after the last.
    const dockElement = tracksRef.current?.querySelector(`#${EDITOR_DOCK_ID}`);
    if (dockElement?.contains(document.activeElement)) {
      const ids = getState().tracks.map(t => t.id);
      const index = ids.indexOf(trackId);
      const neighbour = index < 0 ? undefined : ids[index + 1] ?? ids[index - 1];
      if (neighbour) focusRowControl(neighbour, ['[data-dock-toggle]', '.track-name']);
    }
    // Deleting the docked track closes the dock, and deleting the copy source
    // ends copy mode (a collaborator's delete is caught during render).
    setDock(prev => releaseDockedTrack(prev, trackId));
    setCopySource(prev => (prev === trackId ? null : prev));
    // Clean up audio engine resources (GainNode) to prevent memory leak
    audioEngine.removeTrackGain(trackId);
    dispatch({ type: 'DELETE_TRACK', trackId });
  }, [dispatch, getState, focusRowControl]);

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
    audioEngine.setFMParams(trackId, fmParams.harmonicity, fmParams.modulationIndex);
  }, [dispatch]);

  // Phase 25: Handle track volume changes
  const handleSetVolume = useCallback((trackId: string, volume: number) => {
    dispatch({ type: 'SET_TRACK_VOLUME', trackId, volume });
    // Also apply volume to the audio engine immediately
    audioEngine.setTrackVolume(trackId, volume);
  }, [dispatch]);

  const handleSetPan = useCallback((trackId: string, pan: number) => {
    dispatch({ type: 'SET_TRACK_PAN', trackId, pan });
    // Immediate local feedback; syncGridAudioState handles load/remote paths.
    audioEngine.setTrackPan(trackId, pan);
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

  // Change instrument (issue #63). Only the state change happens here: the
  // audio engine is reconciled by useTrackInstrumentReconcile, which sees this
  // change and a collaborator's or an agent's identically.
  const handleSetInstrument = useCallback((trackId: string, sampleId: string) => {
    const name = state.tracks.find((track) => track.id === trackId)?.name ?? sampleId;
    dispatch({ type: 'SET_TRACK_INSTRUMENT', trackId, sampleId, name });
  }, [dispatch, state.tracks]);

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

    const resolution = resolveTrackReorder(state.tracks, droppedTrackId, targetTrackId);
    if (resolution.kind === 'reorder') {
      dispatch({
        type: 'REORDER_TRACKS',
        fromIndex: resolution.fromIndex,
        toIndex: resolution.toIndex,
      });
      multiplayer?.handleTrackReorder(resolution.trackId, resolution.toIndex);
    } else if (resolution.kind === 'missing-track') {
      import('../utils/toastEvents').then(({ dispatchToastEvent }) => {
        dispatchToastEvent('Track reorder failed - track was modified by another player', 'error');
      });
    }
    setDragState({ draggingTrackId: null, targetTrackId: null });
  }, [dragState.targetTrackId, state.tracks, dispatch, multiplayer]);

  // Phase 31D: Count muted tracks for button display
  const mutedTrackCount = state.tracks.filter(t => t.muted).length;

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

  // Phase 31F / Phase 36: stable references for the keyboard listener, always
  // invoking the latest closure.
  const stablePlayPause = useStableCallback(() => handlePlayPause());
  const stableStartPlayback = useStableCallback(() => startPlayback());
  const stableStopPlayback = useStableCallback(() => stopPlayback());
  const stableDeleteSelectedSteps = useStableCallback(() => handleDeleteSelectedSteps());

  useEffect(() => installMediaSessionActionHandlers({
    play: () => { void stableStartPlayback(); },
    pause: () => { stableStopPlayback(); },
  }), [stableStartPlayback, stableStopPlayback]);

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

  // Editor dock handlers. Reading the committed dock state (rather than a
  // functional update) keeps the "was it closed?" check out of the updater,
  // which StrictMode may run twice.
  const commitDock = useCallback((next: DockState) => {
    if (!getDock().open && next.open) dockPulsePendingRef.current = true;
    setDock(next);
  }, [getDock]);

  const handleOpenDock = useCallback((trackId: string) => {
    commitDock(openDock(getDock(), trackId));
  }, [commitDock, getDock]);

  const handleToggleDock = useCallback((trackId: string) => {
    commitDock(toggleDock(getDock(), trackId));
  }, [commitDock, getDock]);

  const handleCloseDock = useCallback(({ restoreFocus }: { restoreFocus: boolean }) => {
    const { trackId } = getDock();
    setDock(closeDock);
    // Focus was inside the dock, which is about to become inert: hand it back
    // to the row the dock was editing (its pitch toggle, or a drum's name).
    if (restoreFocus && trackId) {
      focusRowControl(trackId, ['[data-dock-toggle]', '.track-name']);
    }
  }, [getDock, focusRowControl]);

  const handleSetDockPane = useCallback((pane: DockPane) => {
    setDock(prev => setDockPane(prev, pane));
  }, []);

  const handleToggleDockDetent = useCallback(() => {
    setDock(toggleDockDetent);
  }, []);

  const hasPitch = useCallback((trackId: string | null) => {
    const track = trackId ? getState().tracks.find(t => t.id === trackId) : undefined;
    return !!track && !isDrumInstrument(track.sampleId);
  }, [getState]);

  // A track name in landscape: that track's Track pane, which holds what the
  // landscape drawer held (transpose, steps, instrument, pattern, actions).
  const handleToggleDockTrackPane = useCallback((trackId: string) => {
    commitDock(toggleDockTrackPane(getDock(), trackId, hasPitch(trackId)));
  }, [commitDock, getDock, hasPitch]);

  // Shift+click or long-press on a step, in a row or in the roll: the Step
  // pane for that step; the same step again leaves the Step pane.
  const handleSelectDockStep = useCallback((trackId: string, step: number) => {
    commitDock(toggleDockStep(getDock(), trackId, step, hasPitch(trackId)));
  }, [commitDock, getDock, hasPitch]);

  // Escape inside the dock (or on the grid while the Step pane shows): back
  // to Notes, or close the dock from Notes or for a track without pitch.
  const handleDismissDockPane = useCallback(() => {
    const current = getDock();
    const next = dismissDockPane(current, hasPitch(current.trackId));
    if (!next.open && current.open) {
      handleCloseDock({ restoreFocus: tracksRef.current?.querySelector(`#${EDITOR_DOCK_ID}`)?.contains(document.activeElement) ?? false });
      return;
    }
    setDock(next);
  }, [getDock, hasPitch, handleCloseDock]);

  // The Step pane's Clear lock: clear, leave the pane, and hand focus back to
  // the step that was being edited (the old strip's contract).
  const handleClearStepLock = useCallback((trackId: string, step: number) => {
    dispatch({ type: 'SET_PARAMETER_LOCK', trackId, step, lock: null });
    setDock(prev => dismissDockPane(prev, hasPitch(trackId)));
    focusRowControl(trackId, [`[data-step-index="${step}"]`]);
  }, [dispatch, hasPitch, focusRowControl]);

  // Change instrument (issue #63) from the row's badge or the Track pane's
  // Instrument button: both open the one picker in the dock.
  const instrumentOpenerRef = useRef<HTMLElement | null>(null);
  const handleToggleInstrumentPicker = useCallback((trackId: string, opener?: HTMLElement) => {
    const current = getDock();
    if (opener && !isDockInstrumentPickerOpen(current, trackId)) instrumentOpenerRef.current = opener;
    commitDock(toggleDockInstrumentPicker(current, trackId));
  }, [commitDock, getDock]);

  const handleChooseInstrument = useCallback((trackId: string, sampleId: string) => {
    handleSetInstrument(trackId, sampleId);
    setDock(closeDockInstrumentPicker);
    // Committing closes the picker so the person sees the result; focus goes
    // back to whatever opened it, or the Track pane's button, or the name.
    const opener = instrumentOpenerRef.current;
    instrumentOpenerRef.current = null;
    requestAnimationFrame(() => {
      const dockButton = tracksRef.current?.querySelector<HTMLElement>(`#${EDITOR_DOCK_ID} .dock-instrument-button`);
      if (focusFirstVisible([opener, dockButton])) return;
      focusRowControl(trackId, ['.track-name']);
    });
  }, [handleSetInstrument, focusRowControl]);

  // Portrait renders no rows and no dock: close it, so rotating back to
  // landscape or desktop finds it closed, as it is on load. Landscape keeps
  // the dock open (it is a bottom dock there) with its pane and picker.
  useLayoutEffect(() => {
    if (orientationMode !== 'portrait') return;
    setDock(prev => closeDockInstrumentPicker(closeDock(prev)));
  }, [orientationMode]);

  // Phase 36: Centralized keyboard handling via useKeyboard hook
  // Handles: Space (play/pause), Escape (cancel/clear), Delete (remove selection),
  // ? (help panel), Cmd/Ctrl+Shift+M (unmute all)
  useKeyboard({
    onSpace: () => {
      stablePlayPause();
    },
    onEscape: () => {
      // Close help panel OR cancel copy mode OR clear selection OR leave the Step pane
      if (isShortcutsPanelOpen) {
        setIsShortcutsPanelOpen(false);
      } else if (getCopySource()) {
        setCopySource(null);
      } else if ((getState().selection?.steps.size ?? 0) > 0) {
        dispatch({ type: 'CLEAR_SELECTION' });
      } else if (getDock().open && getDock().pane === 'step') {
        // The Step pane replaced the strip under the row, which closed on an
        // outside click; Escape on the grid leaves it instead.
        handleDismissDockPane();
      }
    },
    onDelete: () => {
      // Delete selected steps if any
      if ((getState().selection?.steps.size ?? 0) > 0) {
        stableDeleteSelectedSteps();
      }
    },
    onHelp: handleToggleShortcutsPanel,
    onUnmuteAll: () => {
      dispatch({ type: 'UNMUTE_ALL' });
    },
  });

  // Cleanup on unmount
  useEffect(() => {
    const playbackStartLatch = playbackStartLatchRef.current;
    return () => {
      playbackDesiredRef.current = false;
      playbackRestartQueuedRef.current = false;
      playbackStartLatch.cancel();
      playbackActiveRef.current = false;
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

  // Editor dock: every track can be docked (Step and Track apply to drums
  // too); only melodic tracks have Notes and ghosts. A docked track that is
  // deleted, here or by a collaborator, closes the dock.
  const melodicTracks = useMemo(
    () => state.tracks.filter(t => !isDrumInstrument(t.sampleId)),
    [state.tracks],
  );
  const melodicTrackIds = useMemo(() => melodicTracks.map(t => t.id), [melodicTracks]);
  const trackIds = useMemo(() => new Set(state.tracks.map(t => t.id)), [state.tracks]);
  const reconciledDock = reconcileDock(dock, trackIds);
  if (reconciledDock !== dock) setDock(reconciledDock);
  // Copy mode ends, as Escape ends it, when its source track is gone: there is
  // nothing left to paste, and a later track must not inherit the source.
  if (copySource !== null && !trackIds.has(copySource)) setCopySource(null);
  const dockedTrack = reconciledDock.trackId
    ? state.tracks.find(t => t.id === reconciledDock.trackId) ?? null
    : null;
  const isDockOpen = reconciledDock.open && dockedTrack !== null;
  const dockPane = effectiveDockPane(
    reconciledDock,
    dockedTrack !== null && !isDrumInstrument(dockedTrack.sampleId),
  );
  const ghostVisibility = useMemo(
    () => resolveGhostVisibility(reconciledDock, melodicTrackIds),
    [reconciledDock, melodicTrackIds],
  );
  const handleToggleGhost = useCallback((ghostId: string) => {
    setDock(prev => toggleGhost(prev, ghostId, melodicTrackIds));
  }, [melodicTrackIds]);

  // The Track pane's edits, by track id. A published session gets none that
  // change state: its controls render disabled and the picker is absent.
  const dockTrackActions = useMemo<DockTrackActions>(() => ({
    onSetTranspose: handleSetTranspose,
    onSetStepCount: handleSetStepCount,
    onSetInstrument: isPublished ? undefined : handleChooseInstrument,
    onSetFMParams: handleSetFMParams,
    onRotatePattern: handleRotatePattern,
    onInvertPattern: handleInvertPattern,
    onReversePattern: handleReversePattern,
    onMirrorPattern: handleMirrorPattern,
    onEuclideanFill: handleEuclideanFill,
    onSetTrackSwing: handleSetTrackSwing,
    onStartCopy: handleStartCopy,
    onCopyTo: handleCopyTo,
    onClearTrack: handleClearTrack,
    onDeleteTrack: handleDeleteTrack,
  }), [
    isPublished, handleSetTranspose, handleSetStepCount, handleChooseInstrument, handleSetFMParams,
    handleRotatePattern, handleInvertPattern, handleReversePattern, handleMirrorPattern,
    handleEuclideanFill, handleSetTrackSwing, handleStartCopy, handleCopyTo, handleClearTrack,
    handleDeleteTrack,
  ]);

  // Opening a closed dock pulses the docked row's active cells once (150ms),
  // so the eye finds the row the dock is editing, then brings the dock into
  // the viewport if the page has it below the fold (desktop: in landscape the
  // dock is fixed to the viewport, see below). No pulse and no smooth scroll
  // under reduced motion.
  useEffect(() => {
    if (!dockPulsePendingRef.current || !dock.open) return;
    dockPulsePendingRef.current = false;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!reducedMotion) {
      const cells = tracksRef.current?.querySelectorAll<HTMLElement>('.track-row-wrapper.docked .step-cell.active');
      cells?.forEach(cell => {
        cell.classList.remove('pulse');
        void cell.offsetWidth; // restart the animation if it is still running
        cell.classList.add('pulse');
        cell.addEventListener('animationend', () => cell.classList.remove('pulse'), { once: true });
      });
    }
    if (orientationMode === 'landscape') return;
    const reveal = setTimeout(() => {
      const dockElement = tracksRef.current?.querySelector<HTMLElement>(`#${EDITOR_DOCK_ID}`);
      dockElement?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    }, reducedMotion ? 0 : DOCK_TRANSITION_MS);
    return () => clearTimeout(reveal);
  }, [dock, orientationMode]);

  // Landscape: the dock covers the bottom 45% of the viewport, so whenever it
  // opens on a track or switches to another, that track's row is brought into
  // view above it (EditorDock.css gives the docked row a matching scroll margin).
  const landscapeDockedId = orientationMode === 'landscape' && isDockOpen ? dockedTrack.id : null;
  useEffect(() => {
    if (!landscapeDockedId) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const reveal = setTimeout(() => {
      rowWrapper(landscapeDockedId)?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    }, reducedMotion ? 0 : DOCK_TRANSITION_MS);
    return () => clearTimeout(reveal);
  }, [landscapeDockedId, rowWrapper]);

  return (
    <div
      className={`step-sequencer${isPublished ? ' published' : ''}${isPortraitMode ? ' portrait-mode' : ''}${orientationMode === 'landscape' ? ' landscape-mode' : ''}`}
      data-testid="grid"
      data-orientation={orientationMode}
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

      {/* Portrait mode: Minimal consumption interface */}
      {isPortraitMode && (
        <>
          <PortraitHeader
            isPlaying={state.isPlaying}
            tempo={state.tempo}
            sessionName={multiplayer?.sessionName ?? undefined}
            sessionUrl={multiplayer?.sessionId ? `${window.location.origin}/s/${multiplayer.sessionId}` : undefined}
            onPlayPause={handlePlayPause}
            beatPulse={beatPulse}
            beatPulseDuration={beatPulseDuration}
          />
          <OrientationHint />
          <PortraitGrid
            tracks={state.tracks}
            currentStep={state.currentStep}
            isPlaying={state.isPlaying}
            onPlayPause={handlePlayPause}
            anySoloed={anySoloed}
          />
        </>
      )}

      {/* Desktop transport - always allow play/pause even on published */}
      {!isPortraitMode && <Transport
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
      />}

      {/* Mobile transport bar - drag to adjust values (TE knob style) - landscape only */}
      {!isPortraitMode && <TransportBar
        isPlaying={state.isPlaying}
        tempo={state.tempo}
        swing={state.swing}
        onPlayPause={handlePlayPause}
        onTempoChange={isPublished ? () => {} : handleTempoChange}
        onSwingChange={isPublished ? () => {} : handleSwingChange}
      />}

      {/* Desktop/Landscape: Full sequencer interface */}
      {!isPortraitMode && (
        <>
      {/* Phase 31I: Mixer Panel - side-by-side view of all track volumes */}
      {/* Uses same expand/collapse animation pattern as FX panel */}
      <div
        id="mixer-panel"
        className={`mixer-panel-container ${isMixerOpen ? 'expanded' : ''}`}
        aria-hidden={!isMixerOpen}
        inert={!isMixerOpen}
      >
        <div className="mixer-panel-content">
          <MixerPanel
            tracks={state.tracks}
            anySoloed={anySoloed}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            onSetVolume={handleSetVolume}
            onSetPan={handleSetPan}
            onSetSwing={handleSetTrackSwing}
          />
        </div>
      </div>

      {/* Phase 31H: Pitch Overview Panel - above drag region, consistent with Mixer/FX */}
      <div
        id="pitch-panel"
        className={`pitch-panel-container ${isPitchOpen ? 'expanded' : ''}`}
        aria-hidden={!isPitchOpen}
        inert={!isPitchOpen}
      >
        <div className="pitch-panel-content">
          <PitchOverview
            tracks={state.tracks}
            scale={state.scale}
            currentStep={state.isPlaying ? state.currentStep : -1}
            isPlaying={state.isPlaying}
          />
        </div>
      </div>

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
            <Close size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Phase 29E: Main content area with tracks and scale sidebar */}
      <div className="sequencer-content">
        <div className="tracks" ref={tracksRef}>
          <div className="tracks-inner">
            {/* Phase 31G: Loop ruler - set loop regions by dragging. The first
                row of the scroller, sticky to its top, on the cells' step pitch. */}
            {features.loopRuler && (
              <LoopRuler
                totalSteps={longestTrackStepCount}
                loopRegion={state.loopRegion ?? null}
                onSetLoopRegion={isPublished ? () => {} : handleSetLoopRegion}
                currentStep={state.currentStep}
                isPlaying={state.isPlaying}
              />
            )}
            {/* Phase 34: Show skeletons during session loading to prevent CLS */}
            {multiplayer?.sessionStatus === 'loading' && state.tracks.length === 0 && (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <TrackSkeleton key={`skeleton-${i}`} index={i} />
                ))}
              </>
            )}
            {state.tracks.map((track, trackIndex) => {
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
                  isCopySource={isCopySource}
                  isCopyTarget={!!isCopyTarget}
                  readOnly={isPublished}
                  orientationMode={orientationMode}
                  onToggleStep={(step) => handleToggleStep(track.id, step)}
                  onToggleMute={() => handleToggleMute(track.id)}
                  onToggleSolo={() => handleToggleSolo(track.id)}
                  onSetParameterLock={(step, lock) => handleSetParameterLock(track.id, step, lock)}
                  scale={state.scale}
                  onSetName={(name) => handleSetName(track.id, name)}
                  onSetInstrument={isPublished
                    ? undefined
                    : (sampleId) => handleSetInstrument(track.id, sampleId)}
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
                  isDocked={isTrackDocked(reconciledDock, track.id)}
                  onToggleDock={() => handleToggleDock(track.id)}
                  onOpenDock={() => handleOpenDock(track.id)}
                  isTrackPaneDocked={isTrackDocked(reconciledDock, track.id) && dockPane === 'track'}
                  onToggleTrackPane={() => handleToggleDockTrackPane(track.id)}
                  dockSelectedStep={dockSelectedStep(reconciledDock, track.id)}
                  onSelectDockStep={(step) => handleSelectDockStep(track.id, step)}
                  isInstrumentPickerOpen={isDockInstrumentPickerOpen(reconciledDock, track.id)}
                  onToggleInstrumentPicker={(opener) => handleToggleInstrumentPicker(track.id, opener)}
                />
              );
            })}
            {/* Editor dock: after the rows, never between them. */}
            <EditorDock
              open={isDockOpen}
              track={dockedTrack}
              tracks={state.tracks}
              melodicTracks={melodicTracks}
              pane={dockPane}
              selectedStep={reconciledDock.selectedStep}
              instrumentPickerOpen={reconciledDock.instrumentPickerOpen}
              copySourceId={copySource}
              detent={reconciledDock.detent}
              ghostVisibility={ghostVisibility}
              loopRegion={state.loopRegion ?? null}
              currentStep={state.isPlaying ? state.currentStep : -1}
              anySoloed={anySoloed}
              scale={state.scale}
              readOnly={isPublished}
              scrollerRef={tracksRef}
              landscape={orientationMode === 'landscape'}
              onSelectTrack={handleOpenDock}
              onSetPane={handleSetDockPane}
              onSelectStep={handleSelectDockStep}
              onToggleDetent={handleToggleDockDetent}
              onToggleGhost={handleToggleGhost}
              onClose={handleCloseDock}
              onDismissPane={handleDismissDockPane}
              onToggleStep={handleToggleStep}
              onSetParameterLock={handleSetParameterLock}
              onClearStepLock={handleClearStepLock}
              trackActions={dockTrackActions}
              onToggleInstrumentPicker={handleToggleInstrumentPicker}
            />
          </div>
        </div>

        {/* Phase 29E: Scale Sidebar removed - redundant with scale selector in transport bar */}
      </div>
        </>
      )}

      {/* Phase 36: Keyboard shortcuts help panel (desktop only) */}
      <KeyboardShortcutsPanel
        isOpen={isShortcutsPanelOpen}
        onClose={() => setIsShortcutsPanelOpen(false)}
      />
    </div>
  );
}
