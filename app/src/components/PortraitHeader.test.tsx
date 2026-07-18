// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PortraitHeader } from './PortraitHeader';

afterEach(cleanup);

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
