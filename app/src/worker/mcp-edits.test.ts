import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createDefaultTrack } from '../shared/state-mutations';
import { createInitialSessionState } from '../shared/session-defaults';
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
      state: createInitialSessionState({ tracks: [track] }),
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
    const initial = createInitialSessionState();
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
    const state = applyMcpSessionEdit(createInitialSessionState(), {
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

    expect(() => applyMcpSessionEdit(createInitialSessionState(), {
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
    const state = createInitialSessionState({ tracks: [kick, snare] });

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
        const state = createInitialSessionState({ tracks: [kick, snare] });
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
    const state = createInitialSessionState({ tracks: [kick] });

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
    const state = createInitialSessionState({ tracks: [kick] });

    expect(() => applyMcpSessionEdit(state, {
      operation: 'set_steps',
      track_id: 'kick-1',
      changes: [{ step: 16, value: true }],
    })).toThrowError(/outside this track's 16-step loop/);
  });
});
