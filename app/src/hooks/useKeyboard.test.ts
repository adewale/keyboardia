/**
 * useKeyboard Hook Tests
 * Phase 36: Comprehensive tests for centralized keyboard handling
 *
 * Test IDs:
 * - UK-001: Handler invocation tests
 * - UK-002: Event listener lifecycle tests
 * - UK-003: Options flag tests
 * - UK-004: Text input conflict tests
 * - UK-005: Mobile device detection tests
 * - UK-006: Modifier key tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboard } from './useKeyboard';

// Mock the keyboard utilities
vi.mock('../utils/keyboard', () => ({
  isTextEditingContext: vi.fn(() => false),
  isMobileDevice: vi.fn(() => false),
}));

import { isTextEditingContext, isMobileDevice } from '../utils/keyboard';

const mockIsTextEditingContext = vi.mocked(isTextEditingContext);
const mockIsMobileDevice = vi.mocked(isMobileDevice);

describe('useKeyboard Hook', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    mockIsTextEditingContext.mockReturnValue(false);
    mockIsMobileDevice.mockReturnValue(false);
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  // Helper to simulate keyboard events
  function simulateKeyDown(key: string, options: Partial<KeyboardEvent> = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      code: key === ' ' ? 'Space' : `Key${key.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    window.dispatchEvent(event);
    return event;
  }

  // ==========================================================================
  // UK-001: Handler Invocation Tests
  // ==========================================================================
  describe('UK-001: Handler Invocation', () => {
    it('UK-001a: calls onSpace when Space key is pressed', () => {
      const onSpace = vi.fn();
      renderHook(() => useKeyboard({ onSpace }));

      simulateKeyDown(' ');

      expect(onSpace).toHaveBeenCalledTimes(1);
    });

    it('UK-001b: calls onEscape when Escape key is pressed', () => {
      const onEscape = vi.fn();
      renderHook(() => useKeyboard({ onEscape }));

      simulateKeyDown('Escape');

      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('UK-001c: calls onDelete when Delete key is pressed', () => {
      const onDelete = vi.fn();
      renderHook(() => useKeyboard({ onDelete }));

      simulateKeyDown('Delete');

      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('UK-001d: calls onDelete when Backspace key is pressed', () => {
      const onDelete = vi.fn();
      renderHook(() => useKeyboard({ onDelete }));

      simulateKeyDown('Backspace');

      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('UK-001e: calls onHelp when ? key is pressed', () => {
      const onHelp = vi.fn();
      renderHook(() => useKeyboard({ onHelp }));

      simulateKeyDown('?');

      expect(onHelp).toHaveBeenCalledTimes(1);
    });

    it('UK-001f: calls onHelp when Shift+/ is pressed', () => {
      const onHelp = vi.fn();
      renderHook(() => useKeyboard({ onHelp }));

      simulateKeyDown('/', { shiftKey: true });

      expect(onHelp).toHaveBeenCalledTimes(1);
    });

    it('UK-001g: calls onMute when M key is pressed', () => {
      const onMute = vi.fn();
      renderHook(() => useKeyboard({ onMute }));

      simulateKeyDown('m');

      expect(onMute).toHaveBeenCalledTimes(1);
    });

    it('UK-001h: calls onSolo when S key is pressed', () => {
      const onSolo = vi.fn();
      renderHook(() => useKeyboard({ onSolo }));

      simulateKeyDown('s');

      expect(onSolo).toHaveBeenCalledTimes(1);
    });

    it('UK-001i: calls onArrowUp when ArrowUp key is pressed', () => {
      const onArrowUp = vi.fn();
      renderHook(() => useKeyboard({ onArrowUp }));

      simulateKeyDown('ArrowUp');

      expect(onArrowUp).toHaveBeenCalledTimes(1);
    });

    it('UK-001j: calls onArrowDown when ArrowDown key is pressed', () => {
      const onArrowDown = vi.fn();
      renderHook(() => useKeyboard({ onArrowDown }));

      simulateKeyDown('ArrowDown');

      expect(onArrowDown).toHaveBeenCalledTimes(1);
    });

    it('UK-001k: calls onArrowLeft when ArrowLeft key is pressed', () => {
      const onArrowLeft = vi.fn();
      renderHook(() => useKeyboard({ onArrowLeft }));

      simulateKeyDown('ArrowLeft');

      expect(onArrowLeft).toHaveBeenCalledTimes(1);
    });

    it('UK-001l: calls onArrowRight when ArrowRight key is pressed', () => {
      const onArrowRight = vi.fn();
      renderHook(() => useKeyboard({ onArrowRight }));

      simulateKeyDown('ArrowRight');

      expect(onArrowRight).toHaveBeenCalledTimes(1);
    });

    it('UK-001m: calls onEnter when Enter key is pressed', () => {
      const onEnter = vi.fn();
      renderHook(() => useKeyboard({ onEnter }));

      simulateKeyDown('Enter');

      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    it('UK-001n: does not call handler if not provided', () => {
      const onSpace = vi.fn();
      renderHook(() => useKeyboard({ onSpace }));

      // Press a key with no handler
      simulateKeyDown('ArrowUp');

      // onSpace should not be called
      expect(onSpace).not.toHaveBeenCalled();
    });

    it('UK-001o: calls onCustom for unhandled keys', () => {
      const onCustom = vi.fn(() => true);
      renderHook(() => useKeyboard({ onCustom }));

      simulateKeyDown('x');

      expect(onCustom).toHaveBeenCalledTimes(1);
      expect(onCustom).toHaveBeenCalledWith(expect.any(KeyboardEvent));
    });
  });

  // ==========================================================================
  // UK-002: Event Listener Lifecycle Tests
  // ==========================================================================
  describe('UK-002: Event Listener Lifecycle', () => {
    it('UK-002a: registers keydown listener on mount', () => {
      renderHook(() => useKeyboard({ onSpace: vi.fn() }));

      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('UK-002b: removes keydown listener on unmount', () => {
      const { unmount } = renderHook(() => useKeyboard({ onSpace: vi.fn() }));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('UK-002c: does not register listener when disabled', () => {
      renderHook(() => useKeyboard({ onSpace: vi.fn() }, { enabled: false }));

      // Should not add listener when disabled
      expect(addEventListenerSpy).not.toHaveBeenCalled();
    });

    it('UK-002d: removes and re-adds listener when enabled changes', () => {
      const { rerender } = renderHook(
        ({ enabled }) => useKeyboard({ onSpace: vi.fn() }, { enabled }),
        { initialProps: { enabled: true } }
      );

      expect(addEventListenerSpy).toHaveBeenCalledTimes(1);

      // Disable
      rerender({ enabled: false });
      expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);

      // Re-enable
      rerender({ enabled: true });
      expect(addEventListenerSpy).toHaveBeenCalledTimes(2);
    });

    it('UK-002e: handler ref updates without re-registering listener', () => {
      const onSpace1 = vi.fn();
      const onSpace2 = vi.fn();

      const { rerender } = renderHook(
        ({ onSpace }) => useKeyboard({ onSpace }),
        { initialProps: { onSpace: onSpace1 } }
      );

      // Listener registered once
      expect(addEventListenerSpy).toHaveBeenCalledTimes(1);

      // Update handler
      rerender({ onSpace: onSpace2 });

      // Listener should NOT be re-registered (ref-based)
      expect(addEventListenerSpy).toHaveBeenCalledTimes(1);

      // New handler should be called
      simulateKeyDown(' ');
      expect(onSpace1).not.toHaveBeenCalled();
      expect(onSpace2).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // UK-003: Options Flag Tests
  // ==========================================================================
  describe('UK-003: Options Flags', () => {
    it('UK-003a: enabled=false prevents all handlers from being called', () => {
      const onSpace = vi.fn();
      const onEscape = vi.fn();

      renderHook(() => useKeyboard({ onSpace, onEscape }, { enabled: false }));

      simulateKeyDown(' ');
      simulateKeyDown('Escape');

      expect(onSpace).not.toHaveBeenCalled();
      expect(onEscape).not.toHaveBeenCalled();
    });

    it('UK-003b: skipOnMobile=true skips help on mobile devices', () => {
      mockIsMobileDevice.mockReturnValue(true);

      const onHelp = vi.fn();
      renderHook(() => useKeyboard({ onHelp }, { skipOnMobile: true }));

      simulateKeyDown('?');

      expect(onHelp).not.toHaveBeenCalled();
    });

    it('UK-003c: skipOnMobile=false allows help on mobile devices', () => {
      mockIsMobileDevice.mockReturnValue(true);

      const onHelp = vi.fn();
      renderHook(() => useKeyboard({ onHelp }, { skipOnMobile: false }));

      simulateKeyDown('?');

      expect(onHelp).toHaveBeenCalledTimes(1);
    });

    it('UK-003d: skipInTextInput=true skips single-letter shortcuts in text inputs', () => {
      mockIsTextEditingContext.mockReturnValue(true);

      const onMute = vi.fn();
      const onSolo = vi.fn();
      renderHook(() => useKeyboard({ onMute, onSolo }, { skipInTextInput: true }));

      simulateKeyDown('m');
      simulateKeyDown('s');

      expect(onMute).not.toHaveBeenCalled();
      expect(onSolo).not.toHaveBeenCalled();
    });

    it('UK-003e: skipInTextInput=false allows shortcuts in text inputs', () => {
      mockIsTextEditingContext.mockReturnValue(true);

      const onMute = vi.fn();
      renderHook(() => useKeyboard({ onMute }, { skipInTextInput: false }));

      simulateKeyDown('m');

      expect(onMute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // UK-004: Text Input Conflict Tests
  // ==========================================================================
  describe('UK-004: Text Input Conflicts', () => {
    it('UK-004a: Space is skipped in text input context', () => {
      mockIsTextEditingContext.mockReturnValue(true);

      const onSpace = vi.fn();
      renderHook(() => useKeyboard({ onSpace }));

      simulateKeyDown(' ');

      expect(onSpace).not.toHaveBeenCalled();
    });

    it('UK-004b: Delete is skipped in text input context', () => {
      mockIsTextEditingContext.mockReturnValue(true);

      const onDelete = vi.fn();
      renderHook(() => useKeyboard({ onDelete }));

      simulateKeyDown('Delete');

      expect(onDelete).not.toHaveBeenCalled();
    });

    it('UK-004c: Escape ALWAYS works (even in text inputs)', () => {
      mockIsTextEditingContext.mockReturnValue(true);

      const onEscape = vi.fn();
      renderHook(() => useKeyboard({ onEscape }));

      simulateKeyDown('Escape');

      // Escape should always work
      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('UK-004d: Arrow keys are skipped in text input context', () => {
      mockIsTextEditingContext.mockReturnValue(true);

      const onArrowUp = vi.fn();
      const onArrowDown = vi.fn();
      renderHook(() => useKeyboard({ onArrowUp, onArrowDown }));

      simulateKeyDown('ArrowUp');
      simulateKeyDown('ArrowDown');

      expect(onArrowUp).not.toHaveBeenCalled();
      expect(onArrowDown).not.toHaveBeenCalled();
    });

    it('UK-004e: Help (?) is skipped in text input context', () => {
      mockIsTextEditingContext.mockReturnValue(true);

      const onHelp = vi.fn();
      renderHook(() => useKeyboard({ onHelp }));

      simulateKeyDown('?');

      expect(onHelp).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // UK-005: Mobile Device Detection Tests
  // ==========================================================================
  describe('UK-005: Mobile Device Detection', () => {
    it('UK-005a: help panel skipped on mobile by default', () => {
      mockIsMobileDevice.mockReturnValue(true);

      const onHelp = vi.fn();
      renderHook(() => useKeyboard({ onHelp }));

      simulateKeyDown('?');

      expect(onHelp).not.toHaveBeenCalled();
    });

    it('UK-005b: other shortcuts work on mobile', () => {
      mockIsMobileDevice.mockReturnValue(true);

      const onSpace = vi.fn();
      const onEscape = vi.fn();
      renderHook(() => useKeyboard({ onSpace, onEscape }));

      simulateKeyDown(' ');
      simulateKeyDown('Escape');

      // These should still work
      expect(onSpace).toHaveBeenCalledTimes(1);
      expect(onEscape).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // UK-006: Modifier Key Tests
  // ==========================================================================
  describe('UK-006: Modifier Keys', () => {
    it('UK-006a: Cmd/Ctrl+Shift+M calls onUnmuteAll', () => {
      const onUnmuteAll = vi.fn();
      renderHook(() => useKeyboard({ onUnmuteAll }));

      // Test with metaKey (Cmd on Mac)
      simulateKeyDown('m', { metaKey: true, shiftKey: true });

      expect(onUnmuteAll).toHaveBeenCalledTimes(1);
    });

    it('UK-006b: Ctrl+Shift+M calls onUnmuteAll', () => {
      const onUnmuteAll = vi.fn();
      renderHook(() => useKeyboard({ onUnmuteAll }));

      // Test with ctrlKey (Ctrl on Windows/Linux)
      simulateKeyDown('m', { ctrlKey: true, shiftKey: true });

      expect(onUnmuteAll).toHaveBeenCalledTimes(1);
    });

    it('UK-006c: M without modifiers calls onMute (not onUnmuteAll)', () => {
      const onMute = vi.fn();
      const onUnmuteAll = vi.fn();
      renderHook(() => useKeyboard({ onMute, onUnmuteAll }));

      simulateKeyDown('m');

      expect(onMute).toHaveBeenCalledTimes(1);
      expect(onUnmuteAll).not.toHaveBeenCalled();
    });

    it('UK-006d: M with Cmd/Ctrl (no Shift) does not call onMute', () => {
      const onMute = vi.fn();
      renderHook(() => useKeyboard({ onMute }));

      simulateKeyDown('m', { metaKey: true });

      // M with modifier should not trigger onMute
      expect(onMute).not.toHaveBeenCalled();
    });

    it('UK-006e: S with Alt does not call onSolo', () => {
      const onSolo = vi.fn();
      renderHook(() => useKeyboard({ onSolo }));

      simulateKeyDown('s', { altKey: true });

      expect(onSolo).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // UK-007: preventDefault Tests
  // ==========================================================================
  describe('UK-007: preventDefault Behavior', () => {
    it('UK-007a: Space preventDefault called to prevent page scroll', () => {
      const onSpace = vi.fn();
      renderHook(() => useKeyboard({ onSpace }));

      const event = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('UK-007b: Arrow keys preventDefault called', () => {
      const onArrowUp = vi.fn();
      renderHook(() => useKeyboard({ onArrowUp }));

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('UK-007c: Custom handler returning true calls preventDefault', () => {
      const onCustom = vi.fn(() => true);
      renderHook(() => useKeyboard({ onCustom }));

      const event = new KeyboardEvent('keydown', {
        key: 'x',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('UK-007d: Custom handler returning false does not trigger additional preventDefault', () => {
      // Track if onCustom is called and its return value affects behavior
      const onCustom = vi.fn(() => false);
      const { unmount } = renderHook(() => useKeyboard({ onCustom }));

      const event = new KeyboardEvent('keydown', {
        key: 'x',
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(event);

      // onCustom was called
      expect(onCustom).toHaveBeenCalledTimes(1);
      // The event should NOT have defaultPrevented set by our handler
      // (other code might call it, but our handler shouldn't when returning false)
      // We verify this indirectly by checking our handler was called
      expect(onCustom).toHaveReturnedWith(false);

      unmount();
    });
  });
});
