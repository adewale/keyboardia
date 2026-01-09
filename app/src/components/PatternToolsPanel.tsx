/**
 * PatternToolsPanel - Pattern manipulation tools for step sequencer
 *
 * Extracted from TrackRow.tsx to reduce component complexity (NEW-002c).
 * Provides rotate, invert, reverse, mirror, Euclidean fill, and per-track swing.
 *
 * Features:
 * - Rotate pattern left/right (wraps around)
 * - Invert pattern (toggle all steps)
 * - Reverse pattern (flip order)
 * - Smart mirror (reflects the busier half)
 * - Euclidean rhythm generator (even distribution)
 * - Per-track swing control
 */

import React, { useCallback } from 'react';

export interface PatternToolsPanelProps {
  /** Whether the track has any active steps */
  hasSteps: boolean;
  /** Total number of steps in this track */
  stepCount: number;
  /** Number of currently active steps */
  activeStepCount: number;
  /** Per-track swing value (0-100) */
  swing: number;
  /** Callback for rotate pattern */
  onRotate?: (direction: 'left' | 'right') => void;
  /** Callback for invert pattern */
  onInvert?: () => void;
  /** Callback for reverse pattern */
  onReverse?: () => void;
  /** Callback for smart mirror */
  onMirror?: () => void;
  /** Callback for Euclidean fill */
  onEuclideanFill?: (hits: number) => void;
  /** Callback for swing change */
  onSwingChange?: (swing: number) => void;
}

/**
 * Pattern manipulation tools panel.
 *
 * @example
 * ```tsx
 * <PatternToolsPanel
 *   hasSteps={hasSteps}
 *   stepCount={track.stepCount ?? 16}
 *   activeStepCount={activeStepCount}
 *   swing={track.swing ?? 0}
 *   onRotate={handleRotate}
 *   onInvert={handleInvert}
 *   onReverse={handleReverse}
 *   onMirror={handleMirror}
 *   onEuclideanFill={handleEuclidean}
 *   onSwingChange={handleSwingChange}
 * />
 * ```
 */
export function PatternToolsPanel({
  hasSteps,
  stepCount,
  activeStepCount,
  swing,
  onRotate,
  onInvert,
  onReverse,
  onMirror,
  onEuclideanFill,
  onSwingChange,
}: PatternToolsPanelProps) {
  // Handle Euclidean slider change
  const handleEuclideanChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onEuclideanFill?.(Number(e.target.value));
  }, [onEuclideanFill]);

  // Handle swing slider change
  const handleSwingSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    onSwingChange?.(Math.max(0, Math.min(100, value)));
  }, [onSwingChange]);

  return (
    <div className="pattern-tools-panel">
      <div className="pattern-tools-group">
        <span className="pattern-tools-label">Rotate</span>
        <button
          className="pattern-tool-btn"
          onClick={() => onRotate?.('left')}
          title="Rotate pattern left (wrap)"
          disabled={!hasSteps}
        >
          ←
        </button>
        <button
          className="pattern-tool-btn"
          onClick={() => onRotate?.('right')}
          title="Rotate pattern right (wrap)"
          disabled={!hasSteps}
        >
          →
        </button>
      </div>

      <div className="pattern-tools-group">
        <button
          className="pattern-tool-btn"
          onClick={() => onInvert?.()}
          title="Invert pattern (toggle all steps)"
        >
          ⊘
        </button>
        <button
          className="pattern-tool-btn"
          onClick={() => onReverse?.()}
          title="Reverse pattern"
          disabled={!hasSteps}
        >
          ⇆
        </button>
        <button
          className="pattern-tool-btn"
          onClick={() => onMirror?.()}
          title="Smart Mirror: creates symmetry from the busier half"
          disabled={!hasSteps || stepCount <= 2}
        >
          ◇
        </button>
      </div>

      <div className="pattern-tools-group euclidean-group">
        <span className="pattern-tools-label">Euclidean</span>
        <input
          type="range"
          className="euclidean-slider"
          min="0"
          max={stepCount}
          value={activeStepCount}
          onChange={handleEuclideanChange}
          title={`Euclidean rhythm: distribute ${activeStepCount} hits across ${stepCount} steps`}
        />
        <span className="euclidean-value">{activeStepCount}/{stepCount}</span>
      </div>

      <div className="pattern-tools-group swing-group">
        <span className="pattern-tools-label">Swing</span>
        <input
          type="range"
          className="track-swing-slider"
          min="0"
          max="100"
          value={swing}
          onChange={handleSwingSlider}
          title={`Track swing: ${swing === 0 ? 'uses global' : `${swing}%`}`}
        />
        <span className="swing-value">{`${swing}%`}</span>
      </div>
    </div>
  );
}
