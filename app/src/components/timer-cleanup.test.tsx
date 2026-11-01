// @vitest-environment jsdom
/**
 * Timer Cleanup Tests
 *
 * Verifies that timer-based state updates are properly cleaned up on unmount
 * to prevent React warnings about updating unmounted components.
 *
 * Tests cover:
 * - ToastNotification: URL tap auto-dismiss timer
 * - QRPanel: Copy link feedback timer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ToastNotification } from './ToastNotification';
import type { Toast } from './ToastNotification';
import { QRPanel } from './QROverlay/QRPanel';

function fireAnimationEnd(element: Element, animationName: string) {
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: animationName });
  fireEvent(element, event);
}

// Mock clipboard utility
vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
}));

// Mock QRCode component to avoid canvas rendering issues
vi.mock('./QROverlay/QRCode', () => ({
  QRCode: ({ value }: { value: string }) => <div data-testid="qr-code">{value}</div>,
}));

describe('Timer Cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('ToastNotification - URL tap timer', () => {
    const createUrlToast = (): Toast => ({
      id: 'test-url-toast',
      message: 'Copy this link:',
      type: 'url',
      url: 'https://example.com/session/abc123',
    });

    it('clears URL timers when unmounted before dismissal', async () => {
      const onDismiss = vi.fn();
      const toast = createUrlToast();
      const { unmount } = render(
        <ToastNotification toasts={[toast]} onDismiss={onDismiss} />
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Copy URL/ }));
      });
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('still triggers exit animation when component stays mounted', async () => {
      const onDismiss = vi.fn();
      const toast = createUrlToast();

      const { container } = render(<ToastNotification toasts={[toast]} onDismiss={onDismiss} />);

      const toastElement = container.querySelector('.toast-url');

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Copy URL/ }));
      });

      // Verify "Copied!" feedback appears
      expect(screen.getByText(/Copied!/)).toBeTruthy();

      // Advance past 500ms timer
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Toast should now have exiting class
      expect(toastElement?.classList.contains('exiting')).toBe(true);
    });

    it('dismisses on animation end and cancels the fallback after removal', async () => {
      const onDismiss = vi.fn();
      const toast = createUrlToast();

      const { container, rerender } = render(
        <ToastNotification toasts={[toast]} onDismiss={onDismiss} />
      );
      const toastElement = container.querySelector('.toast-url')!;

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Copy URL/ }));
      });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(toastElement.classList.contains('exiting')).toBe(true);

      fireAnimationEnd(toastElement, 'toast-exit');
      expect(onDismiss).toHaveBeenCalledOnce();

      rerender(<ToastNotification toasts={[]} onDismiss={onDismiss} />);
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('uses a fallback when animationend is unavailable', async () => {
      const onDismiss = vi.fn();
      const toast = createUrlToast();
      render(<ToastNotification toasts={[toast]} onDismiss={onDismiss} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Copy URL/ }));
      });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(onDismiss).toHaveBeenCalledWith(toast.id);
    });

    it('cleans up a partially elapsed URL timer on unmount', async () => {
      const onDismiss = vi.fn();
      const toast = createUrlToast();
      const { unmount } = render(
        <ToastNotification toasts={[toast]} onDismiss={onDismiss} />
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Copy URL/ }));
        vi.advanceTimersByTime(200);
      });
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe('QRPanel - Copy link timer', () => {
    const defaultProps = {
      targetURL: 'https://example.com/session/abc123',
      sessionName: 'Test Session',
      playerCount: 2,
    };

    it('clears the copy timer when unmounted before reset', async () => {
      const { unmount } = render(<QRPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /copy/i }));
      });
      expect(screen.getByText('Copied!')).toBeTruthy();
      expect(vi.getTimerCount()).toBe(1);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { vi.advanceTimersByTime(2500); });
    });

    it('resets copied state after 2 seconds when mounted', async () => {
      render(<QRPanel {...defaultProps} />);

      const copyButton = screen.getByRole('button', { name: /copy/i });

      // Initially shows "Copy Link"
      expect(screen.getByText('Copy Link')).toBeTruthy();

      await act(async () => {
        fireEvent.click(copyButton);
      });

      // Shows "Copied!"
      expect(screen.getByText('Copied!')).toBeTruthy();

      // Advance 2 seconds
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      // Should reset to "Copy Link"
      expect(screen.getByText('Copy Link')).toBeTruthy();
    });

    it('restarts timer on rapid clicks (no timer stacking)', async () => {
      render(<QRPanel {...defaultProps} />);

      const copyButton = screen.getByRole('button', { name: /copy/i });

      // First click
      await act(async () => {
        fireEvent.click(copyButton);
      });
      expect(screen.getByText('Copied!')).toBeTruthy();

      // Advance 1.5 seconds
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });

      // Still shows "Copied!"
      expect(screen.getByText('Copied!')).toBeTruthy();

      // Click again (should reset the 2s timer)
      await act(async () => {
        fireEvent.click(copyButton);
      });

      // Advance another 1.5 seconds (total 3s from first click, but only 1.5s from second)
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });

      // Should STILL show "Copied!" because second click reset the timer
      expect(screen.getByText('Copied!')).toBeTruthy();

      // Advance remaining 0.5 seconds
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // NOW it should reset
      expect(screen.getByText('Copy Link')).toBeTruthy();
    });

    it('cleans up a partially elapsed copy timer on unmount', async () => {
      const { unmount } = render(<QRPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /copy/i }));
        vi.advanceTimersByTime(1000);
      });
      expect(vi.getTimerCount()).toBe(1);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { vi.advanceTimersByTime(1500); });
    });
  });
});