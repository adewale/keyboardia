import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { ParameterLock } from '../types';
import { useGrid } from '../state/grid';
import { useMultiplayerContext } from '../context/MultiplayerContext';
import { audioEngine } from '../audio/engine';
import { scheduler } from '../audio/scheduler';
import { logger } from '../utils/logger';
import { TrackRow } from './TrackRow';
import { Transport } from './Transport';
import { TransportBar } from './TransportBar';
import { CursorOverlay } from './CursorOverlay';
import './StepSequencer.css';
import './TransportBar.css';

export function StepSequencer() {
  const { state, dispatch: gridDispatch } = useGrid();
  const multiplayer = useMultiplayerContext();

  // Use multiplayer dispatch if connected, otherwise regular dispatch
  const dispatch = multiplayer?.dispatch ?? gridDispatch;
  const stateRef = useRef(state);
  const [copySource, setCopySource] = useState<string | null>(null);

  // Phase 11: Container ref for cursor tracking
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep ref updated for scheduler
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Initialize audio on first interaction
  const initAudio = useCallback(async () => {
    if (!audioEngine.isInitialized()) {
      await audioEngine.initialize();
    }
  }, []);

  // Handle play/pause
  const handlePlayPause = useCallback(async () => {
    await initAudio();

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
      scheduler.setOnStepChange((step) => {
        dispatch({ type: 'SET_CURRENT_STEP', step });
      });
      scheduler.start(() => stateRef.current);
      dispatch({ type: 'SET_PLAYING', isPlaying: true });
    }
  }, [state.isPlaying, dispatch, initAudio]);

  const handleTempoChange = useCallback((tempo: number) => {
    dispatch({ type: 'SET_TEMPO', tempo });
  }, [dispatch]);

  const handleSwingChange = useCallback((swing: number) => {
    dispatch({ type: 'SET_SWING', swing });
  }, [dispatch]);

  const handleToggleStep = useCallback((trackId: string, step: number) => {
    initAudio();
    dispatch({ type: 'TOGGLE_STEP', trackId, step });
  }, [dispatch, initAudio]);

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

  const handleFillTrack = useCallback((trackId: string, interval: number = 4) => {
    dispatch({ type: 'FILL_TRACK', trackId, interval });
  }, [dispatch]);

  const handleRotateTrack = useCallback((trackId: string, direction: number) => {
    dispatch({ type: 'ROTATE_TRACK', trackId, direction });
  }, [dispatch]);

  const handleInvertTrack = useCallback((trackId: string) => {
    dispatch({ type: 'INVERT_TRACK', trackId });
  }, [dispatch]);

  const handleRandomFillTrack = useCallback((trackId: string, density: number = 50) => {
    dispatch({ type: 'RANDOM_FILL_TRACK', trackId, density });
  }, [dispatch]);

  const handleRenameTrack = useCallback((trackId: string, name: string) => {
    dispatch({ type: 'RENAME_TRACK', trackId, name });
  }, [dispatch]);

  const handleDeleteTrack = useCallback((trackId: string) => {
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

  // Mute all tracks
  const handleMuteAll = useCallback(() => {
    state.tracks.forEach(track => {
      if (!track.muted) {
        dispatch({ type: 'TOGGLE_MUTE', trackId: track.id });
      }
    });
  }, [dispatch, state.tracks]);

  // Clear all solos
  const handleClearSolos = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL_SOLOS' });
  }, [dispatch]);

  // Unmute all tracks
  const handleUnmuteAll = useCallback(() => {
    state.tracks.forEach(track => {
      if (track.muted) {
        dispatch({ type: 'TOGGLE_MUTE', trackId: track.id });
      }
    });
  }, [dispatch, state.tracks]);

  // Stop playback and reset to step 0
  const handleStop = useCallback(() => {
    if (state.isPlaying) {
      scheduler.stop();
      dispatch({ type: 'SET_PLAYING', isPlaying: false });
    }
    dispatch({ type: 'SET_CURRENT_STEP', step: -1 });
  }, [state.isPlaying, dispatch]);

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


  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Spacebar: play/pause
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault(); // Prevent page scroll
        handlePlayPause();
        return;
      }

      // Escape: cancel copy mode OR stop and reset playhead
      if (e.key === 'Escape') {
        if (copySource) {
          setCopySource(null);
        } else {
          handleStop();
        }
        return;
      }

      // Number keys 1-8: solo tracks (Shift+number: mute)
      const num = parseInt(e.key);
      if (num >= 1 && num <= 8) {
        const trackIndex = num - 1;
        if (trackIndex < state.tracks.length) {
          const trackId = state.tracks[trackIndex].id;
          if (e.shiftKey) {
            // Shift+number: toggle mute
            handleToggleMute(trackId);
          } else {
            // Number alone: toggle solo
            handleToggleSolo(trackId);
          }
        }
        return;
      }

      // L key: show "coming soon" hint for loop feature
      if (e.key === 'l' || e.key === 'L') {
        // This would show a toast - for now just log
        console.log('Loop selection coming soon!');
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySource, handlePlayPause, handleStop, handleToggleMute, handleToggleSolo, state.tracks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      scheduler.stop();
    };
  }, []);

  // Calculate if any track is soloed (for playhead visibility)
  const anySoloed = useMemo(() => state.tracks.some(t => t.soloed), [state.tracks]);

  // Calculate max steps across all tracks for step position display
  const maxSteps = useMemo(() => {
    if (state.tracks.length === 0) return 16;
    return Math.max(...state.tracks.map(t => t.stepCount ?? 16));
  }, [state.tracks]);

  // Calculate min steps for dimming beat markers beyond shortest track
  const minSteps = useMemo(() => {
    if (state.tracks.length === 0) return 16;
    return Math.min(...state.tracks.map(t => t.stepCount ?? 16));
  }, [state.tracks]);

  // Calculate progress percentage for progress bar
  const progressPercent = useMemo(() => {
    if (!state.isPlaying || state.currentStep < 0) return 0;
    return ((state.currentStep % maxSteps) / maxSteps) * 100;
  }, [state.isPlaying, state.currentStep, maxSteps]);

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

  return (
    <div
      className={`step-sequencer ${copySource ? 'copy-mode' : ''}`}
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

      {/* Desktop transport */}
      <Transport
        isPlaying={state.isPlaying}
        tempo={state.tempo}
        swing={state.swing}
        currentStep={state.currentStep}
        maxSteps={maxSteps}
        onPlayPause={handlePlayPause}
        onTempoChange={handleTempoChange}
        onSwingChange={handleSwingChange}
        onMuteAll={handleMuteAll}
        onUnmuteAll={handleUnmuteAll}
        onClearSolos={handleClearSolos}
      />

      {/* Mobile transport bar - drag to adjust values (TE knob style) */}
      <TransportBar
        isPlaying={state.isPlaying}
        tempo={state.tempo}
        swing={state.swing}
        onPlayPause={handlePlayPause}
        onTempoChange={handleTempoChange}
        onSwingChange={handleSwingChange}
      />

      {/* Progress bar - shows position in pattern */}
      {state.isPlaying && (
        <div className="progress-bar-container">
          <div className="progress-bar-spacer" />
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Beat markers row - shows bar divisions above the grid */}
      <div className="beat-markers" aria-hidden="true">
        <div className="beat-markers-spacer" /> {/* Space for track controls */}
        <div className="beat-markers-grid">
          {Array.from({ length: maxSteps }, (_, i) => {
            const isDownbeat = i % 4 === 0;
            const beatNumber = Math.floor(i / 4) + 1;
            const isDimmed = i >= minSteps && state.tracks.length > 1;
            return (
              <span
                key={i}
                className={`beat-marker ${isDownbeat ? 'downbeat' : ''} ${isDimmed ? 'dimmed' : ''}`}
              >
                {isDownbeat ? beatNumber : '·'}
              </span>
            );
          })}
        </div>
      </div>

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
              onFill={(interval) => handleFillTrack(track.id, interval)}
              onRotate={(direction) => handleRotateTrack(track.id, direction)}
              onInvert={() => handleInvertTrack(track.id)}
              onRandomFill={(density) => handleRandomFillTrack(track.id, density)}
              onRename={(name) => handleRenameTrack(track.id, name)}
              onDelete={() => handleDeleteTrack(track.id)}
              onStartCopy={() => handleStartCopy(track.id)}
              onCopyTo={() => handleCopyTo(track.id)}
              onSetParameterLock={(step, lock) => handleSetParameterLock(track.id, step, lock)}
              onSetTranspose={(transpose) => handleSetTranspose(track.id, transpose)}
              onSetStepCount={(stepCount) => handleSetStepCount(track.id, stepCount)}
            />
          );
        })}
      </div>
    </div>
  );
}
