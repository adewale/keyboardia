import type { ParameterLock } from '../types';
import './StepCell.css';

interface StepCellProps {
  active: boolean;
  playing: boolean;
  stepIndex: number;
  parameterLock: ParameterLock | null;
  swing: number;
  selected: boolean;
  onClick: () => void;
  onSelect: () => void;
}

export function StepCell({ active, playing, stepIndex, parameterLock, swing, selected, onClick, onSelect }: StepCellProps) {
  // Highlight every 4th step (beat boundaries)
  const isBeatStart = stepIndex % 4 === 0;
  const isSwungStep = stepIndex % 2 === 1; // Odd steps get swung
  const hasLock = parameterLock !== null;
  const hasPitchLock = parameterLock?.pitch !== undefined && parameterLock.pitch !== 0;
  const hasVolumeLock = parameterLock?.volume !== undefined && parameterLock.volume !== 1;

  // Visual swing offset (translate right for swung steps)
  const swingOffset = isSwungStep && swing > 0 ? (swing / 100) * 8 : 0;

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey) {
      // Shift/Cmd+click to select for p-lock editing
      e.preventDefault();
      onSelect();
    } else {
      onClick();
    }
  };

  return (
    <button
      className={`step-cell ${active ? 'active' : ''} ${playing ? 'playing' : ''} ${isBeatStart ? 'beat-start' : ''} ${hasLock ? 'has-lock' : ''} ${selected ? 'selected' : ''}`}
      onClick={handleClick}
      style={{ transform: `translateX(${swingOffset}px)` }}
      aria-label={`Step ${stepIndex + 1}, ${active ? 'active' : 'inactive'}${hasLock ? ', has parameter lock' : ''}`}
    >
      {playing && <div className="playing-indicator" data-testid="playing-indicator" />}

      {/* Parameter lock badges - color coded */}
      {hasLock && (
        <div className="lock-badges">
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
}
