import { describe, expect, it, vi } from 'vitest';
import { scheduleAudioClockCleanup } from './audio-clock-cleanup';

describe('audio-clock cleanup', () => {
  it('uses an audio scheduled source and no wall-clock timer', () => {
    const cleanup = vi.fn();
    const sentinel = {
      buffer: null as AudioBuffer | null,
      onended: null as (() => void) | null,
      start: vi.fn(),
      disconnect: vi.fn(),
    };
    const context = {
      currentTime: 4,
      sampleRate: 48_000,
      createBufferSource: () => sentinel,
      createBuffer: vi.fn(() => ({}) as AudioBuffer),
    } as unknown as AudioContext;
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const result = scheduleAudioClockCleanup(context, 4.25, cleanup);
    expect(result).toBe(sentinel);
    expect(sentinel.start).toHaveBeenCalledWith(4.25);
    expect(timer).not.toHaveBeenCalled();
    sentinel.onended?.();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(sentinel.disconnect).toHaveBeenCalledOnce();
    timer.mockRestore();
  });
});
