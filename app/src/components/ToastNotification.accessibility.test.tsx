// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '../utils/clipboard';
import { ToastNotification, type Toast } from './ToastNotification';

vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

function fireAnimationEnd(element: Element, animationName: string) {
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: animationName });
  fireEvent(element, event);
}

const urlToast: Toast = {
  id: 'url',
  type: 'url',
  message: 'Share this session',
  url: 'https://keyboardia.dev/s/example',
};

describe('ToastNotification accessibility and lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(copyToClipboard).mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('announces urgent and non-urgent notifications appropriately', () => {
    const { container } = render(
      <ToastNotification
        toasts={[
          { id: 'error', type: 'error', message: 'Audio failed' },
          { id: 'join', type: 'join', message: 'Fox joined' },
        ]}
        onDismiss={vi.fn()}
      />,
    );

    // Urgent toasts announce on insertion via role="alert".
    expect(screen.getByRole('alert').textContent).toContain('Audio failed');

    // Non-urgent toasts are announced by the persistent container region, not
    // by a per-toast region: a live region inserted together with its content
    // is commonly missed, which would make join/leave silent.
    const region = container.querySelector('.toast-live-region')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Fox joined');

    const toastContainer = container.querySelector('.toast-container')!;
    expect(toastContainer.getAttribute('aria-live')).toBeNull();
    expect(screen.getByRole('alert').parentElement?.closest('[aria-live]')).toBeNull();

    const joinToast = container.querySelector('.toast.join')!;
    expect(joinToast.getAttribute('role')).toBeNull();
    expect(joinToast.getAttribute('aria-live')).toBeNull();
  });

  it('is mounted before any toast so the polite region can announce updates', () => {
    const { container } = render(<ToastNotification toasts={[]} onDismiss={vi.fn()} />);

    const region = container.querySelector('.toast-live-region');
    expect(region).not.toBeNull();
    expect(region!.getAttribute('aria-live')).toBe('polite');
  });

  it('uses sibling Copy URL and Dismiss buttons instead of nested controls', () => {
    const { container } = render(
      <ToastNotification toasts={[urlToast]} onDismiss={vi.fn()} />,
    );

    const toast = container.querySelector('.toast-url')!;
    expect(toast.getAttribute('role')).toBeNull();
    expect(container.querySelector('.toast-message')!.textContent).toContain('Share this session');
    expect(screen.getByRole('button', { name: /^Copy URL/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDefined();
    expect(toast.querySelector('button button')).toBeNull();
  });

  it('keeps the URL itself in the copy control accessible name', () => {
    render(<ToastNotification toasts={[urlToast]} onDismiss={vi.fn()} />);

    // The URL toast exists because the clipboard failed, so a bare "Copy URL"
    // label would hide the only copy of the URL from assistive technology.
    expect(
      screen.getByRole('button', { name: `Copy URL ${urlToast.url}` }),
    ).toBeDefined();
  });

  it('announces copy success, replaces rapid-tap timers, and cleans up on unmount', async () => {
    const { unmount } = render(
      <ToastNotification toasts={[urlToast]} onDismiss={vi.fn()} />,
    );
    const copy = screen.getByRole('button', { name: /^Copy URL/ });

    await act(async () => {
      fireEvent.click(copy);
      fireEvent.click(copy);
    });

    expect(document.querySelector('.toast-copy-announcement')?.textContent).toContain('Link copied');
    expect(document.querySelector('[aria-live] [aria-live]')).toBeNull();
    // One auto-dismiss timer and only the latest post-copy timer.
    expect(vi.getTimerCount()).toBe(2);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not auto-dismiss an actionable toast while focus remains inside it', async () => {
    const { container } = render(<ToastNotification toasts={[urlToast]} onDismiss={vi.fn()} />);
    const toast = container.querySelector('.toast-url')!;
    const copy = screen.getByRole('button', { name: /^Copy URL/ });

    fireEvent.focus(copy);
    fireEvent.mouseEnter(toast);
    fireEvent.mouseLeave(toast);
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect(toast.classList.contains('exiting')).toBe(false);

    fireEvent.blur(copy, { relatedTarget: document.body });
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(toast.classList.contains('exiting')).toBe(true);
  });

  it('does not remove a copied URL while its Copy control remains focused', async () => {
    const { container } = render(<ToastNotification toasts={[urlToast]} onDismiss={vi.fn()} />);
    const toast = container.querySelector('.toast-url')!;
    const copy = screen.getByRole('button', { name: /^Copy URL/ });

    act(() => copy.focus());
    await act(async () => {
      fireEvent.click(copy);
    });
    act(() => vi.advanceTimersByTime(9000));

    expect(screen.getByText('Copied!')).toBeDefined();
    expect(document.activeElement).toBe(copy);
    expect(toast.classList.contains('exiting')).toBe(false);
  });

  it('restores focus after a focused toast control dismisses', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <>
        <button type="button">Previous action</button>
        <ToastNotification toasts={[urlToast]} onDismiss={onDismiss} />
      </>,
    );
    const previous = screen.getByRole('button', { name: 'Previous action' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    const toast = container.querySelector('.toast-url')!;

    act(() => previous.focus());
    act(() => dismiss.focus());
    fireEvent.click(dismiss);
    fireAnimationEnd(toast, 'toast-exit');
    act(() => vi.advanceTimersByTime(20));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(previous);
  });

  it('does not restore stale focus after the user leaves the toast', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <>
        <button type="button">Before toast</button>
        <ToastNotification toasts={[urlToast]} onDismiss={onDismiss} />
        <button type="button">After toast</button>
      </>,
    );
    const before = screen.getByRole('button', { name: 'Before toast' });
    const copy = screen.getByRole('button', { name: /^Copy URL/ });
    const after = screen.getByRole('button', { name: 'After toast' });
    const toast = container.querySelector('.toast-url')!;

    act(() => before.focus());
    act(() => copy.focus());
    act(() => after.focus());
    expect(document.activeElement).toBe(after);

    act(() => vi.advanceTimersByTime(8000));
    fireAnimationEnd(toast, 'toast-exit');
    act(() => vi.advanceTimersByTime(20));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(after);
  });

  it('ignores animation events bubbling from descendants', async () => {
    const onDismiss = vi.fn();
    const { container } = render(<ToastNotification toasts={[urlToast]} onDismiss={onDismiss} />);
    const toast = container.querySelector('.toast-url')!;

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireAnimationEnd(toast.querySelector('.toast-message')!, 'unrelated-animation');
    expect(onDismiss).not.toHaveBeenCalled();

    fireAnimationEnd(toast, 'toast-exit');
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
