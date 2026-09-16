// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { audioTime, seconds } from './audio-time';
import type { InstrumentRendererRegistry } from './instrument-renderer';
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
  trackId: 'track-1',
  noteId: 'note-1',
  sampleId: 'advanced:sub-bass',
  instrumentType: 'advanced',
  presetId: 'sub-bass',
  pitchSemitones: 0,
  when: audioTime(10),
  duration: seconds(0.25),
  midiVelocity: 96,
  noteGain: 1,
  hasExplicitLock: false,
  loopIteration: 0,
};

describe('dispatchResolvedNote', () => {
  it('binds the engine lazily after the scheduler import cycle initializes', () => {
    expect(renderer.create).not.toHaveBeenCalled();
    renderer.create.mockReturnValue({ schedule: renderer.schedule });
    renderer.schedule.mockReturnValue({ kind: 'scheduled' });

    dispatchResolvedNote(event, audioTime(10));

    expect(renderer.create).toHaveBeenCalledTimes(1);
    expect(renderer.schedule).toHaveBeenCalledWith(event);
  });

  it('surfaces and counts a renderer readiness invariant violation', () => {
    const metrics = {
      recordJitter: vi.fn(),
      recordLateNote: vi.fn(),
      recordDroppedNote: vi.fn(),
      recordRendererUnavailable: vi.fn(),
    };
    const registry: InstrumentRendererRegistry = {
      schedule: vi.fn<InstrumentRendererRegistry['schedule']>(() => ({
        kind: 'renderer-unavailable',
        instrumentType: 'advanced',
        presetId: 'sub-bass',
      })),
    };

    const result = dispatchResolvedNote(event, audioTime(10), metrics, undefined, registry);

    expect(result.kind).toBe('renderer-unavailable');
    expect(metrics.recordRendererUnavailable).toHaveBeenCalledOnce();
  });

  it('counts a policy drop without invoking any renderer', () => {
    const metrics = {
      recordJitter: vi.fn(),
      recordLateNote: vi.fn(),
      recordDroppedNote: vi.fn(),
      recordRendererUnavailable: vi.fn(),
    };
    const registry: InstrumentRendererRegistry = {
      schedule: vi.fn<InstrumentRendererRegistry['schedule']>(() => ({ kind: 'scheduled' })),
    };

    const result = dispatchResolvedNote(event, audioTime(10.2), metrics, undefined, registry);

    expect(result.kind).toBe('drop');
    expect(metrics.recordDroppedNote).toHaveBeenCalledOnce();
    expect(registry.schedule).not.toHaveBeenCalled();
  });
});
