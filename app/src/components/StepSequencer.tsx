import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { ParameterLock, EffectsState, PlaybackMode, FMParams, ScaleState } from '../types';
import { useGrid } from '../state/grid';
import { useMultiplayerContext } from '../context/MultiplayerContext';
import { signalMusicIntent, requireAudioEngine } from '../audio/audioTriggers';
import { audioEngine } from '../audio/engine';
import { scheduler } from '../audio/scheduler';
import { logger } from '../utils/logger';
import { TrackRow } from './TrackRow';
import { Transport } from './Transport';
import { TransportBar } from './TransportBar';
import { CursorOverlay } from './CursorOverlay';
import { ScaleSidebar } from './ScaleSidebar';
import './StepSequencer.css';
import './TransportBar.css';

export function StepSequencer() {
  const { state, dispatch: gridDispatch } = useGrid();
  const multiplayer = useMultiplayerContext();

  // Use multiplayer dispatch if connected, otherwise regular dispatch
  const dispatch = multiplayer?.dispatch ?? gridDispatch;
  const stateRef = useRef(state);
  const [copySource, setCopySource] = useState<string | null>(null);
  const copySourceRef = useRef(copySource);

  // Phase 11: Container ref for cursor tracking
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep ref updated for scheduler
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Keep copySource ref in sync (for stable keyboard listener)
  useEffect(() => {
    copySourceRef.current = copySource;
  }, [copySource]);

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

  const handleSetPlaybackMode = useCallback((trackId: string, playbackMode: PlaybackMode) => {
    dispatch({ type: 'SET_TRACK_PLAYBACK_MODE', trackId, playbackMode });
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


  // Cancel copy on escape (use ref to avoid recreating listener on copySource change)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && copySourceRef.current) {
        setCopySource(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // Stable listener - uses ref instead of state

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      scheduler.stop();
    };
  }, []);

  // Calculate if any track is soloed (for playhead visibility)
  const anySoloed = useMemo(() => state.tracks.some(t => t.soloed), [state.tracks]);

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

      {/* Phase 29E: Main content area with tracks and scale sidebar */}
      <div className="sequencer-content">
        <div className="tracks">
          {state.tracks.map((track) => {
            const hasSteps = track.steps.some(s => s);
            const isCopySource = copySource === track.id;
            const isCopyTarget = copySource && !isCopySource;

            return (
              <TrackRow
                key={track.id}
                track={track}
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
                onSetPlaybackMode={(playbackMode) => handleSetPlaybackMode(track.id, playbackMode)}
                onSetFMParams={(fmParams) => handleSetFMParams(track.id, fmParams)}
                onSetVolume={(volume) => handleSetVolume(track.id, volume)}
                scale={state.scale}
              />
            );
          })}
        </div>

        {/* Phase 29E: Scale Sidebar (visualization) */}
        <ScaleSidebar scale={state.scale} />
      </div>
    </div>
  );
}
