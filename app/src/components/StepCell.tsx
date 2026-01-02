import { memo, useCallback } from 'react';
import type { ParameterLock } from '../types';
import { useLongPress } from '../hooks/useLongPress';
import './StepCell.css';

interface StepCellProps {
  active: boolean;
  playing: boolean;
  stepIndex: number;
  parameterLock: ParameterLock | null;
  swing: number;
  selected: boolean;
  isAnchor?: boolean; // Phase 31F: True if this step is the selection anchor
  hasSelection?: boolean; // Phase 31F: True if any selection exists (for Shift+click behavior)
  dimmed?: boolean; // True if step is beyond track's stepCount
  isPageEnd?: boolean; // True if this is the last step of a 16-step page
  flashColor?: string | null; // Phase 11: Remote change attribution color
  onClick: () => void;
  onSelect: () => void;
  // Phase 31F: Multi-select support
  onSelectToggle?: () => void; // Ctrl+Click: Toggle selection
  onSelectExtend?: () => void; // Shift+Click when selection exists: Extend selection
  // Phase 31F: Drag-to-paint support
  onPaintStart?: () => void; // Called on pointer down to start painting
  onPaintEnter?: () => void; // Called on pointer enter during painting
}

export const StepCell = memo(function StepCell({ active, playing, stepIndex, parameterLock, swing, selected, isAnchor, hasSelection, dimmed, isPageEnd, flashColor, onClick: _onClick, onSelect, onSelectToggle, onSelectExtend, onPaintStart, onPaintEnter }: StepCellProps) {
  // Note: onClick is no longer used directly - paint toggle happens on pointer down
  // It's kept in props for backwards compatibility but prefixed with _ to suppress warning
  // Highlight every 4th step (beat boundaries)
  const isBeatStart = stepIndex % 4 === 0;
  const isSwungStep = stepIndex % 2 === 1; // Odd steps get swung
  const hasLock = parameterLock !== null;
  const hasPitchLock = parameterLock?.pitch !== undefined && parameterLock.pitch !== 0;
  const hasVolumeLock = parameterLock?.volume !== undefined && parameterLock.volume !== 1;
  const hasTie = parameterLock?.tie === true; // Phase 29B: Tied notes

  // Build tooltip text for hover discovery
  const buildTooltip = (): string | undefined => {
    if (!active) return undefined;

    const pitch = parameterLock?.pitch ?? 0;
    const volume = parameterLock?.volume ?? 1;
    const volumePercent = Math.round(volume * 100);

    const pitchStr = pitch === 0 ? '0' : (pitch > 0 ? `+${pitch}` : `${pitch}`);
    const tieStr = parameterLock?.tie ? ' • Tied' : '';
    return `Step ${stepIndex + 1}\nPitch: ${pitchStr} • Vol: ${volumePercent}%${tieStr}\n[Hold or Shift+Click to edit]`;
  };

  // Visual swing offset (translate right for swung steps)
  const swingOffset = isSwungStep && swing > 0 ? (swing / 100) * 8 : 0;

  // Velocity fill height based on volume p-lock (default 100% if no lock)
  const velocityPercent = parameterLock?.volume !== undefined
    ? Math.round(parameterLock.volume * 100)
    : 100;

  // Long press handler for mobile P-Lock editing
  // Also handles Shift+Click for desktop backward compatibility
  const handleLongPress = useCallback(() => {
    if (active) {
      onSelect();
    }
  }, [active, onSelect]);

  // Phase 31F: Drag-to-paint uses pointer events
  // We need to compose our paint handlers with useLongPress handlers
  // - Shift+Click: Opens p-lock menu (handled by useLongPress)
  // - Regular click: Starts painting (our handler)
  // - Long press: Opens p-lock menu (useLongPress timer)
  const longPressHandlers = useLongPress({
    onLongPress: handleLongPress,
    onClick: () => {}, // No-op - paint toggle happens on pointer down
    delay: 400,
  });

  // Phase 31F: Handle pointer down - compose with useLongPress
  // BUG FIX: Added pointer capture for reliable drag-to-paint across cells
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Don't start paint on right-click (used for p-lock menu)
    if (e.button !== 0) return;

    // Phase 31F: Ctrl/Cmd+Click toggles selection (doesn't paint)
    if (e.ctrlKey || (e.metaKey && !e.shiftKey)) {
      e.preventDefault();
      onSelectToggle?.();
      return;
    }

    // Phase 31F: Shift+Click behavior depends on whether selection exists
    // - With selection: Extend selection from anchor
    // - Without selection: Opens p-lock menu (backward compatible)
    if (e.shiftKey) {
      if (hasSelection && onSelectExtend) {
        e.preventDefault();
        onSelectExtend();
        return;
      }
      // No selection - fall through to p-lock menu behavior
      longPressHandlers.onPointerDown(e);
      return;
    }

    // Start useLongPress timer (for long press detection)
    longPressHandlers.onPointerDown(e);

    // Capture pointer to receive events even when pointer leaves element
    // This ensures drag-to-paint works reliably across cells
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore if capture fails (e.g., touch events on some browsers)
    }

    // Start painting (toggle this step and set paint mode)
    onPaintStart?.();
  }, [longPressHandlers, onPaintStart, onSelectToggle, onSelectExtend, hasSelection]);

  // Phase 31F: Handle pointer enter during drag-to-paint
  const handlePointerEnter = useCallback(() => {
    onPaintEnter?.();
  }, [onPaintEnter]);

  // Phase 31F: Handle pointer up - delegate to useLongPress for cleanup
  // BUG FIX: Release pointer capture to restore normal event flow
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // Release pointer capture
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if release fails
    }
    longPressHandlers.onPointerUp(e);
  }, [longPressHandlers]);

  // Phase 31F: Handle pointer leave - delegate to useLongPress
  const handlePointerLeave = useCallback((e: React.PointerEvent) => {
    longPressHandlers.onPointerLeave(e);
  }, [longPressHandlers]);

  // Phase 31F: Handle pointer cancel - delegate to useLongPress
  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    longPressHandlers.onPointerCancel(e);
  }, [longPressHandlers]);

  const classNames = [
    'step-cell',
    active && 'active',
    playing && 'playing',
    isBeatStart && 'beat-start',
    hasLock && 'has-lock',
    hasTie && 'has-tie', // Phase 29B: Visual tie indicator
    selected && 'selected',
    isAnchor && 'anchor', // Phase 31F: Selection anchor indicator
    dimmed && 'dimmed',
    isPageEnd && 'page-end',
    flashColor && 'remote-flash',
  ].filter(Boolean).join(' ');

  // Combine styles: swing offset and optional flash color
  const style: React.CSSProperties = {
    transform: `translateX(${swingOffset}px)`,
    ...(flashColor ? { '--flash-color': flashColor } as React.CSSProperties : {}),
  };

  return (
    <button
      className={classNames}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      style={style}
      title={buildTooltip()}
      aria-label={`Step ${stepIndex + 1}, ${active ? 'active' : 'inactive'}${hasLock ? ', has parameter lock' : ''}`}
    >
      {playing && <div className="playing-indicator" data-testid="playing-indicator" />}

      {/* Velocity fill - visual indicator of volume */}
      {active && velocityPercent < 100 && (
        <div
          className="velocity-fill"
          style={{ height: `${velocityPercent}%` }}
        />
      )}

      {/* Parameter lock badges - color coded */}
      {hasLock && (
        <div className="lock-badges">
          {hasTie && (
            <span className="lock-badge tie" title="Tied: continues from previous step">
              ⌒
            </span>
          )}
          {hasPitchLock && (
            <span className="lock-badge pitch" title={`Pitch: ${parameterLock.pitch! > 0 ? '+' : ''}${parameterLock.pitch}`}>
              {parameterLock.pitch! > 0 ? '↑' : '↓'}
            </span>
          )}
          {hasVolumeLock && (
            <span className="lock-badge volume" title={`Volume: ${Math.round((parameterLock.volume!) * 100)}%`}>
              {parameterLock.volume! < 1 ? '−' : '+'}
            </span>
          )}
        </div>
      )}
    </button>
  );
});
