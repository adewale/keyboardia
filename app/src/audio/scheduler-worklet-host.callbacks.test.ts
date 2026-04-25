/**
 * Regression test for #1: SchedulerWorkletHost fired onStepChange and
 * onBeat the moment a worklet message arrived, but the worklet posts
 * messages up to 150 ms ahead of audio time. The playhead and
 * metronome pulse advanced too early.
 *
 * Fix: delay the callback by `event.time - audioContext.currentTime`
 * via setTimeout, tracked in pendingTimers so stop() can clear them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./engine', () => ({
  audioEngine: { isInitialized: () => true },
}));

import { SchedulerWorkletHost } from './scheduler-worklet-host';

interface MockNode {
  port: { onmessage: ((e: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn<(...a: unknown[]) => void>> };
  disconnect(): void;
  connect(): void;
}

function setupHost(): { host: SchedulerWorkletHost; mockCtx: { currentTime: number } } {
  const host = new SchedulerWorkletHost();
  const mockCtx = { currentTime: 10.0 };
  const mockNode: MockNode = {
    port: { onmessage: null, postMessage: vi.fn<(...a: unknown[]) => void>() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  (host as unknown as { node: unknown }).node = mockNode;
  (host as unknown as { audioContext: unknown }).audioContext = mockCtx;
  (host as unknown as { isRunning: boolean }).isRunning = true;
  return { host, mockCtx };
}

function dispatch(host: SchedulerWorkletHost, event: unknown): void {
  (host as unknown as { handleEvent: (e: unknown) => void }).handleEvent(event);
}

describe('Worklet host UI-callback timing (#1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does NOT fire onStepChange immediately when event.time is in the future', () => {
    const { host, mockCtx } = setupHost();
    const onStep = vi.fn<(s: number) => void>();
    host.setOnStepChange(onStep);
    mockCtx.currentTime = 10.0;

    // Worklet sends a step event for 150ms ahead of now.
    dispatch(host, { type: 'step', step: 3, time: 10.150 });

    // It MUST NOT have been called yet (was the bug).
    expect(onStep).not.toHaveBeenCalled();

    // After 150 ms the timer fires.
    vi.advanceTimersByTime(150);
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledWith(3);
  });

  it('does NOT fire onBeat immediately when event.time is in the future', () => {
    const { host, mockCtx } = setupHost();
    const onBeat = vi.fn<(b: number) => void>();
    host.setOnBeat(onBeat);
    mockCtx.currentTime = 10.0;

    dispatch(host, { type: 'beat', beat: 1, time: 10.075 });
    expect(onBeat).not.toHaveBeenCalled();

    vi.advanceTimersByTime(75);
    expect(onBeat).toHaveBeenCalledWith(1);
  });

  it('fires synchronously when event.time has already passed (defensive)', () => {
    const { host, mockCtx } = setupHost();
    const onStep = vi.fn<(s: number) => void>();
    host.setOnStepChange(onStep);
    mockCtx.currentTime = 10.0;

    dispatch(host, { type: 'step', step: 4, time: 9.95 }); // already late
    vi.advanceTimersByTime(0); // run any 0ms timer
    expect(onStep).toHaveBeenCalledWith(4);
  });

  it('stop() cancels pending UI callback timers', () => {
    const { host, mockCtx } = setupHost();
    const onStep = vi.fn<(s: number) => void>();
    const onBeat = vi.fn<(b: number) => void>();
    host.setOnStepChange(onStep);
    host.setOnBeat(onBeat);
    mockCtx.currentTime = 10.0;

    dispatch(host, { type: 'step', step: 5, time: 10.100 });
    dispatch(host, { type: 'beat', beat: 2, time: 10.100 });

    host.stop();
    vi.advanceTimersByTime(500);

    expect(onStep).not.toHaveBeenCalled();
    expect(onBeat).not.toHaveBeenCalled();
  });
});
