/**
 * Keyboard utilities for conflict detection and input context handling.
 * Phase 36: Centralized keyboard handling abstractions.
 */

/**
 * Check if the event target is a text editing context where keyboard shortcuts
 * should be suppressed (e.g., Space should type a space, not play/pause).
 *
 * Handles:
 * - <input> elements
 * - <textarea> elements
 * - contentEditable elements
 * - Elements with role="textbox"
 */
export function isTextEditingContext(target: EventTarget | null): boolean {
  if (!target) return false;

  // Standard form inputs
  if (target instanceof HTMLInputElement) {
    // Allow shortcuts in non-text inputs (checkbox, radio, range, etc.)
    const textTypes = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'];
    return textTypes.includes(target.type) || !target.type;
  }

  if (target instanceof HTMLTextAreaElement) {
    return true;
  }

  // ContentEditable elements
  if (target instanceof HTMLElement) {
    if (target.isContentEditable) {
      return true;
    }
    // ARIA textbox role
    if (target.getAttribute('role') === 'textbox') {
      return true;
    }
  }

  return false;
}

/**
 * Check if user is on a mobile device (no physical keyboard expected).
 * Used to disable keyboard-only features like the help panel shortcut.
 *
 * Hybrid device handling:
 * - iPad with Magic Keyboard: has touch + fine pointer -> NOT mobile
 * - Chromebook: has touch + fine pointer -> NOT mobile
 * - Surface with keyboard: has touch + fine pointer -> NOT mobile
 * - Phone/tablet without keyboard: only coarse pointer -> IS mobile
 *
 * The key insight: if a device has a fine pointer (mouse/trackpad),
 * it almost certainly has a keyboard available too.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // First check: viewport width for very small screens (phones)
  // These are almost always touch-only devices
  if (window.innerWidth < 480) {
    return true;
  }

  // Check pointer capabilities
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
  const hasAnyPointer = window.matchMedia('(any-pointer: fine)').matches;

  // If device has a fine pointer (mouse/trackpad), it likely has a keyboard
  // This handles: laptops with touchscreens, iPads with Magic Keyboard,
  // Chromebooks, Surface devices with keyboards
  if (hasFinePointer || hasAnyPointer) {
    return false;
  }

  // Check for hover capability - devices with hover typically have keyboards
  const canHover = window.matchMedia('(hover: hover)').matches;
  const anyHover = window.matchMedia('(any-hover: hover)').matches;
  if (canHover || anyHover) {
    return false;
  }

  // At this point: no fine pointer, no hover capability
  // Check if it's a touch-only device
  if (hasCoarsePointer) {
    // Additional check: viewport width for tablets
    // Large tablets (iPad Pro) might still be keyboard-less
    if (window.innerWidth >= 768 && window.innerWidth < 1024) {
      // Medium-sized tablet - could go either way
      // Default to allowing keyboard shortcuts (user can use external keyboard)
      // This is a better UX than blocking features
      return false;
    }

    // Small viewport + coarse pointer only = mobile phone
    if (window.innerWidth < 768) {
      return true;
    }
  }

  // Default: assume keyboard is available
  // Better to show the ? hint than to hide features
  return false;
}

/**
 * Shortcut type: keyboard-only, mouse-based, or mixed.
 */
export type ShortcutType = 'keyboard' | 'mouse' | 'mixed';

/**
 * Keyboard shortcut definition for the help panel and registration.
 */
export interface KeyboardShortcut {
  /** Key or key combination (e.g., "Space", "Escape", "Cmd+Shift+M") */
  keys: string;
  /** Human-readable action description */
  action: string;
  /** Category for grouping in help panel */
  category: 'transport' | 'selection' | 'editing' | 'general';
  /** Whether this shortcut is currently implemented */
  implemented: boolean;
  /** Type of shortcut (keyboard-only, mouse-based, or mixed) */
  type: ShortcutType;
}

/**
 * All keyboard shortcuts for the application.
 * Used by the help panel and for documentation.
 *
 * Note: Only 'keyboard' type shortcuts are shown in the help panel.
 * Mouse-based shortcuts are documented but not displayed there.
 */
export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  // Transport (keyboard only)
  { keys: 'Space', action: 'Play / Pause', category: 'transport', implemented: true, type: 'keyboard' },
  { keys: 'Cmd/Ctrl+Shift+M', action: 'Unmute all tracks', category: 'transport', implemented: true, type: 'keyboard' },

  // Selection (keyboard only)
  { keys: 'Escape', action: 'Clear selection / Cancel', category: 'selection', implemented: true, type: 'keyboard' },
  { keys: 'Delete / Backspace', action: 'Delete selected steps', category: 'selection', implemented: true, type: 'keyboard' },

  // Selection (mouse-based - not shown in help panel)
  { keys: 'Cmd/Ctrl+Click', action: 'Toggle step selection', category: 'selection', implemented: true, type: 'mouse' },

  // Editing (mouse-based - not shown in help panel)
  { keys: 'Shift+Click', action: 'Open parameter editor', category: 'editing', implemented: true, type: 'mouse' },

  // General (keyboard only)
  { keys: '?', action: 'Show keyboard shortcuts', category: 'general', implemented: true, type: 'keyboard' },
];

/**
 * Get shortcuts filtered by category.
 * Only returns keyboard-type shortcuts (not mouse-based).
 */
export function getShortcutsByCategory(category: KeyboardShortcut['category']): KeyboardShortcut[] {
  return KEYBOARD_SHORTCUTS.filter(
    s => s.category === category && s.implemented && s.type === 'keyboard'
  );
}

/**
 * Get all shortcuts filtered by category, including mouse-based.
 * Used for documentation purposes.
 */
export function getAllShortcutsByCategory(category: KeyboardShortcut['category']): KeyboardShortcut[] {
  return KEYBOARD_SHORTCUTS.filter(s => s.category === category && s.implemented);
}

/**
 * Parse a key event into a normalized string representation.
 * E.g., Ctrl+Shift+S on Windows, Cmd+Shift+S on Mac.
 */
export function normalizeKeyEvent(e: KeyboardEvent): string {
  const parts: string[] = [];

  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // Normalize key names
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key === 'Backspace') key = 'Backspace';
  if (key === 'Delete') key = 'Delete';

  // Don't include modifier keys as the main key
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    parts.push(key);
  }

  return parts.join('+');
}
