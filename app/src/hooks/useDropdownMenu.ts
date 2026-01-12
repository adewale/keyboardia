/**
 * useDropdownMenu Hook
 *
 * Reusable hook for dropdown menu behavior, extracted from
 * StepCountDropdown and TransposeDropdown to eliminate duplication.
 *
 * Features:
 * - Click outside detection (closes menu)
 * - Escape key handling (closes menu)
 * - Auto-scroll to selected item on open
 * - Menu positioning relative to trigger
 *
 * TASK-005 from DUPLICATION-REMEDIATION-PLAN.md
 */

import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';

interface MenuPosition {
  top: number;
  left: number;
}

interface UseDropdownMenuOptions {
  /** CSS selector for the selected item (for auto-scroll) */
  selectedSelector?: string;
  /** Gap in pixels between trigger and menu */
  positionGap?: number;
  /** Whether the dropdown is disabled */
  disabled?: boolean;
}

interface UseDropdownMenuReturn<T extends HTMLElement, M extends HTMLElement> {
  /** Whether the menu is currently open */
  isOpen: boolean;
  /** Set the open state directly */
  setIsOpen: (open: boolean) => void;
  /** Toggle the menu open/closed */
  toggle: () => void;
  /** Close the menu */
  close: () => void;
  /** Current menu position for fixed positioning */
  menuPosition: MenuPosition;
  /** Ref to attach to the trigger button */
  triggerRef: RefObject<T | null>;
  /** Ref to attach to the menu container */
  menuRef: RefObject<M | null>;
}

/**
 * Hook for managing dropdown menu state and behavior.
 *
 * @example
 * ```tsx
 * const {
 *   isOpen,
 *   toggle,
 *   menuPosition,
 *   triggerRef,
 *   menuRef,
 * } = useDropdownMenu<HTMLButtonElement, HTMLDivElement>({
 *   selectedSelector: '.option.selected',
 * });
 * ```
 */
export function useDropdownMenu<
  T extends HTMLElement = HTMLButtonElement,
  M extends HTMLElement = HTMLDivElement
>(options: UseDropdownMenuOptions = {}): UseDropdownMenuReturn<T, M> {
  const {
    selectedSelector = '.selected',
    positionGap = 4,
    disabled = false,
  } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const triggerRef = useRef<T>(null);
  const menuRef = useRef<M>(null);

  // Close dropdown when clicking outside (trigger or menu)
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

  // Close on escape key
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
    if (isOpen && menuRef.current && selectedSelector) {
      const selectedEl = menuRef.current.querySelector(selectedSelector);
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
  }, [isOpen, selectedSelector]);

  // Update menu position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + positionGap,
        left: rect.left,
      });
    }
  }, [isOpen, positionGap]);

  const toggle = useCallback(() => {
    if (!disabled) {
      setIsOpen(prev => !prev);
    }
  }, [disabled]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    setIsOpen,
    toggle,
    close,
    menuPosition,
    triggerRef,
    menuRef,
  };
}
