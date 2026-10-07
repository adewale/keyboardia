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

function renderRow(track: Track) {
  return render(
    <TrackRow
      track={track}
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
