import { VALID_SAMPLE_IDS, getInstrumentName } from '../components/sample-constants';
import { DEFAULT_STEP_COUNT, MAX_STEPS, MAX_TRACKS, MAX_TEMPO, MIN_TEMPO } from '../shared/constants';
import type { Session, SessionState, SessionTrack } from '../shared/state';
import { createDefaultTrack } from '../shared/state-mutations';
import { MAX_TRACK_NAME_LENGTH, sanitizeTrackName } from '../shared/validation';

export const MCP_ACTOR_ID = 'mcp';

export const MCP_SAMPLE_IDS = [...VALID_SAMPLE_IDS].sort();

export type McpRhythmEdit =
  | {
      operation: 'add_track';
      track_id: string;
      sample_id: string;
      name?: string;
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

export type McpRhythmEvent =
  | { type: 'track_added'; track: SessionTrack }
  | { type: 'step_toggled'; trackId: string; step: number; value: boolean }
  | { type: 'tempo_changed'; tempo: number };

export interface CompactMcpTrack {
  track_id: string;
  name: string;
  sample_id: string;
  step_count: number;
  active_steps: number[];
}

export interface CompactMcpSession {
  session_id: string;
  immutable: boolean;
  tempo: number;
  tracks: CompactMcpTrack[];
}

export class McpRhythmEditError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'McpRhythmEditError';
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
      };
    }),
  };
}

function assertValidTrackId(trackId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(trackId)) {
    throw new McpRhythmEditError(
      'track_id must be 1-64 characters and use only letters, numbers, ".", "_", ":", or "-".',
      'INVALID_TRACK_ID',
      400
    );
  }
}

function assertUniqueValidChanges(changes: Array<{ step: number; value: boolean }>): void {
  if (changes.length === 0 || changes.length > MAX_STEPS) {
    throw new McpRhythmEditError(
      `changes must contain between 1 and ${MAX_STEPS} step assignments.`,
      'INVALID_STEPS',
      400
    );
  }

  const seen = new Set<number>();
  for (const change of changes) {
    if (!Number.isInteger(change.step) || change.step < 0 || change.step >= MAX_STEPS) {
      throw new McpRhythmEditError(
        `step must be an integer from 0 to ${MAX_STEPS - 1}.`,
        'INVALID_STEP',
        400
      );
    }
    if (seen.has(change.step)) {
      throw new McpRhythmEditError(
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
export function applyMcpRhythmEdit(
  state: SessionState,
  edit: McpRhythmEdit
): { state: SessionState; events: McpRhythmEvent[]; changed: boolean } {
  if (edit.operation === 'set_tempo') {
    if (!Number.isFinite(edit.tempo) || edit.tempo < MIN_TEMPO || edit.tempo > MAX_TEMPO) {
      throw new McpRhythmEditError(
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
    if (!VALID_SAMPLE_IDS.has(edit.sample_id)) {
      throw new McpRhythmEditError(
        `Unknown sample_id: ${edit.sample_id}`,
        'INVALID_SAMPLE_ID',
        400
      );
    }

    const name = sanitizeTrackName(edit.name ?? getInstrumentName(edit.sample_id));
    if (!name) {
      throw new McpRhythmEditError(
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
      throw new McpRhythmEditError(
        `track_id ${edit.track_id} already belongs to a different track.`,
        'TRACK_ID_CONFLICT',
        409
      );
    }

    if (state.tracks.length >= MAX_TRACKS) {
      throw new McpRhythmEditError(
        `A session can contain at most ${MAX_TRACKS} tracks.`,
        'TRACK_LIMIT_REACHED',
        409
      );
    }

    const track = createDefaultTrack(edit.track_id, edit.sample_id, name);
    return {
      state: { ...state, tracks: [...state.tracks, track] },
      events: [{ type: 'track_added', track }],
      changed: true,
    };
  }

  assertUniqueValidChanges(edit.changes);
  const trackIndex = state.tracks.findIndex((track) => track.id === edit.track_id);
  if (trackIndex === -1) {
    throw new McpRhythmEditError(
      `Track not found: ${edit.track_id}`,
      'TRACK_NOT_FOUND',
      404
    );
  }

  const track = state.tracks[trackIndex]!;
  const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
  const outsideLoop = edit.changes.find((change) => change.step >= stepCount);
  if (outsideLoop) {
    throw new McpRhythmEditError(
      `step ${outsideLoop.step} is outside this track's ${stepCount}-step loop.`,
      'STEP_OUTSIDE_LOOP',
      400
    );
  }

  const steps = [...track.steps];
  const events: McpRhythmEvent[] = [];
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
