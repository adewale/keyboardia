// @vitest-environment jsdom
/**
 * TrackDrawer Integration Tests
 *
 * Tests that TrackDrawer renders correctly in landscape mode
 * and integrates properly with TrackRow's accordion behavior.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TrackDrawer } from './TrackDrawer';

afterEach(() => {
  cleanup();
});

const defaultProps = {
  isOpen: false,
  onClose: vi.fn(),
  trackId: 'track-1',
  trackName: 'Kick',
  transpose: 0,
  stepCount: 16,
  volume: 1,
  isMelodicTrack: false,
  hasSteps: true,
  isPitchExpanded: false,
  isVelocityExpanded: false,
  arePatternToolsVisible: false,
  onTransposeChange: vi.fn(),
  onStepCountChange: vi.fn(),
  onVolumeChange: vi.fn(),
  onCopy: vi.fn(),
  onClear: vi.fn(),
  onDelete: vi.fn(),
};

describe('TrackDrawer', () => {
  it('does not render when isOpen is false', () => {
    render(<TrackDrawer {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('renders when isOpen is true', () => {
    render(<TrackDrawer {...defaultProps} isOpen={true} />);
    const region = screen.getByRole('region', { name: 'Kick track controls' });
    expect(region).toBeDefined();
    expect(region.classList.contains('track-drawer')).toBe(true);
  });

  it('shows explicitly named Copy, Clear, and Delete buttons when open', () => {
    render(<TrackDrawer {...defaultProps} isOpen={true} />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDefined();
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    expect(deleteBtn.classList.contains('destructive')).toBe(true);
  });

  it('calls onCopy when Copy button clicked', () => {
    const onCopy = vi.fn();
    render(<TrackDrawer {...defaultProps} isOpen={true} onCopy={onCopy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('calls onClear when Clear button clicked', () => {
    const onClear = vi.fn();
    render(<TrackDrawer {...defaultProps} isOpen={true} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('calls onDelete when Delete button clicked', () => {
    const onDelete = vi.fn();
    render(<TrackDrawer {...defaultProps} isOpen={true} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('shows Paste button instead of Copy/Clear/Delete when in copy-target mode', () => {
    const onPaste = vi.fn();
    render(
      <TrackDrawer
        {...defaultProps}
        isOpen={true}
        isCopyTarget={true}
        onPaste={onPaste}
      />
    );
    expect(screen.getByRole('button', { name: 'Paste' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('shows transpose controls with current value', () => {
    render(<TrackDrawer {...defaultProps} isOpen={true} transpose={5} />);
    expect(screen.getByText('+5')).toBeDefined();
    expect(screen.getByLabelText('Transpose down')).toBeDefined();
    expect(screen.getByLabelText('Transpose up')).toBeDefined();
  });

  it('calls onTransposeChange when transpose buttons clicked', () => {
    const onTransposeChange = vi.fn();
    render(
      <TrackDrawer
        {...defaultProps}
        isOpen={true}
        transpose={0}
        onTransposeChange={onTransposeChange}
      />
    );
    fireEvent.click(screen.getByLabelText('Transpose up'));
    expect(onTransposeChange).toHaveBeenCalledWith(1);
  });

  it('shows step count dropdown', () => {
    render(<TrackDrawer {...defaultProps} isOpen={true} stepCount={16} />);
    const select = screen.getByLabelText('Step count');
    expect(select).toBeDefined();
    expect((select as HTMLSelectElement).value).toBe('16');
  });

  it('shows pitch expand button only for melodic tracks', () => {
    const onExpandPitch = vi.fn();
    const { rerender } = render(
      <TrackDrawer
        {...defaultProps}
        isOpen={true}
        isMelodicTrack={false}
      />
    );
    expect(screen.queryByLabelText('Pitch view')).toBeNull();

    rerender(
      <TrackDrawer
        {...defaultProps}
        isOpen={true}
        isMelodicTrack={true}
        onExpandPitch={onExpandPitch}
      />
    );
    expect(screen.getByLabelText('Pitch view')).toBeDefined();
  });

  it('exposes the expanded state of landscape disclosure controls', () => {
    render(
      <TrackDrawer
        {...defaultProps}
        isOpen={true}
        isMelodicTrack={true}
        isPitchExpanded={true}
        isVelocityExpanded={false}
        arePatternToolsVisible={true}
        onExpandPitch={vi.fn()}
        onExpandVelocity={vi.fn()}
        onShowPatternTools={vi.fn()}
      />
    );

    const pitch = screen.getByRole('button', { name: 'Pitch view' });
    const velocity = screen.getByRole('button', { name: 'Velocity lane' });
    const pattern = screen.getByRole('button', { name: 'Pattern tools' });
    expect(pitch.getAttribute('aria-expanded')).toBe('true');
    expect(velocity.getAttribute('aria-expanded')).toBe('false');
    expect(pattern.getAttribute('aria-expanded')).toBe('true');
    expect(pitch.textContent).toBe('Pitch');
    expect(velocity.textContent).toBe('Velocity');
    expect(pattern.textContent).toBe('Pattern');
  });

  it('closes on Escape with an explicit keyboard reason', () => {
    const onClose = vi.fn();
    render(<TrackDrawer {...defaultProps} isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('escape');
  });

  it('disables Copy and Clear when track has no steps', () => {
    render(<TrackDrawer {...defaultProps} isOpen={true} hasSteps={false} />);
    const copyBtn = screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement;
    const clearBtn = screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement;
    expect(copyBtn.disabled).toBe(true);
    expect(clearBtn.disabled).toBe(true);
  });
});