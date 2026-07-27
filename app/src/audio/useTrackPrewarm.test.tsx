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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { GridState, Track } from '../types';
import { useTrackPrewarm } from './useTrackPrewarm';

const preload = vi.fn<(tracks: { id?: string; sampleId: string }[]) => Promise<void>>();

vi.mock('./engine', () => ({
  audioEngine: {
    preloadInstrumentsForTracks: (tracks: { id?: string; sampleId: string }[]) => preload(tracks),
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
});
