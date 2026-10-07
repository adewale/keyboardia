// @vitest-environment jsdom
/**
 * Editor dock (specs/PIANO-ROLL-DOCK.md, phase 2): the row no longer owns a
 * pitch panel. Its pitch toggle and name ask StepSequencer to dock the track,
 * and the row shows the docked state it is given.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '../types';
import { TrackRow } from './TrackRow';

vi.mock('../audio/prepare-instrument', () => ({
  prepareInstrument: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeTrack(overrides: Partial<Track> = {}): Track {
  const steps = Array(128).fill(false);
  steps[0] = true;
  steps[4] = true;
  return {
    id: 'lead',
    name: 'Lead',
    sampleId: 'synth:lead',
    steps,
    parameterLocks: Array(128).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

function renderRow(overrides: Partial<React.ComponentProps<typeof TrackRow>> = {}) {
  return render(
    <TrackRow
      track={makeTrack()}
      trackIndex={0}
      currentStep={-1}
      swing={0}
      anySoloed={false}
      hasSteps
      canDelete
      isCopySource={false}
      isCopyTarget={false}
      orientationMode="desktop"
      onToggleStep={vi.fn()}
      onToggleMute={vi.fn()}
      onToggleSolo={vi.fn()}
      onClear={vi.fn()}
      onDelete={vi.fn()}
      onStartCopy={vi.fn()}
      onCopyTo={vi.fn()}
      onSetParameterLock={vi.fn()}
      {...overrides}
    />
  );
}

describe('TrackRow and the editor dock', () => {
  it('renders no pitch panel of its own', () => {
    const { container } = renderRow();

    expect(container.querySelector('.chromatic-grid')).toBeNull();
    expect(container.querySelector('.piano-roll-editor')).toBeNull();
    expect(container.querySelector('.pitch-view-header')).toBeNull();
    expect(container.querySelector('[id^="pitch-panel-"]')).toBeNull();
    // Pattern tools and velocity lane keep their inline panels.
    expect(container.querySelectorAll('.panel-animation-container')).toHaveLength(2);
  });

  it('asks to toggle the dock from the pitch toggle', () => {
    const onToggleDock = vi.fn();
    renderRow({ onToggleDock });

    const toggle = screen.getByRole('button', { name: 'Open pitch editor' });
    expect(toggle.getAttribute('aria-controls')).toBe('editor-dock');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.classList.contains('expanded')).toBe(false);
    // Lesson 61: the toggle stays a placed child of .track-left.
    expect(toggle.parentElement?.classList.contains('track-left')).toBe(true);

    fireEvent.click(toggle);
    expect(onToggleDock).toHaveBeenCalledOnce();
  });

  it('shows the docked state: outline class, expanded toggle, no contour', () => {
    const { container } = renderRow({ isDocked: true });

    expect(container.querySelector('.track-row-wrapper')?.classList.contains('docked')).toBe(true);
    const toggle = screen.getByRole('button', { name: 'Close pitch editor' });
    expect(toggle.classList.contains('expanded')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.steps')?.classList.contains('steps-with-contour')).toBe(false);
  });

  it('is not docked by default and keeps its pitch contour', () => {
    const { container } = renderRow();

    expect(container.querySelector('.track-row-wrapper')?.classList.contains('docked')).toBe(false);
    expect(container.querySelector('.steps')?.classList.contains('steps-with-contour')).toBe(true);
  });

  it('docks a melodic track when its name is clicked', () => {
    vi.useFakeTimers();
    const onOpenDock = vi.fn();
    const { container } = renderRow({ onOpenDock });

    fireEvent.click(container.querySelector('.track-name')!);
    // The name waits out the double-click window before acting.
    act(() => { vi.advanceTimersByTime(250); });
    expect(onOpenDock).toHaveBeenCalledOnce();
  });

  it('never docks a drum track', () => {
    vi.useFakeTimers();
    const onOpenDock = vi.fn();
    const { container } = renderRow({ track: makeTrack({ id: 'kick', name: 'Kick', sampleId: 'kick' }), onOpenDock });

    expect(screen.queryByRole('button', { name: 'Open pitch editor' })).toBeNull();
    fireEvent.click(container.querySelector('.track-name')!);
    act(() => { vi.advanceTimersByTime(250); });
    expect(onOpenDock).not.toHaveBeenCalled();
  });
});
