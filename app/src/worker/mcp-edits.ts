import { VALID_SAMPLE_IDS, getInstrumentName } from '../shared/instrument-catalog';
import { DEFAULT_STEP_COUNT, MAX_STEPS, MAX_TRACKS, MAX_TEMPO, MIN_TEMPO } from '../shared/constants';
import type { Session, SessionState, SessionTrack } from '../shared/state';
import { createDefaultTrack } from '../shared/state-mutations';
import { setTrackInstrument } from '../shared/track-instrument';
import { MAX_TRACK_NAME_LENGTH, sanitizeTrackName } from '../shared/validation';
import { isValidPan } from '../shared/validation';
import { recommendedTrackPan } from '../shared/track-pan';

export const MCP_ACTOR_ID = 'mcp';

export const MCP_SAMPLE_IDS = [...VALID_SAMPLE_IDS].sort();

/**
 * Caller-chosen track IDs deliberately exclude ":".
 *
 * The browser client builds its supersession keys as `${trackId}:${step}` for
 * step events and bare `trackId` for track events (see recordSupersession in
 * src/sync/multiplayer.ts). A track ID of "foo:3" would therefore produce the
 * same key as step 3 of track "foo", and an agent adding that track could make
 * a browser discard a collaborator's pending step edit. Browser-generated IDs
 * are `track-${Date.now()}`, so only MCP callers could reach the collision.
 */
export const TRACK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const NEW_TRACK_ID_PATTERN = /^(?=.{10,64}$)[A-Za-z0-9][A-Za-z0-9._-]*-[0-9a-fA-F]{8,32}$/;

export type McpSessionEdit =
  | {
      operation: 'add_track';
      track_id: string;
      sample_id: string;
      name?: string;
    }
  | {
      operation: 'set_track_instrument';
      track_id: string;
      sample_id: string;
    }
  | {
      operation: 'set_track_pan';
      track_id: string;
      pan: number;
    }
  | {
      operation: 'set_steps';
      track_id: string;
      changes: Array<{ step: number; value: boolean }>;
    }
  | {
      operation: 'set_tempo';
      tempo: number;
    };

export type McpEditEvent =
  | { type: 'track_added'; track: SessionTrack }
  | { type: 'track_instrument_set'; trackId: string; sampleId: string; name: string }
  | { type: 'track_pan_set'; trackId: string; pan: number }
  | { type: 'step_toggled'; trackId: string; step: number; value: boolean }
  | { type: 'tempo_changed'; tempo: number };

export interface CompactMcpTrack {
  track_id: string;
  name: string;
  sample_id: string;
  step_count: number;
  active_steps: number[];
  pan: number;
}

export interface CompactMcpSession {
  session_id: string;
  immutable: boolean;
  tempo: number;
  tracks: CompactMcpTrack[];
}

export class McpSessionEditError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'McpSessionEditError';
  }
}

export function compactMcpSession(session: Pick<Session, 'id' | 'immutable' | 'state'>): CompactMcpSession {
  return {
    session_id: session.id,
    immutable: session.immutable,
    tempo: session.state.tempo,
    tracks: session.state.tracks.map((track) => {
      const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
      return {
        track_id: track.id,
        name: track.name,
        sample_id: track.sampleId,
        step_count: stepCount,
        active_steps: track.steps
          .slice(0, stepCount)
          .flatMap((active, step) => active ? [step] : []),
        pan: track.pan ?? 0,
      };
    }),
  };
}

function assertValidTrackId(trackId: string): void {
  if (!TRACK_ID_PATTERN.test(trackId)) {
    throw new McpSessionEditError(
      'track_id must be 1-64 characters and use only letters, numbers, ".", "_", or "-".',
      'INVALID_TRACK_ID',
      400
    );
  }
}

function assertCollisionResistantNewTrackId(trackId: string): void {
  if (!NEW_TRACK_ID_PATTERN.test(trackId)) {
    throw new McpSessionEditError(
      'A new track_id must end with a hyphen and at least eight hexadecimal characters.',
      'INVALID_NEW_TRACK_ID',
      400
    );
  }
}

function assertUniqueValidChanges(changes: Array<{ step: number; value: boolean }>): void {
  if (changes.length === 0 || changes.length > MAX_STEPS) {
    throw new McpSessionEditError(
      `changes must contain between 1 and ${MAX_STEPS} step assignments.`,
      'INVALID_STEPS',
      400
    );
  }

  const seen = new Set<number>();
  for (const change of changes) {
    if (!Number.isInteger(change.step) || change.step < 0 || change.step >= MAX_STEPS) {
      throw new McpSessionEditError(
        `step must be an integer from 0 to ${MAX_STEPS - 1}.`,
        'INVALID_STEP',
        400
      );
    }
    if (seen.has(change.step)) {
      throw new McpSessionEditError(
        `step ${change.step} appears more than once.`,
        'DUPLICATE_STEP',
        400
      );
    }
    seen.add(change.step);
  }
}

/**
 * Applies the complete MCP v1 edit surface without replacing a session or track.
 * The returned events use Keyboardia's existing browser collaboration messages.
 */
export function applyMcpSessionEdit(
  state: SessionState,
  edit: McpSessionEdit
): { state: SessionState; events: McpEditEvent[]; changed: boolean } {
  if (edit.operation === 'set_tempo') {
    if (!Number.isFinite(edit.tempo) || edit.tempo < MIN_TEMPO || edit.tempo > MAX_TEMPO) {
      throw new McpSessionEditError(
        `tempo must be between ${MIN_TEMPO} and ${MAX_TEMPO} BPM.`,
        'INVALID_TEMPO',
        400
      );
    }

    if (state.tempo === edit.tempo) {
      return { state, events: [], changed: false };
    }

    return {
      state: { ...state, tempo: edit.tempo },
      events: [{ type: 'tempo_changed', tempo: edit.tempo }],
      changed: true,
    };
  }

  assertValidTrackId(edit.track_id);

  if (edit.operation === 'add_track') {
    assertCollisionResistantNewTrackId(edit.track_id);
    if (!VALID_SAMPLE_IDS.has(edit.sample_id)) {
      throw new McpSessionEditError(
        `Unknown sample_id: ${edit.sample_id}`,
        'INVALID_SAMPLE_ID',
        400
      );
    }

    const name = sanitizeTrackName(edit.name ?? getInstrumentName(edit.sample_id));
    if (!name) {
      throw new McpSessionEditError(
        `name must contain between 1 and ${MAX_TRACK_NAME_LENGTH} characters.`,
        'INVALID_TRACK_NAME',
        400
      );
    }

    const existing = state.tracks.find((track) => track.id === edit.track_id);
    if (existing) {
      if (existing.sampleId === edit.sample_id && existing.name === name) {
        return { state, events: [], changed: false };
      }
      throw new McpSessionEditError(
        `track_id ${edit.track_id} already belongs to a different track.`,
        'TRACK_ID_CONFLICT',
        409
      );
    }

    if (state.tracks.length >= MAX_TRACKS) {
      throw new McpSessionEditError(
        `A session can contain at most ${MAX_TRACKS} tracks.`,
        'TRACK_LIMIT_REACHED',
        409
      );
    }

    const track = createDefaultTrack(edit.track_id, edit.sample_id, name);
    track.pan = recommendedTrackPan(edit.sample_id, state.tracks.length);
    return {
      state: { ...state, tracks: [...state.tracks, track] },
      events: [{ type: 'track_added', track }],
      changed: true,
    };
  }

  if (edit.operation === 'set_track_instrument') {
    // Change instrument (issue #63). The catalog check, the field preservation,
    // and the engine-state policy all live in the shared domain operation, so an
    // agent and a browser cannot reach different results. See
    // specs/CHANGE-INSTRUMENT.md.
    const result = setTrackInstrument(state, {
      trackId: edit.track_id,
      sampleId: edit.sample_id,
    });

    if (!result.ok) {
      throw new McpSessionEditError(
        result.error.message,
        result.error.code,
        result.error.code === 'TRACK_NOT_FOUND' ? 404 : 400
      );
    }

    if (!result.changed) {
      return { state, events: [], changed: false };
    }

    return {
      state: result.state,
      events: [{
        type: 'track_instrument_set',
        trackId: edit.track_id,
        sampleId: edit.sample_id,
        name: result.track.name,
      }],
      changed: true,
    };
  }

  if (edit.operation === 'set_track_pan') {
    if (!isValidPan(edit.pan)) {
      throw new McpSessionEditError(
        'pan must be a finite normalized number from -1 to 1.',
        'INVALID_PAN',
        400
      );
    }
    const trackIndex = state.tracks.findIndex((track) => track.id === edit.track_id);
    if (trackIndex === -1) {
      throw new McpSessionEditError(
        `Track not found: ${edit.track_id}`,
        'TRACK_NOT_FOUND',
        404
      );
    }
    const track = state.tracks[trackIndex]!;
    if ((track.pan ?? 0) === edit.pan) {
      return { state, events: [], changed: false };
    }
    const tracks = [...state.tracks];
    tracks[trackIndex] = { ...track, pan: edit.pan };
    return {
      state: { ...state, tracks },
      events: [{ type: 'track_pan_set', trackId: edit.track_id, pan: edit.pan }],
      changed: true,
    };
  }

  assertUniqueValidChanges(edit.changes);
  const trackIndex = state.tracks.findIndex((track) => track.id === edit.track_id);
  if (trackIndex === -1) {
    throw new McpSessionEditError(
      `Track not found: ${edit.track_id}`,
      'TRACK_NOT_FOUND',
      404
    );
  }

  const track = state.tracks[trackIndex]!;
  const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
  const outsideLoop = edit.changes.find((change) => change.step >= stepCount);
  if (outsideLoop) {
    throw new McpSessionEditError(
      `step ${outsideLoop.step} is outside this track's ${stepCount}-step loop.`,
      'STEP_OUTSIDE_LOOP',
      400
    );
  }

  const steps = [...track.steps];
  const events: McpEditEvent[] = [];
  for (const change of edit.changes) {
    if (steps[change.step] !== change.value) {
      steps[change.step] = change.value;
      events.push({
        type: 'step_toggled',
        trackId: edit.track_id,
        step: change.step,
        value: change.value,
      });
    }
  }

  if (events.length === 0) {
    return { state, events, changed: false };
  }

  const tracks = [...state.tracks];
  tracks[trackIndex] = { ...track, steps };
  return {
    state: { ...state, tracks },
    events,
    changed: true,
  };
}
