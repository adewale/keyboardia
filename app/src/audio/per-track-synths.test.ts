/**
 * Integration test: AudioEngine keeps a separate tone/advanced synth
 * instance per trackId (bug #6 follow-up).
 *
 * We mock the synth engine classes so we can count how many are created
 * and watch `.connect()` on their outputs — the thing that used to get
 * disconnected and rerouted per note.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Counts + spies set up before the engine module loads so vi.mock replaces
// the real classes with our instrumented fakes. One instance per
// constructor call; `connect` is a spy so we can assert it's only
// invoked at creation time, never during subsequent notes.
type FakeOutput = { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
const toneOutputs: FakeOutput[] = [];
const advancedOutputs: FakeOutput[] = [];

const toneInstances: Array<{ output: FakeOutput; trackId: string | null; playNoteSpy: ReturnType<typeof vi.fn>; disposeSpy: ReturnType<typeof vi.fn> }> = [];
const advancedInstances: Array<{ output: FakeOutput; trackId: string | null; playNoteSpy: ReturnType<typeof vi.fn>; disposeSpy: ReturnType<typeof vi.fn> }> = [];

function makeOutput(): FakeOutput {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

vi.mock('./toneSynths', async () => {
  const actual = await vi.importActual<typeof import('./toneSynths')>('./toneSynths');
  class MockToneSynthManager {
    _instance: (typeof toneInstances)[number];
    constructor() {
      const output = makeOutput();
      this._instance = {
        output,
        trackId: null,
        playNoteSpy: vi.fn(),
        disposeSpy: vi.fn(),
      };
      toneOutputs.push(output);
      toneInstances.push(this._instance);
    }
    async initialize(): Promise<void> {}
    isReady(): boolean { return true; }
    getOutput(): FakeOutput { return this._instance.output; }
    playNote(...args: unknown[]): void { this._instance.playNoteSpy(...args); }
    playNoteSemitone(...args: unknown[]): void { this._instance.playNoteSpy(...args); }
    semitoneToNoteName(semitone: number): string { return `note-${semitone}`; }
    getPresetNames(): string[] { return ['fm-bass']; }
    setFMParams(_h: number, _m: number): void {}
    getFMParams(): unknown { return null; }
    dispose(): void { this._instance.disposeSpy(); }
  }
  return { ...actual, ToneSynthManager: MockToneSynthManager };
});

vi.mock('./advancedSynth', async () => {
  const actual = await vi.importActual<typeof import('./advancedSynth')>('./advancedSynth');
  class MockAdvancedSynthEngine {
    _instance: (typeof advancedInstances)[number];
    constructor() {
      const output = makeOutput();
      this._instance = {
        output,
        trackId: null,
        playNoteSpy: vi.fn(),
        disposeSpy: vi.fn(),
      };
      advancedOutputs.push(output);
      advancedInstances.push(this._instance);
    }
    async initialize(): Promise<void> {}
    isReady(): boolean { return true; }
    getOutput(): FakeOutput { return this._instance.output; }
    setPreset(_name: string): void {}
    playNoteSemitone(...args: unknown[]): void { this._instance.playNoteSpy(...args); }
    getDiagnostics(): unknown { return { activeVoices: 0 }; }
    setFilterFrequency(_v: number): void {}
    setFilterResonance(_v: number): void {}
    setLfoRate(_v: number): void {}
    setLfoAmount(_v: number): void {}
    setAttack(_v: number): void {}
    setRelease(_v: number): void {}
    setOscMix(_v: number): void {}
    dispose(): void { this._instance.disposeSpy(); }
  }
  return { ...actual, AdvancedSynthEngine: MockAdvancedSynthEngine };
});

// Stub the Tone.js module surface that AudioEngine pokes at during init.
vi.mock('tone', () => {
  const ctx = { state: 'running', rawContext: {} };
  return {
    getContext: () => ctx,
    setContext: vi.fn(),
    start: vi.fn(async () => {}),
    connect: vi.fn(),
    Gain: class { connect = vi.fn(); disconnect = vi.fn(); },
  };
});

import { AudioEngine } from './engine';

/** Manually seed an engine with the minimum state `playToneSynth`/`playAdvancedSynth` read. */
async function makeInitializedEngine(): Promise<AudioEngine> {
  const engine = new AudioEngine();
  const fakeCtx = { currentTime: 0, state: 'running', sampleRate: 48000, createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }) };
  (engine as unknown as { audioContext: unknown }).audioContext = fakeCtx;
  (engine as unknown as { initialized: boolean }).initialized = true;
  (engine as unknown as { toneInitialized: boolean }).toneInitialized = true;
  // TrackBusManager returns a fake bus input per track.
  const busInputs = new Map<string, { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>();
  const fakeBusManager = {
    getBusInput: (trackId: string) => {
      let input = busInputs.get(trackId);
      if (!input) {
        input = { connect: vi.fn(), disconnect: vi.fn() };
        busInputs.set(trackId, input);
      }
      return input;
    },
    hasBus: (trackId: string) => busInputs.has(trackId),
    removeBus: vi.fn((trackId: string) => busInputs.delete(trackId)),
    setTrackVolume: vi.fn(),
    setTrackMuted: vi.fn(),
    getActiveTrackIds: () => Array.from(busInputs.keys()),
    getOrCreateBus: (trackId: string) => ({ getInput: () => busInputs.get(trackId) ?? (busInputs.set(trackId, { connect: vi.fn(), disconnect: vi.fn() }), busInputs.get(trackId)!) }),
    getBusCount: () => busInputs.size,
  };
  (engine as unknown as { trackBusManager: unknown }).trackBusManager = fakeBusManager;
  // Make the engine's track-bus-input lookup stash the fake inputs too.
  (engine as unknown as { _testBusInputs: unknown })._testBusInputs = busInputs;
  return engine;
}

describe('Per-track tone/advanced synth instances', () => {
  beforeEach(() => {
    toneOutputs.length = 0;
    advancedOutputs.length = 0;
    toneInstances.length = 0;
    advancedInstances.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a separate ToneSynthManager per track when pre-warmed and played on different tracks', async () => {
    const engine = await makeInitializedEngine();
    await engine.warmToneSynthForTrack('trackA');
    await engine.warmToneSynthForTrack('trackB');

    engine.playToneSynth('fm-bass', 0, 0, 0.1, 1, 'trackA');
    engine.playToneSynth('fm-bass', 0, 0, 0.1, 1, 'trackB');

    expect(toneInstances.length).toBe(2);
    expect(toneInstances[0]).not.toBe(toneInstances[1]);
    expect(toneInstances[0].playNoteSpy).toHaveBeenCalledTimes(1);
    expect(toneInstances[1].playNoteSpy).toHaveBeenCalledTimes(1);
  });

  it('creates a separate AdvancedSynthEngine per track', async () => {
    const engine = await makeInitializedEngine();
    await engine.warmAdvancedSynthForTrack('trackA');
    await engine.warmAdvancedSynthForTrack('trackB');

    engine.playAdvancedSynth('supersaw', 0, 0, 0.1, 1, 'trackA');
    engine.playAdvancedSynth('wobble-bass', 0, 0, 0.1, 1, 'trackB');

    expect(advancedInstances.length).toBe(2);
    expect(advancedInstances[0]).not.toBe(advancedInstances[1]);
  });

  it('never disconnects a shared output when a different track plays (the hijack bug)', async () => {
    const engine = await makeInitializedEngine();
    await engine.warmAdvancedSynthForTrack('trackA');
    engine.playAdvancedSynth('supersaw', 0, 0, 0.1, 1, 'trackA');
    const aConnectsAfterFirstPlay = advancedInstances[0].output.connect.mock.calls.length;
    const aDisconnectsAfterFirstPlay = advancedInstances[0].output.disconnect.mock.calls.length;

    // Track B plays — historically this would disconnect A's output and
    // reroute it to B's bus.
    await engine.warmAdvancedSynthForTrack('trackB');
    engine.playAdvancedSynth('wobble-bass', 0, 0, 0.1, 1, 'trackB');

    expect(advancedInstances[0].output.disconnect).toHaveBeenCalledTimes(aDisconnectsAfterFirstPlay);
    expect(advancedInstances[0].output.connect).toHaveBeenCalledTimes(aConnectsAfterFirstPlay);
  });

  it('reuses the same track\'s synth on repeated notes', async () => {
    const engine = await makeInitializedEngine();
    await engine.warmAdvancedSynthForTrack('trackA');
    engine.playAdvancedSynth('supersaw', 0, 0, 0.1, 1, 'trackA');
    engine.playAdvancedSynth('supersaw', 0, 0, 0.1, 1, 'trackA');
    engine.playAdvancedSynth('supersaw', 0, 0, 0.1, 1, 'trackA');

    expect(advancedInstances.length).toBe(1);
    expect(advancedInstances[0].playNoteSpy).toHaveBeenCalledTimes(3);
  });
});
