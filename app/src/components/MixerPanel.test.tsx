// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../types';
import { MixerPanel } from './MixerPanel';

vi.mock('./TrackMeter', () => ({ TrackMeter: () => <div data-testid="track-meter" /> }));

const track: Track = {
  id: 'track-1',
  name: 'Kick',
  sampleId: 'kick',
  steps: Array(128).fill(false),
  parameterLocks: Array(128).fill(null),
  volume: 1,
  pan: -0.2,
  muted: true,
  soloed: false,
  transpose: 0,
  stepCount: 16,
};

afterEach(cleanup);

describe('MixerPanel toggle semantics', () => {
  it('exposes stable mute and solo names with their pressed state', () => {
    render(
      <MixerPanel
        tracks={[track]}
        anySoloed={false}
        onToggleMute={vi.fn()}
        onToggleSolo={vi.fn()}
        onSetVolume={vi.fn()}
        onSetPan={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Solo' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('converts displayed integer percent to normalized canonical pan', () => {
    const onSetPan = vi.fn();
    render(
      <MixerPanel
        tracks={[track]}
        anySoloed={false}
        onToggleMute={vi.fn()}
        onToggleSolo={vi.fn()}
        onSetVolume={vi.fn()}
        onSetPan={onSetPan}
      />,
    );

    const pan = screen.getByRole('slider', { name: 'Kick pan' });
    expect((pan as HTMLInputElement).value).toBe('-20');
    fireEvent.change(pan, { target: { value: '35' } });
    expect(onSetPan).toHaveBeenCalledWith('track-1', 0.35);
  });
});
