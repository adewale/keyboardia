import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './TransposeDropdown.css';

/**
 * Transpose value categories with labels
 */
const TRANSPOSE_CATEGORIES = {
  octaves: {
    label: 'Octaves',
    values: [-24, -12, 0, 12, 24] as const,
  },
  common: {
    label: 'Common',
    values: [-7, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 7] as const,
  },
} as const;

type CategoryKey = keyof typeof TRANSPOSE_CATEGORIES;

/**
 * Labels for transpose values
 */
const TRANSPOSE_LABELS: Record<number, string> = {
  // Octaves
  [-24]: '-2 oct',
  [-12]: '-1 oct',
  [0]: 'none',
  [12]: '+1 oct',
  [24]: '+2 oct',
  // Intervals (common transpositions)
  [-7]: 'P5 down',
  [-5]: 'P4 down',
  [-4]: 'M3 down',
  [-3]: 'm3 down',
  [-2]: 'M2 down',
  [-1]: 'm2 down',
  [1]: 'm2 up',
  [2]: 'M2 up',
  [3]: 'm3 up',
  [4]: 'M3 up',
  [5]: 'P4 up',
  [7]: 'P5 up',
};

interface TransposeDropdownProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

/**
 * Dropdown for selecting transpose values with category headers
 * Uses portal for overlay behavior (matches StepCountDropdown)
 */
export const TransposeDropdown = memo(function TransposeDropdown({
  value,
  onChange,
  disabled = false,
}: TransposeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedTrigger = triggerRef.current?.contains(target);
      const clickedMenu = menuRef.current?.contains(target);
      if (!clickedTrigger && !clickedMenu) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Scroll to selected item when opening
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const selectedEl = menuRef.current.querySelector('.transpose-option.selected');
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
  }, [isOpen]);

  // Update menu position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    if (!disabled) {
      setIsOpen(prev => !prev);
    }
  }, [disabled]);

  const handleSelect = useCallback((newValue: number) => {
    onChange(newValue);
    setIsOpen(false);
  }, [onChange]);

  const displayValue = value > 0 ? `+${value}` : `${value}`;

  // Menu rendered via portal
  const menu = isOpen
    ? createPortal(
        <div
          className="transpose-menu"
          role="listbox"
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
          }}
        >
          {(Object.keys(TRANSPOSE_CATEGORIES) as CategoryKey[]).map(categoryKey => {
            const category = TRANSPOSE_CATEGORIES[categoryKey];

            return (
              <div key={categoryKey} className="menu-category">
                <div className="category-header">
                  <span className="category-label">{category.label}</span>
                </div>

                <div className="category-options">
                  {category.values.map(transposeValue => {
                    const isSelected = transposeValue === value;
                    const label = TRANSPOSE_LABELS[transposeValue] || '';
                    const display = transposeValue > 0 ? `+${transposeValue}` : `${transposeValue}`;

                    return (
                      <button
                        key={transposeValue}
                        className={`transpose-option ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelect(transposeValue)}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className="option-value">{display}</span>
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
    <div className="transpose-dropdown">
      <button
        ref={triggerRef}
        className={`transpose-trigger ${isOpen ? 'open' : ''} ${value !== 0 ? 'active' : ''}`}
        onClick={handleToggle}
        disabled={disabled}
        title={`Transpose: ${displayValue} semitones`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="transpose-value">{displayValue}</span>
        <span className="transpose-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>
      {menu}
    </div>
  );
});
