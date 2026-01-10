import { memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { STEP_COUNT_OPTIONS } from '../types';
import { useDropdownMenu } from '../hooks/useDropdownMenu';
import './StepCountDropdown.css';

/**
 * Step count categories with labels for the grouped dropdown
 * See specs/PHASE-31-UI-ENHANCEMENTS.md for full documentation
 */
const STEP_CATEGORIES = {
  standard: {
    label: 'Standard',
    values: [4, 8, 16, 32, 64, 128] as const,
  },
  triplet: {
    label: 'Triplet',
    values: [3, 6, 12, 24, 48, 96] as const,
  },
  polyrhythmic: {
    label: 'Polyrhythmic',
    values: [5, 7, 9, 10, 11, 13, 14, 15, 18, 20, 21, 27, 28, 36] as const,
  },
} as const;

type CategoryKey = keyof typeof STEP_CATEGORIES;

/**
 * Short labels for each step count value
 */
const STEP_LABELS: Record<number, string> = {
  // Standard
  4: '¼ bar',
  8: '½ bar',
  16: '1 bar',
  32: '2 bars',
  64: '4 bars',
  128: '8 bars',
  // Triplet
  3: 'triplet',
  6: '½ triplet',
  12: '1 bar',
  24: 'trap hats',
  48: '3 bars',
  96: '6 bars',
  // Polyrhythmic
  5: '5-let',
  7: '7-let',
  9: '9-let',
  10: '5:4',
  11: 'prime',
  13: 'prime',
  14: '7×2',
  15: '5×3',
  18: '6×3',
  20: '5:4 bar',
  21: '7×3',
  27: '3³',
  28: '7×4',
  36: '6×6',
};

interface StepCountDropdownProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

/**
 * Simple dropdown for selecting step count with category headers
 * All options visible, no collapsing - just scroll
 */
export const StepCountDropdown = memo(function StepCountDropdown({
  value,
  onChange,
  disabled = false,
}: StepCountDropdownProps) {
  const {
    isOpen,
    toggle,
    close,
    menuPosition,
    triggerRef,
    menuRef,
  } = useDropdownMenu<HTMLButtonElement, HTMLDivElement>({
    selectedSelector: '.step-option.selected',
    disabled,
  });

  const handleSelect = useCallback((newValue: number) => {
    onChange(newValue);
    close();
  }, [onChange, close]);

  const currentLabel = STEP_LABELS[value] || `${value}`;

  // Menu rendered via portal to escape overflow containers
  const menu = isOpen
    ? createPortal(
        <div
          className="step-count-menu"
          role="listbox"
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
          }}
        >
          {(Object.keys(STEP_CATEGORIES) as CategoryKey[]).map(categoryKey => {
            const category = STEP_CATEGORIES[categoryKey];

            return (
              <div key={categoryKey} className="menu-category">
                <div className="category-header">
                  <span className="category-label">{category.label}</span>
                </div>

                <div className="category-options">
                  {category.values.map(stepValue => {
                    // Only show values that are in STEP_COUNT_OPTIONS
                    if (!STEP_COUNT_OPTIONS.includes(stepValue)) return null;
                    const isSelected = stepValue === value;
                    const label = STEP_LABELS[stepValue];

                    return (
                      <button
                        key={stepValue}
                        className={`step-option ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelect(stepValue)}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className="option-value">{stepValue}</span>
                        <span className="option-label">{label}</span>
                        {isSelected && <span className="option-check">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>,
        document.body
      )
    : null;

  return (
    <div className="step-count-dropdown">
      <button
        ref={triggerRef}
        className={`step-count-trigger ${isOpen ? 'open' : ''}`}
        onClick={toggle}
        disabled={disabled}
        title={`${value} steps (${currentLabel})`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="step-count-value">{value}</span>
        <span className="step-count-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>
      {menu}
    </div>
  );
});
