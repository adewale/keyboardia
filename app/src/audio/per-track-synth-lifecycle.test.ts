/**
 * Phase 4: lifecycle hooks for per-track synth instances.
 *
 * - Deleting a track (engine.removeTrackGain) disposes the per-track
 *   synth instances so they don't leak.
 * - Changing a track's instrument (engine.clearTrackSynths) disposes
 *   the per-track synth so a new one is created for the new category.
 * - Engine dispose() tears down every registered instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface Instance { disposeSpy: ReturnType<typeof vi.fn<() => void>>; }
const toneInstances: Instance[] = [];
const advancedInstances: Instance[] = [];

vi.mock('./toneSynths', async () => {
  const actual = await vi.importActual<typeof import('./toneSynths')>('./toneSynths');
  class MockToneSynthManager {
    private i: Instance;
    constructor() { this.i = { disposeSpy: vi.fn<() => void>() }; toneInstances.push(this.i); }
    async initialize(): Promise<void> {}
    getOutput(): { connect: () => void } { return { connect: () => {} }; }
    setFMParams(): void {}
    getFMParams(): null { return null; }
    semitoneToNoteName(s: number): string { return `n${s}`; }
    getPresetNames(): string[] { return []; }
    playNote(): void {}
    dispose(): void { this.i.disposeSpy(); }
  }
  return { ...actual, ToneSynthManager: MockToneSynthManager };
});

vi.mock('./advancedSynth', async () => {
  const actual = await vi.importActual<typeof import('./advancedSynth')>('./advancedSynth');
  class MockAdvancedSynthEngine {
    private i: Instance;
    constructor() { this.i = { disposeSpy: vi.fn<() => void>() }; advancedInstances.push(this.i); }
    async initialize(): Promise<void> {}
    isReady(): boolean { return true; }
    getOutput(): { connect: () => void } { return { connect: () => {} }; }
    setPreset(): void {}
    playNoteSemitone(): void {}
    getDiagnostics(): unknown { return { activeVoices: 0 }; }
    setFilterFrequency(): void {}
    setFilterResonance(): void {}
    setLfoRate(): void {}
    setLfoAmount(): void {}
    setAttack(): void {}
    setRelease(): void {}
    setOscMix(): void {}
    dispose(): void { this.i.disposeSpy(); }
  }
  return { ...actual, AdvancedSynthEngine: MockAdvancedSynthEngine };
});

vi.mock('tone', () => ({
  getContext: () => ({ state: 'running', rawContext: {} }),
  getTransport: () => ({ stop: vi.fn(), cancel: vi.fn() }),
  setContext: vi.fn(),
  start: vi.fn(async () => {}),
  connect: vi.fn(),
  Gain: class { connect = vi.fn(); disconnect = vi.fn(); },
}));

import { AudioEngine } from './engine';

function stubEngineInternals(engine: AudioEngine): void {
  (engine as unknown as { audioContext: unknown }).audioContext = { currentTime: 0, state: 'running', sampleRate: 48000 };
  (engine as unknown as { initialized: boolean }).initialized = true;
  (engine as unknown as { toneInitialized: boolean }).toneInitialized = true;
  const buses = new Set<string>();
  const fakeBusManager = {
    getBusInput: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    removeBus: vi.fn((trackId: string) => { buses.delete(trackId); }),
    dispose: vi.fn(),
  };
  (engine as unknown as { trackBusManager: unknown }).trackBusManager = fakeBusManager;
}

describe('Phase 4: per-track synth lifecycle', () => {
  beforeEach(() => {
    toneInstances.length = 0;
    advancedInstances.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('removeTrackGain disposes both tone and advanced synth instances for that track', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmToneSynthForTrack('A');
    await engine.warmAdvancedSynthForTrack('A');
    await engine.warmAdvancedSynthForTrack('B');

    engine.removeTrackGain('A');

    expect(toneInstances[0].disposeSpy).toHaveBeenCalledTimes(1);
    expect(advancedInstances[0].disposeSpy).toHaveBeenCalledTimes(1); // A
    expect(advancedInstances[1].disposeSpy).not.toHaveBeenCalled();    // B survives
  });

  it('after removeTrackGain, a subsequent warm for the same trackId creates a fresh instance', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmAdvancedSynthForTrack('A');
    engine.removeTrackGain('A');
    await engine.warmAdvancedSynthForTrack('A');

    expect(advancedInstances.length).toBe(2);
    expect(advancedInstances[0]).not.toBe(advancedInstances[1]);
    expect(advancedInstances[0].disposeSpy).toHaveBeenCalledTimes(1);
    expect(advancedInstances[1].disposeSpy).not.toHaveBeenCalled();
  });

  it('clearTrackSynths disposes both registries for a track (used on instrument change)', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmToneSynthForTrack('A');
    await engine.warmAdvancedSynthForTrack('A');

    engine.clearTrackSynths('A');

    expect(toneInstances[0].disposeSpy).toHaveBeenCalledTimes(1);
    expect(advancedInstances[0].disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('engine dispose disposes every registered instance across all tracks', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmToneSynthForTrack('A');
    await engine.warmToneSynthForTrack('B');
    await engine.warmAdvancedSynthForTrack('A');

    engine.dispose();

    for (const i of toneInstances) expect(i.disposeSpy).toHaveBeenCalledTimes(1);
    for (const i of advancedInstances) expect(i.disposeSpy).toHaveBeenCalledTimes(1);
  });
});
