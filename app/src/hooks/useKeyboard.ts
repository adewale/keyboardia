/**
 * useKeyboard - Centralized keyboard event handling hook.
 * Phase 36: Keyboard shortcuts infrastructure.
 *
 * Features:
 * - Automatic text input conflict detection
 * - Mobile device detection (skips shortcuts on mobile)
 * - Ref-based handlers for stable dependencies
 * - Handler map pattern for cleaner code
 * - Cleanup on unmount
 */

import { useEffect, useRef, useCallback } from 'react';
import { isTextEditingContext, isMobileDevice } from '../utils/keyboard';

/**
 * Keyboard handler configuration.
 * Each handler receives the keyboard event and returns true if handled
 * (to prevent further processing).
 */
export interface KeyboardHandlers {
  /** Space key - typically Play/Pause */
  onSpace?: () => void;
  /** Escape key - cancel/close/clear */
  onEscape?: () => void;
  /** Delete or Backspace key */
  onDelete?: () => void;
  /** ? key - show help panel (desktop only) */
  onHelp?: () => void;
  /** Arrow Up key */
  onArrowUp?: () => void;
  /** Arrow Down key */
  onArrowDown?: () => void;
  /** Arrow Left key */
  onArrowLeft?: () => void;
  /** Arrow Right key */
  onArrowRight?: () => void;
  /** Enter key */
  onEnter?: () => void;
  /** M key - mute focused track */
  onMute?: () => void;
  /** S key - solo focused track */
  onSolo?: () => void;
  /** Cmd/Ctrl+Shift+M - unmute all */
  onUnmuteAll?: () => void;
  /** Custom handler for any key not explicitly handled */
  onCustom?: (e: KeyboardEvent) => boolean;
}

/**
 * Options for the useKeyboard hook.
 */
export interface UseKeyboardOptions {
  /** Whether keyboard handling is enabled (default: true) */
  enabled?: boolean;
  /** Whether to skip shortcuts on mobile devices (default: true) */
  skipOnMobile?: boolean;
  /** Whether to skip single-letter shortcuts in text inputs (default: true) */
  skipInTextInput?: boolean;
}

/**
 * Handler definition for the handler map.
 */
interface HandlerDef {
  /** Handler function name in KeyboardHandlers */
  handler: keyof Omit<KeyboardHandlers, 'onCustom'>;
  /** Whether this shortcut should be skipped in text inputs (default: true) */
  skipInTextInput?: boolean;
  /** Whether this shortcut should be skipped on mobile (default: false) */
  skipOnMobile?: boolean;
  /** Whether modifiers must NOT be pressed (default: false) */
  requireNoModifiers?: boolean;
}

/**
 * Key matcher function type.
 */
type KeyMatcher = (e: KeyboardEvent) => boolean;

/**
 * Handler map entry: [matcher, definition]
 */
type HandlerMapEntry = [KeyMatcher, HandlerDef];

/**
 * Create the handler map - maps key matchers to handler definitions.
 * Order matters: first match wins.
 */
const HANDLER_MAP: HandlerMapEntry[] = [
  // Escape - always works (even in text inputs)
  [
    (e) => e.key === 'Escape',
    { handler: 'onEscape', skipInTextInput: false },
  ],

  // Cmd/Ctrl+Shift+M - unmute all (before plain M check)
  [
    (e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm',
    { handler: 'onUnmuteAll' },
  ],

  // ? or Shift+/ - help panel (desktop only)
  [
    (e) => e.key === '?' || (e.shiftKey && e.key === '/'),
    { handler: 'onHelp', skipOnMobile: true },
  ],

  // Space - play/pause
  [
    (e) => e.key === ' ' || e.code === 'Space',
    { handler: 'onSpace' },
  ],

  // Delete/Backspace - delete selection
  [
    (e) => e.key === 'Delete' || e.key === 'Backspace',
    { handler: 'onDelete' },
  ],

  // Arrow keys
  [
    (e) => e.key === 'ArrowUp',
    { handler: 'onArrowUp' },
  ],
  [
    (e) => e.key === 'ArrowDown',
    { handler: 'onArrowDown' },
  ],
  [
    (e) => e.key === 'ArrowLeft',
    { handler: 'onArrowLeft' },
  ],
  [
    (e) => e.key === 'ArrowRight',
    { handler: 'onArrowRight' },
  ],

  // Enter
  [
    (e) => e.key === 'Enter',
    { handler: 'onEnter' },
  ],

  // M - mute (no modifiers)
  [
    (e) => e.key.toLowerCase() === 'm',
    { handler: 'onMute', requireNoModifiers: true },
  ],

  // S - solo (no modifiers)
  [
    (e) => e.key.toLowerCase() === 's',
    { handler: 'onSolo', requireNoModifiers: true },
  ],
];

/**
 * Hook for centralized keyboard handling.
 *
 * @example
 * ```tsx
 * useKeyboard({
 *   onSpace: () => handlePlayPause(),
 *   onEscape: () => handleCancel(),
 *   onDelete: () => handleDeleteSelection(),
 * });
 * ```
 */
export function useKeyboard(
  handlers: KeyboardHandlers,
  options: UseKeyboardOptions = {}
): void {
  const {
    enabled = true,
    skipOnMobile = true,
    skipInTextInput = true,
  } = options;

  // Use refs for handlers to avoid re-registering on every render
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  // Memoize mobile check result to avoid repeated calls
  const isMobileRef = useRef<boolean | null>(null);
  const checkIsMobile = useCallback(() => {
    if (isMobileRef.current === null) {
      isMobileRef.current = isMobileDevice();
    }
    return isMobileRef.current;
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const h = handlersRef.current;

    // Skip if disabled
    if (!enabled) return;

    // Check text input context for shortcuts that would conflict
    const inTextInput = skipInTextInput && isTextEditingContext(e.target);

    // Check for modifier keys
    const hasModifiers = e.metaKey || e.ctrlKey || e.altKey;

    // Try each handler in the map
    for (const [matcher, def] of HANDLER_MAP) {
      if (!matcher(e)) continue;

      // Get the handler function
      const handlerFn = h[def.handler];
      if (!handlerFn) continue;

      // Check skipInTextInput (default: true)
      const shouldSkipInTextInput = def.skipInTextInput !== false;
      if (shouldSkipInTextInput && inTextInput) continue;

      // Check skipOnMobile
      if (def.skipOnMobile && skipOnMobile && checkIsMobile()) continue;

      // Check requireNoModifiers
      if (def.requireNoModifiers && hasModifiers) continue;

      // All checks passed - call the handler
      e.preventDefault();
      handlerFn();
      return;
    }

    // Custom handler for anything not explicitly handled
    if (h.onCustom) {
      const handled = h.onCustom(e);
      if (handled) {
        e.preventDefault();
      }
    }
  }, [enabled, skipOnMobile, skipInTextInput, checkIsMobile]);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

export default useKeyboard;
