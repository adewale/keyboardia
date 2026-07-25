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

    // The grid itself is presentational: no role, no tab stop, and no click
    // handler on a non-interactive element.
    const grid = container.querySelector('.portrait-grid')!;
    expect(grid.getAttribute('role')).toBeNull();
    expect(grid.getAttribute('tabindex')).toBeNull();

    // The documented tap gesture lives on a real button instead.
    const tapLayer = container.querySelector('.portrait-grid-tap-layer')!;
    expect(tapLayer.tagName.toLowerCase()).toBe('button');
    fireEvent.click(tapLayer);
    expect(onPlayPause).toHaveBeenCalledOnce();
  });

  it('keeps the tap layer out of the accessibility tree and the tab order', () => {
    const { container } = render(
      <PortraitGrid
        tracks={[track]}
        currentStep={-1}
        isPlaying={false}
        onPlayPause={vi.fn()}
        anySoloed={false}
      />,
    );

    // It duplicates PortraitHeader's labelled play control, so exposing it
    // would add a second Play button and an invisible tab stop.
    const tapLayer = container.querySelector('.portrait-grid-tap-layer')!;
    expect(tapLayer.getAttribute('aria-hidden')).toBe('true');
    expect(tapLayer.getAttribute('tabindex')).toBe('-1');
    expect(screen.queryAllByRole('button', { name: /play|stop/i })).toEqual([]);
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
