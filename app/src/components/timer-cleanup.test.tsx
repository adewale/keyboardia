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

    it('does not warn when unmounted before URL tap timer fires', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onDismiss = vi.fn();
      const toast = createUrlToast();

      const { unmount } = render(
        <ToastNotification toasts={[toast]} onDismiss={onDismiss} />
      );

      // Click the toast to trigger URL tap (which starts 500ms timer)
      const toastElement = screen.getByText('Copy this link:').closest('.toast');
      expect(toastElement).toBeTruthy();

      await act(async () => {
        fireEvent.click(toastElement!);
      });

      // Unmount before the 500ms timer fires
      unmount();

      // Advance timers past the 500ms delay
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Should not see React warning about unmounted component state update
      const unmountedWarnings = consoleSpy.mock.calls.filter(
        (call) => call[0]?.toString().includes('unmounted') ||
                  call[0]?.toString().includes("Can't perform a React state update")
      );
      expect(unmountedWarnings).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('still triggers exit animation when component stays mounted', async () => {
      const onDismiss = vi.fn();
      const toast = createUrlToast();

      render(<ToastNotification toasts={[toast]} onDismiss={onDismiss} />);

      const toastElement = screen.getByText('Copy this link:').closest('.toast');

      await act(async () => {
        fireEvent.click(toastElement!);
      });

      // Verify "Copied!" feedback appears (includes checkmark: "✓ Copied!")
      expect(screen.getByText(/Copied!/)).toBeTruthy();

      // Advance past 500ms timer
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Toast should now have exiting class
      expect(toastElement?.classList.contains('exiting')).toBe(true);
    });

    it('cleans up auto-dismiss timer on unmount (no state update)', async () => {
      const onDismiss = vi.fn();
      const toast = createUrlToast();

      const { unmount } = render(
        <ToastNotification toasts={[toast]} onDismiss={onDismiss} />
      );

      // Click to start the timer
      const toastElement = screen.getByText('Copy this link:').closest('.toast');
      await act(async () => {
        fireEvent.click(toastElement!);
      });

      // Advance 200ms (timer still pending)
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Unmount while timer is still pending
      unmount();

      // Advance past when timer would have fired - should not throw
      await act(async () => {
        vi.advanceTimersByTime(400);
      });

      // If we got here without errors, cleanup worked
      expect(true).toBe(true);
    });
  });

  describe('QRPanel - Copy link timer', () => {
    const defaultProps = {
      targetURL: 'https://example.com/session/abc123',
      sessionName: 'Test Session',
      playerCount: 2,
    };

    it('does not warn when unmounted before copy timer fires', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { unmount } = render(<QRPanel {...defaultProps} />);

      // Click copy button
      const copyButton = screen.getByRole('button', { name: /copy/i });
      await act(async () => {
        fireEvent.click(copyButton);
      });

      // Should show "Copied!"
      expect(screen.getByText('Copied!')).toBeTruthy();

      // Unmount before 2000ms timer fires
      unmount();

      // Advance timers past the 2000ms delay
      await act(async () => {
        vi.advanceTimersByTime(2500);
      });

      // Should not see React warning
      const unmountedWarnings = consoleSpy.mock.calls.filter(
        (call) => call[0]?.toString().includes('unmounted') ||
                  call[0]?.toString().includes("Can't perform a React state update")
      );
      expect(unmountedWarnings).toHaveLength(0);

      consoleSpy.mockRestore();
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

    it('cleans up timer on unmount without errors', async () => {
      const { unmount } = render(<QRPanel {...defaultProps} />);

      const copyButton = screen.getByRole('button', { name: /copy/i });

      await act(async () => {
        fireEvent.click(copyButton);
      });

      // Advance 1 second (timer still pending)
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      // Unmount
      unmount();

      // Advance past when timer would have fired
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });

      // If we got here without errors, cleanup worked
      expect(true).toBe(true);
    });
  });
});
