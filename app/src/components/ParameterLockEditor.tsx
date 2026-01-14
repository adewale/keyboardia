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

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import type { ParameterLock } from '../types';
import { isInRange, getInstrumentRange } from '../audio/instrument-ranges';

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
  /** Callback when editor should be dismissed */
  onDismiss: () => void;
  /** Sample ID for range validation (e.g., 'sampled:piano') */
  sampleId?: string;
  /** Track transpose value */
  transpose?: number;
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
  onClearLock,
  onDismiss,
  sampleId,
  transpose = 0,
}: ParameterLockEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div className="plock-inline" ref={containerRef}>
      <span className="plock-step">Step {step + 1}</span>

      <div className="plock-control">
        <span className={`plock-label pitch ${isOutOfRange ? 'out-of-range' : ''}`}>
          Pitch{isOutOfRange ? ' ⚠' : ''}
        </span>
        <input
          type="range"
          min={minPitch}
          max={maxPitch}
          value={Math.max(minPitch, Math.min(maxPitch, pitch))}
          onChange={handlePitchSlider}
          className={`plock-slider pitch ${isOutOfRange ? 'out-of-range' : ''}`}
          title={isOutOfRange ? 'This pitch is outside the instrument\'s playable range and will be silent' : undefined}
        />
        <span className={`plock-value ${isOutOfRange ? 'out-of-range' : ''}`}>
          {pitch > 0 ? '+' : ''}{pitch}
        </span>
      </div>

      <div className="plock-control">
        <span className="plock-label volume">Vol</span>
        <input
          type="range"
          min="0"
          max="100"
          value={volume * 100}
          onChange={handleVolumeSlider}
          className="plock-slider volume"
        />
        <span className="plock-value">{Math.round(volume * 100)}%</span>
      </div>

      {/* Tie toggle - only show if not the first step */}
      {step > 0 && (
        <button
          className={`plock-tie ${hasTie ? 'active' : ''}`}
          onClick={onTieToggle}
          title="Tie: Continue note from previous step (no new attack)"
        >
          ⌒
        </button>
      )}

      {hasAnyLock && (
        <button className="plock-clear" onClick={onClearLock}>✕</button>
      )}
    </div>
  );
}
