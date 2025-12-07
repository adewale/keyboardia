import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Track, ParameterLock } from '../types';
import { STEPS_PER_PAGE } from '../types';
import { StepCell } from './StepCell';
import { audioEngine } from '../audio/engine';
import './TrackRow.css';

interface TrackRowProps {
  track: Track;
  currentStep: number;
  swing: number;
  hasSteps: boolean;
  canDelete: boolean;
  isCopySource: boolean;
  isCopyTarget: boolean;
  onToggleStep: (step: number) => void;
  onToggleMute: () => void;
  onClear: () => void;
  onDelete: () => void;
  onStartCopy: () => void;
  onCopyTo: () => void;
  onSetParameterLock?: (step: number, lock: ParameterLock | null) => void;
  onSetTranspose?: (transpose: number) => void;
  onSetStepCount?: (stepCount: number) => void;
}

export function TrackRow({
  track,
  currentStep,
  swing,
  hasSteps,
  canDelete,
  isCopySource,
  isCopyTarget,
  onToggleStep,
  onToggleMute,
  onClear,
  onDelete,
  onStartCopy,
  onCopyTo,
  onSetParameterLock,
  onSetTranspose,
  onSetStepCount
}: TrackRowProps) {
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const plockRef = useRef<HTMLDivElement>(null);

  // Get current p-lock for selected step
  const selectedLock = selectedStep !== null ? track.parameterLocks[selectedStep] : null;

  // Auto-dismiss p-lock editor when clicking outside
  useEffect(() => {
    if (selectedStep === null) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (plockRef.current && !plockRef.current.contains(e.target as Node)) {
        setSelectedStep(null);
      }
    };

    // Delay to avoid immediate dismissal
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
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

  const handlePitchChange = useCallback((pitch: number) => {
    if (selectedStep === null || !onSetParameterLock) return;
    const currentLock = track.parameterLocks[selectedStep];
    onSetParameterLock(selectedStep, { ...currentLock, pitch: pitch === 0 ? undefined : pitch });

    // Preview sound immediately
    if (audioEngine.isInitialized()) {
      const time = audioEngine.getCurrentTime();
      audioEngine.playSample(track.sampleId, `preview-${track.id}`, time, undefined, 'oneshot', pitch);
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
  }, [selectedStep, onSetParameterLock]);

  const handleTransposeChange = useCallback((transpose: number) => {
    if (!onSetTranspose) return;

    // Guard against NaN (can happen with undefined track.transpose from old sessions)
    const safeTranspose = Number.isFinite(transpose) ? transpose : 0;
    onSetTranspose(safeTranspose);

    // Preview sound at new pitch
    if (audioEngine.isInitialized()) {
      const time = audioEngine.getCurrentTime();
      const isSynth = track.sampleId.startsWith('synth:');
      if (isSynth) {
        const preset = track.sampleId.replace('synth:', '');
        audioEngine.playSynthNote(`preview-${track.id}`, preset, safeTranspose, time, 0.2);
      } else {
        audioEngine.playSample(track.sampleId, `preview-${track.id}`, time, undefined, 'oneshot', safeTranspose);
      }
    }
  }, [onSetTranspose, track.sampleId, track.id]);

  return (
    <div className="track-row-wrapper">
      <div className={`track-row ${track.muted ? 'muted' : ''} ${isCopySource ? 'copy-source' : ''} ${isCopyTarget ? 'copy-target' : ''}`}>
        {/* Track controls - left side */}
        <div className="track-controls">
          <button
            className={`mute-button ${track.muted ? 'active' : ''}`}
            onClick={onToggleMute}
            aria-label={track.muted ? 'Unmute' : 'Mute'}
          >
            M
          </button>
          <span className="track-name">{track.name}</span>

          {/* Transpose control */}
          <div className="transpose-control" title="Track transpose (semitones)">
            <button
              className="transpose-btn"
              onClick={() => handleTransposeChange((track.transpose ?? 0) - 1)}
              disabled={(track.transpose ?? 0) <= -12}
            >
              −
            </button>
            <span className={`transpose-value ${(track.transpose ?? 0) !== 0 ? 'active' : ''}`}>
              {(track.transpose ?? 0) > 0 ? '+' : ''}{track.transpose ?? 0}
            </span>
            <button
              className="transpose-btn"
              onClick={() => handleTransposeChange((track.transpose ?? 0) + 1)}
              disabled={(track.transpose ?? 0) >= 12}
            >
              +
            </button>
          </div>

          {/* Step count control - quick presets for 16/32/64 steps */}
          <div className="step-count-control" title="Pattern length">
            {[16, 32, 64].map((count) => (
              <button
                key={count}
                className={`step-preset-btn ${(track.stepCount ?? STEPS_PER_PAGE) === count ? 'active' : ''}`}
                onClick={() => onSetStepCount?.(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        {/* Step grid - only render steps up to stepCount */}
        <div className="steps">
          {(() => {
            // Calculate trackPlayingStep ONCE outside the map
            const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
            const trackPlayingStep = currentStep >= 0 ? currentStep % trackStepCount : -1;

            return track.steps.slice(0, trackStepCount).map((active, index) => (
              <StepCell
                key={index}
                active={active}
                playing={trackPlayingStep === index}
                stepIndex={index}
                parameterLock={track.parameterLocks[index]}
                swing={swing}
                selected={selectedStep === index}
                isPageEnd={(index + 1) % STEPS_PER_PAGE === 0 && index < trackStepCount - 1}
                onClick={stepClickHandlers[index]}
                onSelect={stepSelectHandlers[index]}
              />
            ));
          })()}
        </div>

        {/* Track actions - right side */}
        <div className="track-actions">
          {isCopyTarget ? (
            <button className="action-btn paste" onClick={onCopyTo} title="Paste here">
              PST
            </button>
          ) : (
            <>
              <button
                className="action-btn"
                onClick={onStartCopy}
                disabled={!hasSteps}
                title="Copy"
              >
                CPY
              </button>
              <button
                className="action-btn"
                onClick={onClear}
                disabled={!hasSteps}
                title="Clear"
              >
                CLR
              </button>
              {canDelete && (
                <button
                  className="action-btn delete"
                  onClick={onDelete}
                  title="Delete"
                >
                  DEL
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Inline parameter lock editor - appears when step selected */}
      {selectedStep !== null && track.steps[selectedStep] && (
        <div className="plock-inline" ref={plockRef}>
          <span className="plock-step">Step {selectedStep + 1}</span>

          <div className="plock-control">
            <span className="plock-label pitch">Pitch</span>
            <input
              type="range"
              min="-12"
              max="12"
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

          {(selectedLock?.pitch !== undefined || selectedLock?.volume !== undefined) && (
            <button className="plock-clear" onClick={handleClearLock}>✕</button>
          )}
        </div>
      )}
    </div>
  );
}
