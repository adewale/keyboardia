import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createDefaultTrack, createInitialState } from '../shared/state-mutations';
import {
  McpSessionEditError,
  TRACK_ID_PATTERN,
  applyMcpSessionEdit,
  compactMcpSession,
} from './mcp-edits';

describe('MCP rhythm domain', () => {
  it('returns a compact musical view limited to each track loop', () => {
    const track = createDefaultTrack('kick-1', 'kick', 'Kick');
    track.steps[0] = true;
    track.steps[8] = true;
    track.steps[20] = true;

    expect(compactMcpSession({
      id: '00000000-0000-4000-8000-000000000001',
      immutable: false,
      state: { ...createInitialState(), tracks: [track] },
    })).toEqual({
      session_id: '00000000-0000-4000-8000-000000000001',
      immutable: false,
      tempo: 120,
      tracks: [{
        track_id: 'kick-1',
        name: 'Kick',
        sample_id: 'kick',
        step_count: 16,
        active_steps: [0, 8],
      }],
    });
  });

  it('adds a complete Keyboardia track and treats an identical retry as a no-op', () => {
    const initial = createInitialState();
    const edit = {
      operation: 'add_track' as const,
      track_id: 'kick-agent-1',
      sample_id: 'kick',
    };

    const added = applyMcpSessionEdit(initial, edit);
    expect(added.changed).toBe(true);
    expect(added.state.tracks[0]).toMatchObject({
      id: 'kick-agent-1',
      name: 'Kick',
      sampleId: 'kick',
      stepCount: 16,
    });
    expect(added.state.tracks[0]?.steps).toHaveLength(128);
    expect(added.events).toEqual([{
      type: 'track_added',
      track: added.state.tracks[0],
    }]);

    const retry = applyMcpSessionEdit(added.state, edit);
    expect(retry).toEqual({ state: added.state, events: [], changed: false });
  });

  it('rejects reusing a track ID for a different track', () => {
    const state = applyMcpSessionEdit(createInitialState(), {
      operation: 'add_track',
      track_id: 'agent-track',
      sample_id: 'kick',
    }).state;

    expect(() => applyMcpSessionEdit(state, {
      operation: 'add_track',
      track_id: 'agent-track',
      sample_id: 'snare',
    })).toThrowError(McpSessionEditError);
  });

  it('rejects a track ID that would collide with a browser supersession key', () => {
    // The browser keys step events as `${trackId}:${step}` and track events as
    // the bare trackId, so a track called "kick-1:3" would share a key with
    // step 3 of track "kick-1" and could discard a collaborator's pending edit.
    expect(TRACK_ID_PATTERN.test('kick-1:3')).toBe(false);

    expect(() => applyMcpSessionEdit(createInitialState(), {
      operation: 'add_track',
      track_id: 'kick-1:3',
      sample_id: 'kick',
    })).toThrowError(/track_id must be 1-64 characters/);

    // The characters an agent actually needs still work, including the shape
    // the browser itself generates.
    for (const trackId of ['kick-agent-1', 'track-1769299200000', 'agent.kick_2']) {
      expect(TRACK_ID_PATTERN.test(trackId)).toBe(true);
    }
  });

  it('sets only named steps and emits existing granular collaboration events', () => {
    const kick = createDefaultTrack('kick-1', 'kick', 'Kick');
    kick.steps[1] = true;
    kick.parameterLocks[4] = { pitch: 7 };
    const snare = createDefaultTrack('snare-1', 'snare', 'Snare');
    snare.steps[4] = true;
    const state = { ...createInitialState(), tracks: [kick, snare] };

    const result = applyMcpSessionEdit(state, {
      operation: 'set_steps',
      track_id: 'kick-1',
      changes: [
        { step: 0, value: true },
        { step: 1, value: false },
        { step: 4, value: true },
      ],
    });

    expect(result.state.tracks[0]?.steps.slice(0, 6)).toEqual([
      true, false, false, false, true, false,
    ]);
    expect(result.state.tracks[0]?.parameterLocks[4]).toEqual({ pitch: 7 });
    expect(result.state.tracks[1]).toBe(snare);
    expect(result.events).toEqual([
      { type: 'step_toggled', trackId: 'kick-1', step: 0, value: true },
      { type: 'step_toggled', trackId: 'kick-1', step: 1, value: false },
      { type: 'step_toggled', trackId: 'kick-1', step: 4, value: true },
    ]);
  });

  it('preserves every unnamed musical value for arbitrary step assignments', () => {
    const changes = fc.uniqueArray(
      fc.record({
        step: fc.integer({ min: 0, max: 15 }),
        value: fc.boolean(),
      }),
      {
        minLength: 1,
        maxLength: 16,
        selector: ({ step }) => step,
      }
    );

    fc.assert(fc.property(
      fc.array(fc.boolean(), { minLength: 16, maxLength: 16 }),
      changes,
      (initialSteps, namedChanges) => {
        const kick = createDefaultTrack('kick-1', 'kick', 'Kick');
        initialSteps.forEach((value, step) => {
          kick.steps[step] = value;
        });
        kick.parameterLocks[4] = { pitch: 7 };
        const snare = createDefaultTrack('snare-1', 'snare', 'Snare');
        snare.steps[4] = true;
        const state = { ...createInitialState(), tracks: [kick, snare] };
        const originalKickSteps = [...kick.steps];
        const originalLocks = structuredClone(kick.parameterLocks);
        const assignments = new Map(
          namedChanges.map(({ step, value }) => [step, value])
        );

        const result = applyMcpSessionEdit(state, {
          operation: 'set_steps',
          track_id: 'kick-1',
          changes: namedChanges,
        });

        expect(result.state.tracks[0]?.steps).toEqual(
          originalKickSteps.map((value, step) => assignments.get(step) ?? value)
        );
        expect(result.state.tracks[0]?.parameterLocks).toEqual(originalLocks);
        expect(result.state.tracks[1]).toEqual(snare);
        expect(kick.steps).toEqual(originalKickSteps);
        expect(result.events).toHaveLength(
          namedChanges.filter(({ step, value }) => originalKickSteps[step] !== value).length
        );
        expect(applyMcpSessionEdit(result.state, {
          operation: 'set_steps',
          track_id: 'kick-1',
          changes: namedChanges,
        })).toEqual({
          state: result.state,
          events: [],
          changed: false,
        });
      }
    ));
  });

  it('does not emit broadcasts when an explicit edit already holds', () => {
    const kick = createDefaultTrack('kick-1', 'kick', 'Kick');
    kick.steps[0] = true;
    const state = { ...createInitialState(), tracks: [kick] };

    expect(applyMcpSessionEdit(state, {
      operation: 'set_steps',
      track_id: 'kick-1',
      changes: [{ step: 0, value: true }],
    })).toEqual({ state, events: [], changed: false });

    expect(applyMcpSessionEdit(state, {
      operation: 'set_tempo',
      tempo: 120,
    })).toEqual({ state, events: [], changed: false });
  });

  it('rejects hidden step assignments outside the current track loop', () => {
    const kick = createDefaultTrack('kick-1', 'kick', 'Kick');
    const state = { ...createInitialState(), tracks: [kick] };

    expect(() => applyMcpSessionEdit(state, {
      operation: 'set_steps',
      track_id: 'kick-1',
      changes: [{ step: 16, value: true }],
    })).toThrowError(/outside this track's 16-step loop/);
  });

  describe('set_track_instrument', () => {
    /** A track a person has already invested work in. */
    function workedOnTrack() {
      const track = createDefaultTrack('lead-1', 'tone:fm-bass', 'Ada’s Lead');
      track.steps[0] = true;
      track.steps[6] = true;
      track.parameterLocks[6] = { pitch: 7 };
      track.volume = 0.42;
      track.transpose = -5;
      track.stepCount = 12;
      track.swing = 30;
      track.fmParams = { harmonicity: 9, modulationIndex: 19 };
      return track;
    }

    it('replaces the sound source and keeps the rest of the track', () => {
      const track = workedOnTrack();
      const state = { ...createInitialState(), tracks: [track] };

      const result = applyMcpSessionEdit(state, {
        operation: 'set_track_instrument',
        track_id: 'lead-1',
        sample_id: 'sampled:808-kick',
      });

      expect(result.changed).toBe(true);
      expect(result.events).toEqual([{
        type: 'track_instrument_set',
        trackId: 'lead-1',
        sampleId: 'sampled:808-kick',
        name: 'Ada’s Lead',
      }]);

      const after = result.state.tracks[0]!;
      expect(after.sampleId).toBe('sampled:808-kick');
      // An agent must not be able to erase a collaborator's label by
      // swapping a sound.
      expect(after.name).toBe('Ada’s Lead');
      expect(after.steps).toEqual(track.steps);
      expect(after.parameterLocks).toEqual(track.parameterLocks);
      expect(after.volume).toBe(0.42);
      expect(after.transpose).toBe(-5);
      expect(after.stepCount).toBe(12);
      expect(after.swing).toBe(30);
      // Engine-scoped state does not survive an instrument change.
      expect(after.fmParams).toBeUndefined();
    });

    it('treats an identical retry as a no-op', () => {
      const state = { ...createInitialState(), tracks: [workedOnTrack()] };
      const edit = {
        operation: 'set_track_instrument' as const,
        track_id: 'lead-1',
        sample_id: 'kick',
      };

      const first = applyMcpSessionEdit(state, edit);
      expect(first.changed).toBe(true);

      const retry = applyMcpSessionEdit(first.state, edit);
      expect(retry).toEqual({ state: first.state, events: [], changed: false });
    });

    it('rejects an unknown instrument without mutating the session', () => {
      const state = { ...createInitialState(), tracks: [workedOnTrack()] };

      let thrown: unknown;
      try {
        applyMcpSessionEdit(state, {
          operation: 'set_track_instrument',
          track_id: 'lead-1',
          sample_id: 'not-an-instrument',
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(McpSessionEditError);
      expect((thrown as McpSessionEditError).code).toBe('INVALID_SAMPLE_ID');
      expect((thrown as McpSessionEditError).status).toBe(400);
      expect(state.tracks[0]!.sampleId).toBe('tone:fm-bass');
    });

    it('rejects an unknown track with 404 and no mutation', () => {
      const state = { ...createInitialState(), tracks: [workedOnTrack()] };

      let thrown: unknown;
      try {
        applyMcpSessionEdit(state, {
          operation: 'set_track_instrument',
          track_id: 'no-such-track',
          sample_id: 'kick',
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(McpSessionEditError);
      expect((thrown as McpSessionEditError).code).toBe('TRACK_NOT_FOUND');
      expect((thrown as McpSessionEditError).status).toBe(404);
      expect(state.tracks).toHaveLength(1);
    });

    it('leaves collaborator tracks untouched', () => {
      const mine = workedOnTrack();
      const theirs = createDefaultTrack('snare-1', 'snare', 'Their Snare');
      theirs.steps[4] = true;
      const state = { ...createInitialState(), tracks: [mine, theirs] };

      const result = applyMcpSessionEdit(state, {
        operation: 'set_track_instrument',
        track_id: 'lead-1',
        sample_id: 'kick',
      });

      expect(result.state.tracks[1]).toBe(theirs);
      expect(result.state.tracks.map((t) => t.id)).toEqual(['lead-1', 'snare-1']);
    });
  });
});
