// @vitest-environment jsdom
/**
 * Change Instrument (issue #63): the track row's three entry points.
 *
 * Desktop, the mobile inline drawer, and the landscape TrackDrawer must all
 * open the SAME picker panel over the SAME catalog, and all three must vanish
 * on a published session.
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

  it('keeps the picker panel collapsed until the toggle is used', () => {
    renderRow({ onSetInstrument: vi.fn() });

    const panel = document.querySelector('.instrument-panel-container')!;
    // Collapsed means zero-height and inert, not merely hidden: the landscape
    // visual baseline depends on it contributing no layout.
    expect(panel.className).not.toContain('expanded');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('change-instrument-track-1').getAttribute('aria-expanded'))
      .toBe('false');

    // The catalog itself is not in the document while closed. Leaving it there
    // duplicates the Add Track picker's accessible names, so a query for an
    // instrument by name resolves into this zero-height panel instead of the
    // add-track control — which is exactly how it broke the drag-reorder and
    // multiplayer suites.
    expect(screen.queryByText('Change Instrument')).toBeNull();
    expect(screen.queryByTestId('set-instrument-kick')).toBeNull();
    expect(document.querySelectorAll('.instrument-btn')).toHaveLength(0);
  });

  it('opens the picker from the desktop toggle and marks the current instrument', () => {
    renderRow({ onSetInstrument: vi.fn() });

    fireEvent.click(screen.getByTestId('change-instrument-track-1'));

    const panel = document.querySelector('.instrument-panel-container')!;
    expect(panel.className).toContain('expanded');
    expect(screen.getByText('Change Instrument')).toBeTruthy();
    expect(screen.getByTestId('set-instrument-tone:fm-bass').className).toContain('current');
  });

  it('opens the same panel from the mobile drawer row', () => {
    renderRow({ onSetInstrument: vi.fn() });

    // The inline drawer is unmounted until the "tap to edit" strip opens it.
    fireEvent.click(document.querySelector('.mobile-edit-panel')!);

    const drawerButton = screen.getByTestId('drawer-change-instrument-track-1');
    // The drawer row shows what the track plays now, so a person does not have
    // to open the picker to find out.
    expect(drawerButton.textContent).toContain('FM Bass');

    fireEvent.click(drawerButton);

    const panel = document.querySelector('.instrument-panel-container')!;
    expect(panel.className).toContain('expanded');
    expect(drawerButton.getAttribute('aria-controls')).toBe('instrument-panel-track-1');
  });

  it('opens the same panel from the landscape drawer', () => {
    renderRow({
      onSetInstrument: vi.fn(),
      orientationMode: 'landscape',
      isLandscapeDrawerOpen: true,
      onToggleLandscapeDrawer: vi.fn(),
    });

    fireEvent.click(screen.getByTestId('landscape-change-instrument-track-1'));

    expect(document.querySelector('.instrument-panel-container')!.className)
      .toContain('expanded');
    // One picker, not a second cramped list built for landscape.
    expect(document.querySelectorAll('.sample-picker.variant-change')).toHaveLength(1);
  });

  it('commits the chosen instrument and closes the picker', () => {
    const onSetInstrument = vi.fn();
    renderRow({ onSetInstrument });

    fireEvent.click(screen.getByTestId('change-instrument-track-1'));
    fireEvent.click(screen.getByTestId('set-instrument-sampled:808-kick'));

    expect(onSetInstrument).toHaveBeenCalledWith('sampled:808-kick');
    // No name argument: renaming stays a separate action.
    expect(onSetInstrument).toHaveBeenCalledTimes(1);
    expect(onSetInstrument.mock.calls[0]).toHaveLength(1);
    expect(document.querySelector('.instrument-panel-container')!.className)
      .not.toContain('expanded');
  });

  it('does not rename the track when the instrument changes', () => {
    const onSetName = vi.fn();
    renderRow({ onSetInstrument: vi.fn(), onSetName });

    fireEvent.click(screen.getByTestId('change-instrument-track-1'));
    fireEvent.click(screen.getByTestId('set-instrument-sampled:808-kick'));

    expect(onSetName).not.toHaveBeenCalled();
  });
});
