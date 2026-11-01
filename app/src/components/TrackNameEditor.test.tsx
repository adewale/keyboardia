// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackNameEditor } from './TrackNameEditor';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TrackNameEditor disclosure behavior', () => {
  it('exposes landscape drawer state and supports immediate keyboard activation', () => {
    const onClickOverride = vi.fn();
    render(
      <TrackNameEditor
        name="Kick"
        instrumentName="Kick"
        sampleId="kick"
        canRename={false}
        onSave={vi.fn()}
        onPreview={vi.fn()}
        onClickOverride={onClickOverride}
        disclosureExpanded={false}
        disclosureControls="track-drawer-track-1"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Kick' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('track-drawer-track-1');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onClickOverride).toHaveBeenCalledOnce();
  });
});

describe('TrackNameEditor tooltip', () => {
  function renderEditor(name: string, instrumentName: string, sampleId: string) {
    render(
      <TrackNameEditor
        name={name}
        instrumentName={instrumentName}
        sampleId={sampleId}
        canRename
        onSave={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    return screen.getByRole('button', { name });
  }

  it('shows the ID and rename hint for an unchanged track name', () => {
    const trigger = renderEditor('Kick', 'Kick', 'kick');

    expect(trigger.getAttribute('title')).toBe('ID: kick\nDouble-click to rename');
  });

  it('also shows the original instrument for a renamed track', () => {
    const trigger = renderEditor('Beat 1', 'Kick', 'kick');

    expect(trigger.getAttribute('title'))
      .toBe('Instrument: Kick\nID: kick\nDouble-click to rename');
  });
});
