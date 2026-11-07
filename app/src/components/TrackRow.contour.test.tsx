// @vitest-environment jsdom
/**
 * Pitch contour marks (specs/PIANO-ROLL-DOCK.md, phase 5): every active step
 * of a melodic row carries a mark at its pitch within the row's own range;
 * drum rows carry none.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ParameterLock, Track } from '../types';
import { TrackRow } from './TrackRow';

vi.mock('../audio/prepare-instrument', () => ({
  prepareInstrument: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function makeTrack(notes: Array<[number, ParameterLock | null]>, overrides: Partial<Track> = {}): Track {
  const steps = Array(128).fill(false);
  const parameterLocks: (ParameterLock | null)[] = Array(128).fill(null);
  for (const [step, lock] of notes) {
    steps[step] = true;
    parameterLocks[step] = lock;
  }
  return {
    id: 'lead',
    name: 'Lead',
    sampleId: 'synth:lead',
    steps,
    parameterLocks,
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

function renderRow(track: Track, overrides: Partial<React.ComponentProps<typeof TrackRow>> = {}) {
  return render(
    <TrackRow
      track={track}
      trackIndex={0}
      currentStep={-1}
      swing={0}
      anySoloed={false}
      isCopySource={false}
      isCopyTarget={false}
      orientationMode="desktop"
      onToggleStep={vi.fn()}
      onToggleMute={vi.fn()}
      onToggleSolo={vi.fn()}
      onSetParameterLock={vi.fn()}
      {...overrides}
    />
  );
}

function contourAt(container: HTMLElement, step: number): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `.step-cell[data-step-index="${step}"] [data-testid="step-contour"]`,
  );
}

describe('TrackRow pitch contour marks', () => {
  it('marks each active melodic step at its pitch within the track range', () => {
    const { container } = renderRow(makeTrack([
      [0, { pitch: -12 }],
      [4, null],
      [8, { pitch: 12 }],
      [9, { tie: true }],
    ]));

    expect(container.querySelectorAll('[data-testid="step-contour"]')).toHaveLength(4);
    expect(contourAt(container, 0)!.style.getPropertyValue('--contour-fraction')).toBe('0');
    expect(contourAt(container, 4)!.style.getPropertyValue('--contour-fraction')).toBe('0.5');
    expect(contourAt(container, 8)!.style.getPropertyValue('--contour-fraction')).toBe('1');
    expect(contourAt(container, 9)!.classList.contains('tied')).toBe(true);
    expect(contourAt(container, 8)!.classList.contains('tied')).toBe(false);
    expect(contourAt(container, 1)).toBeNull();
  });

  it('draws nothing under the row: the marks are the only contour, docked or not', () => {
    const track = makeTrack([[0, { pitch: -12 }], [4, { pitch: 12 }]]);
    for (const isDocked of [false, true]) {
      const { container, unmount } = renderRow(track, { isDocked });
      const steps = container.querySelector('.steps')!;
      // Only cells in the steps container: no SVG overlay over or under them.
      expect(Array.from(steps.children).every(child => child.classList.contains('step-cell'))).toBe(true);
      expect(container.querySelector('svg.pitch-contour, .contour-dot')).toBeNull();
      expect(container.querySelectorAll('[data-testid="step-contour"]')).toHaveLength(2);
      unmount();
    }
  });

  it('places a single-pitch melodic track in the middle', () => {
    const { container } = renderRow(makeTrack([[0, null], [5, null]], { transpose: 7 }));
    expect(contourAt(container, 0)!.style.getPropertyValue('--contour-fraction')).toBe('0.5');
    expect(contourAt(container, 5)!.style.getPropertyValue('--contour-fraction')).toBe('0.5');
  });

  it('draws no contour on drum tracks', () => {
    const { container } = renderRow(makeTrack(
      [[0, { pitch: 5 }], [4, null]],
      { id: 'kick', name: 'Kick', sampleId: 'sampled:808-kick' },
    ));
    expect(container.querySelectorAll('[data-testid="step-contour"]')).toHaveLength(0);
  });
});
