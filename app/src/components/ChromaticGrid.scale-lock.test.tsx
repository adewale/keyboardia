// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MAX_STEPS } from '../shared/constants';
import type { Track } from '../types';
import { ChromaticGrid } from './ChromaticGrid';

vi.mock('../audio/audioTriggers', () => ({
  previewInstrument: vi.fn(),
  signalMusicIntent: vi.fn(),
}));

function legacyTrackWithOutOfScaleNote(): Track {
  const steps = Array(MAX_STEPS).fill(false);
  const parameterLocks = Array(MAX_STEPS).fill(null);
  steps[0] = true;
  parameterLocks[0] = { pitch: 1 };
  return {
    id: 'track-1',
    name: 'Piano',
    sampleId: 'sampled:piano',
    steps,
    parameterLocks,
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
  };
}

describe('ChromaticGrid scale-lock note entry', () => {
  it('keeps an old out-of-scale row removable but blocks new notes on it', () => {
    const onSetParameterLock = vi.fn();
    const onToggleStep = vi.fn();
    render(
      <ChromaticGrid
        track={legacyTrackWithOutOfScaleNote()}
        currentStep={-1}
        anySoloed={false}
        onSetParameterLock={onSetParameterLock}
        onToggleStep={onToggleStep}
        scale={{ root: 'C', scaleId: 'minor-pentatonic', locked: true }}
      />,
    );

    fireEvent.click(screen.getByTitle('Step 2, C#'));
    expect(onToggleStep).not.toHaveBeenCalled();
    expect(onSetParameterLock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Step 1, C# (click to remove)'));
    expect(onToggleStep).toHaveBeenCalledWith(0);
  });
});
