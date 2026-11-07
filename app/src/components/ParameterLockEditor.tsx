/**
 * ParameterLockEditor - the controls for one step's parameter lock
 *
 * Extracted from TrackRow.tsx to reduce component complexity (NEW-002a). It
 * renders in the editor dock's Step pane (specs/PIANO-ROLL-DOCK.md, phase 6),
 * which decides when it shows and how it is dismissed (Escape, the Notes
 * chip, or selecting another step), so it no longer listens for clicks
 * outside itself.
 *
 * Features:
 * - Pitch adjustment (-24 to +24 semitones)
 * - Volume adjustment (0-100%)
 * - Tie toggle (continue note from previous step)
 * - Range validation with visual feedback for out-of-range pitches
 */

import React, { useCallback, useId, useMemo } from 'react';
import type { ParameterLock } from '../types';
import { isInRange, getInstrumentRange } from '../audio/instrument-ranges';
import { Warning } from '../icons';
import './ParameterLockEditor.css';

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
  /** Callback to clear all locks on this step */
  onClearLock: () => void;
  /** Published session: show the lock, accept no edits */
  disabled?: boolean;
  /** Sample ID for range validation (e.g., 'sampled:piano') */
  sampleId?: string;
  /** Track transpose value */
  transpose?: number;
}

/**
 * Parameter lock controls for a single step.
 *
 * @example
 * ```tsx
 * <ParameterLockEditor
 *   step={selectedStep}
 *   lock={track.parameterLocks[selectedStep]}
 *   onPitchChange={handlePitchChange}
 *   onVolumeChange={handleVolumeChange}
 *   onTieToggle={handleTieToggle}
 *   onClearLock={handleClearLock}
 * />
 * ```
 */
export function ParameterLockEditor({
  step,
  lock,
  onPitchChange,
  onVolumeChange,
  onTieToggle,
  onClearLock,
  disabled = false,
  sampleId,
  transpose = 0,
}: ParameterLockEditorProps) {
  const pitchId = useId();
  const volumeId = useId();
  const pitchWarningId = useId();

  // Get display values with defaults
  const pitch = lock?.pitch ?? 0;
  const volume = lock?.volume ?? 1;
  const hasTie = lock?.tie ?? false;

  // Check if any locks are set (for showing clear button)
  const hasAnyLock = lock?.pitch !== undefined || lock?.volume !== undefined || lock?.tie;

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
    <div className="plock-inline">
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
          disabled={disabled}
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
          disabled={disabled}
          className="plock-slider volume"
        />
        <span className="plock-value">{Math.round(volume * 100)}%</span>
      </div>

      {/* Tie toggle - only show if not the first step */}
      {step > 0 && (
        <button
          className={`plock-tie ${hasTie ? 'active' : ''}`}
          onClick={onTieToggle}
          disabled={disabled}
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
          disabled={disabled}
          title="Clear parameter lock"
        >
          Clear lock
        </button>
      )}
    </div>
  );
}
