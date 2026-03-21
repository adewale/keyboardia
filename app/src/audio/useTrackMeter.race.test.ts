/**
 * Race condition test: useTrackMeter subscribes BEFORE metering worklet loads.
 *
 * Invariant: useTrackMeter must deliver level data regardless of whether
 * the metering worklet was available when the hook first mounted.
 *
 * This test reproduces the staging bug where:
 * 1. Component mounts → useTrackMeter runs → meteringHost.isAvailable() = false → no subscription
 * 2. Worklet loads later → meteringHost becomes available → no listeners → meters stay inactive
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrackMeter } from './useTrackMeter';
import { MeteringHost } from './metering-host';

// Mock rAF to fire synchronously — the hook uses rAF coalescing which
// doesn't flush in jsdom's act(). We're testing subscription logic, not rAF.
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(performance.now());
  return 1;
});
vi.stubGlobal('cancelAnimationFrame', vi.fn());

// We need to mock the meteringHost singleton used by the hook
vi.mock('./metering-host', async () => {
  const { MeteringHost } = await vi.importActual<typeof import('./metering-host')>('./metering-host');
  const mockHost = new MeteringHost();
  return {
    MeteringHost,
    meteringHost: mockHost,
  };
});

async function getMockHost(): Promise<MeteringHost> {
  const mod = await import('./metering-host');
  return mod.meteringHost;
}

function resetHost(host: MeteringHost) {
  const h = host as unknown as {
    node: unknown;
    moduleLoaded: boolean;
    listeners: Set<unknown>;
    readyListeners: Set<unknown>;
    levels: Map<unknown, unknown>;
    trackIdByIndex: Map<unknown, unknown>;
    indexByTrackId: Map<unknown, unknown>;
  };
  h.node = null;
  h.moduleLoaded = false;
  h.listeners.clear();
  h.readyListeners.clear();
  h.levels.clear();
  h.trackIdByIndex.clear();
  h.indexByTrackId.clear();
}

function makeHostAvailable(host: MeteringHost) {
  const h = host as unknown as {
    node: unknown;
    moduleLoaded: boolean;
    readyListeners: Set<() => void>;
  };
  h.moduleLoaded = true;
  h.node = { disconnect: vi.fn() };
  // Fire ready listeners (simulating what initialize() does)
  for (const cb of h.readyListeners) {
    cb();
  }
  h.readyListeners.clear();
}

function simulateMeterData(host: MeteringHost, trackId: string, rms: number) {
  const h = host as unknown as {
    levels: Map<string, { rms: number; peak: number; clipping: boolean }>;
    listeners: Set<(levels: Map<string, { rms: number; peak: number; clipping: boolean }>) => void>;
  };
  h.levels.set(trackId, { rms, peak: rms * 1.5, clipping: rms > 0.9 });
  for (const listener of h.listeners) {
    listener(h.levels);
  }
}

describe('useTrackMeter race condition', () => {
  let host: MeteringHost;

  beforeEach(async () => {
    host = await getMockHost();
    resetHost(host);
  });

  it('hook subscribes when worklet is already available at mount time', () => {
    makeHostAvailable(host);
    expect(host.isAvailable()).toBe(true);

    const { result } = renderHook(() => useTrackMeter('track-1'));
    expect(result.current).toBeNull(); // No data yet

    // Send data
    act(() => simulateMeterData(host, 'track-1', 0.5));
    expect(result.current).not.toBeNull();
    expect(result.current!.rms).toBe(0.5);
  });

  it('hook subscribes when worklet loads AFTER mount', () => {
    // Step 1: Mount hook while metering is NOT available
    expect(host.isAvailable()).toBe(false);
    const { result } = renderHook(() => useTrackMeter('track-1'));
    expect(result.current).toBeNull();

    // Step 2: Worklet becomes available
    act(() => makeHostAvailable(host));
    expect(host.isAvailable()).toBe(true);

    // Step 3: Verify hook is now subscribed
    const listenerCount = (host as unknown as { listeners: Set<unknown> }).listeners.size;
    expect(listenerCount).toBe(1);

    // Step 4: Send data — hook should receive it
    act(() => simulateMeterData(host, 'track-1', 0.42));
    expect(result.current).not.toBeNull();
    expect(result.current!.rms).toBe(0.42);
  });

  it('hook cleans up on unmount even if worklet has not loaded', () => {
    expect(host.isAvailable()).toBe(false);
    const { unmount } = renderHook(() => useTrackMeter('track-1'));

    // Ready listener should be registered
    const readyListeners = (host as unknown as { readyListeners: Set<unknown> }).readyListeners;
    expect(readyListeners.size).toBe(1);

    // Unmount should clean up
    unmount();
    expect(readyListeners.size).toBe(0);
  });

  it('hook cleans up on unmount after worklet loaded', () => {
    makeHostAvailable(host);
    const { unmount } = renderHook(() => useTrackMeter('track-1'));

    const listeners = (host as unknown as { listeners: Set<unknown> }).listeners;
    expect(listeners.size).toBe(1);

    unmount();
    expect(listeners.size).toBe(0);
  });

  it('shallow equality prevents re-renders on identical data', () => {
    makeHostAvailable(host);
    const { result } = renderHook(() => useTrackMeter('track-1'));

    act(() => simulateMeterData(host, 'track-1', 0.5));
    const first = result.current;

    // Same values again — should return same reference
    act(() => simulateMeterData(host, 'track-1', 0.5));
    expect(result.current).toBe(first); // Same object reference
  });
});
