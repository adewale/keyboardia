import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Track, ParameterLock } from '../types';
import { STEPS_PER_PAGE, STEP_COUNT_OPTIONS, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { StepCell } from './StepCell';
import { ChromaticGrid, PitchContour } from './ChromaticGrid';
import { InlineDrawer } from './InlineDrawer';
import { audioEngine } from '../audio/engine';
import { useRemoteChanges } from '../context/RemoteChangeContext';
import './TrackRow.css';
import './ChromaticGrid.css';
import './InlineDrawer.css';

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
}

export function TrackRow({
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
  onSetStepCount
}: TrackRowProps) {
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const plockRef = useRef<HTMLDivElement>(null);
  const remoteChanges = useRemoteChanges();

  // Check if this is a synth track (can use chromatic view)
  const isSynthTrack = track.sampleId.startsWith('synth:');

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
    setSelectedStep(null); // Close the panel after clearing
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
      {/* Mobile: Track header row with name only */}
      <div className={`track-header-mobile ${track.muted ? 'muted' : ''} ${track.soloed ? 'soloed' : ''}`}>
        <span className="track-name-mobile">
          {track.name}
          {isSynthTrack && <span className="track-type-badge">♪</span>}
          {track.muted && <span className="track-status-badge muted">M</span>}
          {track.soloed && <span className="track-status-badge soloed">S</span>}
        </span>
      </div>

      <div className={`track-row ${track.muted ? 'muted' : ''} ${track.soloed ? 'soloed' : ''} ${isCopySource ? 'copy-source' : ''} ${isCopyTarget ? 'copy-target' : ''}`}>
        {/* Grid column: mute */}
        <button
          className={`mute-button ${track.muted ? 'active' : ''}`}
          onClick={onToggleMute}
          aria-label={track.muted ? 'Unmute' : 'Mute'}
        >
          M
        </button>

        {/* Grid column: solo */}
        <button
          className={`solo-button ${track.soloed ? 'active' : ''}`}
          onClick={onToggleSolo}
          aria-label={track.soloed ? 'Unsolo' : 'Solo'}
        >
          S
        </button>

        {/* Grid column: name - tappable on mobile to open drawer */}
        <span
          className="track-name"
          title={track.name}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          role="button"
          tabIndex={0}
        >
          {track.name}
        </span>

        {/* Grid column: transpose */}
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

        {/* Grid column: step-count */}
        <select
          className="step-count-select"
          value={track.stepCount ?? STEPS_PER_PAGE}
          onChange={(e) => onSetStepCount?.(Number(e.target.value))}
          title="Pattern length (steps)"
        >
          {STEP_COUNT_OPTIONS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>

        {/* Grid column: expand (chromatic view toggle for synth tracks, placeholder otherwise) */}
        {isSynthTrack ? (
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
        ) : (
          <div className="expand-placeholder" />
        )}

        {/* Step grid - only render steps up to stepCount */}
        <div className={`steps ${isSynthTrack && !isExpanded ? 'steps-with-contour' : ''}`}>
          {(() => {
            // Calculate trackPlayingStep ONCE outside the map
            const trackStepCount = track.stepCount ?? STEPS_PER_PAGE;
            const trackPlayingStep = currentStep >= 0 ? currentStep % trackStepCount : -1;

            // Determine if track is audible (for playhead visibility)
            // Track is audible if: (no tracks soloed AND not muted) OR (some tracks soloed AND this one is soloed)
            const isAudible = anySoloed ? track.soloed : !track.muted;
            const showPlayhead = !HIDE_PLAYHEAD_ON_SILENT_TRACKS || isAudible;

            return track.steps.slice(0, trackStepCount).map((active, index) => (
              <StepCell
                key={index}
                active={active}
                playing={showPlayhead && trackPlayingStep === index}
                stepIndex={index}
                parameterLock={track.parameterLocks[index]}
                swing={swing}
                selected={selectedStep === index}
                isPageEnd={(index + 1) % STEPS_PER_PAGE === 0 && index < trackStepCount - 1}
                flashColor={remoteChanges?.getFlashColor(track.id, index)}
                onClick={stepClickHandlers[index]}
                onSelect={stepSelectHandlers[index]}
              />
            ));
          })()}
          {/* Pitch contour overlay for collapsed synth tracks */}
          {isSynthTrack && !isExpanded && (
            <PitchContour track={track} currentStep={currentStep} anySoloed={anySoloed} />
          )}
        </div>

        {/* Track actions - right side (desktop) */}
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
            >
              M
            </button>
            <button
              className={`drawer-toggle-btn ${track.soloed ? 'active soloed' : ''}`}
              onClick={onToggleSolo}
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
              disabled={(track.transpose ?? 0) <= -12}
            >
              −
            </button>
            <span className={`drawer-stepper-value ${(track.transpose ?? 0) !== 0 ? 'active' : ''}`}>
              {(track.transpose ?? 0) > 0 ? '+' : ''}{track.transpose ?? 0}
            </span>
            <button
              className="drawer-stepper-btn"
              onClick={() => handleTransposeChange((track.transpose ?? 0) + 1)}
              disabled={(track.transpose ?? 0) >= 12}
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

      {/* Chromatic grid - expanded pitch view for synth tracks */}
      {isSynthTrack && isExpanded && onSetParameterLock && (
        <ChromaticGrid
          track={track}
          currentStep={currentStep}
          anySoloed={anySoloed}
          onSetParameterLock={onSetParameterLock}
          onToggleStep={onToggleStep}
        />
      )}

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
