/**
 * state-adapters — the GridState <-> SessionState boundary.
 *
 * Every SYNCED action in gridReducer routes through delegateToApplyMutation
 * (28 call sites in src/state/grid.tsx), so a field this module forgets to
 * carry across is silently reset by *any* edit the user makes. That is the
 * failure these tests are aimed at, and it is not one that showed up in
 * gridReducer's own tests: those assert on the field the action changed, and
 * an unrelated field being clobbered on the way through goes unnoticed.
 *
 * The central case is `preserves every local-only field through a mutation`,
 * which is written against the *declared* list of local-only fields rather
 * than an enumeration copied by hand — so a new local-only field added to
 * GridState fails here until the adapter carries it.
 */
import { describe, it, expect } from 'vitest';
import {
  gridStateToSessionState,
  applySessionToGridState,
  maybeInvalidateSelection,
  delegateToApplyMutation,
} from './state-adapters';
import { applyMutation } from './state-mutations';
import { DEFAULT_STEP_COUNT } from './constants';
import type { GridState, Track, SelectionState } from '../types';
import type { SessionState, SessionTrack } from './state';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    name: 'Kick',
    sampleId: 'sampled:808-kick',
    steps: Array(128).fill(false),
    parameterLocks: Array(128).fill(null),
    volume: 0.8,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

function makeGridState(overrides: Partial<GridState> = {}): GridState {
  return {
    tracks: [makeTrack()],
    tempo: 120,
    swing: 0,
    isPlaying: false,
    currentStep: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// gridStateToSessionState
// ---------------------------------------------------------------------------

describe('gridStateToSessionState', () => {
  it('carries the synced fields onto the session state', () => {
    const grid = makeGridState({
      tempo: 145,
      swing: 30,
      tracks: [makeTrack({ id: 'a', volume: 0.5, transpose: -3, stepCount: 12 })],
    });

    const session = gridStateToSessionState(grid);

    expect(session.tempo).toBe(145);
    expect(session.swing).toBe(30);
    expect(session.tracks).toHaveLength(1);
    expect(session.tracks[0]).toMatchObject({
      id: 'a',
      volume: 0.5,
      transpose: -3,
      stepCount: 12,
    });
  });

  it('drops local-only fields rather than sending them to the server', () => {
    const session = gridStateToSessionState(
      makeGridState({
        isPlaying: true,
        currentStep: 47,
        selection: { trackId: 't1', steps: new Set([1, 2]), anchor: 1 },
        focus: { context: 'step', trackId: 't1', stepIndex: 4 },
      }),
    );

    // These have no place on the wire — a transport that shipped them would
    // make one player's transport position authoritative for everyone.
    expect(session).not.toHaveProperty('isPlaying');
    expect(session).not.toHaveProperty('currentStep');
    expect(session).not.toHaveProperty('selection');
    expect(session).not.toHaveProperty('focus');
  });

  it('normalises a null loopRegion to undefined', () => {
    // SessionState distinguishes "no loop region" (undefined) from an explicit
    // null clear; GridState uses null for both. The adapter picks undefined so
    // applySessionToGridState's null-vs-undefined branch stays meaningful.
    expect(gridStateToSessionState(makeGridState({ loopRegion: null })).loopRegion)
      .toBeUndefined();
    expect(gridStateToSessionState(makeGridState({ loopRegion: { start: 0, end: 8 } })).loopRegion)
      .toEqual({ start: 0, end: 8 });
  });
});

// ---------------------------------------------------------------------------
// applySessionToGridState
// ---------------------------------------------------------------------------

describe('applySessionToGridState', () => {
  it('takes synced values from the session, not the original', () => {
    const original = makeGridState({ tempo: 120, swing: 0 });
    const mutated: SessionState = {
      ...gridStateToSessionState(original),
      tempo: 174,
      swing: 55,
    };

    const result = applySessionToGridState(original, mutated);

    expect(result.tempo).toBe(174);
    expect(result.swing).toBe(55);
  });

  it('keeps the local mute/solo state when the server disagrees', () => {
    // "My Ears, My Control": mute and solo are per-listener. A collaborator
    // muting their copy must not mute mine, even though the field rides along
    // on SessionTrack.
    const original = makeGridState({
      tracks: [makeTrack({ id: 't1', muted: true, soloed: false })],
    });
    const mutated = gridStateToSessionState(original);
    mutated.tracks[0] = { ...mutated.tracks[0], muted: false, soloed: true };

    const result = applySessionToGridState(original, mutated);

    expect(result.tracks[0].muted).toBe(true);
    expect(result.tracks[0].soloed).toBe(false);
  });

  it('defaults mute/solo for a track that did not exist locally', () => {
    const original = makeGridState({ tracks: [makeTrack({ id: 't1' })] });
    const incoming: SessionTrack = {
      id: 'from-peer',
      name: 'Snare',
      sampleId: 'sampled:808-snare',
      steps: Array(128).fill(false),
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: true,
      transpose: 0,
    };
    const mutated: SessionState = {
      ...gridStateToSessionState(original),
      tracks: [...gridStateToSessionState(original).tracks, incoming],
    };

    const result = applySessionToGridState(original, mutated);
    const added = result.tracks.find((t) => t.id === 'from-peer')!;

    expect(added.muted).toBe(true);      // no local opinion yet, so take theirs
    expect(added.soloed).toBe(false);    // absent on the wire -> default
    expect(added.stepCount).toBe(DEFAULT_STEP_COUNT); // absent -> default
  });

  it('preserves every local-only field through a mutation', () => {
    // Written against the declared list rather than a hand-copied one: adding
    // a local-only field to GridState without teaching the adapter to carry it
    // fails here. `focus` was exactly that case — declared local-only in
    // types.ts and in SYNCED_ACTIONS, but dropped by this adapter, so any
    // synced edit reset keyboard navigation.
    const LOCAL_ONLY = ['isPlaying', 'currentStep', 'selection', 'focus'] as const;

    const selection: SelectionState = { trackId: 't1', steps: new Set([3, 4]), anchor: 3 };
    const original = makeGridState({
      isPlaying: true,
      currentStep: 61,
      selection,
      focus: { context: 'step', trackId: 't1', stepIndex: 9 },
    });

    const result = delegateToApplyMutation(original, { type: 'set_tempo', tempo: 150 });

    expect(result.tempo).toBe(150); // the mutation did happen
    for (const field of LOCAL_ONLY) {
      expect(result[field], `local-only field '${field}' was not preserved`)
        .toEqual(original[field]);
    }
  });

  it('falls back to the original effects and scale when the session omits them', () => {
    // Older sessions predate both fields. Reading `undefined` off the wire as
    // "clear it" would wipe a user's effects on the next edit.
    const original = makeGridState({
      effects: {
        reverb: { decay: 2.5, wet: 0.4 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 1.5, depth: 0.5, wet: 0.1 },
        distortion: { amount: 0.2, wet: 0.15 },
      },
      scale: { root: 'C', scaleId: 'minor-pentatonic', locked: true },
    });
    const mutated: SessionState = {
      ...gridStateToSessionState(original),
      effects: undefined,
      scale: undefined,
    };

    const result = applySessionToGridState(original, mutated);

    expect(result.effects).toEqual(original.effects);
    expect(result.scale).toEqual(original.scale);
  });

  it('distinguishes an absent loopRegion from an explicitly cleared one', () => {
    const original = makeGridState({ loopRegion: { start: 0, end: 8 } });
    const base = gridStateToSessionState(original);

    // undefined = the message said nothing about the loop region -> keep it.
    expect(applySessionToGridState(original, { ...base, loopRegion: undefined }).loopRegion)
      .toEqual({ start: 0, end: 8 });
    // null = the mutation cleared it -> clear it locally too.
    expect(applySessionToGridState(original, { ...base, loopRegion: null }).loopRegion)
      .toBeNull();
    // A new region replaces the old one.
    expect(applySessionToGridState(original, { ...base, loopRegion: { start: 4, end: 12 } }).loopRegion)
      .toEqual({ start: 4, end: 12 });
  });

  it('does not mutate the state it was given', () => {
    const original = makeGridState({
      tracks: [makeTrack({ id: 't1', muted: true })],
      selection: { trackId: 't1', steps: new Set([2]), anchor: 2 },
    });
    const before = JSON.stringify({ ...original, selection: [...original.selection!.steps] });

    delegateToApplyMutation(original, { type: 'toggle_step', trackId: 't1', step: 5 });

    expect(JSON.stringify({ ...original, selection: [...original.selection!.steps] }))
      .toBe(before);
  });
});

// ---------------------------------------------------------------------------
// maybeInvalidateSelection
// ---------------------------------------------------------------------------

describe('maybeInvalidateSelection', () => {
  const selection: SelectionState = { trackId: 't1', steps: new Set([1, 2, 3]), anchor: 1 };

  it('clears a selection on the track that was rearranged', () => {
    // Pattern ops (rotate, reverse, euclidean) change what an index points at,
    // so the retained indices would select different steps than the user chose.
    expect(maybeInvalidateSelection(selection, 't1')).toBeNull();
  });

  it('keeps a selection on an untouched track', () => {
    expect(maybeInvalidateSelection(selection, 'other-track')).toBe(selection);
  });

  it('returns null for an absent selection', () => {
    expect(maybeInvalidateSelection(null, 't1')).toBeNull();
    expect(maybeInvalidateSelection(undefined, 't1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delegateToApplyMutation
// ---------------------------------------------------------------------------

describe('delegateToApplyMutation', () => {
  it('produces the same synced result as applyMutation does server-side', () => {
    // The point of the delegation refactor: one implementation of each
    // mutation, shared by client and server. If these diverge, two clients
    // that applied the same message locally would disagree on state.
    const grid = makeGridState({
      tracks: [makeTrack({ id: 't1' }), makeTrack({ id: 't2', volume: 0.3 })],
    });
    const message = { type: 'toggle_step' as const, trackId: 't2', step: 7 };

    const viaAdapter = delegateToApplyMutation(grid, message);
    const viaServer = applyMutation(gridStateToSessionState(grid), message);

    expect(viaAdapter.tempo).toBe(viaServer.tempo);
    expect(viaAdapter.swing).toBe(viaServer.swing);
    expect(viaAdapter.tracks.map((t) => t.steps)).toEqual(viaServer.tracks.map((t) => t.steps));
    expect(viaAdapter.tracks[1].steps[7]).toBe(true);
  });

  it('leaves state untouched for a mutation that targets a missing track', () => {
    const grid = makeGridState();
    const result = delegateToApplyMutation(grid, {
      type: 'toggle_step',
      trackId: 'ghost',
      step: 1,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].steps.filter(Boolean)).toHaveLength(0);
  });

  it('round-trips an unmutated state back to an equivalent GridState', () => {
    // The adapter pair must be lossless for everything GridState declares;
    // a field silently dropped here is a field every edit would reset.
    const grid = makeGridState({
      tempo: 133,
      swing: 22,
      isPlaying: true,
      currentStep: 12,
      selection: { trackId: 't1', steps: new Set([0, 9]), anchor: 0 },
      focus: { context: 'track', trackId: 't1' },
      loopRegion: { start: 2, end: 10 },
      tracks: [makeTrack({ id: 't1', muted: true, soloed: true, swing: 15 })],
    });

    const result = applySessionToGridState(grid, gridStateToSessionState(grid));

    expect(result).toEqual(grid);
  });
});
