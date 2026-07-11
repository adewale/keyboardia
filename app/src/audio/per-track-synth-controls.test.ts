// @vitest-environment jsdom
/**
 * Phase 3: global controls fan out to every active per-track synth AND
 * apply to tracks created later (override memory).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GridState } from '../types';

type NumberSetter = ReturnType<typeof vi.fn<(v: number) => void>>;
interface SpyAdvanced {
  setTempo: NumberSetter;
  setFilterFrequency: NumberSetter;
  setFilterResonance: NumberSetter;
  setLfoRate: NumberSetter;
  setLfoAmount: NumberSetter;
  setAttack: NumberSetter;
  setRelease: NumberSetter;
  setOscMix: NumberSetter;
}
interface SpyTone {
  setFMParams: ReturnType<typeof vi.fn<(h: number, m: number) => void>>;
  getFMParams: ReturnType<typeof vi.fn<() => { harmonicity: number; modulationIndex: number } | null>>;
}

const advancedInstances: SpyAdvanced[] = [];
const toneInstances: SpyTone[] = [];

vi.mock('./toneSynths', async () => {
  const actual = await vi.importActual<typeof import('./toneSynths')>('./toneSynths');
  class MockToneSynthManager {
    private fm: { harmonicity: number; modulationIndex: number } | null = null;
    private spies: SpyTone;
    constructor() {
      this.spies = {
        setFMParams: vi.fn<(h: number, m: number) => void>((h, m) => {
          this.fm = { harmonicity: h, modulationIndex: m };
        }),
        getFMParams: vi.fn<() => { harmonicity: number; modulationIndex: number } | null>(() => this.fm),
      };
      toneInstances.push(this.spies);
    }
    async initialize(): Promise<void> {}
    getOutput(): { connect: () => void; disconnect: () => void } { return { connect: () => {}, disconnect: () => {} }; }
    setFMParams(h: number, m: number): void { this.spies.setFMParams(h, m); }
    getFMParams(): { harmonicity: number; modulationIndex: number } | null { return this.spies.getFMParams(); }
    semitoneToNoteName(s: number): string { return `n${s}`; }
    getPresetNames(): string[] { return []; }
    playNote(): void {}
    dispose(): void {}
  }
  return { ...actual, ToneSynthManager: MockToneSynthManager };
});

vi.mock('./advancedSynth', async () => {
  const actual = await vi.importActual<typeof import('./advancedSynth')>('./advancedSynth');
  class MockAdvancedSynthEngine {
    private spies: SpyAdvanced;
    constructor() {
      this.spies = {
        setTempo: vi.fn<(v: number) => void>(),
        setFilterFrequency: vi.fn<(v: number) => void>(),
        setFilterResonance: vi.fn<(v: number) => void>(),
        setLfoRate: vi.fn<(v: number) => void>(),
        setLfoAmount: vi.fn<(v: number) => void>(),
        setAttack: vi.fn<(v: number) => void>(),
        setRelease: vi.fn<(v: number) => void>(),
        setOscMix: vi.fn<(v: number) => void>(),
      };
      advancedInstances.push(this.spies);
    }
    async initialize(): Promise<void> {}
    isReady(): boolean { return true; }
    getOutput(): { connect: () => void; disconnect: () => void } { return { connect: () => {}, disconnect: () => {} }; }
    setTempo(v: number): void { this.spies.setTempo(v); }
    setPreset(): void {}
    playNoteSemitone(): void {}
    getDiagnostics(): unknown { return { activeVoices: 0 }; }
    setFilterFrequency(v: number): void { this.spies.setFilterFrequency(v); }
    setFilterResonance(v: number): void { this.spies.setFilterResonance(v); }
    setLfoRate(v: number): void { this.spies.setLfoRate(v); }
    setLfoAmount(v: number): void { this.spies.setLfoAmount(v); }
    setAttack(v: number): void { this.spies.setAttack(v); }
    setRelease(v: number): void { this.spies.setRelease(v); }
    setOscMix(v: number): void { this.spies.setOscMix(v); }
    dispose(): void {}
  }
  return { ...actual, AdvancedSynthEngine: MockAdvancedSynthEngine };
});

vi.mock('tone', () => ({
  getContext: () => ({ state: 'running', rawContext: {} }),
  setContext: vi.fn(),
  start: vi.fn(async () => {}),
  connect: vi.fn(),
  Gain: class { connect = vi.fn(); disconnect = vi.fn(); },
}));

import { AudioEngine } from './engine';

function stubEngineInternals(engine: AudioEngine): void {
  const fakeCtx = { currentTime: 0, state: 'running', sampleRate: 48000 };
  (engine as unknown as { audioContext: unknown }).audioContext = fakeCtx;
  (engine as unknown as { initialized: boolean }).initialized = true;
  (engine as unknown as { toneInitialized: boolean }).toneInitialized = true;
  const fakeBusManager = {
    getBusInput: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
  };
  (engine as unknown as { trackBusManager: unknown }).trackBusManager = fakeBusManager;
}

describe('Phase 3: global controls fan out + overrides', () => {
  beforeEach(() => {
    advancedInstances.length = 0;
    toneInstances.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reconciles base faders once and reclaims tracks absent from a later snapshot', () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    const bus = {
      getBusInput: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      setTrackVolume: vi.fn<(trackId: string, volume: number) => void>(),
      removeBus: vi.fn<(trackId: string) => void>(),
    };
    (engine as unknown as { trackBusManager: unknown }).trackBusManager = bus;
    const withTrack = {
      tempo: 96,
      tracks: [{ id: 'A', volume: 0.25 }],
    } as unknown as Pick<GridState, 'tempo' | 'tracks'>;

    engine.syncGridAudioState(withTrack);
    engine.syncGridAudioState(withTrack);
    expect(bus.setTrackVolume).toHaveBeenCalledOnce();
    expect(bus.setTrackVolume).toHaveBeenCalledWith('A', 0.25);

    engine.syncGridAudioState({ tempo: 96, tracks: [] });
    expect(bus.removeBus).toHaveBeenCalledWith('A');
  });

  it('sequencer tempo fans out and is inherited by synths created later', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmAdvancedSynthForTrack('A');

    engine.setTempo(90);
    expect(advancedInstances[0].setTempo).toHaveBeenLastCalledWith(90);

    await engine.warmAdvancedSynthForTrack('B');
    expect(advancedInstances[1].setTempo).toHaveBeenCalledWith(90);
  });

  it('setFilterFrequency applies to every currently-registered track', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmAdvancedSynthForTrack('A');
    await engine.warmAdvancedSynthForTrack('B');
    await engine.warmAdvancedSynthForTrack('C');

    engine.setFilterFrequency(1234);

    expect(advancedInstances.length).toBe(3);
    for (const s of advancedInstances) {
      expect(s.setFilterFrequency).toHaveBeenCalledWith(1234);
    }
  });

  it.each([
    ['setFilterResonance', 'setFilterResonance', 2.5],
    ['setLfoRate', 'setLfoRate', 7],
    ['setLfoAmount', 'setLfoAmount', 0.5],
    ['setAttack', 'setAttack', 0.3],
    ['setRelease', 'setRelease', 0.8],
    ['setOscMix', 'setOscMix', 0.7],
  ] as const)('%s fans out to all tracks', async (method, spyName, value) => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmAdvancedSynthForTrack('A');
    await engine.warmAdvancedSynthForTrack('B');

    (engine[method] as (v: number) => void)(value);

    for (const s of advancedInstances) {
      expect(s[spyName]).toHaveBeenCalledWith(value);
    }
  });

  it('setFilterFrequency applied BEFORE any track exists is inherited by new tracks', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    engine.setFilterFrequency(1500); // no tracks yet — override stored
    expect(advancedInstances.length).toBe(0);

    await engine.warmAdvancedSynthForTrack('A');
    expect(advancedInstances[0].setFilterFrequency).toHaveBeenCalledWith(1500);
  });

  it('multiple XY-pad settings stack and apply together to new tracks', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);

    engine.setFilterFrequency(800);
    engine.setFilterResonance(3.2);
    engine.setLfoAmount(0.4);

    await engine.warmAdvancedSynthForTrack('A');

    expect(advancedInstances[0].setFilterFrequency).toHaveBeenCalledWith(800);
    expect(advancedInstances[0].setFilterResonance).toHaveBeenCalledWith(3.2);
    expect(advancedInstances[0].setLfoAmount).toHaveBeenCalledWith(0.4);
    expect(advancedInstances[0].setLfoRate).not.toHaveBeenCalled();
  });

  it('setFMParams fans out across tone tracks AND is preserved for new tracks', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmToneSynthForTrack('A');
    await engine.warmToneSynthForTrack('B');

    engine.setFMParams(3, 7);
    for (const t of toneInstances) {
      expect(t.setFMParams).toHaveBeenCalledWith(3, 7);
    }

    await engine.warmToneSynthForTrack('C');
    const newInstance = toneInstances[toneInstances.length - 1];
    expect(newInstance.setFMParams).toHaveBeenCalledWith(3, 7);
  });

  it('getFMParams reports the shared-override value when set', () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    expect(engine.getFMParams()).toBeNull();
    engine.setFMParams(2, 5);
    expect(engine.getFMParams()).toEqual({ harmonicity: 2, modulationIndex: 5 });
  });
});