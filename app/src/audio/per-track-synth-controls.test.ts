// @vitest-environment jsdom
/**
 * Phase 3: shared advanced controls fan out, while FM controls remain scoped
 * to the track that owns their persisted state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GridState } from '../types';

type NumberSetter = ReturnType<typeof vi.fn<(v: number) => void>>;
interface SpyAdvanced {
  setEnvelope: ReturnType<typeof vi.fn<(value: unknown) => void>>;
  setTempo: NumberSetter;
  setFilterFrequency: NumberSetter;
  setFilterResonance: NumberSetter;
  setLfoRate: NumberSetter;
  setLfoAmount: NumberSetter;
  setOscMix: NumberSetter;
}
interface SpyTone {
  setEnvelope: ReturnType<typeof vi.fn<(value: unknown) => void>>;
  setFMParams: ReturnType<typeof vi.fn<(h: number, m: number) => void>>;
  resetFMParams: ReturnType<typeof vi.fn<() => void>>;
  getFMParams: ReturnType<typeof vi.fn<() => { harmonicity: number; modulationIndex: number } | null>>;
  playNote: ReturnType<typeof vi.fn<() => void>>;
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
        setEnvelope: vi.fn<(value: unknown) => void>(),
        setFMParams: vi.fn<(h: number, m: number) => void>((h, m) => {
          this.fm = { harmonicity: h, modulationIndex: m };
        }),
        resetFMParams: vi.fn<() => void>(() => { this.fm = null; }),
        getFMParams: vi.fn<() => { harmonicity: number; modulationIndex: number } | null>(() => this.fm),
        playNote: vi.fn<() => void>(),
      };
      toneInstances.push(this.spies);
    }
    async initialize(): Promise<void> {}
    getOutput(): { connect: () => void; disconnect: () => void } { return { connect: () => {}, disconnect: () => {} }; }
    setFMParams(h: number, m: number): void { this.spies.setFMParams(h, m); }
    setEnvelope(value: unknown): void { this.spies.setEnvelope(value); }
    resetFMParams(): void { this.spies.resetFMParams(); }
    getFMParams(): { harmonicity: number; modulationIndex: number } | null { return this.spies.getFMParams(); }
    semitoneToNoteName(s: number): string { return `n${s}`; }
    getPresetNames(): string[] { return []; }
    playNote(): void { this.spies.playNote(); }
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
        setEnvelope: vi.fn<(value: unknown) => void>(),
        setTempo: vi.fn<(v: number) => void>(),
        setFilterFrequency: vi.fn<(v: number) => void>(),
        setFilterResonance: vi.fn<(v: number) => void>(),
        setLfoRate: vi.fn<(v: number) => void>(),
        setLfoAmount: vi.fn<(v: number) => void>(),
        setOscMix: vi.fn<(v: number) => void>(),
      };
      advancedInstances.push(this.spies);
    }
    async initialize(): Promise<void> {}
    isReady(): boolean { return true; }
    getOutput(): { connect: () => void; disconnect: () => void } { return { connect: () => {}, disconnect: () => {} }; }
    setTempo(v: number): void { this.spies.setTempo(v); }
    setEnvelope(value: unknown): void { this.spies.setEnvelope(value); }
    setPreset(): void {}
    playNoteSemitone(): void {}
    getDiagnostics(): unknown { return { activeVoices: 0 }; }
    setFilterFrequency(v: number): void { this.spies.setFilterFrequency(v); }
    setFilterResonance(v: number): void { this.spies.setFilterResonance(v); }
    setLfoRate(v: number): void { this.spies.setLfoRate(v); }
    setLfoAmount(v: number): void { this.spies.setLfoAmount(v); }
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
    setTrackVolume: vi.fn(),
    setTrackPan: vi.fn(),
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
      setTrackPan: vi.fn<(trackId: string, pan: number) => void>(),
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
    expect(bus.setTrackPan).toHaveBeenCalledOnce();
    expect(bus.setTrackPan).toHaveBeenCalledWith('A', 0);

    engine.syncGridAudioState({ tempo: 96, tracks: [] });
    expect(bus.removeBus).toHaveBeenCalledWith('A');
  });

  it('retains pan before audio initialization and clears it with track lifecycle', () => {
    const engine = new AudioEngine();
    engine.setTrackPan('A', -0.2);
    const pending = (engine as unknown as { pendingTrackPans: Map<string, number> }).pendingTrackPans;
    expect(pending.get('A')).toBe(-0.2);

    engine.removeTrackGain('A');
    expect(pending.has('A')).toBe(false);
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

  it('translates canonical mixed-unit envelopeV2 state before a synth renderer is created', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    engine.syncGridAudioState({
      tempo: 120,
      tracks: [{
        id: 'v2-track',
        name: 'v2-track',
        sampleId: 'advanced:supersaw',
        steps: [],
        parameterLocks: [],
        volume: 1,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
        envelope: { attack: 4, decay: 4, sustain: 1, release: 8 },
        envelopeV2: {
          model: 'adsr',
          attack: { value: 2, unit: 'steps' },
          decay: { value: 0.05, unit: 'seconds' },
          sustain: 0.4,
          release: { value: 4, unit: 'steps' },
        },
      }],
    });

    await engine.warmAdvancedSynthForTrack('v2-track');
    expect(advancedInstances[0].setEnvelope).toHaveBeenLastCalledWith({
      attack: 0.25,
      decay: 0.05,
      sustain: 0.4,
      release: 0.5,
    });
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

  it('setFMParams updates only its track and is inherited by that track', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmToneSynthForTrack('A');
    await engine.warmToneSynthForTrack('B');

    engine.setFMParams('A', 3, 7);
    expect(toneInstances[0].setFMParams).toHaveBeenCalledWith(3, 7);
    expect(toneInstances[1].setFMParams).not.toHaveBeenCalled();

    engine.setFMParams('C', 4, 9);
    await engine.warmToneSynthForTrack('C');
    const newInstance = toneInstances[toneInstances.length - 1];
    expect(newInstance.setFMParams).toHaveBeenCalledWith(4, 9);
  });

  it('reconciles persisted FM parameters and resets a removed override', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    const withFMParams = {
      tempo: 120,
      tracks: [{
        id: 'A',
        volume: 1,
        fmParams: { harmonicity: 9, modulationIndex: 19 },
      }],
    } as unknown as Pick<GridState, 'tempo' | 'tracks'>;

    engine.syncGridAudioState(withFMParams);
    await engine.warmToneSynthForTrack('A');
    expect(toneInstances[0].setFMParams).toHaveBeenCalledWith(9, 19);
    engine.playToneSynth('fm-bass', 0, 0, 0.1, 1, 'A');

    engine.syncGridAudioState({
      tempo: 120,
      tracks: [{ id: 'A', volume: 1 }],
    } as unknown as Pick<GridState, 'tempo' | 'tracks'>);
    engine.playToneSynth('fm-bass', 0, 0.1, 0.1, 1, 'A');

    expect(toneInstances).toHaveLength(1);
    expect(toneInstances[0].resetFMParams).toHaveBeenCalledOnce();
    expect(toneInstances[0].playNote).toHaveBeenCalledTimes(2);
    expect(engine.getFMParams('A')).toBeNull();
  });

  it('instrument replacement clears a track FM override before rebuilding', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    await engine.warmToneSynthForTrack('A');
    engine.setFMParams('A', 2, 5);

    engine.clearTrackSynths('A');
    await engine.warmToneSynthForTrack('A');

    const rebuilt = toneInstances[toneInstances.length - 1];
    expect(rebuilt.setFMParams).not.toHaveBeenCalled();
    expect(engine.getFMParams('A')).toBeNull();
  });

  it('getFMParams reports the selected track override', () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);
    expect(engine.getFMParams('A')).toBeNull();
    engine.setFMParams('A', 2, 5);
    expect(engine.getFMParams('A')).toEqual({ harmonicity: 2, modulationIndex: 5 });
  });
});
