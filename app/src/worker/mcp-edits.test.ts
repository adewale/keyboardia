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

    const compact = compactMcpSession({
      id: '00000000-0000-4000-8000-000000000001',
      immutable: false,
      state: createInitialSessionState({ tracks: [track] }),
    });
    expect(compact).toMatchObject({
      session_id: '00000000-0000-4000-8000-000000000001',
      immutable: false,
      tempo: 120,
      tracks: [{
        track_id: 'kick-1',
        name: 'Kick',
        sample_id: 'kick',
        step_count: 16,
        active_steps: [0, 8],
        pan: 0,
        envelope: { attack: .003, decay: 0, sustain: 1, release: .1 },
        envelope_override: false,
        envelope_time_unit: 'seconds',
        gate: 90,
        envelope_locks: [],
      }],
    });
    expect(compact.tracks[0]).toMatchObject({
      authored_envelope: null,
      effective_envelope: { model: 'ahd' },
      sample_playback_mode: 'trigger',
      envelope_active: true,
      ignored_envelope_stages: [],
    });
  });

  it('adds a complete Keyboardia track and treats an identical retry as a no-op', () => {
    const initial = createInitialSessionState();
    const edit = {
      operation: 'add_track' as const,
      track_id: 'kick-agent-a7f3c29d',
      sample_id: 'kick',
    };

    const added = applyMcpSessionEdit(initial, edit);
    expect(added.changed).toBe(true);
    expect(added.state.tracks[0]).toMatchObject({
      id: 'kick-agent-a7f3c29d',
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

  it('sets, reports, and resets a track envelope idempotently', () => {
    const track = createDefaultTrack('pad-1', 'synth:pad', 'Pad');
    const initial = createInitialSessionState({ tracks: [track] });
    const edit = {
      operation: 'set_track_envelope' as const,
      track_id: 'pad-1',
      envelope: { attack: .8, decay: .3, sustain: .85, release: 3.5 },
    };
    const applied = applyMcpSessionEdit(initial, edit);
    expect(applied.events).toEqual([
      {
        type: 'track_envelope_set',
        trackId: 'pad-1',
        envelope: edit.envelope,
      },
      {
        type: 'track_envelope_v2_set',
        trackId: 'pad-1',
        envelope: {
          model: 'adsr',
          attack: { value: .8, unit: 'seconds' },
          decay: { value: .3, unit: 'seconds' },
          sustain: .85,
          release: { value: 3.5, unit: 'seconds' },
        },
      },
    ]);
    expect(compactMcpSession({ id: 'session', immutable: false, state: applied.state }).tracks[0])
      .toMatchObject({ envelope: edit.envelope, envelope_override: true });
    expect(applyMcpSessionEdit(applied.state, edit).changed).toBe(false);

    const reordered = {
      operation: 'set_track_envelope' as const,
      track_id: 'pad-1',
      envelope: { release: 3.5, sustain: .85, decay: .3, attack: .8 },
    };
    expect(applyMcpSessionEdit(applied.state, reordered).changed).toBe(false);

    const reset = applyMcpSessionEdit(applied.state, {
      operation: 'set_track_envelope', track_id: 'pad-1', envelope: null,
    });
    expect(reset.state.tracks[0]?.envelope).toBeUndefined();
    expect(reset.state.tracks[0]?.envelopeV2).toBeUndefined();
    expect(reset.events).toEqual([
      { type: 'track_envelope_set', trackId: 'pad-1', envelope: null },
      { type: 'track_envelope_v2_set', trackId: 'pad-1', envelope: null },
    ]);
    expect(compactMcpSession({ id: 'session', immutable: false, state: reset.state }).tracks[0])
      .toMatchObject({ envelope: { attack: .05, decay: .15, sustain: .85, release: 1 }, envelope_override: false });
  });

  it('sets tempo-relative units and gate with retry-safe assignments', () => {
    const initial = createInitialSessionState({
      tracks: [createDefaultTrack('lead-1', 'synth:lead', 'Lead')],
    });
    const unit = applyMcpSessionEdit(initial, {
      operation: 'set_track_envelope_time_unit', track_id: 'lead-1', unit: 'steps',
    });
    const gate = applyMcpSessionEdit(unit.state, {
      operation: 'set_track_gate', track_id: 'lead-1', gate: 75,
    });
    expect(gate.events).toEqual([{ type: 'track_gate_set', trackId: 'lead-1', gate: 75 }]);
    expect(compactMcpSession({ id: 'session', immutable: false, state: gate.state }).tracks[0])
      .toMatchObject({ envelope_time_unit: 'steps', gate: 75 });
    expect(applyMcpSessionEdit(gate.state, {
      operation: 'set_track_gate', track_id: 'lead-1', gate: 75,
    }).changed).toBe(false);
  });

  it('sets compact mixed-model v2 envelopes and reports authored/effective capability', () => {
    const initial = createInitialSessionState({
      tracks: [createDefaultTrack('lead-1', 'synth:lead', 'Lead')],
    });
    const result = applyMcpSessionEdit(initial, {
      operation: 'set_track_envelope',
      track_id: 'lead-1',
      envelope: {
        model: 'adsr', attack: 0.01, decay: 0.2, sustain: 0.7,
        release: 2, duration_unit: 'steps',
      },
      gate: 80,
    });
    expect(result.state.tracks[0]).toMatchObject({
      envelopeV2: {
        model: 'adsr',
        attack: { value: 0.01, unit: 'steps' },
        decay: { value: 0.2, unit: 'steps' },
        sustain: 0.7,
        release: { value: 2, unit: 'steps' },
      },
      gate: 80,
    });
    expect(result.events[0]?.type).toBe('track_envelope_v2_set');
    const read = compactMcpSession({ id: 'session', immutable: false, state: result.state }).tracks[0]!;
    expect(read.authored_envelope).toEqual(read.effective_envelope);
    expect(read.envelope_capability?.models).toContain('adsr');
    expect(read.envelope_active).toBe(true);
    expect(applyMcpSessionEdit(result.state, {
      operation: 'set_track_envelope',
      track_id: 'lead-1',
      envelope: {
        model: 'adsr', attack: 0.01, decay: 0.2, sustain: 0.7,
        release: 2, duration_unit: 'steps',
      },
      gate: 80,
    })).toEqual({ state: result.state, events: [], changed: false });
  });

  it('rejects unsupported sample sustain instead of exposing a silent MCP control', () => {
    const initial = createInitialSessionState({
      tracks: [createDefaultTrack('piano-1', 'sampled:piano', 'Piano')],
    });
    expect(() => applyMcpSessionEdit(initial, {
      operation: 'set_track_envelope',
      track_id: 'piano-1',
      envelope: {
        model: 'adsr', attack: 0.01, decay: 0.2, sustain: 0.8,
        release: 1, duration_unit: 'seconds',
      },
    })).toThrowError(McpSessionEditError);
  });

  it('converts units and writes onset-owned typed locks', () => {
    const track = createDefaultTrack('lead-1', 'synth:lead', 'Lead');
    track.parameterLocks[0] = { release: 2 };
    const initial = createInitialSessionState({
      tempo: 120,
      tracks: [track],
    });
    const adsr = applyMcpSessionEdit(initial, {
      operation: 'set_track_envelope', track_id: 'lead-1',
      envelope: {
        model: 'adsr', attack: { value: 0.25, unit: 'seconds' },
        decay: { value: 0.25, unit: 'seconds' }, sustain: 0.7,
        release: { value: 0.5, unit: 'seconds' },
      },
    });
    const converted = applyMcpSessionEdit(adsr.state, {
      operation: 'convert_track_envelope_units', track_id: 'lead-1', target_unit: 'steps',
    });
    expect(converted.state.tracks[0]?.envelopeV2?.attack).toEqual({ value: 2, unit: 'steps' });
    const locked = applyMcpSessionEdit(converted.state, {
      operation: 'set_envelope_lock', track_id: 'lead-1', step: 0,
      stage: 'release', duration: { value: 4, unit: 'steps' },
    });
    expect(locked.state.tracks[0]?.parameterLocks[0]?.releaseDuration)
      .toEqual({ value: 4, unit: 'steps' });
    expect(locked.state.tracks[0]?.parameterLocks[0]?.release).toBeUndefined();
    expect(compactMcpSession({ id: 'session', immutable: false, state: locked.state }).tracks[0]
      ?.envelope_locks).toEqual([
        { step: 0, stage: 'release', duration: { value: 4, unit: 'steps' } },
      ]);
    expect(applyMcpSessionEdit(locked.state, {
      operation: 'set_envelope_lock', track_id: 'lead-1', step: 0,
      stage: 'release', duration: { value: 4, unit: 'steps' },
    })).toEqual({ state: locked.state, events: [], changed: false });
    const cleared = applyMcpSessionEdit(locked.state, {
      operation: 'set_envelope_lock', track_id: 'lead-1', step: 0,
      stage: 'release', duration: null,
    });
    expect(cleared.state.tracks[0]?.parameterLocks[0]).toBeNull();
    expect(applyMcpSessionEdit(cleared.state, {
      operation: 'set_envelope_lock', track_id: 'lead-1', step: 0,
      stage: 'release', duration: null,
    })).toEqual({ state: cleared.state, events: [], changed: false });
  });

  it('converts canonical envelope units instead of changing only the legacy label', () => {
    const track = createDefaultTrack('lead-units', 'synth:lead', 'Lead');
    track.envelopeV2 = {
      model: 'adsr',
      attack: { value: 0.25, unit: 'seconds' },
      decay: { value: 0.5, unit: 'seconds' },
      sustain: 0.6,
      release: { value: 1, unit: 'seconds' },
    };
    const initial = createInitialSessionState({ tempo: 120, tracks: [track] });
    const converted = applyMcpSessionEdit(initial, {
      operation: 'set_track_envelope_time_unit', track_id: track.id, unit: 'steps',
    });

    expect(converted.state.tracks[0]?.envelopeV2).toEqual({
      model: 'adsr',
      attack: { value: 2, unit: 'steps' },
      decay: { value: 4, unit: 'steps' },
      sustain: 0.6,
      release: { value: 8, unit: 'steps' },
    });
    expect(converted.events.map(event => event.type)).toEqual([
      'track_envelope_time_unit_set',
      'track_envelope_units_v2_converted',
    ]);
  });

  it('clamps MCP unit conversion before storing the converted envelope', () => {
    const track = createDefaultTrack('lead-fast', 'synth:lead', 'Fast Lead');
    track.envelopeV2 = {
      model: 'ar',
      attack: { value: 48, unit: 'steps' },
      release: { value: 96, unit: 'steps' },
    };
    const initial = createInitialSessionState({ tempo: 60, tracks: [track] });

    const converted = applyMcpSessionEdit(initial, {
      operation: 'convert_track_envelope_units',
      track_id: 'lead-fast',
      target_unit: 'seconds',
    });

    expect(converted.state.tracks[0]?.envelopeV2).toMatchObject({
      model: 'ar',
      attack: { value: 4, unit: 'seconds' },
      release: { value: 8, unit: 'seconds' },
    });
  });

  it('rejects reusing a track ID for a different track', () => {
    const state = applyMcpSessionEdit(createInitialSessionState(), {
      operation: 'add_track',
      track_id: 'agent-track-a7f3c29d',
      sample_id: 'kick',
    }).state;

    expect(() => applyMcpSessionEdit(state, {
      operation: 'add_track',
      track_id: 'agent-track-a7f3c29d',
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

  it('rejects predictable new track IDs without a collision-resistant suffix', () => {
    expect(() => applyMcpSessionEdit(createInitialSessionState(), {
      operation: 'add_track',
      track_id: 'agent-kick-1',
      sample_id: 'kick',
    })).toThrowError(/at least eight hexadecimal characters/);
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
      const state = createInitialSessionState({ tracks: [track] });

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
      const state = createInitialSessionState({ tracks: [workedOnTrack()] });
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
      const state = createInitialSessionState({ tracks: [workedOnTrack()] });

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
      const state = createInitialSessionState({ tracks: [workedOnTrack()] });

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
      const state = createInitialSessionState({ tracks: [mine, theirs] });

      const result = applyMcpSessionEdit(state, {
        operation: 'set_track_instrument',
        track_id: 'lead-1',
        sample_id: 'kick',
      });

      expect(result.state.tracks[1]).toBe(theirs);
      expect(result.state.tracks.map((t) => t.id)).toEqual(['lead-1', 'snare-1']);
    });
  });

  describe('set_track_pan', () => {
    it('uses normalized units, preserves the track, and is retry-safe', () => {
      const track = createDefaultTrack('lead-1', 'synth:lead', 'Lead');
      track.steps[3] = true;
      const state = createInitialSessionState({ tracks: [track] });
      const edit = { operation: 'set_track_pan' as const, track_id: 'lead-1', pan: -0.2 };

      const result = applyMcpSessionEdit(state, edit);
      expect(result.state.tracks[0]).toEqual({ ...track, pan: -0.2 });
      expect(result.events).toEqual([{ type: 'track_pan_set', trackId: 'lead-1', pan: -0.2 }]);
      expect(applyMcpSessionEdit(result.state, edit)).toEqual({
        state: result.state,
        events: [],
        changed: false,
      });
    });

    it.each([NaN, Infinity, -1.01, 1.01])('rejects invalid pan %s with no mutation', (pan) => {
      const track = createDefaultTrack('lead-1', 'synth:lead', 'Lead');
      const state = createInitialSessionState({ tracks: [track] });
      expect(() => applyMcpSessionEdit(state, {
        operation: 'set_track_pan',
        track_id: 'lead-1',
        pan,
      })).toThrowError(/normalized number from -1 to 1/);
      expect(state.tracks[0]?.pan).toBe(0);
    });
  });
});
