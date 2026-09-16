import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioTime, seconds } from './audio-time';
import type { ResolvedNoteEvent } from './resolved-note-event';

const renderer = vi.hoisted(() => ({
  create: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock('./engine', () => ({ audioEngine: {} }));
vi.mock('./instrument-renderer', () => ({
  createInstrumentRendererRegistry: renderer.create,
}));

import { dispatchResolvedNote } from './note-dispatcher';

const event: ResolvedNoteEvent = {
  type: 'note',
  instrumentType: 'synth',
  presetId: 'default',
  noteId: 'note-1',
  trackId: 'track-1',
  sampleId: 'sample-1',
  pitchSemitones: 0,
  when: audioTime(1),
  duration: seconds(0.25),
  noteGain: 1,
  midiVelocity: 100,
  loopIteration: 0,
  hasExplicitLock: false,
};

describe('dispatchResolvedNote module initialization', () => {
  beforeEach(() => {
    renderer.create.mockReset();
    renderer.schedule.mockReset();
    renderer.create.mockReturnValue({ schedule: renderer.schedule });
  });

  it('does not bind the engine while the scheduler import cycle is initializing', () => {
    expect(renderer.create).not.toHaveBeenCalled();
  });

  it('creates the renderer registry lazily on first dispatch', () => {
    dispatchResolvedNote(event, audioTime(0));

    expect(renderer.create).toHaveBeenCalledTimes(1);
    expect(renderer.schedule).toHaveBeenCalledWith(event);
  });
});
