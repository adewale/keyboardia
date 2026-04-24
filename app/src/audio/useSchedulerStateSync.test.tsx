/**
 * Tests for useSchedulerStateSync — the hook that forwards grid-state
 * mutations to the scheduler while playback is running.
 *
 * The worklet scheduler holds a serialized copy of the grid state and
 * cannot call back into the main thread on every tick the way the
 * main-thread scheduler does. Without an explicit push, live edits
 * (track toggles, tempo, swing, loopRegion) never reach the worklet
 * and playback continues against stale state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { GridState } from '../types';
import { useSchedulerStateSync } from './useSchedulerStateSync';

function makeState(overrides: Partial<GridState> = {}): GridState {
  return {
    tempo: 120,
    swing: 0,
    tracks: [],
    loopRegion: null,
    ...(overrides as unknown as GridState),
  } as unknown as GridState;
}

describe('useSchedulerStateSync', () => {
  let scheduler: { updateState: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    scheduler = { updateState: vi.fn() };
  });

  it('does not call updateState when paused', () => {
    const state = makeState();
    renderHook(() => useSchedulerStateSync(scheduler, state, false));
    expect(scheduler.updateState).not.toHaveBeenCalled();
  });

  it('does not call updateState on the initial playing render (start() already sent the state)', () => {
    // When isPlaying flips from false → true, scheduler.start() has already
    // serialized the current state. Firing updateState right away would just
    // be a redundant re-post.
    const state = makeState();
    renderHook(
      ({ s, playing }) => useSchedulerStateSync(scheduler, s, playing),
      { initialProps: { s: state, playing: true } }
    );
    expect(scheduler.updateState).not.toHaveBeenCalled();
  });

  it('calls updateState whenever state changes while playing', () => {
    const s1 = makeState({ tempo: 120 });
    const s2 = makeState({ tempo: 140 });

    const { rerender } = renderHook(
      ({ s, playing }: { s: GridState; playing: boolean }) =>
        useSchedulerStateSync(scheduler, s, playing),
      { initialProps: { s: s1, playing: true } }
    );

    expect(scheduler.updateState).not.toHaveBeenCalled();

    rerender({ s: s2, playing: true });
    expect(scheduler.updateState).toHaveBeenCalledTimes(1);
    expect(scheduler.updateState).toHaveBeenLastCalledWith(s2);
  });

  it('does not call updateState after playback stops', () => {
    const s1 = makeState({ tempo: 120 });
    const s2 = makeState({ tempo: 140 });

    const { rerender } = renderHook(
      ({ s, playing }: { s: GridState; playing: boolean }) =>
        useSchedulerStateSync(scheduler, s, playing),
      { initialProps: { s: s1, playing: true } }
    );

    rerender({ s: s1, playing: false });
    scheduler.updateState.mockClear();

    rerender({ s: s2, playing: false });
    expect(scheduler.updateState).not.toHaveBeenCalled();
  });

  it('tolerates a scheduler that does not implement updateState', () => {
    const bareScheduler = {} as { updateState?: (s: GridState) => void };
    const { rerender } = renderHook(
      ({ s, playing }: { s: GridState; playing: boolean }) =>
        useSchedulerStateSync(bareScheduler, s, playing),
      { initialProps: { s: makeState({ tempo: 120 }), playing: true } }
    );
    // No throw on rerender with a different state:
    expect(() => rerender({ s: makeState({ tempo: 140 }), playing: true })).not.toThrow();
  });
});
