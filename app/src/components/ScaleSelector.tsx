import { memo, useCallback } from 'react';
import type { ScaleState } from '../types';
import {
  SCALES,
  ROOT_NOTES,
  getScaleShortName,
  type ScaleId,
  type NoteName,
} from '../music/music-theory';
import './ScaleSelector.css';

interface ScaleSelectorProps {
  scale: ScaleState;
  onScaleChange: (scale: ScaleState) => void;
  disabled?: boolean;
}

/**
 * Scale selector component for the Transport bar.
 * Provides root note selector, scale type selector, and lock toggle.
 */
export const ScaleSelector = memo(function ScaleSelector({
  scale,
  onScaleChange,
  disabled = false,
}: ScaleSelectorProps) {
  const handleRootChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onScaleChange({
      ...scale,
      root: e.target.value as NoteName,
    });
  }, [scale, onScaleChange]);

  const handleScaleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onScaleChange({
      ...scale,
      scaleId: e.target.value as ScaleId,
    });
  }, [scale, onScaleChange]);

  const handleLockToggle = useCallback(() => {
    onScaleChange({
      ...scale,
      locked: !scale.locked,
    });
  }, [scale, onScaleChange]);

  // Group scales by category for the dropdown
  const scalesByCategory = {
    pentatonic: Object.entries(SCALES).filter(([, s]) => s.category === 'pentatonic'),
    diatonic: Object.entries(SCALES).filter(([, s]) => s.category === 'diatonic'),
    modal: Object.entries(SCALES).filter(([, s]) => s.category === 'modal'),
    other: Object.entries(SCALES).filter(([, s]) => s.category === 'other'),
  };

  return (
    <div className={`scale-selector ${scale.locked ? 'locked' : ''}`}>
      <div className="scale-controls">
        {/* Root note selector */}
        <select
          value={scale.root}
          onChange={handleRootChange}
          disabled={disabled}
          className="scale-root-select"
          title="Root note"
          aria-label="Root note"
        >
          {ROOT_NOTES.map(note => (
            <option key={note} value={note}>{note}</option>
          ))}
        </select>

        {/* Scale type selector */}
        <select
          value={scale.scaleId}
          onChange={handleScaleChange}
          disabled={disabled}
          className="scale-type-select"
          title="Scale type"
          aria-label="Scale type"
        >
          <optgroup label="Pentatonic">
            {scalesByCategory.pentatonic.map(([id, s]) => (
              <option key={id} value={id}>{s.name}</option>
            ))}
          </optgroup>
          <optgroup label="Diatonic">
            {scalesByCategory.diatonic.map(([id, s]) => (
              <option key={id} value={id}>{s.name}</option>
            ))}
          </optgroup>
          <optgroup label="Modal">
            {scalesByCategory.modal.map(([id, s]) => (
              <option key={id} value={id}>{s.name}</option>
            ))}
          </optgroup>
          <optgroup label="Other">
            {scalesByCategory.other.map(([id, s]) => (
              <option key={id} value={id}>{s.name}</option>
            ))}
          </optgroup>
        </select>

        {/* Lock toggle */}
        <button
          onClick={handleLockToggle}
          disabled={disabled}
          className={`scale-lock-btn ${scale.locked ? 'locked' : ''}`}
          title={scale.locked ? 'Unlock scale (show all notes)' : 'Lock scale (constrain to scale notes only)'}
          aria-label={scale.locked ? 'Unlock scale' : 'Lock scale'}
          aria-pressed={scale.locked}
        >
          {scale.locked ? '🔒' : '🔓'}
        </button>
      </div>

      {/* Compact display of current scale */}
      <span className="scale-display" title={`Current scale: ${getScaleShortName(scale.root as NoteName, scale.scaleId as ScaleId)}`}>
        {getScaleShortName(scale.root as NoteName, scale.scaleId as ScaleId)}
      </span>
    </div>
  );
});
