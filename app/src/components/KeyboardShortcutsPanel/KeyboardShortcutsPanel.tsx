/**
 * KeyboardShortcutsPanel - Desktop-only help panel showing keyboard shortcuts.
 * Phase 36: Keyboard shortcuts infrastructure.
 *
 * Features:
 * - Triggered by ? key (desktop only)
 * - Studio professional aesthetic with grid-based alignment
 * - Non-blocking (Space still plays/pauses while open)
 * - Closes with ?, Escape, backdrop click, or X button
 * - Smart parsing: handles both alternatives (/) and combinations (+)
 */

import { useCallback, useEffect, useRef } from 'react';
import { getShortcutsByCategory } from '../../utils/keyboard';
import './KeyboardShortcutsPanel.css';

interface KeyboardShortcutsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Token types for key string parsing.
 */
type KeyToken =
  | { type: 'key'; value: string }
  | { type: 'combo' }      // + separator (key combination)
  | { type: 'alt' };       // / separator (alternative keys)

/**
 * Parse a key string into tokens that distinguish between:
 * - Key combinations (using +): "Cmd/Ctrl+Shift+M"
 * - Alternative keys (using /): "Delete / Backspace", "Cmd/Ctrl"
 *
 * Rules:
 * - " / " (with spaces) = alternative separator
 * - "/" within a key like "Cmd/Ctrl" = inline alternative (renders as single badge)
 * - "+" = combination separator
 */
function parseKeyString(keys: string): KeyToken[] {
  const tokens: KeyToken[] = [];

  // First, split by " / " (alternatives with spaces)
  const altParts = keys.split(' / ');

  altParts.forEach((part, altIndex) => {
    if (altIndex > 0) {
      tokens.push({ type: 'alt' });
    }

    // Then split each part by "+" (combinations)
    const comboParts = part.split('+');

    comboParts.forEach((key, comboIndex) => {
      if (comboIndex > 0) {
        tokens.push({ type: 'combo' });
      }
      tokens.push({ type: 'key', value: key.trim() });
    });
  });

  return tokens;
}

/**
 * Render a single shortcut row with smart key token rendering.
 */
function ShortcutRow({ keys, action }: { keys: string; action: string }) {
  const tokens = parseKeyString(keys);

  return (
    <div className="shortcut-row">
      <div className="shortcut-keys">
        {tokens.map((token, i) => {
          if (token.type === 'key') {
            return <kbd key={i} className="shortcut-key">{token.value}</kbd>;
          }
          if (token.type === 'combo') {
            return <span key={i} className="shortcut-separator">+</span>;
          }
          if (token.type === 'alt') {
            return <span key={i} className="shortcut-alt-separator">/</span>;
          }
          return null;
        })}
      </div>
      <span className="shortcut-action">{action}</span>
    </div>
  );
}

/**
 * Render a section of shortcuts.
 */
function ShortcutSection({ title, category }: { title: string; category: 'transport' | 'selection' | 'editing' | 'general' }) {
  const shortcuts = getShortcutsByCategory(category);

  if (shortcuts.length === 0) return null;

  return (
    <div className="shortcuts-section">
      <h3 className="shortcuts-section-title">{title}</h3>
      <div className="shortcuts-list">
        {shortcuts.map((shortcut, i) => (
          <ShortcutRow key={i} keys={shortcut.keys} action={shortcut.action} />
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsPanel({ isOpen, onClose }: KeyboardShortcutsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Store previous focus on open
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Focus the close button for keyboard accessibility
      setTimeout(() => {
        const closeButton = panelRef.current?.querySelector('.shortcuts-close') as HTMLButtonElement;
        closeButton?.focus();
      }, 0);
    } else {
      // Restore focus on close
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Get all focusable elements within the panel
  const getFocusableElements = useCallback(() => {
    if (!panelRef.current) return [];
    const focusableSelectors = [
      'button',
      '[href]',
      'input',
      'select',
      'textarea',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');
    return Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelectors));
  }, []);

  // Handle keyboard events including focus trap
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Close on Escape
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    // Close on ? (toggle behavior)
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    // Focus trap on Tab
    if (e.key === 'Tab') {
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  }, [onClose, getFocusableElements]);

  if (!isOpen) return null;

  return (
    <div
      className="shortcuts-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="shortcuts-panel" ref={panelRef}>
        <div className="shortcuts-header">
          <h2 className="shortcuts-title">Keyboard Shortcuts</h2>
          <button
            className="shortcuts-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="shortcuts-content">
          <ShortcutSection title="Transport" category="transport" />
          <ShortcutSection title="Selection" category="selection" />
          <ShortcutSection title="Editing" category="editing" />
          <ShortcutSection title="General" category="general" />
        </div>

        <div className="shortcuts-footer">
          <p className="shortcuts-hint">
            Press <kbd>?</kbd> or <kbd>Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}

export default KeyboardShortcutsPanel;
