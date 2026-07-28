/**
 * Change Instrument — shared domain operation
 *
 * These tests are the contract every transport inherits. The browser reducer,
 * the Durable Object WebSocket handler, and MCP `edit_session` all call
 * setTrackInstrument(), so a behavior asserted here is asserted for all three.
 *
 * See specs/CHANGE-INSTRUMENT.md.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { VALID_SAMPLE_IDS } from '../components/sample-constants';
import { MAX_STEPS } from './constants';
import type { SessionState, SessionTrack } from './state';
import { applyMutation } from './state-mutations';
import { carryOverEngineState, setTrackInstrument } from './track-instrument';

const CATALOG_IDS = [...VALID_SAMPLE_IDS].sort();

/** A track with every optional field populated, so "preserved" means something. */
function fullTrack(overrides: Partial<SessionTrack> = {}): SessionTrack {
  const steps = Array<boolean>(MAX_STEPS).fill(false);
  steps[0] = true;
  steps[7] = true;
  const parameterLocks = Array<SessionTrack['parameterLocks'][number]>(MAX_STEPS).fill(null);
  parameterLocks[7] = { pitch: 5, volume: 0.4 };

  return {
    id: 'track-1',
    name: 'My Custom Label',
    sampleId: 'tone:fm-bass',
    steps,
    parameterLocks,
    volume: 0.62,
    muted: true,
    soloed: true,
    transpose: -7,
    stepCount: 12,
    swing: 35,
    fmParams: { harmonicity: 9, modulationIndex: 19 },
    ...overrides,
  };
}

function stateWith(...tracks: SessionTrack[]): SessionState {
  return { tracks, tempo: 128, swing: 10, version: 1 };
}

type InstrumentResult = ReturnType<typeof setTrackInstrument>;
type InstrumentSuccess = Extract<InstrumentResult, { ok: true }>;
type InstrumentFailure = Extract<InstrumentResult, { ok: false }>;

function expectSuccess(result: InstrumentResult): asserts result is InstrumentSuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected instrument change to succeed: ${result.error.message}`);
}

function expectFailure(result: InstrumentResult): asserts result is InstrumentFailure {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected instrument change to fail');
}

describe('setTrackInstrument', () => {
  it('routes the legacy wire alias through validation and field cleanup', () => {
    const before = fullTrack();
    const state = stateWith(before);
    const changed = applyMutation(state, {
      type: 'set_track_sample',
      trackId: 'track-1',
      sampleId: 'sampled:808-kick',
      name: 'Untrusted rename',
    });

    expect(changed.tracks[0].sampleId).toBe('sampled:808-kick');
    expect(changed.tracks[0].name).toBe('My Custom Label');
    expect(changed.tracks[0].fmParams).toBeUndefined();

    expect(applyMutation(state, {
      type: 'set_track_sample',
      trackId: 'track-1',
      sampleId: 'not-in-the-catalog',
      name: 'Untrusted rename',
    })).toBe(state);
  });

  it('replaces only the sound source', () => {
    const before = fullTrack();
    const result = setTrackInstrument(stateWith(before), {
      trackId: 'track-1',
      sampleId: 'sampled:808-kick',
    });

    expectSuccess(result);
    expect(result.changed).toBe(true);

    const after = result.state.tracks[0];
    expect(after.sampleId).toBe('sampled:808-kick');

    // Everything a person could have spent time on survives, field by field.
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('My Custom Label');
    expect(after.steps).toEqual(before.steps);
    expect(after.parameterLocks).toEqual(before.parameterLocks);
    expect(after.volume).toBe(before.volume);
    expect(after.muted).toBe(before.muted);
    expect(after.soloed).toBe(before.soloed);
    expect(after.transpose).toBe(before.transpose);
    expect(after.stepCount).toBe(before.stepCount);
    expect(after.swing).toBe(before.swing);
  });

  it('never mutates the caller\'s state', () => {
    const before = fullTrack();
    const state = stateWith(before);
    const snapshot = structuredClone(state);

    setTrackInstrument(state, { trackId: 'track-1', sampleId: 'kick' });

    expect(state).toEqual(snapshot);
  });

  it('keeps the track in its original position', () => {
    const state = stateWith(
      fullTrack({ id: 'a', sampleId: 'kick' }),
      fullTrack({ id: 'b', sampleId: 'snare' }),
      fullTrack({ id: 'c', sampleId: 'hihat' }),
    );

    const result = setTrackInstrument(state, { trackId: 'b', sampleId: 'clap' });

    expect(result.ok).toBe(true);
    expect(result.state.tracks.map((track) => track.id)).toEqual(['a', 'b', 'c']);
    expect(result.state.tracks[1].sampleId).toBe('clap');
  });

  it('leaves sibling tracks byte-identical', () => {
    const sibling = fullTrack({ id: 'other', sampleId: 'snare' });
    const state = stateWith(fullTrack(), sibling);

    const result = setTrackInstrument(state, { trackId: 'track-1', sampleId: 'kick' });

    // Same reference, not merely deep-equal: nothing re-created the sibling.
    expect(result.state.tracks[1]).toBe(sibling);
  });

  it('preserves unrelated session fields', () => {
    const state: SessionState = {
      ...stateWith(fullTrack()),
      effects: {
        bypass: false,
        reverb: { decay: 1.5, wet: 0.3 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 1.5, depth: 0.5, wet: 0.2 },
        distortion: { amount: 0, wet: 0 },
      },
      scale: { root: 'C', scaleId: 'minor-pentatonic', locked: true },
      loopRegion: { start: 2, end: 9 },
    };

    const result = setTrackInstrument(state, { trackId: 'track-1', sampleId: 'kick' });

    expect(result.state.tempo).toBe(128);
    expect(result.state.swing).toBe(10);
    expect(result.state.version).toBe(1);
    expect(result.state.effects).toEqual(state.effects);
    expect(result.state.scale).toEqual(state.scale);
    expect(result.state.loopRegion).toEqual(state.loopRegion);
  });

  describe('rejection', () => {
    it('rejects an instrument that is not in the canonical catalog', () => {
      const state = stateWith(fullTrack());
      const result = setTrackInstrument(state, {
        trackId: 'track-1',
        sampleId: 'definitely-not-an-instrument',
      });

      expectFailure(result);
      expect(result.error.code).toBe('INVALID_SAMPLE_ID');
      // The caller's own reference comes back, so assigning the result
      // unconditionally cannot drop a concurrent edit.
      expect(result.state).toBe(state);
    });

    it('rejects an unknown track', () => {
      const state = stateWith(fullTrack());
      const result = setTrackInstrument(state, { trackId: 'nope', sampleId: 'kick' });

      expectFailure(result);
      expect(result.error.code).toBe('TRACK_NOT_FOUND');
      expect(result.state).toBe(state);
    });

    it('reports the instrument first when both are invalid', () => {
      const result = setTrackInstrument(stateWith(fullTrack()), {
        trackId: 'nope',
        sampleId: 'also-nope',
      });

      expectFailure(result);
      // An invalid ID must be rejected identically whether or not the track
      // happens to exist, so callers get a stable error for a stable input.
      expect(result.error.code).toBe('INVALID_SAMPLE_ID');
    });

    it('rejects a legacy quarantined instrument that a session may still hold', () => {
      // A persisted session can open with 'sampled:rhodes-ep', but the picker
      // never offers it, so nothing may deliberately switch a track TO it.
      const result = setTrackInstrument(stateWith(fullTrack()), {
        trackId: 'track-1',
        sampleId: 'sampled:rhodes-ep',
      });

      expect(result.ok).toBe(false);
    });

    it.each([
      ['empty string', ''],
      ['whitespace-padded valid id', ' kick '],
      ['prototype key', '__proto__'],
      ['constructor key', 'constructor'],
    ])('rejects %s', (_label, sampleId) => {
      const result = setTrackInstrument(stateWith(fullTrack()), {
        trackId: 'track-1',
        sampleId,
      });

      expect(result.ok).toBe(false);
    });

    it('rejects a non-string instrument without throwing', () => {
      const result = setTrackInstrument(stateWith(fullTrack()), {
        trackId: 'track-1',
        sampleId: undefined as unknown as string,
      });

      expectFailure(result);
      expect(result.error.code).toBe('INVALID_SAMPLE_ID');
    });
  });

  describe('no-op', () => {
    it('reports changed: false when the instrument is unchanged', () => {
      const state = stateWith(fullTrack({ sampleId: 'kick', fmParams: undefined }));
      const result = setTrackInstrument(state, { trackId: 'track-1', sampleId: 'kick' });

      expectSuccess(result);
      expect(result.changed).toBe(false);
      expect(result.state).toBe(state);
    });

    it('does not discard FM parameters when re-picking the same preset', () => {
      // A person tweaking FM knobs and then re-selecting the preset they are
      // already on must not lose their edits.
      const state = stateWith(fullTrack({ sampleId: 'tone:fm-bell' }));
      const result = setTrackInstrument(state, {
        trackId: 'track-1',
        sampleId: 'tone:fm-bell',
      });

      expectSuccess(result);
      expect(result.track.fmParams).toEqual({ harmonicity: 9, modulationIndex: 19 });
    });
  });

  describe('engine-state compatibility policy', () => {
    it('drops FM parameters when switching between FM presets', () => {
      const result = setTrackInstrument(
        stateWith(fullTrack({ sampleId: 'tone:fm-bass' })),
        { trackId: 'track-1', sampleId: 'tone:fm-bell' },
      );

      expect(result.ok).toBe(true);
      expect(result.state.tracks[0].fmParams).toBeUndefined();
    });

    it('drops FM parameters when leaving the FM engine entirely', () => {
      const result = setTrackInstrument(
        stateWith(fullTrack({ sampleId: 'tone:fm-bass' })),
        { trackId: 'track-1', sampleId: 'kick' },
      );

      expect(result.ok).toBe(true);
      expect(result.state.tracks[0].fmParams).toBeUndefined();
    });

    it('removes the fmParams key rather than storing undefined', () => {
      // A dropped field must leave the track shaped like one that never had FM
      // parameters, so persisted state and wire payloads stay identical.
      const result = setTrackInstrument(
        stateWith(fullTrack({ sampleId: 'tone:fm-bass' })),
        { trackId: 'track-1', sampleId: 'kick' },
      );

      expect(result.ok).toBe(true);
      expect(Object.hasOwn(result.state.tracks[0], 'fmParams')).toBe(false);
    });

    it('cannot resurrect FM parameters by round-tripping through another instrument', () => {
      const start = stateWith(fullTrack({ sampleId: 'tone:fm-bell' }));

      const away = setTrackInstrument(start, { trackId: 'track-1', sampleId: 'kick' });
      expect(away.ok).toBe(true);
      const back = setTrackInstrument(away.state, {
        trackId: 'track-1',
        sampleId: 'tone:fm-bell',
      });

      expect(back.ok).toBe(true);
      expect(back.state.tracks[0].fmParams).toBeUndefined();
    });

    it('exposes the policy as one function', () => {
      const track = fullTrack({ sampleId: 'tone:fm-bass' });

      expect(carryOverEngineState(track, 'tone:fm-bass')).toEqual({
        fmParams: { harmonicity: 9, modulationIndex: 19 },
      });
      expect(carryOverEngineState(track, 'tone:fm-bell')).toEqual({ fmParams: undefined });
      expect(carryOverEngineState(track, 'kick')).toEqual({ fmParams: undefined });
    });
  });

  describe('properties', () => {
    const arbCatalogId = fc.constantFrom(...CATALOG_IDS);

    it('preserves everything except sampleId and fmParams, for every catalog instrument', () => {
      fc.assert(
        fc.property(arbCatalogId, arbCatalogId, (from, to) => {
          const before = fullTrack({ sampleId: from });
          const result = setTrackInstrument(stateWith(before), {
            trackId: 'track-1',
            sampleId: to,
          });

          expectSuccess(result);

          const after = result.state.tracks[0];
          expect(after.sampleId).toBe(to);

          const strip = (track: SessionTrack) => {
            const copy: Partial<SessionTrack> = { ...track };
            delete copy.sampleId;
            delete copy.fmParams;
            return copy;
          };
          expect(strip(after)).toEqual(strip(before));
        }),
        { numRuns: 200 },
      );
    });

    it('is idempotent: applying twice equals applying once', () => {
      fc.assert(
        fc.property(arbCatalogId, arbCatalogId, (from, to) => {
          const state = stateWith(fullTrack({ sampleId: from }));

          const once = setTrackInstrument(state, { trackId: 'track-1', sampleId: to });
          expectSuccess(once);
          const twice = setTrackInstrument(once.state, { trackId: 'track-1', sampleId: to });
          expectSuccess(twice);

          expect(twice.state).toEqual(once.state);
          // The second application must also report no change, which is what
          // makes an MCP retry silent instead of re-broadcasting.
          expect(twice.changed).toBe(false);
        }),
        { numRuns: 200 },
      );
    });

    it('accepts every instrument the picker can offer', () => {
      // The picker and the validator must agree, or a person could click an
      // instrument the server refuses.
      for (const sampleId of CATALOG_IDS) {
        const result = setTrackInstrument(stateWith(fullTrack({ sampleId: 'kick' })), {
          trackId: 'track-1',
          sampleId,
        });
        expect(result.ok, `catalog instrument rejected: ${sampleId}`).toBe(true);
      }
    });
  });
});
