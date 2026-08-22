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
 * Animation: 200ms ease-out, max-height 0→64px.
 */

import { memo, useCallback, useRef, useEffect } from 'react';
import { STEP_COUNT_OPTIONS } from '../types';
import { useStableCallback } from '../hooks/useStableCallback';
import { Add, ChevronDown, Minus } from '../icons';
import './TrackDrawer.css';

type TrackDrawerCloseReason = 'outside' | 'escape';

interface TrackDrawerProps {
  isOpen: boolean;
  onClose: (reason: TrackDrawerCloseReason) => void;
  // Track state
  trackId: string;
  trackName: string;
  transpose: number;
  stepCount: number;
  volume: number;
  isMelodicTrack: boolean;
  hasSteps: boolean;
  isPitchExpanded: boolean;
  isVelocityExpanded: boolean;
  arePatternToolsVisible: boolean;
  isEnvelopeVisible?: boolean;
  envelopeLabel?: string;
  // Callbacks
  onTransposeChange: (transpose: number) => void;
  onStepCountChange: (stepCount: number) => void;
  onVolumeChange: (volume: number) => void;
  onExpandPitch?: () => void;
  onExpandVelocity?: () => void;
  onShowPatternTools?: () => void;
  onShowEnvelope?: () => void;
  /** Change instrument (issue #63): absent when the session cannot be edited. */
  onChangeInstrument?: (opener: HTMLButtonElement) => void;
  /** Display name of the track's current instrument, for the button's label. */
  instrumentName?: string;
  /** Whether the shared picker panel below the row is open. */
  isInstrumentPickerVisible?: boolean;
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
  trackName,
  transpose,
  stepCount,
  volume: _volume, // Reserved for future volume slider
  isMelodicTrack,
  hasSteps,
  isPitchExpanded,
  isVelocityExpanded,
  arePatternToolsVisible,
  isEnvelopeVisible,
  envelopeLabel = 'Envelope',
  onTransposeChange,
  onStepCountChange,
  onVolumeChange: _onVolumeChange, // Reserved for future volume slider
  onExpandPitch,
  onExpandVelocity,
  onShowPatternTools,
  onShowEnvelope,
  onChangeInstrument,
  instrumentName,
  isInstrumentPickerVisible,
  onCopy,
  onClear,
  onDelete,
  isCopyTarget,
  onPaste,
}: TrackDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Stable across renders, always calls the latest onClose — so the
  // click-outside listener below can register once instead of re-binding
  // whenever the parent re-creates the prop.
  const handleClose = useStableCallback(onClose);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        // Allow clicks on parent track row (for M/S buttons)
        if (!target.closest('.track-row') && !target.closest('.track-name-wrapper')) {
          handleClose('outside');
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
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose('escape');
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleClose]);

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
      id={`track-drawer-${trackId}`}
      className="track-drawer"
      ref={drawerRef}
      role="region"
      aria-label={`${trackName} track controls`}
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
            <Minus size={14} aria-hidden="true" />
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
            <Add size={14} aria-hidden="true" />
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
          <span className="drawer-control-suffix"><ChevronDown size={12} aria-hidden="true" /></span>
        </div>

        {/* Expand pitch view (melodic tracks only) */}
        {isMelodicTrack && onExpandPitch && (
          <button
            className={`drawer-icon-btn ${isPitchExpanded ? 'active' : ''}`}
            onClick={onExpandPitch}
            title={isPitchExpanded ? 'Collapse pitch view' : 'Expand pitch view'}
            aria-label="Pitch view"
            aria-expanded={isPitchExpanded}
          >
            Pitch
          </button>
        )}

        {/* Velocity lane toggle */}
        {onExpandVelocity && (
          <button
            className={`drawer-icon-btn ${isVelocityExpanded ? 'active' : ''}`}
            onClick={onExpandVelocity}
            title="Velocity lane"
            aria-label="Velocity lane"
            aria-expanded={isVelocityExpanded}
          >
            Velocity
          </button>
        )}

        {/* Pattern tools toggle */}
        {onShowPatternTools && (
          <button
            className={`drawer-icon-btn ${arePatternToolsVisible ? 'active' : ''}`}
            onClick={onShowPatternTools}
            title="Pattern tools"
            aria-label="Pattern tools"
            aria-expanded={arePatternToolsVisible}
          >
            Pattern
          </button>
        )}

        {onShowEnvelope && (
          <button
            className={`drawer-icon-btn ${isEnvelopeVisible ? 'active' : ''}`}
            onClick={onShowEnvelope}
            title="Amplitude envelope"
            aria-label="Amplitude envelope"
            aria-expanded={isEnvelopeVisible}
            aria-controls={isEnvelopeVisible ? `envelope-panel-${trackId}` : undefined}
          >
            {envelopeLabel}
          </button>
        )}

        {/* Change instrument (issue #63). Opens the shared picker panel that
            TrackRow renders below the row, so landscape browses the same
            catalog as desktop rather than a second cramped list. */}
        {onChangeInstrument && (
          <button
            className={`drawer-icon-btn ${isInstrumentPickerVisible ? 'active' : ''}`}
            onClick={(event) => onChangeInstrument(event.currentTarget)}
            title={instrumentName ? `Change instrument (currently ${instrumentName})` : 'Change instrument'}
            aria-label="Change instrument"
            aria-expanded={!!isInstrumentPickerVisible}
            aria-controls={isInstrumentPickerVisible ? `instrument-panel-${trackId}` : undefined}
            data-testid={`landscape-change-instrument-${trackId}`}
          >
            Sound
          </button>
        )}

        {/* Separator */}
        <div className="drawer-separator" />

        {/* Actions */}
        {isCopyTarget && onPaste ? (
          <button
            className="drawer-action-btn-compact primary"
            onClick={onPaste}
            title="Paste pattern here"
          >
            Paste
          </button>
        ) : (
          <>
            <button
              className="drawer-action-btn-compact"
              onClick={onCopy}
              disabled={!hasSteps}
              title="Copy pattern"
            >
              Copy
            </button>
            <button
              className="drawer-action-btn-compact"
              onClick={onClear}
              disabled={!hasSteps}
              title="Clear all steps"
            >
              Clear
            </button>
            <button
              className="drawer-action-btn-compact destructive"
              onClick={onDelete}
              title="Delete track"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
});
