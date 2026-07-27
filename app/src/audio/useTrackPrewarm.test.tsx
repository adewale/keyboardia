// @vitest-environment jsdom
/**
 * Regression tests for instruments added or changed mid-playback. Every
 * instrument family whose scheduler hot path requires readiness must cross
 * preloadInstrumentsForTracks when it first appears in live grid state.
 *
 * The hook keeps readiness-gated sampled/tone/advanced instruments warm by
 * re-running preload whenever their live track membership changes during
 * playback. The registries are idempotent, so repeated calls are cheap.
 */
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { GridState, Track } from '../types';
import { useTrackPrewarm } from './useTrackPrewarm';

const preload = vi.fn<(tracks: { id?: string; sampleId: string }[]) => Promise<void>>();
const sampledReady = vi.fn<(instrumentId: string) => boolean>();

vi.mock('./engine', () => ({
  audioEngine: {
    preloadInstrumentsForTracks: (tracks: { id?: string; sampleId: string }[]) => preload(tracks),
    isSampledInstrumentReady: (instrumentId: string) => sampledReady(instrumentId),
  },
}));

function makeState(tracks: Track[]): GridState {
  return { tracks, tempo: 120, swing: 0, loopRegion: null } as unknown as GridState;
}

function track(id: string, sampleId: string): Track {
  return { id, sampleId } as unknown as Track;
}

describe('useTrackPrewarm', () => {
  beforeEach(() => {
    preload.mockClear();
    preload.mockImplementation(async () => {});
    sampledReady.mockReset();
    sampledReady.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not prewarm when paused', () => {
    const state = makeState([track('A', 'tone:fm-bass')]);
    renderHook(() => useTrackPrewarm(state, false));
    expect(preload).not.toHaveBeenCalled();
  });

  it('prewarms once on the first render while playing', () => {
    const state = makeState([track('A', 'tone:fm-bass')]);
    renderHook(() => useTrackPrewarm(state, true));
    expect(preload).toHaveBeenCalledTimes(1);
    expect(preload.mock.calls[0][0]).toEqual([{ id: 'A', sampleId: 'tone:fm-bass' }]);
  });

  it('re-prewarms when a NEW tone track is added during playback', () => {
    const s1 = makeState([track('A', 'tone:fm-bass')]);
    const s2 = makeState([track('A', 'tone:fm-bass'), track('B', 'advanced:supersaw')]);
    const { rerender } = renderHook(
      ({ s }: { s: GridState }) => useTrackPrewarm(s, true),
      { initialProps: { s: s1 } },
    );
    expect(preload).toHaveBeenCalledTimes(1);

    rerender({ s: s2 });
    expect(preload).toHaveBeenCalledTimes(2);
    expect(preload.mock.calls[1][0]).toEqual([
      { id: 'A', sampleId: 'tone:fm-bass' },
      { id: 'B', sampleId: 'advanced:supersaw' },
    ]);
  });

  it('re-prewarms when an EXISTING track changes its sampleId to tone/advanced', () => {
    const s1 = makeState([track('A', '808-kick')]);
    const s2 = makeState([track('A', 'advanced:wobble-bass')]);
    const { rerender } = renderHook(
      ({ s }: { s: GridState }) => useTrackPrewarm(s, true),
      { initialProps: { s: s1 } },
    );
    // No tone/advanced tracks initially — no warm yet.
    expect(preload).not.toHaveBeenCalled();

    rerender({ s: s2 });
    expect(preload).toHaveBeenCalledTimes(1);
    expect(preload.mock.calls[0][0]).toEqual([{ id: 'A', sampleId: 'advanced:wobble-bass' }]);
  });

  it('does NOT re-prewarm when tracks list reference changes but contents are identical', () => {
    const t1 = track('A', 'tone:fm-bass');
    const s1 = makeState([t1]);
    const s2 = makeState([{ ...t1 }]); // new array, same id+sampleId
    const { rerender } = renderHook(
      ({ s }: { s: GridState }) => useTrackPrewarm(s, true),
      { initialProps: { s: s1 } },
    );
    rerender({ s: s2 });
    // Idempotent diff: only the initial call counts.
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('skips prewarm when every track is an immediately playable plain sample', () => {
    const state = makeState([track('A', '808-kick'), track('B', 'snare')]);
    renderHook(() => useTrackPrewarm(state, true));
    expect(preload).not.toHaveBeenCalled();
  });

  it('prewarms a sampled track arriving through MCP during playback exactly once', () => {
    const beforeMcpEdit = makeState([track('existing-kick', 'kick')]);
    const afterMcpEdit = makeState([
      track('existing-kick', 'kick'),
      track('mcp-brush-snare', 'sampled:brushes-snare'),
    ]);
    const afterSoloToggle = makeState([
      track('existing-kick', 'kick'),
      { ...track('mcp-brush-snare', 'sampled:brushes-snare'), soloed: true } as Track,
    ]);

    const { rerender } = renderHook(
      ({ s }: { s: GridState }) => useTrackPrewarm(s, true),
      { initialProps: { s: beforeMcpEdit } },
    );

    rerender({ s: afterMcpEdit });
    expect(preload).toHaveBeenCalledTimes(1);
    expect(preload).toHaveBeenLastCalledWith([
      { id: 'existing-kick', sampleId: 'kick' },
      { id: 'mcp-brush-snare', sampleId: 'sampled:brushes-snare' },
    ]);

    rerender({ s: afterSoloToggle });

    // A mix-only change must not refetch or rebuild an already-warming
    // instrument. The relevant id/sampleId membership did not change.
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('distinguishes valid REST memberships containing signature delimiters', () => {
    const beforeRestEdit = makeState([
      track('x:sampled:alto-sax|y', 'sampled:piano'),
    ]);
    const afterRestEdit = makeState([
      track('x', 'sampled:alto-sax'),
      track('y', 'sampled:piano'),
    ]);

    const { rerender } = renderHook(
      ({ s }: { s: GridState }) => useTrackPrewarm(s, true),
      { initialProps: { s: beforeRestEdit } },
    );
    rerender({ s: afterRestEdit });

    expect(preload).toHaveBeenCalledTimes(2);
    expect(preload).toHaveBeenLastCalledWith(afterRestEdit.tracks);
  });

  it('re-establishes retry ownership after StrictMode replays an active mount', async () => {
    vi.useFakeTimers();
    sampledReady.mockReturnValue(false);
    const state = makeState([
      track('mcp-brush-snare', 'sampled:brushes-snare'),
    ]);

    renderHook(() => useTrackPrewarm(state, true), { wrapper: StrictMode });

    await act(async () => {
      await Promise.resolve();
    });
    // StrictMode runs setup, cleanup, then setup again. The replayed setup must
    // own a live generation rather than inheriting the cancelled signature.
    expect(preload).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(preload).toHaveBeenCalledTimes(3);
  });

  it('retries the same sampled membership after a transient preload failure', async () => {
    vi.useFakeTimers();
    sampledReady.mockReturnValueOnce(false).mockReturnValue(true);
    const state = makeState([
      track('mcp-brush-snare', 'sampled:brushes-snare'),
    ]);

    renderHook(() => useTrackPrewarm(state, true));

    await act(async () => {
      await Promise.resolve();
    });
    expect(preload).toHaveBeenCalledTimes(1);
    expect(sampledReady).toHaveBeenCalledWith('brushes-snare');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(preload).toHaveBeenCalledTimes(2);
  });

  it('retries when the preloader rejects', async () => {
    vi.useFakeTimers();
    preload
      .mockRejectedValueOnce(new Error('transient preload rejection'))
      .mockResolvedValue(undefined);
    const state = makeState([
      track('mcp-brush-snare', 'sampled:brushes-snare'),
    ]);

    renderHook(() => useTrackPrewarm(state, true));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(preload).toHaveBeenCalledTimes(2);
  });

  it('uses exactly three bounded retries at 250ms, 1s, and 4s', async () => {
    vi.useFakeTimers();
    sampledReady.mockReturnValue(false);
    const state = makeState([
      track('mcp-brush-snare', 'sampled:brushes-snare'),
    ]);

    renderHook(() => useTrackPrewarm(state, true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(preload).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(preload).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(preload).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(preload).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(preload).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_999);
    });
    expect(preload).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(preload).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(preload).toHaveBeenCalledTimes(4);
  });

  it('cancels a pending retry when playback stops', async () => {
    vi.useFakeTimers();
    sampledReady.mockReturnValue(false);
    const state = makeState([
      track('mcp-brush-snare', 'sampled:brushes-snare'),
    ]);
    const { rerender } = renderHook(
      ({ playing }: { playing: boolean }) => useTrackPrewarm(state, playing),
      { initialProps: { playing: true } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(preload).toHaveBeenCalledTimes(1);

    rerender({ playing: false });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending retry when the hook unmounts', async () => {
    vi.useFakeTimers();
    sampledReady.mockReturnValue(false);
    const state = makeState([
      track('mcp-brush-snare', 'sampled:brushes-snare'),
    ]);
    const { unmount } = renderHook(() => useTrackPrewarm(state, true));

    await act(async () => {
      await Promise.resolve();
    });
    expect(preload).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(preload).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the obsolete retry when readiness-gated membership changes', async () => {
    vi.useFakeTimers();
    sampledReady.mockReturnValue(false);
    const brushes = makeState([
      track('sampled-track', 'sampled:brushes-snare'),
    ]);
    const altoSax = makeState([
      track('sampled-track', 'sampled:alto-sax'),
    ]);
    const { rerender } = renderHook(
      ({ s }: { s: GridState }) => useTrackPrewarm(s, true),
      { initialProps: { s: brushes } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(preload).toHaveBeenCalledTimes(1);

    sampledReady.mockImplementation(instrumentId => instrumentId === 'alto-sax');
    rerender({ s: altoSax });
    await act(async () => {
      await Promise.resolve();
      await vi.runAllTimersAsync();
    });

    expect(preload).toHaveBeenCalledTimes(2);
    expect(preload).toHaveBeenLastCalledWith(altoSax.tracks);
    expect(vi.getTimerCount()).toBe(0);
  });
});
