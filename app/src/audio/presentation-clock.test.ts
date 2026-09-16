import { describe, expect, it, vi } from 'vitest';
import { audioTime, type AudioClock } from './audio-time';
import {
  PresentationClock,
  type PresentationFrameSource,
} from './presentation-clock';

function harness() {
  let now = 10;
  let nextHandle = 1;
  const frames = new Map<number, () => void>();
  const audioClock: AudioClock = { now: () => audioTime(now) };
  const frameSource: PresentationFrameSource = {
    request: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancel: (handle) => { frames.delete(handle); },
  };
  const clock = new PresentationClock(audioClock, frameSource);
  return {
    clock,
    setNow: (value: number) => { now = value; },
    frame: () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback());
    },
    frameCount: () => frames.size,
  };
}

describe('PresentationClock', () => {
  it('fires from AudioContext position rather than wall-clock delay', () => {
    const h = harness();
    const callback = vi.fn();
    h.clock.schedule('step', audioTime(10.1), callback);

    h.frame();
    expect(callback).not.toHaveBeenCalled();
    h.setNow(10.1);
    h.frame();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('coalesces overdue visual events to the newest state per channel', () => {
    const h = harness();
    const callbacks = [vi.fn(), vi.fn(), vi.fn()];
    h.clock.schedule('step', audioTime(10.1), callbacks[0]);
    h.clock.schedule('step', audioTime(10.2), callbacks[1]);
    h.clock.schedule('step', audioTime(10.3), callbacks[2]);
    h.setNow(10.3);
    h.frame();

    expect(callbacks[0]).not.toHaveBeenCalled();
    expect(callbacks[1]).not.toHaveBeenCalled();
    expect(callbacks[2]).toHaveBeenCalledOnce();
  });

  it('bounds retained callbacks while frames are throttled', () => {
    const h = harness();
    for (let index = 0; index < 100; index++) {
      h.clock.schedule('step', audioTime(11 + index / 10), vi.fn());
    }
    expect(h.clock.pendingCount).toBeLessThanOrEqual(8);
  });

  it('cancels the frame and releases callbacks on clear', () => {
    const h = harness();
    h.clock.schedule('beat', audioTime(11), vi.fn());
    expect(h.frameCount()).toBe(1);
    h.clock.clear();
    expect(h.clock.pendingCount).toBe(0);
    expect(h.frameCount()).toBe(0);
  });
});
