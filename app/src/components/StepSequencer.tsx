import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParameterLock } from '../types';
import { DEFAULT_SAMPLES } from '../types';
import { useGrid } from '../state/grid';
import { audioEngine } from '../audio/engine';
import { scheduler } from '../audio/scheduler';
import { TrackRow } from './TrackRow';
import { Transport } from './Transport';
import './StepSequencer.css';

export function StepSequencer() {
  const { state, dispatch } = useGrid();
  const stateRef = useRef(state);
  const [copySource, setCopySource] = useState<string | null>(null);

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
    dispatch({ type: 'TOGGLE_MUTE', trackId });
  }, [dispatch]);

  const handleClearTrack = useCallback((trackId: string) => {
    dispatch({ type: 'CLEAR_TRACK', trackId });
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


  // Cancel copy on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && copySource) {
        setCopySource(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySource]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      scheduler.stop();
    };
  }, []);

  return (
    <div className="step-sequencer" data-testid="grid">
      <Transport
        isPlaying={state.isPlaying}
        tempo={state.tempo}
        swing={state.swing}
        onPlayPause={handlePlayPause}
        onTempoChange={handleTempoChange}
        onSwingChange={handleSwingChange}
      />


      <div className="tracks">
        {state.tracks.map((track, index) => {
          const isPreset = index < DEFAULT_SAMPLES.length;
          const hasSteps = track.steps.some(s => s);
          const isCopySource = copySource === track.id;
          const isCopyTarget = copySource && !isCopySource;

          return (
            <TrackRow
              key={track.id}
              track={track}
              currentStep={state.isPlaying ? state.currentStep : -1}
              swing={state.swing}
              hasSteps={hasSteps}
              canDelete={!isPreset}
              isCopySource={isCopySource}
              isCopyTarget={!!isCopyTarget}
              onToggleStep={(step) => handleToggleStep(track.id, step)}
              onToggleMute={() => handleToggleMute(track.id)}
              onClear={() => handleClearTrack(track.id)}
              onDelete={() => handleDeleteTrack(track.id)}
              onStartCopy={() => handleStartCopy(track.id)}
              onCopyTo={() => handleCopyTo(track.id)}
              onSetParameterLock={(step, lock) => handleSetParameterLock(track.id, step, lock)}
              onSetTranspose={(transpose) => handleSetTranspose(track.id, transpose)}
            />
          );
        })}
      </div>
    </div>
  );
}
