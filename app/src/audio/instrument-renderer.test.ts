import { describe, expect, it, vi } from 'vitest';
import { audioTime, seconds } from './audio-time';
import {
  createInstrumentRendererRegistry,
  type AudioEngineRendererPort,
  type ResolvedNoteEvent,
} from './instrument-renderer';

function enginePort(): AudioEngineRendererPort {
  return {
    playSynthNote: vi.fn(),
    playSample: vi.fn(),
    playSampledInstrument: vi.fn(),
    playToneSynth: vi.fn(),
    playAdvancedSynth: vi.fn(),
    isSampledInstrumentReady: vi.fn(() => true),
    isToneSynthReady: vi.fn(() => true),
  };
}

function event(overrides: Partial<ResolvedNoteEvent> = {}): ResolvedNoteEvent {
  return {
    type: 'note',
    trackId: 'track-1',
    noteId: 'note-1',
    sampleId: 'sample:kick',
    instrumentType: 'sample',
    presetId: 'kick',
    pitchSemitones: 0,
    when: audioTime(10),
    duration: seconds(0.125),
    midiVelocity: 90,
    noteGain: 1,
    hasExplicitLock: false,
    loopIteration: 2,
    ...overrides,
  };
}

describe('InstrumentRendererRegistry', () => {
  it('preserves one resolved timestamp through every renderer family', () => {
    const engine = enginePort();
    const registry = createInstrumentRendererRegistry(engine);

    registry.schedule(event({ instrumentType: 'sample' }));
    registry.schedule(event({ instrumentType: 'synth', presetId: 'lead' }));
    registry.schedule(event({ instrumentType: 'sampled', presetId: 'piano' }));
    registry.schedule(event({ instrumentType: 'tone', presetId: 'fm-bass' }));
    registry.schedule(event({ instrumentType: 'advanced', presetId: 'supersaw' }));

    expect(vi.mocked(engine.playSample).mock.calls[0]?.[2]).toBe(10);
    expect(vi.mocked(engine.playSynthNote).mock.calls[0]?.[3]).toBe(10);
    expect(vi.mocked(engine.playSampledInstrument).mock.calls[0]?.[3]).toBe(10);
    expect(vi.mocked(engine.playToneSynth).mock.calls[0]?.[2]).toBe(10);
    expect(vi.mocked(engine.playAdvancedSynth).mock.calls[0]?.[2]).toBe(10);
  });

  it('uses the resolved velocity and gain rather than recomputing dynamics', () => {
    const engine = enginePort();
    createInstrumentRendererRegistry(engine).schedule(event({
      hasExplicitLock: true,
      midiVelocity: 64,
      noteGain: 0.1,
    }));

    expect(engine.playSample).toHaveBeenCalledWith(
      'sample:kick', 'track-1', 10, 0.125, 0, 0.1, 64,
    );
  });
});
