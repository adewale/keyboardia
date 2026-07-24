// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PortraitHeader } from './PortraitHeader';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PortraitHeader transport semantics', () => {
  it('announces Stop while playback is active because the action resets playback', () => {
    const onPlayPause = vi.fn();
    render(
      <PortraitHeader
        isPlaying
        tempo={120}
        onPlayPause={onPlayPause}
      />,
    );

    const stopButton = screen.getByRole('button', { name: 'Stop' });
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(stopButton);
    expect(onPlayPause).toHaveBeenCalledOnce();
  });

  it('announces clipboard success and cleans up its reset timer', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const { unmount } = render(
      <PortraitHeader
        isPlaying={false}
        tempo={120}
        onPlayPause={vi.fn()}
        sessionUrl="https://keyboardia.dev/s/test"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share session' }));
    });
    expect(screen.getByRole('button', { name: 'Share session' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('Link copied');

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('announces Play while playback is stopped', () => {
    render(
      <PortraitHeader
        isPlaying={false}
        tempo={120}
        onPlayPause={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Play' })).toBeDefined();
  });
});
