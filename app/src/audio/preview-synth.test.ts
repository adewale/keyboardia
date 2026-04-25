/**
 * Regression test for merged_bug_002: preview path silent first-note + leak.
 *
 * Previewing tone:* / advanced:* from the SamplePicker (no trackId)
 * previously routed through the per-track registry under a hardcoded
 * '__preview__' id. Two defects:
 *   (a) First preview was silent — getIfReady('__preview__') returned
 *       null, the code kicked off async creation and returned without
 *       playing.
 *   (b) The lazily-created bus + metering slot for '__preview__' was
 *       never reclaimed, leaking one of 16 slots per session.
 *
 * Fix: maintain a single eagerly-created shared preview synth per
 * category, statically connected to the effects chain (no track bus,
 * no metering slot), and dispatch trackId-less previews to it
 * synchronously.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toneInstances: Array<{ playNoteSpy: ReturnType<typeof vi.fn<(...a: unknown[]) => void>>; output: { connect: ReturnType<typeof vi.fn<(...a: unknown[]) => void>> } }> = [];
const advancedInstances: Array<{ playNoteSpy: ReturnType<typeof vi.fn<(...a: unknown[]) => void>>; output: { connect: ReturnType<typeof vi.fn<(...a: unknown[]) => void>> } }> = [];

vi.mock('./toneSynths', async () => {
  const actual = await vi.importActual<typeof import('./toneSynths')>('./toneSynths');
  class MockToneSynthManager {
    private out = { connect: vi.fn<(...a: unknown[]) => void>() };
    private playNoteSpy = vi.fn<(...a: unknown[]) => void>();
    constructor() {
      toneInstances.push({ playNoteSpy: this.playNoteSpy, output: this.out });
    }
    async initialize(): Promise<void> {}
    isReady(): boolean { return true; }
    getOutput(): { connect: (...a: unknown[]) => void } { return this.out; }
    playNote(...a: unknown[]): void { this.playNoteSpy(...a); }
    semitoneToNoteName(s: number): string { return `n${s}`; }
    getPresetNames(): string[] { return []; }
    setFMParams(): void {}
    getFMParams(): null { return null; }
    dispose(): void {}
  }
  return { ...actual, ToneSynthManager: MockToneSynthManager };
});

vi.mock('./advancedSynth', async () => {
  const actual = await vi.importActual<typeof import('./advancedSynth')>('./advancedSynth');
  class MockAdvancedSynthEngine {
    private out = { connect: vi.fn<(...a: unknown[]) => void>() };
    private playNoteSpy = vi.fn<(...a: unknown[]) => void>();
    constructor() {
      advancedInstances.push({ playNoteSpy: this.playNoteSpy, output: this.out });
    }
    async initialize(): Promise<void> {}
    isReady(): boolean { return true; }
    getOutput(): { connect: (...a: unknown[]) => void } { return this.out; }
    setPreset(): void {}
    playNoteSemitone(...a: unknown[]): void { this.playNoteSpy(...a); }
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

async function makePreparedEngine(): Promise<{ engine: AudioEngine; busLookups: { count: number } }> {
  const engine = new AudioEngine();
  const fakeCtx = { currentTime: 0, state: 'running', sampleRate: 48000 };
  (engine as unknown as { audioContext: unknown }).audioContext = fakeCtx;
  (engine as unknown as { initialized: boolean }).initialized = true;
  (engine as unknown as { toneInitialized: boolean }).toneInitialized = true;
  // toneEffects has a getInput() that the shared preview synth will connect to.
  const fakeEffectsInput = { connect: vi.fn(), disconnect: vi.fn() };
  (engine as unknown as { toneEffects: unknown }).toneEffects = {
    getInput: () => fakeEffectsInput,
  };
  // TrackBusManager: count getBusInput calls so we can detect a leak.
  const busLookups = { count: 0 };
  (engine as unknown as { trackBusManager: unknown }).trackBusManager = {
    getBusInput: (_id: string) => {
      busLookups.count++;
      return { connect: vi.fn(), disconnect: vi.fn() };
    },
  };
  // Pre-create the shared preview instances exactly the way initializeTone
  // would. The test owns this side-effect so we can assert engine behavior
  // without running the full Tone.js init.
  await (engine as unknown as { ensurePreviewSynths: () => Promise<void> }).ensurePreviewSynths();
  return { engine, busLookups };
}

describe('Preview synth (merged_bug_002)', () => {
  beforeEach(() => {
    toneInstances.length = 0;
    advancedInstances.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('plays the FIRST tone preview synchronously (no silent first note)', async () => {
    const { engine } = await makePreparedEngine();
    engine.playToneSynth('fm-bass', 0, 0, 0.15);
    expect(toneInstances.length).toBeGreaterThanOrEqual(1);
    const calledOne = toneInstances.some(i => i.playNoteSpy.mock.calls.length === 1);
    expect(calledOne).toBe(true);
  });

  it('plays the FIRST advanced preview synchronously (no silent first note)', async () => {
    const { engine } = await makePreparedEngine();
    engine.playAdvancedSynth('supersaw', 0, 0, 0.15);
    expect(advancedInstances.length).toBeGreaterThanOrEqual(1);
    const calledOne = advancedInstances.some(i => i.playNoteSpy.mock.calls.length === 1);
    expect(calledOne).toBe(true);
  });

  it('does not create a __preview__ entry in the per-track registry', async () => {
    const { engine } = await makePreparedEngine();
    engine.playToneSynth('fm-bass', 0, 0, 0.15);
    engine.playAdvancedSynth('supersaw', 0, 0, 0.15);

    const toneIds = (engine as unknown as { toneSynthRegistry: { activeTrackIds(): string[] } }).toneSynthRegistry.activeTrackIds();
    const advIds = (engine as unknown as { advancedSynthRegistry: { activeTrackIds(): string[] } }).advancedSynthRegistry.activeTrackIds();
    expect(toneIds).not.toContain('__preview__');
    expect(advIds).not.toContain('__preview__');
  });

  it('does not consume a track bus / metering slot for previews', async () => {
    const { engine, busLookups } = await makePreparedEngine();
    busLookups.count = 0; // ignore bus lookups during preview-synth init
    engine.playToneSynth('fm-bass', 0, 0, 0.15);
    engine.playAdvancedSynth('supersaw', 0, 0, 0.15);
    engine.playToneSynth('fm-bass', 0, 0, 0.15);
    expect(busLookups.count).toBe(0);
  });

  it('reuses the same shared preview synth across many calls', async () => {
    const { engine } = await makePreparedEngine();
    const initialToneCount = toneInstances.length;
    for (let i = 0; i < 10; i++) {
      engine.playToneSynth('fm-bass', 0, 0, 0.15);
    }
    // No new instances created beyond the eager init.
    expect(toneInstances.length).toBe(initialToneCount);
  });
});
