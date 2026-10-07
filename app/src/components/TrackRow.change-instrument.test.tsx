// @vitest-environment jsdom
/**
 * Change Instrument (issue #63): the track row's entry points.
 *
 * On desktop the row's badge asks the editor dock to show the picker in its
 * Track pane (specs/PIANO-ROLL-DOCK.md, phase 7; StepSequencer.dock.test.tsx
 * covers the dock side). Landscape hides the badge; its rows reach the same
 * picker through the dock's Track pane, which the track name opens (phase 8).
 *
 * See specs/CHANGE-INSTRUMENT.md §7.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '../types';
import { TrackRow } from './TrackRow';

// Only the preload side effect is stubbed. audioTriggers stays real so this
// test cannot pass against a mock that has drifted from the module it doubles
// (specs/TESTING.md: "audio fakes implement typed production surfaces").
vi.mock('../audio/prepare-instrument', () => ({
  prepareInstrument: vi.fn(),
}));

afterEach(cleanup);

const track: Track = {
  id: 'track-1',
  name: 'Ada’s Lead',
  sampleId: 'tone:fm-bass',
  steps: Array(128).fill(false),
  parameterLocks: Array(128).fill(null),
  volume: 1,
  muted: false,
  soloed: false,
  transpose: 0,
  stepCount: 16,
};

function renderRow(overrides: Partial<React.ComponentProps<typeof TrackRow>> = {}) {
  return render(
    <TrackRow
      track={track}
      trackIndex={0}
      currentStep={-1}
      swing={0}
      anySoloed={false}
      hasSteps={false}
      canDelete
      isCopySource={false}
      isCopyTarget={false}
      onToggleStep={vi.fn()}
      onToggleMute={vi.fn()}
      onToggleSolo={vi.fn()}
      onClear={vi.fn()}
      onDelete={vi.fn()}
      onStartCopy={vi.fn()}
      onCopyTo={vi.fn()}
      {...overrides}
    />
  );
}

describe('TrackRow change instrument', () => {
  it('offers no instrument control without an onSetInstrument handler', () => {
    // This is how a published session hides it: StepSequencer withholds the
    // callback, exactly as it does for Delete.
    renderRow();

    expect(screen.queryByTestId('change-instrument-track-1')).toBeNull();
    expect(screen.queryByTestId('drawer-change-instrument-track-1')).toBeNull();
    expect(document.querySelector('.instrument-panel-container')).toBeNull();
  });

  it('offers no instrument control on a read-only row', () => {
    renderRow({ onSetInstrument: vi.fn(), readOnly: true });

    expect(screen.queryByTestId('change-instrument-track-1')).toBeNull();
    expect(document.querySelector('.instrument-panel-container')).toBeNull();
  });

  it('renders no picker under a landscape row: the dock owns it there too', () => {
    renderRow({ onSetInstrument: vi.fn(), orientationMode: 'landscape' });

    expect(document.querySelector('.instrument-panel-container')).toBeNull();
    expect(document.querySelector('.track-drawer')).toBeNull();
    // No catalogue in the document: it would duplicate the Add Track
    // picker's accessible names.
    expect(document.querySelector('.sample-picker')).toBeNull();
    expect(document.querySelectorAll('.instrument-btn')).toHaveLength(0);
  });

  it('renders no picker under a desktop row: the dock owns it', () => {
    renderRow({ onSetInstrument: vi.fn() });
    expect(document.querySelector('.instrument-panel-container')).toBeNull();
    expect(document.querySelector('.sample-picker')).toBeNull();
  });

  it('puts the desktop toggle in the badge slot of the placed controls line', () => {
    // .track-left is a fully-allocated grid whose every child is explicitly
    // placed. A child without a placement is auto-placed into an implicit
    // extra row, which once grew every track row from 48px to 84px and moved
    // the drag-reorder drop targets — 11 reorder tests failed while this
    // component looked fine in isolation. jsdom computes no layout, so assert
    // the contract that layout depends on: the toggle sits in the badge slot
    // of line two, and line two is a direct, placed child of .track-left.
    renderRow({ onSetInstrument: vi.fn() });

    const toggle = screen.getByTestId('change-instrument-track-1');
    expect(toggle.classList.contains('instrument-toggle')).toBe(true);
    expect(toggle.classList.contains('track-instrument-badge')).toBe(true);
    const group = toggle.parentElement!;
    expect(group.classList.contains('track-disclosure-group')).toBe(true);
    expect(group.firstElementChild).toBe(toggle);
    expect(group.parentElement?.classList.contains('track-controls')).toBe(true);
    expect(group.parentElement?.parentElement?.classList.contains('track-left')).toBe(true);
  });

  it('asks the dock for the picker from the desktop badge', () => {
    const onToggleInstrumentPicker = vi.fn();
    renderRow({ onSetInstrument: vi.fn(), onToggleInstrumentPicker });

    const toggle = screen.getByTestId('change-instrument-track-1');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(toggle);
    expect(onToggleInstrumentPicker).toHaveBeenCalledWith(toggle);
    // Nothing opens under the row.
    expect(document.querySelector('.sample-picker')).toBeNull();
  });

  it('shows the dock picker state on the badge', () => {
    renderRow({ onSetInstrument: vi.fn(), onToggleInstrumentPicker: vi.fn(), isInstrumentPickerOpen: true });

    const toggle = screen.getByTestId('change-instrument-track-1');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('dock-instrument-picker');
    expect(toggle.classList.contains('active')).toBe(true);
  });

  it('leaves the unreachable mobile drawer without an instrument row', () => {
    renderRow({ onSetInstrument: vi.fn() });
    fireEvent.click(document.querySelector('.mobile-edit-panel')!);
    expect(screen.queryByTestId('drawer-change-instrument-track-1')).toBeNull();
  });

  it('a landscape name asks the dock for this track\'s Track pane', () => {
    const onToggleTrackPane = vi.fn();
    const onOpenDock = vi.fn();
    const { rerender } = renderRow({
      onSetInstrument: vi.fn(),
      orientationMode: 'landscape',
      onToggleTrackPane,
      onOpenDock,
    });

    const name = document.querySelector<HTMLElement>('.track-name')!;
    expect(name.getAttribute('aria-expanded')).toBe('false');
    // The dock is always in the document (inert while closed).
    expect(name.getAttribute('aria-controls')).toBe('editor-dock');
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onToggleTrackPane).toHaveBeenCalledTimes(1);
    expect(onOpenDock).not.toHaveBeenCalled();

    rerender(
      <TrackRow
        track={track}
        trackIndex={0}
        currentStep={-1}
        swing={0}
        anySoloed={false}
        hasSteps={false}
        canDelete
        isCopySource={false}
        isCopyTarget={false}
        onToggleStep={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleSolo={vi.fn()}
        onClear={vi.fn()}
        onDelete={vi.fn()}
        onStartCopy={vi.fn()}
        onCopyTo={vi.fn()}
        onSetInstrument={vi.fn()}
        orientationMode="landscape"
        isDocked
        isTrackPaneDocked
        onToggleTrackPane={onToggleTrackPane}
      />
    );
    expect(document.querySelector('.track-name')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('a desktop name docks the track and is not a disclosure', () => {
    const onToggleTrackPane = vi.fn();
    const onOpenDock = vi.fn();
    renderRow({ onSetInstrument: vi.fn(), onToggleTrackPane, onOpenDock });

    const name = document.querySelector<HTMLElement>('.track-name')!;
    expect(name.hasAttribute('aria-expanded')).toBe(false);
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onOpenDock).toHaveBeenCalledTimes(1);
    expect(onToggleTrackPane).not.toHaveBeenCalled();
  });
});
