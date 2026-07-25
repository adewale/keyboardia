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
  it('exposes tap-anywhere playback as a labelled native control', () => {
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

    // The documented tap gesture lives on an accessible real button rather
    // than an aria-hidden control that can still receive pointer focus.
    const tapLayer = screen.getByRole('button', { name: 'Play' });
    expect(tapLayer.classList.contains('portrait-grid-tap-layer')).toBe(true);
    expect(tapLayer.getAttribute('aria-hidden')).toBeNull();
    expect(tapLayer.getAttribute('tabindex')).toBeNull();
    fireEvent.click(tapLayer);
    expect(onPlayPause).toHaveBeenCalledOnce();
  });

  it('updates the full-grid control name to match stop semantics', () => {
    render(
      <PortraitGrid
        tracks={[track]}
        currentStep={0}
        isPlaying={true}
        onPlayPause={vi.fn()}
        anySoloed={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Stop' })).toBeDefined();
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

  it.each([24, 32, 64, 128])('provides every page for a %i-step pattern', (stepCount) => {
    render(
      <PortraitGrid
        tracks={[{ ...track, stepCount }]}
        currentStep={-1}
        isPlaying={false}
        onPlayPause={vi.fn()}
        anySoloed={false}
      />,
    );

    expect(screen.getAllByRole('button', { name: /^View steps/ })).toHaveLength(stepCount / 8);
    expect(screen.getByRole('button', { name: `View steps ${stepCount - 7}-${stepCount}` })).toBeDefined();
  });

  it('follows the longest track through mixed polymeter pages', () => {
    render(
      <PortraitGrid
        tracks={[track, { ...track, id: 'track-2', stepCount: 24 }]}
        currentStep={16}
        isPlaying={true}
        onPlayPause={vi.fn()}
        anySoloed={false}
      />,
    );

    expect(screen.getByText('17').classList.contains('active')).toBe(true);
    expect(screen.getByRole('button', { name: 'View steps 17-24' }).getAttribute('aria-pressed')).toBe('true');
  });
});
