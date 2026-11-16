/**
 * The editor dock's Step and Track toolbars (specs/PIANO-ROLL-DOCK.md,
 * phases 6 and 7). Each renders under the dock header for the docked track;
 * the roll stays visible beneath them.
 *
 * Step absorbs the ParameterLockEditor strip that used to open between rows.
 * Track absorbs the controls the two-line row block gave up: transpose, step
 * count, instrument, pattern tools, FM parameters and the track actions.
 * Both reuse the existing components (AFFORDANCES C-2) and only adapt their
 * callbacks to (trackId, step).
 */

import { memo, useCallback, useMemo } from 'react';
import type { FMParams, ParameterLock, Track } from '../types';
import { STEPS_PER_PAGE } from '../types';
import { ParameterLockEditor } from './ParameterLockEditor';
import { PatternToolsPanel } from './PatternToolsPanel';
import { SamplePicker } from './SamplePicker';
import { StepCountDropdown } from './StepCountDropdown';
import { TransposeDropdown } from './TransposeDropdown';
import { getInstrumentName } from './sample-constants';
import { previewInstrument } from '../audio/audioTriggers';
import { isDrumInstrument } from '../shared/instrument-classification';
import { ChevronDown, ChevronUp } from '../icons';

/** DOM id of the Track pane's instrument picker, for aria-controls. */
export const DOCK_INSTRUMENT_PICKER_ID = 'dock-instrument-picker';

// ---------------------------------------------------------------------------
// Step pane
// ---------------------------------------------------------------------------

interface DockStepPaneProps {
  track: Track;
  /** The selected step; null, inactive or past the track's end shows a hint. */
  step: number | null;
  readOnly: boolean;
  onSetParameterLock: (trackId: string, step: number, lock: ParameterLock | null) => void;
  /** Clear the step's lock; the dock then leaves the Step pane. */
  onClearLock: (trackId: string, step: number) => void;
}

export const DockStepPane = memo(function DockStepPane({
  track,
  step,
  readOnly,
  onSetParameterLock,
  onClearLock,
}: DockStepPaneProps) {
  const stepCount = track.stepCount ?? STEPS_PER_PAGE;
  const editable = step !== null && step >= 0 && step < stepCount && track.steps[step];
  const lock = step !== null ? track.parameterLocks[step] ?? null : null;
  const trackId = track.id;
  const sampleId = track.sampleId;

  const handlePitchChange = useCallback(async (pitch: number) => {
    if (step === null || readOnly) return;
    onSetParameterLock(trackId, step, { ...lock, pitch: pitch === 0 ? undefined : pitch });
    // Preview sound (only if audio already loaded - don't block for slider)
    await previewInstrument('preview_pitch', {
      sampleId,
      previewId: `preview-${trackId}`,
      pitch,
    });
  }, [step, readOnly, lock, trackId, sampleId, onSetParameterLock]);

  const handleVolumeChange = useCallback((volume: number) => {
    if (step === null || readOnly) return;
    onSetParameterLock(trackId, step, { ...lock, volume: volume === 1 ? undefined : volume });
  }, [step, readOnly, lock, trackId, onSetParameterLock]);

  const handleTieToggle = useCallback(() => {
    if (step === null || readOnly) return;
    onSetParameterLock(trackId, step, { ...lock, tie: !lock?.tie || undefined });
  }, [step, readOnly, lock, trackId, onSetParameterLock]);

  const handleClearLock = useCallback(() => {
    if (step === null || readOnly) return;
    onClearLock(trackId, step);
  }, [step, readOnly, trackId, onClearLock]);

  if (!editable) {
    return (
      <p className="dock-pane-hint">
        Shift+click an active cell in the {track.name} row to edit its lock.
      </p>
    );
  }

  return (
    <ParameterLockEditor
      step={step}
      lock={lock}
      onPitchChange={handlePitchChange}
      onVolumeChange={handleVolumeChange}
      onTieToggle={handleTieToggle}
      onClearLock={handleClearLock}
      disabled={readOnly}
      sampleId={sampleId}
      transpose={track.transpose ?? 0}
    />
  );
});

// ---------------------------------------------------------------------------
// Track pane
// ---------------------------------------------------------------------------

/** The track edits the Track pane makes, each addressed by track id. */
export interface DockTrackActions {
  onSetTranspose: (trackId: string, transpose: number) => void;
  onSetStepCount: (trackId: string, stepCount: number) => void;
  /** Absent in a published session, which hides the instrument picker. */
  onSetInstrument?: (trackId: string, sampleId: string) => void;
  onSetFMParams: (trackId: string, fmParams: FMParams) => void;
  onRotatePattern: (trackId: string, direction: 'left' | 'right') => void;
  onInvertPattern: (trackId: string) => void;
  onReversePattern: (trackId: string) => void;
  onMirrorPattern: (trackId: string) => void;
  onEuclideanFill: (trackId: string, hits: number) => void;
  onSetTrackSwing: (trackId: string, swing: number) => void;
  onStartCopy: (trackId: string) => void;
  onCopyTo: (trackId: string) => void;
  onClearTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
}

/** FM synth presets carry harmonicity and modulation index. */
function isFMSynth(sampleId: string): boolean {
  return sampleId.startsWith('tone:fm-');
}

/** Default FM params for each FM preset (based on toneSynths.ts presets). */
const FM_PRESET_DEFAULTS: Record<string, FMParams> = {
  'tone:fm-epiano': { harmonicity: 3.01, modulationIndex: 10 },
  'tone:fm-bass': { harmonicity: 2, modulationIndex: 8 },
  'tone:fm-bell': { harmonicity: 5.01, modulationIndex: 14 },
};

interface DockTrackPaneProps {
  track: Track;
  readOnly: boolean;
  /** The track a copy started from, so another track offers Paste. */
  copySourceId: string | null;
  instrumentPickerOpen: boolean;
  actions: DockTrackActions;
  onToggleInstrumentPicker: (trackId: string, opener: HTMLElement) => void;
}

export const DockTrackPane = memo(function DockTrackPane({
  track,
  readOnly,
  copySourceId,
  instrumentPickerOpen,
  actions,
  onToggleInstrumentPicker,
}: DockTrackPaneProps) {
  const trackId = track.id;
  const stepCount = track.stepCount ?? STEPS_PER_PAGE;
  const isMelodic = !isDrumInstrument(track.sampleId);
  const hasSteps = track.steps.some(Boolean);
  const activeStepCount = useMemo(
    () => track.steps.slice(0, stepCount).filter(Boolean).length,
    [track.steps, stepCount],
  );
  const canChangeInstrument = !!actions.onSetInstrument && !readOnly;
  const isCopyTarget = copySourceId !== null && copySourceId !== trackId;

  const handleTransposeChange = useCallback(async (transpose: number) => {
    // Guard against NaN (can happen with undefined track.transpose from old sessions)
    const safeTranspose = Number.isFinite(transpose) ? transpose : 0;
    actions.onSetTranspose(trackId, safeTranspose);
    // Preview sound (only if audio already loaded - don't block for the menu)
    await previewInstrument('preview_transpose', {
      sampleId: track.sampleId,
      previewId: `preview-${trackId}`,
      pitch: safeTranspose,
    });
  }, [actions, trackId, track.sampleId]);

  const handleStepCountChange = useCallback(
    (count: number) => actions.onSetStepCount(trackId, count),
    [actions, trackId],
  );

  const fmParams = useMemo(
    () => track.fmParams ?? FM_PRESET_DEFAULTS[track.sampleId] ?? { harmonicity: 3, modulationIndex: 10 },
    [track.fmParams, track.sampleId],
  );

  const pattern = useMemo(() => ({
    onRotate: (direction: 'left' | 'right') => actions.onRotatePattern(trackId, direction),
    onInvert: () => actions.onInvertPattern(trackId),
    onReverse: () => actions.onReversePattern(trackId),
    onMirror: () => actions.onMirrorPattern(trackId),
    onEuclideanFill: (hits: number) => actions.onEuclideanFill(trackId, hits),
    onSwingChange: (swing: number) => actions.onSetTrackSwing(trackId, swing),
  }), [actions, trackId]);

  const instrumentName = getInstrumentName(track.sampleId);

  return (
    <>
      <div className="dock-pane dock-pane-track">
        {isMelodic && (
          <div className="dock-tool-group">
            <span className="dock-tool-label">Transpose</span>
            <TransposeDropdown value={track.transpose ?? 0} onChange={handleTransposeChange} disabled={readOnly} />
          </div>
        )}
        <div className="dock-tool-group">
          <span className="dock-tool-label">Steps</span>
          <StepCountDropdown value={stepCount} onChange={handleStepCountChange} disabled={readOnly} />
        </div>
        <div className="dock-tool-group">
          <span className="dock-tool-label">Instrument</span>
          {canChangeInstrument ? (
            <button
              type="button"
              className={`dock-tool-button dock-instrument-button${instrumentPickerOpen ? ' active' : ''}`}
              onClick={(event) => onToggleInstrumentPicker(trackId, event.currentTarget)}
              aria-expanded={instrumentPickerOpen}
              aria-controls={instrumentPickerOpen ? DOCK_INSTRUMENT_PICKER_ID : undefined}
              title={`Change instrument (currently ${instrumentName})`}
              data-testid={`dock-change-instrument-${trackId}`}
            >
              {instrumentName}
              {instrumentPickerOpen
                ? <ChevronUp size={12} aria-hidden="true" />
                : <ChevronDown size={12} aria-hidden="true" />}
            </button>
          ) : (
            <span className="dock-tool-readout">{instrumentName}</span>
          )}
        </div>
        {isFMSynth(track.sampleId) && (
          <div className="dock-tool-group dock-fm-controls">
            <label className="fm-control">
              <span className="fm-label">Harmonicity</span>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.1"
                value={fmParams.harmonicity}
                onChange={(e) => actions.onSetFMParams(trackId, { ...fmParams, harmonicity: Number(e.target.value) })}
                disabled={readOnly}
                className="fm-slider"
              />
              <span className="fm-value">{fmParams.harmonicity.toFixed(1)}×</span>
            </label>
            <label className="fm-control">
              <span className="fm-label">Mod Index</span>
              <input
                type="range"
                min="0"
                max="20"
                step="0.5"
                value={fmParams.modulationIndex}
                onChange={(e) => actions.onSetFMParams(trackId, { ...fmParams, modulationIndex: Number(e.target.value) })}
                disabled={readOnly}
                className="fm-slider"
              />
              <span className="fm-value">{fmParams.modulationIndex.toFixed(1)}</span>
            </label>
          </div>
        )}
        <PatternToolsPanel
          hasSteps={hasSteps}
          stepCount={stepCount}
          activeStepCount={activeStepCount}
          swing={track.swing ?? 0}
          disabled={readOnly}
          {...pattern}
        />
        <div className="dock-tool-group dock-track-actions" role="group" aria-label="Track actions">
          {isCopyTarget ? (
            <button type="button" className="dock-tool-button paste" onClick={() => actions.onCopyTo(trackId)} disabled={readOnly} title="Paste pattern here">
              Paste
            </button>
          ) : (
            <button type="button" className="dock-tool-button" onClick={() => actions.onStartCopy(trackId)} disabled={readOnly || !hasSteps} title="Copy pattern">
              Copy
            </button>
          )}
          <button type="button" className="dock-tool-button" onClick={() => actions.onClearTrack(trackId)} disabled={readOnly || !hasSteps} title="Clear all steps">
            Clear
          </button>
          <button type="button" className="dock-tool-button destructive" onClick={() => actions.onDeleteTrack(trackId)} disabled={readOnly} title="Delete track">
            Delete
          </button>
        </div>
      </div>
      {canChangeInstrument && instrumentPickerOpen && actions.onSetInstrument && (
        <div id={DOCK_INSTRUMENT_PICKER_ID} className="dock-instrument-picker">
          {/* Mounted only while open: a closed picker must not leave ~100
              instrument buttons in the document, duplicating the Add Track
              picker's accessible names. */}
          <SamplePicker
            variant="change"
            selectedSampleId={track.sampleId}
            onSelectSample={(sampleId) => actions.onSetInstrument?.(trackId, sampleId)}
            disabled={readOnly}
            previewsDisabled={readOnly}
          />
        </div>
      )}
    </>
  );
});
