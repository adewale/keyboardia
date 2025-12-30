import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Track, ParameterLock, PlaybackMode, FMParams, ScaleState } from '../types';
import { STEPS_PER_PAGE, STEP_COUNT_OPTIONS, HIDE_PLAYHEAD_ON_SILENT_TRACKS } from '../types';
import { StepCell } from './StepCell';
import { ChromaticGrid, PitchContour } from './ChromaticGrid';
import { InlineDrawer } from './InlineDrawer';
import { tryGetEngineForPreview } from '../audio/audioTriggers';
import { useRemoteChanges } from '../context/RemoteChangeContext';
import './TrackRow.css';
import './ChromaticGrid.css';
import './InlineDrawer.css';

// Tone.js drum synths that should NOT show keyboard view (they're percussive, not melodic)
const TONE_DRUM_SYNTHS = ['tone:membrane-kick', 'tone:membrane-tom', 'tone:metal-cymbal', 'tone:metal-hihat'];

/**
 * Check if an instrument is melodic (should show chromatic/keyboard view)
 * Melodic instruments can play different pitches, percussive instruments cannot
 */
function isMelodicInstrument(sampleId: string): boolean {
  // All synth: prefixed instruments are melodic
  if (sampleId.startsWith('synth:')) return true;
  // All advanced: prefixed instruments are melodic
  if (sampleId.startsWith('advanced:')) return true;
  // All sampled: prefixed instruments are melodic (like piano)
  if (sampleId.startsWith('sampled:')) return true;
  // Tone.js synths - some are melodic, some are drums
  if (sampleId.startsWith('tone:')) {
    return !TONE_DRUM_SYNTHS.includes(sampleId);
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
  onSetPlaybackMode?: (playbackMode: PlaybackMode) => void;
  onSetFMParams?: (fmParams: FMParams) => void;
  onSetVolume?: (volume: number) => void;
  scale?: ScaleState; // Phase 29E: Scale state for Key Assistant
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
  onSetPlaybackMode,
  onSetFMParams,
  onSetVolume,
  scale
}: TrackRowProps) {
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const plockRef = useRef<HTMLDivElement>(null);
  const remoteChanges = useRemoteChanges();

  // Check if this is a melodic track (can use chromatic/keyboard view)
  const isMelodicTrack = isMelodicInstrument(track.sampleId);

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
        audioEngine.playSample(track.sampleId, `preview-${track.id}`, time, undefined, 'oneshot', safeTranspose);
      }
    }
  }, [onSetTranspose, track.sampleId, track.id]);

  const handlePlaybackModeChange = useCallback(() => {
    if (!onSetPlaybackMode) return;
    const newMode: PlaybackMode = track.playbackMode === 'oneshot' ? 'gate' : 'oneshot';
    onSetPlaybackMode(newMode);
  }, [onSetPlaybackMode, track.playbackMode]);

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

        {/* Grid column: volume - Phase 25 per-track volume control */}
        <div className="track-volume-control" title={`Volume: ${Math.round((track.volume ?? 1) * 100)}%`}>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round((track.volume ?? 1) * 100)}
            onChange={(e) => handleTrackVolumeChange(Number(e.target.value) / 100)}
            className="track-volume-slider"
          />
        </div>

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
            disabled={(track.transpose ?? 0) <= -24}
          >
            −
          </button>
          <span className={`transpose-value ${(track.transpose ?? 0) !== 0 ? 'active' : ''}`}>
            {(track.transpose ?? 0) > 0 ? '+' : ''}{track.transpose ?? 0}
          </span>
          <button
            className="transpose-btn"
            onClick={() => handleTransposeChange((track.transpose ?? 0) + 1)}
            disabled={(track.transpose ?? 0) >= 24}
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

        {/* Grid column: playback-mode */}
        <button
          className={`playback-mode-btn ${track.playbackMode === 'gate' ? 'gate' : 'oneshot'}`}
          onClick={handlePlaybackModeChange}
          title={track.playbackMode === 'oneshot'
            ? 'One-shot: plays to completion. Click for Gate mode.'
            : 'Gate: cuts at step boundary. Click for One-shot mode.'}
          aria-label={`Playback mode: ${track.playbackMode ?? 'oneshot'}`}
        >
          {track.playbackMode === 'gate' ? '▬' : '●'}
        </button>

        {/* Grid column: expand (chromatic view toggle for synth tracks, placeholder otherwise) */}
        {isMelodicTrack ? (
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
        <div className={`steps ${isMelodicTrack && !isExpanded ? 'steps-with-contour' : ''}`}>
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
          {isMelodicTrack && !isExpanded && (
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

        {/* Row 4: Playback mode */}
        <div className="drawer-row">
          <span className="drawer-label">Mode</span>
          <button
            className={`drawer-mode-btn ${track.playbackMode === 'gate' ? 'gate' : ''}`}
            onClick={handlePlaybackModeChange}
            title={track.playbackMode === 'oneshot'
              ? 'One-shot: plays to completion'
              : 'Gate: cuts at step boundary'}
          >
            {track.playbackMode === 'oneshot' ? '● One-shot' : '▬ Gate'}
          </button>
        </div>

        {/* Row 5: Volume */}
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

      {/* Chromatic grid - expanded pitch view for synth tracks */}
      {isMelodicTrack && isExpanded && onSetParameterLock && (
        <ChromaticGrid
          track={track}
          currentStep={currentStep}
          anySoloed={anySoloed}
          onSetParameterLock={onSetParameterLock}
          onToggleStep={onToggleStep}
          scale={scale}
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
