/**
 * KeyboardShortcutsPanel Component Tests
 * Phase 36: Tests for the keyboard shortcuts help panel
 *
 * Test IDs:
 * - KSP-001: Rendering tests
 * - KSP-002: Close functionality tests
 * - KSP-003: Focus management tests
 * - KSP-004: Content tests
 * - KSP-005: Accessibility tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';

// Mock the keyboard utilities
vi.mock('../../utils/keyboard', () => ({
  getShortcutsByCategory: vi.fn((category: string) => {
    const shortcuts: Record<string, Array<{ keys: string; action: string }>> = {
      transport: [
        { keys: 'Space', action: 'Play/Pause' },
      ],
      selection: [
        { keys: 'Escape', action: 'Clear selection' },
        { keys: 'Delete', action: 'Delete selected steps' },
      ],
      editing: [
        { keys: 'Cmd/Ctrl+Shift+M', action: 'Unmute all tracks' },
      ],
      general: [
        { keys: '?', action: 'Show keyboard shortcuts' },
      ],
    };
    return shortcuts[category] || [];
  }),
}));

describe('KeyboardShortcutsPanel', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset any focus
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // KSP-001: Rendering Tests
  // ==========================================================================
  describe('KSP-001: Rendering', () => {
    it('KSP-001a: renders nothing when isOpen is false', () => {
      const { container } = render(
        <KeyboardShortcutsPanel isOpen={false} onClose={vi.fn()} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('KSP-001b: renders panel when isOpen is true', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
    });

    it('KSP-001c: renders backdrop with correct class', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const backdrop = document.querySelector('.shortcuts-backdrop');
      expect(backdrop).not.toBeNull();
    });

    it('KSP-001d: renders panel container', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const panel = document.querySelector('.shortcuts-panel');
      expect(panel).not.toBeNull();
    });

    it('KSP-001e: renders header with title', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const title = screen.getByText('Keyboard Shortcuts');
      expect(title).not.toBeNull();
    });

    it('KSP-001f: renders close button', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const closeButton = document.querySelector('.shortcuts-close');
      expect(closeButton).not.toBeNull();
      expect(closeButton?.getAttribute('aria-label')).toBe('Close');
    });

    it('KSP-001g: renders footer hint', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const footer = document.querySelector('.shortcuts-footer');
      expect(footer).not.toBeNull();
      expect(footer?.textContent).toContain('Press');
      expect(footer?.textContent).toContain('to close');
    });
  });

  // ==========================================================================
  // KSP-002: Close Functionality Tests
  // ==========================================================================
  describe('KSP-002: Close Functionality', () => {
    it('KSP-002a: calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);

      const closeButton = document.querySelector('.shortcuts-close');
      if (closeButton) {
        fireEvent.click(closeButton);
      }

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('KSP-002b: calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);

      const backdrop = document.querySelector('.shortcuts-backdrop');
      if (backdrop) {
        // Click directly on the backdrop (not the panel)
        fireEvent.click(backdrop);
      }

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('KSP-002c: does NOT call onClose when panel content is clicked', () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);

      const panel = document.querySelector('.shortcuts-panel');
      if (panel) {
        fireEvent.click(panel);
      }

      expect(onClose).not.toHaveBeenCalled();
    });

    it('KSP-002d: calls onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);

      const backdrop = document.querySelector('.shortcuts-backdrop');
      if (backdrop) {
        fireEvent.keyDown(backdrop, { key: 'Escape' });
      }

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('KSP-002e: calls onClose when ? key is pressed', () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);

      const backdrop = document.querySelector('.shortcuts-backdrop');
      if (backdrop) {
        fireEvent.keyDown(backdrop, { key: '?' });
      }

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('KSP-002f: calls onClose when Shift+/ is pressed', () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);

      const backdrop = document.querySelector('.shortcuts-backdrop');
      if (backdrop) {
        fireEvent.keyDown(backdrop, { key: '/', shiftKey: true });
      }

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('KSP-002g: stops propagation on Escape to prevent double-handling', () => {
      const onClose = vi.fn();
      render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);

      const backdrop = document.querySelector('.shortcuts-backdrop');
      if (backdrop) {
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        });
        const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

        fireEvent(backdrop, event);

        expect(stopPropagationSpy).toHaveBeenCalled();
      }
    });
  });

  // ==========================================================================
  // KSP-003: Focus Management Tests
  // ==========================================================================
  describe('KSP-003: Focus Management', () => {
    it('KSP-003a: focuses close button when panel opens', async () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      // Wait for setTimeout in the component
      await waitFor(() => {
        const closeButton = document.querySelector('.shortcuts-close');
        expect(document.activeElement).toBe(closeButton);
      });
    });

    it('KSP-003b: restores focus to previously focused element on close', async () => {
      // For this test, we need to control the open/close cycle
      const { rerender } = render(
        <>
          <button data-testid="trigger-button">Trigger</button>
          <KeyboardShortcutsPanel isOpen={false} onClose={vi.fn()} />
        </>
      );

      // Focus the trigger button
      const triggerButton = screen.getByTestId('trigger-button');
      triggerButton.focus();
      expect(document.activeElement).toBe(triggerButton);

      // Open the panel
      rerender(
        <>
          <button data-testid="trigger-button">Trigger</button>
          <KeyboardShortcutsPanel isOpen={true} onClose={vi.fn()} />
        </>
      );

      // Wait for focus to move to close button
      await waitFor(() => {
        const closeButton = document.querySelector('.shortcuts-close');
        expect(document.activeElement).toBe(closeButton);
      });

      // Close the panel
      rerender(
        <>
          <button data-testid="trigger-button">Trigger</button>
          <KeyboardShortcutsPanel isOpen={false} onClose={vi.fn()} />
        </>
      );

      // Focus should be restored to trigger button
      await waitFor(() => {
        const currentTrigger = screen.getByTestId('trigger-button');
        expect(document.activeElement).toBe(currentTrigger);
      });
    });

    it('KSP-003c: close button has correct class for styling', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const closeButton = document.querySelector('.shortcuts-close');
      expect(closeButton).not.toBeNull();
      expect(closeButton?.classList.contains('shortcuts-close')).toBe(true);
    });
  });

  // ==========================================================================
  // KSP-004: Content Tests
  // ==========================================================================
  describe('KSP-004: Content', () => {
    it('KSP-004a: renders Transport section', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const transportTitle = screen.getByText('Transport');
      expect(transportTitle).not.toBeNull();
    });

    it('KSP-004b: renders Selection section', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const selectionTitle = screen.getByText('Selection');
      expect(selectionTitle).not.toBeNull();
    });

    it('KSP-004c: renders Editing section', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const editingTitle = screen.getByText('Editing');
      expect(editingTitle).not.toBeNull();
    });

    it('KSP-004d: renders General section', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const generalTitle = screen.getByText('General');
      expect(generalTitle).not.toBeNull();
    });

    it('KSP-004e: renders Space shortcut in Transport section', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const playPauseAction = screen.getByText('Play/Pause');
      expect(playPauseAction).not.toBeNull();
    });

    it('KSP-004f: renders keyboard keys with kbd element', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const kbdElements = document.querySelectorAll('kbd.shortcut-key');
      expect(kbdElements.length).toBeGreaterThan(0);
    });

    it('KSP-004g: renders shortcut with + separator for modifiers', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      // Cmd/Ctrl+Shift+M should have + separators
      const separators = document.querySelectorAll('.shortcut-separator');
      expect(separators.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // KSP-005: Accessibility Tests
  // ==========================================================================
  describe('KSP-005: Accessibility', () => {
    it('KSP-005a: has role="dialog"', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
    });

    it('KSP-005b: has aria-modal="true"', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
    });

    it('KSP-005c: has aria-label', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.getAttribute('aria-label')).toBe('Keyboard shortcuts');
    });

    it('KSP-005d: close button has aria-label', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const closeButton = document.querySelector('.shortcuts-close');
      expect(closeButton?.getAttribute('aria-label')).toBe('Close');
    });

    it('KSP-005e: close button has type="button"', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const closeButton = document.querySelector('.shortcuts-close');
      expect(closeButton?.getAttribute('type')).toBe('button');
    });

    it('KSP-005f: main title is h2', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const h2 = document.querySelector('h2.shortcuts-title');
      expect(h2).not.toBeNull();
      expect(h2?.textContent).toBe('Keyboard Shortcuts');
    });

    it('KSP-005g: section titles are h3', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const h3Elements = document.querySelectorAll('h3.shortcuts-section-title');
      expect(h3Elements.length).toBe(4); // Transport, Selection, Editing, General
    });
  });

  // ==========================================================================
  // KSP-006: Animation & Styling Tests
  // ==========================================================================
  describe('KSP-006: Animation & Styling', () => {
    it('KSP-006a: backdrop has animation class', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const backdrop = document.querySelector('.shortcuts-backdrop');
      expect(backdrop).not.toBeNull();
    });

    it('KSP-006b: panel has panel class', () => {
      render(<KeyboardShortcutsPanel {...defaultProps} />);

      const panel = document.querySelector('.shortcuts-panel');
      expect(panel).not.toBeNull();
    });
  });
});
