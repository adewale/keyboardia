// @vitest-environment jsdom
/**
 * Regression test for #4: tone/advanced tracks added or changed
 * mid-playback dropped their first note because preloadInstrumentsForTracks
 * only ran at play-start.
 *
 * The hook keeps tone/advanced track instances pre-warmed by re-running
 * preload whenever the tracks list changes during playback. The
 * registry's getOrCreate is idempotent, so repeated calls for the same
 * trackId are no-ops.
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

describe('useTrackPrewarm (#4)', () => {
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

  it('skips prewarm when no tracks are tone/advanced', () => {
    const state = makeState([track('A', '808-kick'), track('B', 'sampled:piano')]);
    renderHook(() => useTrackPrewarm(state, true));
    expect(preload).not.toHaveBeenCalled();
  });
});