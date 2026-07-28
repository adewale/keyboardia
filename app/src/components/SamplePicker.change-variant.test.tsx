// @vitest-environment jsdom
/**
 * SamplePicker: Change Instrument variant (issue #63).
 *
 * The picker serves two roles over one catalog. These tests pin the part that
 * would otherwise rot: the 'add' variant's rendered output, which
 * e2e/visual.spec.ts holds a `sample-picker.png` baseline of, and the 'change'
 * variant's distinct affordances.
 *
 * See specs/CHANGE-INSTRUMENT.md.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SamplePicker } from './SamplePicker';
import { VALID_SAMPLE_IDS } from './sample-constants';

vi.mock('../audio/prepare-instrument', () => ({
  prepareInstrument: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SamplePicker variants', () => {
  it('renders the add variant exactly as before the change variant existed', () => {
    render(<SamplePicker onSelectSample={vi.fn()} disabled={false} />);

    expect(screen.getByText('Add Track')).toBeTruthy();
    expect(screen.queryByText('Change Instrument')).toBeNull();

    // The visual baseline is of the default picker; these are the attributes
    // that would move it.
    const kick = screen.getByTestId('add-track-kick');
    expect(kick.getAttribute('title')).toBe('Add Kick track');
    expect(kick.className).toBe('instrument-btn sample');
    expect(kick.getAttribute('aria-current')).toBeNull();
    expect(document.querySelector('.sample-picker.variant-change')).toBeNull();
  });

  it('labels the change variant for replacing a sound', () => {
    render(
      <SamplePicker
        variant="change"
        selectedSampleId="kick"
        onSelectSample={vi.fn()}
        disabled={false}
      />
    );

    expect(screen.getByText('Change Instrument')).toBeTruthy();
    expect(screen.queryByText('Add Track')).toBeNull();
    expect(screen.getByTestId('set-instrument-snare').getAttribute('title')).toBe('Use Snare');
    expect(screen.queryByTestId('add-track-snare')).toBeNull();
  });

  it('marks the instrument the track already plays', () => {
    render(
      <SamplePicker
        variant="change"
        selectedSampleId="snare"
        onSelectSample={vi.fn()}
        disabled={false}
      />
    );

    const current = screen.getByTestId('set-instrument-snare');
    expect(current.className).toContain('current');
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.getAttribute('title')).toBe('Current instrument: Snare');

    const other = screen.getByTestId('set-instrument-kick');
    expect(other.className).not.toContain('current');
    expect(other.getAttribute('aria-current')).toBeNull();
  });

  it('commits a canonical catalog ID and its display name', () => {
    const onSelectSample = vi.fn();
    render(
      <SamplePicker
        variant="change"
        selectedSampleId="kick"
        onSelectSample={onSelectSample}
        disabled={false}
      />
    );

    screen.getByTestId('set-instrument-sampled:808-kick').click();

    expect(onSelectSample).toHaveBeenCalledWith('sampled:808-kick', '808 Kick');
    // Whatever the picker commits must be something the shared operation
    // accepts, or a person could click an instrument the server refuses.
    expect(VALID_SAMPLE_IDS.has(onSelectSample.mock.calls[0][0])).toBe(true);
  });

  it('preloads the instrument it commits', async () => {
    const { prepareInstrument } = await import('../audio/prepare-instrument');
    render(
      <SamplePicker
        variant="change"
        selectedSampleId="kick"
        onSelectSample={vi.fn()}
        disabled={false}
      />
    );

    screen.getByTestId('set-instrument-sampled:808-kick').click();

    expect(prepareInstrument).toHaveBeenCalledWith('sampled:808-kick');
  });

  it('disables every instrument when the picker is disabled', () => {
    render(
      <SamplePicker
        variant="change"
        selectedSampleId="kick"
        onSelectSample={vi.fn()}
        disabled
      />
    );

    expect(screen.getByTestId('set-instrument-snare').hasAttribute('disabled')).toBe(true);
  });
});
