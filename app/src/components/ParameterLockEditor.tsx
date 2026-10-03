/**
 * ParameterLockEditor - Inline editor for step parameter locks
 *
 * Extracted from TrackRow.tsx to reduce component complexity (NEW-002a).
 * Provides controls for per-step pitch, volume, and tie settings.
 *
 * Features:
 * - Pitch adjustment (-24 to +24 semitones)
 * - Volume adjustment (0-100%)
 * - Tie toggle (continue note from previous step)
 * - Auto-dismiss when clicking outside
 * - Range validation with visual feedback for out-of-range pitches
 */

import React, { useRef, useEffect, useCallback, useId, useMemo, useState } from 'react';
import type {
  EnvelopeDuration,
  EnvelopeStageName,
  EnvelopeTimeUnit,
  ParameterLock,
} from '../types';
import { isInRange, getInstrumentRange } from '../audio/instrument-ranges';
import { Warning } from '../icons';
import {
  ENVELOPE_DURATION_RANGES_V2,
  clampEnvelopeDurationV2,
  durationToSeconds,
} from '../shared/envelope-contract-v2';

const DEFAULT_ENVELOPE_STAGES = ['attack', 'decay', 'release'] as const;

function typedLockDuration(
  lock: ParameterLock | null,
  stage: EnvelopeStageName,
): EnvelopeDuration | undefined {
  if (stage === 'attack') return lock?.attackDuration;
  if (stage === 'hold') return lock?.holdDuration;
  if (stage === 'decay') return lock?.decayDuration;
  return lock?.releaseDuration;
}

function legacyLockDuration(
  lock: ParameterLock | null,
  stage: EnvelopeStageName,
  unit: EnvelopeTimeUnit,
): EnvelopeDuration | undefined {
  if (stage === 'hold') return undefined;
  const value = lock?.[stage];
  return value === undefined ? undefined : { value, unit };
}

function stageLabel(stage: EnvelopeStageName): string {
  return stage[0].toUpperCase() + stage.slice(1);
}

interface EnvelopeLockControlProps {
  stage: EnvelopeStageName;
  duration?: EnvelopeDuration;
  legacy: boolean;
  bpm: number;
  disabled: boolean;
  onCommit: (stage: EnvelopeStageName, duration: EnvelopeDuration | undefined) => void;
}

function EnvelopeLockControl({
  stage,
  duration,
  legacy,
  bpm,
  disabled,
  onCommit,
}: EnvelopeLockControlProps) {
  const inputId = useId();
  const cancelBlurRef = useRef(false);
  const [draftValue, setDraftValue] = useState(duration ? String(duration.value) : '');
  const [unit, setUnit] = useState<EnvelopeTimeUnit>(duration?.unit ?? 'seconds');
  const range = ENVELOPE_DURATION_RANGES_V2[stage][unit];

  const commitValue = () => {
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false;
      return;
    }
    const raw = draftValue.trim();
    if (!raw) {
      if (duration !== undefined) onCommit(stage, undefined);
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setDraftValue(duration ? String(duration.value) : '');
      return;
    }
    const next = clampEnvelopeDurationV2(stage, { value, unit });
    setDraftValue(String(next.value));
    if (duration?.value === next.value && duration.unit === next.unit) return;
    onCommit(stage, next);
  };

  const changeUnit = (nextUnit: EnvelopeTimeUnit) => {
    setUnit(nextUnit);
    const value = Number(draftValue);
    if (!Number.isFinite(value) || draftValue.trim() === '') return;
    const current = clampEnvelopeDurationV2(stage, { value, unit });
    const seconds = durationToSeconds(current, bpm);
    const converted = clampEnvelopeDurationV2(stage, nextUnit === 'seconds'
      ? { value: seconds, unit: 'seconds' }
      : { value: seconds / (60 / bpm / 4), unit: 'steps' });
    setDraftValue(String(converted.value));
    if (duration?.value === converted.value && duration.unit === converted.unit) return;
    onCommit(stage, converted);
  };

  return (
    <div className="plock-control plock-envelope-control">
      <label className="plock-label" htmlFor={inputId}>
        {stageLabel(stage)}
        {legacy && <span className="plock-legacy">Legacy</span>}
      </label>
      <input
        id={inputId}
        aria-label={`${stageLabel(stage)} envelope lock value`}
        type="number"
        min={range.min}
        max={range.max}
        step={unit === 'steps' ? 0.01 : 0.001}
        value={draftValue}
        placeholder="—"
        disabled={disabled}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={commitValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelBlurRef.current = true;
            setDraftValue(duration ? String(duration.value) : '');
            event.currentTarget.blur();
          }
        }}
      />
      <select
        aria-label={`${stageLabel(stage)} envelope lock unit`}
        value={unit}
        disabled={disabled}
        onChange={(event) => changeUnit(event.target.value as EnvelopeTimeUnit)}
      >
        <option value="seconds">Seconds</option>
        <option value="steps">Steps</option>
      </select>
      <span className="plock-value">
        {draftValue === '' ? '—' : `${draftValue}${unit === 'steps' ? 'st' : 's'}`}
      </span>
    </div>
  );
}

export interface ParameterLockEditorProps {
  /** The step index being edited (1-based display, 0-based internally) */
  step: number;
  /** Current parameter lock data for this step */
  lock: ParameterLock | null;
  /** Callback when pitch changes */
  onPitchChange: (pitch: number) => void;
  /** Callback when volume changes */
  onVolumeChange: (volume: number) => void;
  /** Callback to toggle tie setting */
  onTieToggle: () => void;
  /** Set or clear a per-step envelope time lock. */
  onEnvelopeLockChange?: (stage: EnvelopeStageName, duration: EnvelopeDuration | undefined) => void;
  /** Active timed stages after model and source-capability resolution. */
  envelopeStages?: readonly EnvelopeStageName[];
  /** Callback to clear all locks on this step */
  onClearLock: () => void;
  /** Callback when editor should be dismissed */
  onDismiss: () => void;
  /** Sample ID for range validation (e.g., 'sampled:piano') */
  sampleId?: string;
  /** Track transpose value */
  transpose?: number;
  /** Unit used by A/D/R locks on this track. */
  envelopeTimeUnit?: EnvelopeTimeUnit;
  /** Tempo used to preserve time when a lock switches between seconds and steps. */
  bpm?: number;
}

/**
 * Inline parameter lock editor for a single step.
 *
 * @example
 * ```tsx
 * {selectedStep !== null && (
 *   <ParameterLockEditor
 *     step={selectedStep}
 *     lock={track.parameterLocks[selectedStep]}
 *     onPitchChange={handlePitchChange}
 *     onVolumeChange={handleVolumeChange}
 *     onTieToggle={handleTieToggle}
 *     onClearLock={handleClearLock}
 *     onDismiss={() => setSelectedStep(null)}
 *   />
 * )}
 * ```
 */
export function ParameterLockEditor({
  step,
  lock,
  onPitchChange,
  onVolumeChange,
  onTieToggle,
  onEnvelopeLockChange,
  envelopeStages = DEFAULT_ENVELOPE_STAGES,
  onClearLock,
  onDismiss,
  sampleId,
  transpose = 0,
  envelopeTimeUnit = 'seconds',
  bpm = 120,
}: ParameterLockEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pitchId = useId();
  const volumeId = useId();
  const pitchWarningId = useId();

  // Auto-dismiss when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };

    // Delay to avoid immediate dismissal when opening
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onDismiss]);

  // Get display values with defaults
  const pitch = lock?.pitch ?? 0;
  const volume = lock?.volume ?? 1;
  const hasTie = lock?.tie ?? false;

  // Check if any locks are set (for showing clear button)
  const hasAnyLock = lock?.pitch !== undefined || lock?.volume !== undefined || lock?.tie
    || lock?.attack !== undefined || lock?.decay !== undefined || lock?.release !== undefined
    || lock?.attackDuration !== undefined || lock?.holdDuration !== undefined
    || lock?.decayDuration !== undefined || lock?.releaseDuration !== undefined;

  // Calculate valid pitch range based on instrument's playable range
  const { minPitch, maxPitch, isOutOfRange } = useMemo(() => {
    if (!sampleId) {
      return { minPitch: -24, maxPitch: 24, isOutOfRange: false };
    }

    const range = getInstrumentRange(sampleId);
    const baseMidi = 60; // C4
    const effectiveMidi = baseMidi + transpose + pitch;

    // Calculate how far we can go from current note
    const minPitch = Math.max(-24, range.minMidi - baseMidi - transpose);
    const maxPitch = Math.min(24, range.maxMidi - baseMidi - transpose);

    // Check if current pitch is out of range
    const isOutOfRange = !isInRange(effectiveMidi, sampleId);

    return { minPitch, maxPitch, isOutOfRange };
  }, [sampleId, transpose, pitch]);

  // Handler wrappers to convert slider values
  const handlePitchSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onPitchChange(Number(e.target.value));
  }, [onPitchChange]);

  const handleVolumeSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onVolumeChange(Number(e.target.value) / 100);
  }, [onVolumeChange]);

  return (
    <div className="plock-inline" ref={containerRef}>
      <span className="plock-step">Step {step + 1}</span>

      <div className="plock-control">
        <label htmlFor={pitchId} className={`plock-label pitch ${isOutOfRange ? 'out-of-range' : ''}`}>
          Pitch{isOutOfRange ? <> <Warning size={14} aria-hidden="true" /></> : ''}
        </label>
        <input
          id={pitchId}
          type="range"
          min={minPitch}
          max={maxPitch}
          value={Math.max(minPitch, Math.min(maxPitch, pitch))}
          onChange={handlePitchSlider}
          className={`plock-slider pitch ${isOutOfRange ? 'out-of-range' : ''}`}
          aria-describedby={isOutOfRange ? pitchWarningId : undefined}
        />
        <span className={`plock-value ${isOutOfRange ? 'out-of-range' : ''}`}>
          {pitch > 0 ? '+' : ''}{pitch}
        </span>
        {isOutOfRange && (
          <span id={pitchWarningId} className="plock-warning">
            Outside playable range — silent
          </span>
        )}
      </div>

      <div className="plock-control">
        <label htmlFor={volumeId} className="plock-label volume">Volume</label>
        <input
          id={volumeId}
          type="range"
          min="0"
          max="100"
          value={volume * 100}
          onChange={handleVolumeSlider}
          className="plock-slider volume"
        />
        <span className="plock-value">{Math.round(volume * 100)}%</span>
      </div>

      {envelopeStages.map(stage => {
        const typed = typedLockDuration(lock, stage);
        const legacy = typed ? undefined : legacyLockDuration(lock, stage, envelopeTimeUnit);
        const duration = typed ?? legacy;
        return (
          <EnvelopeLockControl
            key={`${stage}:${duration?.value ?? 'none'}:${duration?.unit ?? envelopeTimeUnit}:${Boolean(legacy)}`}
            stage={stage}
            duration={duration}
            legacy={Boolean(legacy)}
            bpm={bpm}
            disabled={!onEnvelopeLockChange}
            onCommit={(lockStage, next) => onEnvelopeLockChange?.(lockStage, next)}
          />
        );
      })}

      {/* Tie toggle - only show if not the first step */}
      {step > 0 && (
        <button
          className={`plock-tie ${hasTie ? 'active' : ''}`}
          onClick={onTieToggle}
          title="Continue note from previous step without a new attack"
          aria-pressed={hasTie}
        >
          Tie
        </button>
      )}

      {hasAnyLock && (
        <button
          className="plock-clear"
          onClick={onClearLock}
          title="Clear parameter lock"
        >
          Clear lock
        </button>
      )}
    </div>
  );
}
