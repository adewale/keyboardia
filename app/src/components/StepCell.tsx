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
  dimmed?: boolean; // True if step is beyond track's stepCount
  isPageEnd?: boolean; // True if this is the last step of a 16-step page
  flashColor?: string | null; // Phase 11: Remote change attribution color
  onClick: () => void;
  onSelect: () => void;
}

export const StepCell = memo(function StepCell({ active, playing, stepIndex, parameterLock, swing, selected, dimmed, isPageEnd, flashColor, onClick, onSelect }: StepCellProps) {
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

  const longPressHandlers = useLongPress({
    onLongPress: handleLongPress,
    onClick: onClick,
    delay: 400,
  });

  const classNames = [
    'step-cell',
    active && 'active',
    playing && 'playing',
    isBeatStart && 'beat-start',
    hasLock && 'has-lock',
    hasTie && 'has-tie', // Phase 29B: Visual tie indicator
    selected && 'selected',
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
      {...longPressHandlers}
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
