// @vitest-environment jsdom
/**
 * Change Instrument (issue #63): audio engine reconciliation.
 *
 * The reconciler reads session state, not events, so that a collaborator's
 * change and an MCP agent's change get the same treatment as a local click.
 * These tests exist mostly to pin that: an event-based implementation would
 * pass the "local" case and silently fail the other two.
 *
 * See specs/CHANGE-INSTRUMENT.md §8.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { GridState, Track } from '../types';
import { useTrackInstrumentReconcile } from './useTrackInstrumentReconcile';

vi.mock('./engine', () => ({
  audioEngine: { clearTrackSynths: vi.fn() },
}));
vi.mock('./prepare-instrument', () => ({
  prepareInstrument: vi.fn(),
}));

const { audioEngine } = await import('./engine');
const { prepareInstrument } = await import('./prepare-instrument');

function track(id: string, sampleId: string): Track {
  return {
    id,
    name: id,
    sampleId,
    steps: Array(128).fill(false),
    parameterLocks: Array(128).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
  };
}

function state(...tracks: Track[]): GridState {
  return {
    tracks,
    tempo: 120,
    swing: 0,
    isPlaying: false,
    currentStep: -1,
  } as GridState;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useTrackInstrumentReconcile', () => {
  it('rebuilds a track\'s synth when its instrument changes', () => {
    const { rerender } = renderHook(
      ({ value }: { value: GridState }) => useTrackInstrumentReconcile(value),
      { initialProps: { value: state(track('a', 'tone:fm-bass')) } },
    );

    rerender({ value: state(track('a', 'tone:fm-bell')) });

    expect(audioEngine.clearTrackSynths).toHaveBeenCalledWith('a');
    expect(prepareInstrument).toHaveBeenCalledWith('tone:fm-bell', 'a');
  });

  it('does nothing on first observation of an existing session', () => {
    // Opening a session must not dispose synths that were just built for it.
    renderHook(() => useTrackInstrumentReconcile(
      state(track('a', 'tone:fm-bass'), track('b', 'kick')),
    ));

    expect(audioEngine.clearTrackSynths).not.toHaveBeenCalled();
    expect(prepareInstrument).not.toHaveBeenCalled();
  });

  it('does nothing for a newly added track', () => {
    // The add-track path already preloads; clearing here would undo it.
    const { rerender } = renderHook(
      ({ value }: { value: GridState }) => useTrackInstrumentReconcile(value),
      { initialProps: { value: state(track('a', 'kick')) } },
    );

    rerender({ value: state(track('a', 'kick'), track('b', 'tone:fm-bell')) });

    expect(audioEngine.clearTrackSynths).not.toHaveBeenCalled();
    expect(prepareInstrument).not.toHaveBeenCalled();
  });

  it('does nothing when unrelated track fields change', () => {
    const before = track('a', 'kick');
    const after = { ...track('a', 'kick'), volume: 0.3, transpose: 5 };

    const { rerender } = renderHook(
      ({ value }: { value: GridState }) => useTrackInstrumentReconcile(value),
      { initialProps: { value: state(before) } },
    );
    rerender({ value: state(after) });

    expect(audioEngine.clearTrackSynths).not.toHaveBeenCalled();
  });

  it('reconciles a change that arrived from a collaborator or an agent', () => {
    // Indistinguishable from a local change at this layer, which is the point:
    // the reducer applies a remote broadcast and an MCP-driven snapshot the
    // same way, so both reach the engine through this hook.
    const { rerender } = renderHook(
      ({ value }: { value: GridState }) => useTrackInstrumentReconcile(value),
      { initialProps: { value: state(track('remote-1', 'advanced:supersaw')) } },
    );

    rerender({ value: state(track('remote-1', 'sampled:808-kick')) });

    expect(audioEngine.clearTrackSynths).toHaveBeenCalledWith('remote-1');
    expect(prepareInstrument).toHaveBeenCalledWith('sampled:808-kick', 'remote-1');
  });

  it('reconciles every track that changed in one update', () => {
    const { rerender } = renderHook(
      ({ value }: { value: GridState }) => useTrackInstrumentReconcile(value),
      {
        initialProps: {
          value: state(track('a', 'kick'), track('b', 'snare'), track('c', 'hihat')),
        },
      },
    );

    rerender({
      value: state(track('a', 'clap'), track('b', 'snare'), track('c', 'tom')),
    });

    expect(audioEngine.clearTrackSynths).toHaveBeenCalledWith('a');
    expect(audioEngine.clearTrackSynths).toHaveBeenCalledWith('c');
    expect(audioEngine.clearTrackSynths).not.toHaveBeenCalledWith('b');
    expect(audioEngine.clearTrackSynths).toHaveBeenCalledTimes(2);
  });

  it('does not fire for a deleted track, and treats a reused ID as new', () => {
    // handleDeleteTrack already disposes via removeTrackGain. A stale entry
    // here would clear synths for a track that no longer exists, and would
    // misread a recreated ID as a change.
    const { rerender } = renderHook(
      ({ value }: { value: GridState }) => useTrackInstrumentReconcile(value),
      { initialProps: { value: state(track('a', 'kick')) } },
    );

    rerender({ value: state() });
    expect(audioEngine.clearTrackSynths).not.toHaveBeenCalled();

    rerender({ value: state(track('a', 'snare')) });
    expect(audioEngine.clearTrackSynths).not.toHaveBeenCalled();
    expect(prepareInstrument).not.toHaveBeenCalled();
  });

  it('reconciles a change that follows a reconnect snapshot', () => {
    const { rerender } = renderHook(
      ({ value }: { value: GridState }) => useTrackInstrumentReconcile(value),
      { initialProps: { value: state(track('a', 'kick')) } },
    );

    // A snapshot replaces the whole tracks array with new object identities.
    rerender({ value: state(track('a', 'tone:fm-bell')) });

    expect(audioEngine.clearTrackSynths).toHaveBeenCalledWith('a');
  });
});
