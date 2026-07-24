// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../types';
import { PortraitGrid } from './PortraitGrid';

const track: Track = {
  id: 'track-1',
  name: 'Kick',
  sampleId: 'kick',
  steps: Array(128).fill(false),
  parameterLocks: Array(128).fill(null),
  volume: 1,
  muted: false,
  soloed: false,
  transpose: 0,
  stepCount: 16,
};

afterEach(cleanup);

describe('PortraitGrid semantics', () => {
  it('keeps tap-anywhere playback supplementary to the native header control', () => {
    const onPlayPause = vi.fn();
    const { container } = render(
      <PortraitGrid
        tracks={[track]}
        currentStep={-1}
        isPlaying={false}
        onPlayPause={onPlayPause}
        anySoloed={false}
      />,
    );

    const grid = container.querySelector('.portrait-grid')!;
    expect(grid.getAttribute('role')).toBeNull();
    expect(grid.getAttribute('tabindex')).toBeNull();
    fireEvent.click(grid);
    expect(onPlayPause).toHaveBeenCalledOnce();
  });

  it('exposes page selection state without triggering playback', () => {
    const onPlayPause = vi.fn();
    render(
      <PortraitGrid
        tracks={[track]}
        currentStep={-1}
        isPlaying={false}
        onPlayPause={onPlayPause}
        anySoloed={false}
      />,
    );

    const first = screen.getByRole('button', { name: 'View steps 1-8' });
    const second = screen.getByRole('button', { name: 'View steps 9-16' });
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(second);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(onPlayPause).not.toHaveBeenCalled();
  });
});
