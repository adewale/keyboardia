/**
 * Phase 3: global controls fan out to every active per-track synth AND
 * apply to tracks created later (override memory).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface SpyAdvanced {
  setFilterFrequency: ReturnType<typeof vi.fn>;
  setFilterResonance: ReturnType<typeof vi.fn>;
  setLfoRate: ReturnType<typeof vi.fn>;
  setLfoAmount: ReturnType<typeof vi.fn>;
  setAttack: ReturnType<typeof vi.fn>;
  setRelease: ReturnType<typeof vi.fn>;
  setOscMix: ReturnType<typeof vi.fn>;
}
interface SpyTone {
  setFMParams: ReturnType<typeof vi.fn>;
  getFMParams: ReturnType<typeof vi.fn>;
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
        setFMParams: vi.fn((h: number, m: number) => {
          this.fm = { harmonicity: h, modulationIndex: m };
        }),
        getFMParams: vi.fn(() => this.fm),
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
        setFilterFrequency: vi.fn(),
        setFilterResonance: vi.fn(),
        setLfoRate: vi.fn(),
        setLfoAmount: vi.fn(),
        setAttack: vi.fn(),
        setRelease: vi.fn(),
        setOscMix: vi.fn(),
      };
      advancedInstances.push(this.spies);
    }
    async initialize(): Promise<void> {}
    isReady(): boolean { return true; }
    getOutput(): { connect: () => void; disconnect: () => void } { return { connect: () => {}, disconnect: () => {} }; }
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
