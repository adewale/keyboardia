/**
 * TrackDrawer Component
 *
 * Compact inline drawer for landscape mobile mode.
 * Shows track controls in a horizontal layout:
 * - Drag handle (⠿) - for reordering
 * - Transpose (±) - pitch adjustment
 * - Step count (16▾) - polymetric
 * - Expand (🎹) - pitch view toggle
 * - Velocity (▎) - velocity lane toggle
 * - Pattern tools (⚙) - rotate, invert, etc.
 * - Copy/Clear/Delete - track actions
 *
 * Uses accordion pattern - only one drawer open at a time.
 * Animation: 200ms ease-out, max-height 0→56px.
 */

import { memo, useCallback, useRef, useEffect } from 'react';
import { STEP_COUNT_OPTIONS } from '../types';
import './TrackDrawer.css';

interface TrackDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  // Track state
  trackId: string;
  transpose: number;
  stepCount: number;
  volume: number;
  isMelodicTrack: boolean;
  hasSteps: boolean;
  // Callbacks
  onTransposeChange: (transpose: number) => void;
  onStepCountChange: (stepCount: number) => void;
  onVolumeChange: (volume: number) => void;
  onExpandPitch?: () => void;
  onExpandVelocity?: () => void;
  onShowPatternTools?: () => void;
  onCopy: () => void;
  onClear: () => void;
  onDelete: () => void;
  // Copy state
  isCopyTarget?: boolean;
  onPaste?: () => void;
}

export const TrackDrawer = memo(function TrackDrawer({
  isOpen,
  onClose,
  trackId,
  transpose,
  stepCount,
  volume: _volume, // Reserved for future volume slider
  isMelodicTrack,
  hasSteps,
  onTransposeChange,
  onStepCountChange,
  onVolumeChange: _onVolumeChange, // Reserved for future volume slider
  onExpandPitch,
  onExpandVelocity,
  onShowPatternTools,
  onCopy,
  onClear,
  onDelete,
  isCopyTarget,
  onPaste,
}: TrackDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  // Keep onClose ref updated
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        // Allow clicks on parent track row (for M/S buttons)
        if (!target.closest('.track-row') && !target.closest('.track-name-wrapper')) {
          onCloseRef.current();
        }
      }
    };

    // Delay to prevent immediate close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Transpose handlers
  const handleTransposeDown = useCallback(() => {
    if (transpose > -24) onTransposeChange(transpose - 1);
  }, [transpose, onTransposeChange]);

  const handleTransposeUp = useCallback(() => {
    if (transpose < 24) onTransposeChange(transpose + 1);
  }, [transpose, onTransposeChange]);

  if (!isOpen) return null;

  return (
    <div
      className="track-drawer"
      ref={drawerRef}
      role="region"
      aria-label={`Track ${trackId} controls`}
    >
      <div className="track-drawer-content">
        {/* Transpose control */}
        <div className="drawer-control-group">
          <span className="drawer-control-label">±</span>
          <button
            className="drawer-compact-btn"
            onClick={handleTransposeDown}
            disabled={transpose <= -24}
            aria-label="Transpose down"
          >
            −
          </button>
          <span className={`drawer-control-value ${transpose !== 0 ? 'active' : ''}`}>
            {transpose > 0 ? '+' : ''}{transpose}
          </span>
          <button
            className="drawer-compact-btn"
            onClick={handleTransposeUp}
            disabled={transpose >= 24}
            aria-label="Transpose up"
          >
            +
          </button>
        </div>

        {/* Step count dropdown */}
        <div className="drawer-control-group">
          <select
            className="drawer-compact-select"
            value={stepCount}
            onChange={(e) => onStepCountChange(Number(e.target.value))}
            aria-label="Step count"
          >
            {STEP_COUNT_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
          <span className="drawer-control-suffix">▾</span>
        </div>

        {/* Expand pitch view (melodic tracks only) */}
        {isMelodicTrack && onExpandPitch && (
          <button
            className="drawer-icon-btn"
            onClick={onExpandPitch}
            title="Expand pitch view"
            aria-label="Expand pitch view"
          >
            🎹
          </button>
        )}

        {/* Velocity lane toggle */}
        {onExpandVelocity && (
          <button
            className="drawer-icon-btn"
            onClick={onExpandVelocity}
            title="Velocity lane"
            aria-label="Velocity lane"
          >
            ▎
          </button>
        )}

        {/* Pattern tools toggle */}
        {onShowPatternTools && (
          <button
            className="drawer-icon-btn"
            onClick={onShowPatternTools}
            title="Pattern tools"
            aria-label="Pattern tools"
          >
            ⚙
          </button>
        )}

        {/* Separator */}
        <div className="drawer-separator" />

        {/* Actions */}
        {isCopyTarget && onPaste ? (
          <button
            className="drawer-action-btn-compact primary"
            onClick={onPaste}
          >
            Paste
          </button>
        ) : (
          <>
            <button
              className="drawer-action-btn-compact"
              onClick={onCopy}
              disabled={!hasSteps}
            >
              Copy
            </button>
            <button
              className="drawer-action-btn-compact"
              onClick={onClear}
              disabled={!hasSteps}
            >
              Clear
            </button>
            <button
              className="drawer-action-btn-compact destructive"
              onClick={onDelete}
            >
              ×
            </button>
          </>
        )}
      </div>
    </div>
  );
});
