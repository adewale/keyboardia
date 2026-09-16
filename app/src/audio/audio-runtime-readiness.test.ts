import { describe, expect, it, vi } from 'vitest';
import { AudioRuntimeReadiness } from './audio-runtime-readiness';

describe('AudioRuntimeReadiness', () => {
  it('makes the legal playback preparation path explicit', () => {
    const runtime = new AudioRuntimeReadiness();
    const generation = runtime.beginStart();

    expect(runtime.getState()).toEqual({ status: 'starting', generation });
    expect(runtime.markBaseReady(generation)).toBe(true);
    expect(runtime.beginPreparing(generation, ['sampled:piano', 'tone:fm-bass'])).toBe(true);
    expect(runtime.markReady(generation)).toBe(true);
    expect(runtime.getState()).toEqual({
      status: 'ready',
      generation,
      instruments: ['sampled:piano', 'tone:fm-bass'],
    });
  });

  it('rejects impossible transitions instead of manufacturing readiness', () => {
    const runtime = new AudioRuntimeReadiness();
    expect(() => runtime.markReady(0)).toThrow(/locked.*ready/i);
  });

  it('ignores completion from a disposed generation', () => {
    const runtime = new AudioRuntimeReadiness();
    const generation = runtime.beginStart();
    runtime.dispose();

    expect(runtime.markBaseReady(generation)).toBe(false);
    expect(runtime.getState()).toEqual({ status: 'disposed', generation: generation + 1 });
  });

  it('records failures with the stage and error without retaining the Error object', () => {
    const runtime = new AudioRuntimeReadiness();
    const generation = runtime.beginStart();
    const error = new Error('sample manifest failed');

    expect(runtime.fail(generation, 'starting', error)).toBe(true);
    expect(runtime.getState()).toEqual({
      status: 'failed',
      generation,
      stage: 'starting',
      message: 'sample manifest failed',
    });
  });

  it('notifies subscribers once per accepted transition', () => {
    const runtime = new AudioRuntimeReadiness();
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);
    const generation = runtime.beginStart();
    runtime.markBaseReady(generation);
    unsubscribe();
    runtime.beginPreparing(generation, []);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('releases subscribers on disposal', () => {
    const runtime = new AudioRuntimeReadiness();
    const listener = vi.fn();
    runtime.subscribe(listener);
    runtime.dispose();
    runtime.beginStart();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
