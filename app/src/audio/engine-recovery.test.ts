// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const toneHarness = vi.hoisted(() => ({
  rawContext: null as BaseAudioContext | null,
  acceptSetContext: true,
}));

vi.mock('tone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('tone')>();
  return {
    ...actual,
    start: vi.fn().mockResolvedValue(undefined),
    setContext: vi.fn((context: AudioContext) => {
      if (toneHarness.acceptSetContext) toneHarness.rawContext = context;
    }),
    getContext: vi.fn(() => ({
      state: toneHarness.rawContext?.state ?? 'suspended',
      rawContext: toneHarness.rawContext,
    })),
    getTransport: vi.fn(() => ({
      stop: vi.fn(),
      cancel: vi.fn(),
    })),
  };
});

import * as Tone from 'tone';
import { AudioEngine, waitForLiveAudioClock } from './engine';

type RecoveryEngine = {
  audioContext: AudioContext | null;
  toneInitialized: boolean;
  initializeTone(): Promise<void>;
  resumeAllAudioContexts(trigger: string): Promise<boolean>;
  attachUnlockListeners(): void;
  dispose(): void;
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  toneHarness.rawContext = null;
  toneHarness.acceptSetContext = true;
});

describe('audio-context recovery', () => {
  it('distinguishes a live audio clock from a parked running context', async () => {
    let currentTime = 2;
    const liveContext = {
      state: 'running',
      get currentTime() {
        currentTime += 0.01;
        return currentTime;
      },
    } as Pick<AudioContext, 'currentTime' | 'state'>;

    expect(await waitForLiveAudioClock(liveContext, 2, 1)).toBe(true);
    expect(await waitForLiveAudioClock({ state: 'running', currentTime: 2 }, 2, 1)).toBe(false);
  });

  it('fails closed instead of rebinding after initialized Tone nodes have a stale context', async () => {
    let state = 'interrupted';
    const context = {
      get state() { return state; },
      currentTime: 0,
      resume: vi.fn(async () => { state = 'running'; }),
    } as unknown as AudioContext;
    const staleToneContext = { state: 'suspended' } as BaseAudioContext;
    toneHarness.rawContext = staleToneContext;

    const engine = new AudioEngine() as unknown as RecoveryEngine;
    engine.audioContext = context;
    engine.toneInitialized = true;

    await expect(engine.resumeAllAudioContexts('test-mismatch')).resolves.toBe(false);
    expect(context.resume).not.toHaveBeenCalled();
    expect(Tone.setContext).not.toHaveBeenCalled();
    expect(Tone.start).not.toHaveBeenCalled();
    expect(toneHarness.rawContext).toBe(staleToneContext);
  });

  it('fails initial Tone setup when the context switch retry is refused', async () => {
    const context = {
      state: 'running',
      currentTime: 0,
      sampleRate: 44_100,
    } as unknown as AudioContext;
    const staleToneContext = {
      state: 'running',
      sampleRate: 48_000,
    } as BaseAudioContext;
    toneHarness.rawContext = staleToneContext;
    toneHarness.acceptSetContext = false;

    const engine = new AudioEngine() as unknown as RecoveryEngine;
    engine.audioContext = context;

    await expect(engine.initializeTone()).rejects.toThrow(/context switch failed/);
    expect(Tone.setContext).toHaveBeenCalledTimes(2);
    expect(Tone.start).toHaveBeenCalledTimes(2);
    expect(engine.toneInitialized).toBe(false);
    expect(toneHarness.rawContext).toBe(staleToneContext);
  });

  it('recovers interrupted native and Tone audio when they share one context', async () => {
    let state = 'interrupted';
    let currentTime = 0;
    const context = {
      get state() { return state; },
      get currentTime() {
        if (state === 'running') currentTime += 0.01;
        return currentTime;
      },
      resume: vi.fn(async () => { state = 'running'; }),
    } as unknown as AudioContext;
    toneHarness.rawContext = context;

    const engine = new AudioEngine() as unknown as RecoveryEngine;
    engine.audioContext = context;
    engine.toneInitialized = true;

    await expect(engine.resumeAllAudioContexts('test-interruption')).resolves.toBe(true);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(Tone.setContext).not.toHaveBeenCalled();
    expect(Tone.start).toHaveBeenCalledTimes(1);
  });

  it('retries a context that reports running while currentTime is parked', async () => {
    vi.useFakeTimers();
    let live = false;
    let currentTime = 4;
    const context = {
      state: 'running',
      get currentTime() {
        if (live) currentTime += 0.01;
        return currentTime;
      },
      resume: vi.fn(async () => { live = true; }),
    } as unknown as AudioContext;

    const engine = new AudioEngine() as unknown as RecoveryEngine;
    engine.audioContext = context;

    const recovery = engine.resumeAllAudioContexts('test-parked-clock');
    await vi.runAllTimersAsync();

    await expect(recovery).resolves.toBe(true);
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it('attempts recovery when an interrupted visible page changes state', async () => {
    const stateListeners: Array<() => void> = [];
    const context = {
      state: 'interrupted',
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === 'statechange') stateListeners.push(listener);
      }),
      removeEventListener: vi.fn(),
    } as unknown as AudioContext;
    const engine = new AudioEngine() as unknown as RecoveryEngine;
    engine.audioContext = context;
    const recover = vi.spyOn(engine, 'resumeAllAudioContexts').mockResolvedValue(true);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    engine.attachUnlockListeners();
    expect(stateListeners).toHaveLength(1);
    stateListeners[0]();
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(recover).toHaveBeenCalledWith('statechange');
    expect(recover).toHaveBeenCalledWith('visibilitychange');
    engine.dispose();
    expect(context.removeEventListener).toHaveBeenCalledWith('statechange', expect.any(Function));
  });
});
