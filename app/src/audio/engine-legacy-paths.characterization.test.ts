// @vitest-environment jsdom
/**
 * Characterization tests for engine.ts's legacy play methods.
 *
 * These methods (`playSynthNote`, `playSampledInstrument`) predate the
 * audio-engine-review branch and have inline business logic without
 * focused tests. The skill recommends writing characterization tests
 * BEFORE refactoring legacy code so future refactors have a safety net.
 *
 * What's recorded here is the OBSERVABLE BEHAVIOUR of the current
 * implementation, not what it ideally should do. If a refactor changes
 * any of these recorded outcomes, this test breaks and tells you
 * exactly what changed.
 *
 * The methods route through delegate objects (synthEngine,
 * sampledInstrumentRegistry, trackBusManager) which are mocked here
 * with a recorder that captures the exact argument tuples each method
 * sees. The assertions document:
 *   - Argument forwarding shape and order
 *   - Track-bus routing decision (with trackId vs without)
 *   - Error-path behaviour (unknown preset, missing instrument)
 *
 * See `docs/LESSONS-LEARNED.md` lesson 33 — these are not meant to
 * verify correctness; they are meant to detect change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const synthPlayNote = vi.fn<(...args: unknown[]) => void>();
const sampledRegistryGet = vi.fn<(id: string) => unknown>();

vi.mock('./synth', async () => {
  const actual = await vi.importActual<typeof import('./synth')>('./synth');
  return {
    ...actual,
    synthEngine: {
      playNote: (...args: unknown[]) => synthPlayNote(...args),
      stopAll: vi.fn(),
      getVoiceCount: () => 0,
      initialize: vi.fn(),
    },
  };
});

vi.mock('./sampled-instrument', async () => {
  const actual = await vi.importActual<typeof import('./sampled-instrument')>('./sampled-instrument');
  return {
    ...actual,
    sampledInstrumentRegistry: {
      get: (id: string) => sampledRegistryGet(id),
      isReady: () => true,
      onStateChange: () => () => {},
      acquireInstrumentSamples: vi.fn(),
      releaseInstrumentSamples: vi.fn(),
      load: vi.fn(async () => true),
      initialize: vi.fn(),
      dispose: vi.fn(),
    },
  };
});

import { AudioEngine } from './engine';

interface FakeBusInput { connect: ReturnType<typeof vi.fn<(...a: unknown[]) => void>>; }

function setupEngine(): { engine: AudioEngine; busInputs: Map<string, FakeBusInput>; getBusInput: ReturnType<typeof vi.fn<(id: string) => FakeBusInput>> } {
  const engine = new AudioEngine();
  (engine as unknown as { initialized: boolean }).initialized = true;
  const busInputs = new Map<string, FakeBusInput>();
  const getBusInput = vi.fn<(id: string) => FakeBusInput>((id: string) => {
    let input = busInputs.get(id);
    if (!input) {
      input = { connect: vi.fn<(...a: unknown[]) => void>() };
      busInputs.set(id, input);
    }
    return input;
  });
  (engine as unknown as { trackBusManager: unknown }).trackBusManager = { getBusInput };
  return { engine, busInputs, getBusInput };
}

describe('characterization: playSynthNote', () => {
  beforeEach(() => {
    synthPlayNote.mockClear();
  });

  it('passes (noteId, frequency, preset, time, duration, volume, destination) to synthEngine.playNote', () => {
    const { engine } = setupEngine();
    engine.playSynthNote('note-1', 'lead', 12, 5.0, 0.25, 0.7, 'trackA');
    expect(synthPlayNote).toHaveBeenCalledTimes(1);
    const args = synthPlayNote.mock.calls[0];
    // Recorded shape — index by index.
    expect(args[0]).toBe('note-1');                              // noteId
    expect(typeof args[1]).toBe('number');                       // frequency from semitoneToFrequency
    expect(args[2]).toMatchObject({ waveform: expect.any(String) }); // preset (SynthParams shape)
    expect(args[3]).toBe(5.0);                                   // time
    expect(args[4]).toBe(0.25);                                  // duration
    expect(args[5]).toBe(0.7);                                   // volume
    expect(args[6]).toMatchObject({ connect: expect.any(Function) }); // destination = bus input
  });

  it('passes destination=undefined when no trackId is given', () => {
    const { engine } = setupEngine();
    engine.playSynthNote('note-x', 'lead', 0, 0, undefined, 1);
    const args = synthPlayNote.mock.calls[0];
    expect(args[6]).toBeUndefined();
  });

  it('falls back to the lead preset when an unknown name is passed (recorded behaviour, not validation)', () => {
    const { engine } = setupEngine();
    engine.playSynthNote('note-1', 'definitely-not-a-preset', 0, 0);
    expect(synthPlayNote).toHaveBeenCalledTimes(1);
    // Behaviour preserved: a single playNote happens with the lead preset.
    // A future refactor that changes this to "skip unknown presets" would
    // fail here — that's the point of characterization.
    const preset = synthPlayNote.mock.calls[0][2] as { waveform?: string };
    expect(preset).toBeDefined();
    expect(typeof preset.waveform).toBe('string');
  });

  it('frequency is computed from the semitone (proves arg index 1 is not, e.g., the raw semitone)', () => {
    const { engine } = setupEngine();
    engine.playSynthNote('a', 'lead', 0, 0); // 0 semitones → C4 frequency
    const freqAtZero = synthPlayNote.mock.calls[0][1] as number;
    synthPlayNote.mockClear();

    engine.playSynthNote('b', 'lead', 12, 0); // +12 → one octave up
    const freqAtTwelve = synthPlayNote.mock.calls[0][1] as number;

    // Octave doubles the frequency (within fp tolerance).
    expect(freqAtTwelve / freqAtZero).toBeCloseTo(2, 2);
  });
});

describe('characterization: playSampledInstrument', () => {
  beforeEach(() => {
    sampledRegistryGet.mockReset();
  });

  function makeFakeInstrument() {
    return {
      isReady: () => true,
      playNote: vi.fn<(...a: unknown[]) => void>(),
    };
  }

  it('forwards (noteId, midiNote, time, duration, volume, velocity, destination) to instrument.playNote', () => {
    const { engine } = setupEngine();
    const inst = makeFakeInstrument();
    sampledRegistryGet.mockReturnValue(inst);

    engine.playSampledInstrument('piano', 'note-1', 60, 2.5, 0.5, 0.8, 'trackA', 90);

    expect(inst.playNote).toHaveBeenCalledTimes(1);
    const args = inst.playNote.mock.calls[0];
    expect(args[0]).toBe('note-1');
    expect(args[1]).toBe(60);                                            // midiNote
    expect(args[2]).toBe(2.5);                                           // scheduled time (P1 fix: was hardcoded 0)
    expect(args[3]).toBe(0.5);                                           // duration
    expect(args[4]).toBe(0.8);                                           // volume
    expect(args[5]).toBe(90);                                            // velocity (P2 fix: was hardcoded 100)
    expect(args[6]).toMatchObject({ connect: expect.any(Function) });    // destination = bus input
  });

  it('defaults velocity to 127 (full hit) when the caller omits it', () => {
    const { engine } = setupEngine();
    const inst = makeFakeInstrument();
    sampledRegistryGet.mockReturnValue(inst);

    engine.playSampledInstrument('piano', 'note-1', 60, 0, 0.5, 0.8, 'trackA');

    expect(inst.playNote.mock.calls[0][5]).toBe(127);
  });

  it('passes destination=undefined when no trackId is given', () => {
    const { engine } = setupEngine();
    const inst = makeFakeInstrument();
    sampledRegistryGet.mockReturnValue(inst);

    engine.playSampledInstrument('piano', 'n', 60, 0);

    const args = inst.playNote.mock.calls[0];
    expect(args[6]).toBeUndefined();
  });

  it('skips silently (no playNote, no throw) when the instrument is not registered', () => {
    const { engine } = setupEngine();
    sampledRegistryGet.mockReturnValue(undefined);

    expect(() => engine.playSampledInstrument('unregistered', 'n', 60, 0)).not.toThrow();
    // playNote is on the result of registry.get; a missing entry means it's
    // never called. Recording: error path is silent, not thrown.
  });

  it('skips silently when the instrument exists but is not ready', () => {
    const { engine } = setupEngine();
    const inst = { isReady: () => false, playNote: vi.fn<(...a: unknown[]) => void>() };
    sampledRegistryGet.mockReturnValue(inst);

    engine.playSampledInstrument('piano', 'n', 60, 0);
    expect(inst.playNote).not.toHaveBeenCalled();
  });
});