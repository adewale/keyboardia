// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
      />,
    );

    expect(screen.getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Solo' }).getAttribute('aria-pressed')).toBe('false');
  });
});
