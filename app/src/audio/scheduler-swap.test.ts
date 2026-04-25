/**
 * Regression test for bug_005: live scheduler swap drops registered
 * callbacks (notably the metronome's onBeat).
 *
 * `upgradeToWorkletScheduler` reassigns the exported `scheduler`
 * binding. ES module live bindings keep `scheduler.method(...)` calls
 * pointing at the new instance — but callbacks already registered on
 * the OLD instance via `setOnBeat` / `setOnStepChange` are not
 * automatically migrated. With `setOnBeat` registered once in a
 * `useEffect([beatPulseDuration])`, the metronome silently dies when
 * the worklet flag flips.
 *
 * Fix: the upgrade function captures the old scheduler's callbacks
 * and re-applies them on the new one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock audio engine + worklet support so upgradeToWorkletScheduler can
// actually run in jsdom.
vi.mock('./engine', () => ({
  audioEngine: {
    isInitialized: () => true,
  },
}));

vi.mock('./worklet-support', async () => ({
  supportsAudioWorklet: () => true,
  loadWorkletModule: vi.fn(async () => true),
}));

vi.mock('../config/features', () => ({
  features: { workletScheduler: true },
}));

import { Scheduler, scheduler as exportedScheduler, upgradeToWorkletScheduler } from './scheduler';
import type { IScheduler } from './scheduler-types';

describe('Scheduler swap callback handoff (bug_005)', () => {
  beforeEach(() => {
    // Reset the exported binding to a fresh Scheduler before each test by
    // re-running the module would be ideal, but we can also just register
    // callbacks on the current instance and verify the swap copies them.
  });

  it('Scheduler exposes registered onBeat / onStepChange via getters', () => {
    const s = new Scheduler();
    const onBeat = vi.fn<(b: number) => void>();
    const onStep = vi.fn<(s: number) => void>();
    s.setOnBeat(onBeat);
    s.setOnStepChange(onStep);

    const sAny = s as unknown as { getOnBeat?: () => unknown; getOnStepChange?: () => unknown };
    expect(sAny.getOnBeat?.()).toBe(onBeat);
    expect(sAny.getOnStepChange?.()).toBe(onStep);
  });

  it('upgradeToWorkletScheduler re-registers the old scheduler\'s callbacks on the new instance', async () => {
    // Prepare: register callbacks on the current main-thread scheduler.
    const onBeat = vi.fn<(b: number) => void>();
    const onStep = vi.fn<(s: number) => void>();
    exportedScheduler.setOnBeat(onBeat);
    exportedScheduler.setOnStepChange(onStep);

    // jsdom has no AudioWorkletNode — stub it just for this test so the
    // SchedulerWorkletHost.initialize() path can run.
    class StubAudioWorkletNode {
      port = { onmessage: null as ((e: MessageEvent) => void) | null, postMessage: vi.fn() };
      connect = vi.fn();
      disconnect = vi.fn();
    }
    (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = StubAudioWorkletNode;

    const fakeCtx = {
      audioWorklet: { addModule: vi.fn(async () => {}) },
      currentTime: 0,
      state: 'running',
      sampleRate: 48000,
      destination: { connect: vi.fn() },
    } as unknown as AudioContext;

    const ok = await upgradeToWorkletScheduler(fakeCtx);
    expect(ok).toBe(true);

    // Re-import to get the new live binding value.
    const { scheduler: postSwapScheduler } = await import('./scheduler');
    const newAny = postSwapScheduler as unknown as IScheduler & {
      getOnBeat?: () => unknown;
      getOnStepChange?: () => unknown;
    };
    expect(newAny.getOnBeat?.()).toBe(onBeat);
    expect(newAny.getOnStepChange?.()).toBe(onStep);
  });
});
