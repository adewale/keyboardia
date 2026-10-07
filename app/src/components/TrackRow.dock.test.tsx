// @vitest-environment jsdom
/**
 * Editor dock (specs/PIANO-ROLL-DOCK.md, phases 2, 6 and 7): the row no longer
 * owns a pitch panel, a p-lock strip, pattern tools or an FM panel. Its pitch
 * toggle, name and step cells ask StepSequencer to dock the track, and the row
 * shows the docked state it is given.
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
    // Pattern tools, the FM panel and the p-lock strip moved to the dock; the
    // velocity lane, a row of cells, keeps its inline panel.
    expect(container.querySelector('.pattern-tools-panel')).toBeNull();
    expect(container.querySelector('.fm-controls-panel, .fm-slider')).toBeNull();
    expect(container.querySelector('.plock-inline')).toBeNull();
    expect(container.querySelectorAll('.panel-animation-container')).toHaveLength(1);
    expect(container.querySelector('.panel-animation-container')?.id).toBe('velocity-panel-lead');
  });

  it('renders no FM panel under an FM track', () => {
    const { container } = renderRow({ track: makeTrack({ sampleId: 'tone:fm-bass' }) });
    expect(container.querySelector('.fm-controls-panel, .fm-slider')).toBeNull();
  });

  it('asks for the Step pane on Shift+click of an active cell, and opens no strip', () => {
    const onSelectDockStep = vi.fn();
    const { container } = renderRow({ onSelectDockStep });
    const cells = container.querySelectorAll<HTMLElement>('.step-cell');

    fireEvent.pointerDown(cells[4], { button: 0, shiftKey: true, pointerId: 1 });
    expect(onSelectDockStep).toHaveBeenCalledWith(4);
    expect(container.querySelector('.plock-inline')).toBeNull();

    // An inactive cell has no lock to edit.
    fireEvent.pointerDown(cells[1], { button: 0, shiftKey: true, pointerId: 1 });
    expect(onSelectDockStep).toHaveBeenCalledTimes(1);
  });

  it('rings the step the dock is editing', () => {
    const { container } = renderRow({ dockSelectedStep: 4 });
    const selected = Array.from(container.querySelectorAll('.step-cell.selected'))
      .map(cell => cell.getAttribute('data-step-index'));
    expect(selected).toEqual(['4']);
  });

  it('asks to toggle the dock from the pitch toggle', () => {
    const onToggleDock = vi.fn();
    renderRow({ onToggleDock });

    const toggle = screen.getByRole('button', { name: 'Open pitch editor' });
    expect(toggle.getAttribute('aria-controls')).toBe('editor-dock');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.classList.contains('expanded')).toBe(false);
    // Lesson 61: the toggle sits on the placed controls line of .track-left.
    expect(toggle.parentElement?.classList.contains('track-disclosure-group')).toBe(true);
    expect(toggle.closest('.track-controls')?.parentElement?.classList.contains('track-left')).toBe(true);

    fireEvent.click(toggle);
    expect(onToggleDock).toHaveBeenCalledOnce();
  });

  it('shows the docked state: outline class, expanded toggle', () => {
    const { container } = renderRow({ isDocked: true });

    expect(container.querySelector('.track-row-wrapper')?.classList.contains('docked')).toBe(true);
    const toggle = screen.getByRole('button', { name: 'Close pitch editor' });
    expect(toggle.classList.contains('expanded')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('is not docked by default', () => {
    const { container } = renderRow();

    expect(container.querySelector('.track-row-wrapper')?.classList.contains('docked')).toBe(false);
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

  it('docks a drum track from its name, but gives it no pitch toggle', () => {
    vi.useFakeTimers();
    const onOpenDock = vi.fn();
    const { container } = renderRow({ track: makeTrack({ id: 'kick', name: 'Kick', sampleId: 'kick' }), onOpenDock });

    expect(screen.queryByRole('button', { name: 'Open pitch editor' })).toBeNull();
    fireEvent.click(container.querySelector('.track-name')!);
    act(() => { vi.advanceTimersByTime(250); });
    expect(onOpenDock).toHaveBeenCalledOnce();
  });
});
