/**
 * Phase 5: eager pre-warm of per-track tone/advanced synths at the
 * start of playback, so the first note doesn't pay initialisation
 * latency (50–200 ms of Tone/node graph construction).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toneCreates: string[] = [];
const advancedCreates: string[] = [];

vi.mock('./toneSynths', async () => {
  const actual = await vi.importActual<typeof import('./toneSynths')>('./toneSynths');
  let nextId = 0;
  class MockToneSynthManager {
    private id = nextId++;
    async initialize(): Promise<void> {}
    getOutput(): { connect: () => void } { return { connect: () => {} }; }
    setFMParams(): void {}
    getFMParams(): null { return null; }
    semitoneToNoteName(s: number): string { return `n${s}`; }
    getPresetNames(): string[] { return []; }
    playNote(): void {}
    dispose(): void {}
    _id(): number { return this.id; }
  }
  return { ...actual, ToneSynthManager: MockToneSynthManager };
});

vi.mock('./advancedSynth', async () => {
  const actual = await vi.importActual<typeof import('./advancedSynth')>('./advancedSynth');
  class MockAdvancedSynthEngine {
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
    dispose(): void {}
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
  const fakeBusManager = { getBusInput: () => ({ connect: vi.fn(), disconnect: vi.fn() }) };
  (engine as unknown as { trackBusManager: unknown }).trackBusManager = fakeBusManager;
  // Observe registry factory calls via the logger side-effect is fragile; we
  // instead assert on registry state before/after.
  const tReg = (engine as unknown as { toneSynthRegistry: { has(id: string): boolean; activeTrackIds(): string[] } }).toneSynthRegistry;
  const aReg = (engine as unknown as { advancedSynthRegistry: { has(id: string): boolean; activeTrackIds(): string[] } }).advancedSynthRegistry;
  void tReg; void aReg;
}

describe('Phase 5: pre-warm tone/advanced synths', () => {
  beforeEach(() => {
    toneCreates.length = 0;
    advancedCreates.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('preloadInstrumentsForTracks creates a tone synth per tone track', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);

    await engine.preloadInstrumentsForTracks([
      { id: 'A', sampleId: 'tone:fm-bass' },
      { id: 'B', sampleId: 'tone:membrane-kick' },
      { id: 'C', sampleId: 'sample:kick' }, // not a tone/advanced track
    ]);

    const reg = (engine as unknown as { toneSynthRegistry: { activeTrackIds(): string[] } }).toneSynthRegistry;
    const ids = reg.activeTrackIds().sort();
    expect(ids).toEqual(['A', 'B']);
  });

  it('preloadInstrumentsForTracks creates an advanced synth per advanced track', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);

    await engine.preloadInstrumentsForTracks([
      { id: 'A', sampleId: 'advanced:supersaw' },
      { id: 'B', sampleId: 'advanced:wobble-bass' },
    ]);

    const reg = (engine as unknown as { advancedSynthRegistry: { activeTrackIds(): string[] } }).advancedSynthRegistry;
    expect(reg.activeTrackIds().sort()).toEqual(['A', 'B']);
  });

  it('handles a mix of track types without blowing up', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);

    await engine.preloadInstrumentsForTracks([
      { id: 'A', sampleId: 'tone:fm-bass' },
      { id: 'B', sampleId: 'advanced:supersaw' },
      { id: 'C', sampleId: 'sample:kick' },
      { id: 'D', sampleId: 'sampled:piano' },
    ]);

    const tReg = (engine as unknown as { toneSynthRegistry: { activeTrackIds(): string[] } }).toneSynthRegistry;
    const aReg = (engine as unknown as { advancedSynthRegistry: { activeTrackIds(): string[] } }).advancedSynthRegistry;
    expect(tReg.activeTrackIds()).toEqual(['A']);
    expect(aReg.activeTrackIds()).toEqual(['B']);
  });

  it('skips tracks without id (preview path from SamplePicker)', async () => {
    const engine = new AudioEngine();
    stubEngineInternals(engine);

    await engine.preloadInstrumentsForTracks([
      { sampleId: 'tone:fm-bass' }, // no id → preview-style call, skip warm
    ]);

    const reg = (engine as unknown as { toneSynthRegistry: { activeTrackIds(): string[] } }).toneSynthRegistry;
    expect(reg.activeTrackIds()).toEqual([]);
  });
});
