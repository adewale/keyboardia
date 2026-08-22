import { VALID_SAMPLE_IDS, getInstrumentName } from '../shared/instrument-catalog';
import { DEFAULT_STEP_COUNT, MAX_STEPS, MAX_TRACKS, MAX_TEMPO, MIN_TEMPO } from '../shared/constants';
import type { Session, SessionState, SessionTrack } from '../shared/state';
import { createDefaultTrack } from '../shared/state-mutations';
import { setTrackInstrument } from '../shared/track-instrument';
import { MAX_TRACK_NAME_LENGTH, sanitizeTrackName } from '../shared/validation';
import { isValidPan } from '../shared/validation';
import { recommendedTrackPan } from '../shared/track-pan';
import type { EnvelopeTimeUnit, TrackEnvelope } from '../shared/sync-types';
import type {
  EnvelopeDuration,
  EnvelopeDurationUnit,
  EnvelopeStageName,
  SamplePlaybackMode,
  TrackEnvelopeV2,
} from '../shared/envelope-contract-v2';
import {
  convertTrackEnvelopeUnitsWithReportV2,
  ENVELOPE_DURATION_RANGES_V2,
  isEnvelopeDuration,
  isSamplePlaybackMode,
  legacyTrackEnvelopeToV2,
  trackEnvelopeV2ToLegacySeconds,
  validateTrackEnvelopeV2,
} from '../shared/envelope-contract-v2';
import {
  clampTrackEnvelope,
  DEFAULT_TRACK_GATE,
  isTrackEnvelope,
  TRACK_GATE_RANGE,
  getEffectiveTrackEnvelope,
  getEffectiveTrackEnvelopeV2,
} from '../shared/envelope';
import { describeEnvelopeCompatibility, getEnvelopeCapability } from '../shared/envelope-capabilities';
import { applyEnvelopeLockDurationV2 } from '../shared/envelope-lock-v2';

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

type McpCompactEnvelopeV2 =
  | { model: 'ad'; attack: number; decay: number; duration_unit: EnvelopeDurationUnit }
  | { model: 'ahd'; attack: number; hold: number; decay: number; duration_unit: EnvelopeDurationUnit }
  | { model: 'ar'; attack: number; release: number; duration_unit: EnvelopeDurationUnit }
  | { model: 'adsr'; attack: number; decay: number; sustain: number; release: number; duration_unit: EnvelopeDurationUnit };

export type McpEnvelopeInput = TrackEnvelope | TrackEnvelopeV2 | McpCompactEnvelopeV2;

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
    }
  | {
      operation: 'set_track_envelope';
      track_id: string;
      envelope: McpEnvelopeInput | null;
      gate?: number;
      sample_playback_mode?: SamplePlaybackMode;
    }
  | {
      operation: 'set_track_envelope_time_unit';
      track_id: string;
      unit: EnvelopeTimeUnit;
    }
  | {
      operation: 'set_track_gate';
      track_id: string;
      gate: number;
    }
  | {
      operation: 'convert_track_envelope_units';
      track_id: string;
      target_unit: EnvelopeDurationUnit;
    }
  | {
      operation: 'set_track_sample_playback_mode';
      track_id: string;
      mode: SamplePlaybackMode | null;
    }
  | {
      operation: 'set_envelope_lock';
      track_id: string;
      step: number;
      stage: EnvelopeStageName;
      duration: EnvelopeDuration | null;
    };

export type McpEditEvent =
  | { type: 'track_added'; track: SessionTrack }
  | { type: 'track_instrument_set'; trackId: string; sampleId: string; name: string }
  | { type: 'track_pan_set'; trackId: string; pan: number }
  | { type: 'step_toggled'; trackId: string; step: number; value: boolean }
  | { type: 'tempo_changed'; tempo: number }
  | { type: 'track_envelope_set'; trackId: string; envelope: TrackEnvelope | null }
  | { type: 'track_envelope_time_unit_set'; trackId: string; unit: EnvelopeTimeUnit }
  | { type: 'track_gate_set'; trackId: string; gate: number }
  | { type: 'track_envelope_v2_set'; trackId: string; envelope: TrackEnvelopeV2 | null }
  | { type: 'track_envelope_units_v2_converted'; trackId: string; envelope: TrackEnvelopeV2 }
  | { type: 'track_sample_playback_mode_v2_set'; trackId: string; mode: SamplePlaybackMode | null }
  | { type: 'envelope_lock_v2_set'; trackId: string; step: number; stage: EnvelopeStageName; duration: EnvelopeDuration | null };

export interface CompactMcpTrack {
  track_id: string;
  name: string;
  sample_id: string;
  step_count: number;
  active_steps: number[];
  pan: number;
  envelope: TrackEnvelope;
  envelope_override: boolean;
  envelope_time_unit: EnvelopeTimeUnit;
  gate: number;
  authored_envelope?: TrackEnvelopeV2 | null;
  effective_envelope?: TrackEnvelopeV2;
  sample_playback_mode?: SamplePlaybackMode;
  envelope_capability?: ReturnType<typeof getEnvelopeCapability>;
  envelope_active?: boolean;
  ignored_envelope_stages?: readonly string[];
  inactive_envelope_reason?: string;
  envelope_locks?: Array<{
    step: number;
    stage: EnvelopeStageName;
    duration: EnvelopeDuration;
  }>;
}

export interface CompactMcpSession {
  session_id: string;
  immutable: boolean;
  tempo: number;
  tracks: CompactMcpTrack[];
}

export class McpSessionEditError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    code: string,
    status: number
  ) {
    super(message);
    this.code = code;
    this.status = status;
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
      const envelopeV2 = getEffectiveTrackEnvelopeV2(track);
      // Keep the original v1 projection truthful. Legacy-authored values retain
      // their declared unit; canonical-only values are explicitly projected to
      // seconds; preset-only tracks keep the preset ADSR view older clients
      // already understand instead of pretending a finite AHD safety fade is
      // an eight-second ADSR decay.
      const effectiveLegacyEnvelope = track.envelope
        ? clampTrackEnvelope(track.envelope)
        : envelopeV2.authored
          ? trackEnvelopeV2ToLegacySeconds(envelopeV2.effective, session.state.tempo)
          : getEffectiveTrackEnvelope(track);
      const legacyEnvelopeUnit: EnvelopeTimeUnit = track.envelope
        ? (track.envelopeTimeUnit ?? 'seconds')
        : envelopeV2.authored
          ? 'seconds'
          : (track.envelopeTimeUnit ?? 'seconds');
      const envelopeLocks = track.parameterLocks.slice(0, stepCount).flatMap((lock, step) => {
        if (!lock) return [];
        return (['attack', 'hold', 'decay', 'release'] as const).flatMap(stage => {
          const duration = lock[`${stage}Duration` as const];
          return duration ? [{ step, stage, duration }] : [];
        });
      });
      return {
        track_id: track.id,
        name: track.name,
        sample_id: track.sampleId,
        step_count: stepCount,
        active_steps: track.steps
          .slice(0, stepCount)
          .flatMap((active, step) => active ? [step] : []),
        pan: track.pan ?? 0,
        envelope: effectiveLegacyEnvelope,
        envelope_override: envelopeV2.authored !== null,
        envelope_time_unit: legacyEnvelopeUnit,
        gate: track.gate ?? DEFAULT_TRACK_GATE,
        authored_envelope: envelopeV2.authored,
        effective_envelope: envelopeV2.effective,
        ...(envelopeV2.playbackMode ? { sample_playback_mode: envelopeV2.playbackMode } : {}),
        envelope_capability: envelopeV2.capability,
        envelope_active: envelopeV2.active,
        ignored_envelope_stages: envelopeV2.ignoredStages,
        ...(envelopeV2.inactiveReason
          ? { inactive_envelope_reason: envelopeV2.inactiveReason }
          : {}),
        envelope_locks: envelopeLocks,
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

function normalizeMcpEnvelopeV2(value: McpEnvelopeInput): TrackEnvelopeV2 | null {
  const direct = validateTrackEnvelopeV2(value);
  if (direct.valid) return direct.envelope ?? null;
  if (!value || typeof value !== 'object' || !('model' in value)) {
    return isTrackEnvelope(value) ? legacyTrackEnvelopeToV2(value) : null;
  }
  if (!('duration_unit' in value)) {
    return null;
  }
  const compact = value as McpCompactEnvelopeV2;
  const unit = compact.duration_unit;
  if (unit !== 'seconds' && unit !== 'steps') return null;
  const duration = (stage: 'attack' | 'hold' | 'decay' | 'release'): EnvelopeDuration | null => {
    const raw = (compact as unknown as Record<string, unknown>)[stage];
    return typeof raw === 'number' && Number.isFinite(raw) ? { value: raw, unit } : null;
  };
  const attack = duration('attack');
  let expanded: unknown;
  if (!attack) return null;
  if (compact.model === 'ad') {
    const decay = duration('decay');
    expanded = decay && { model: 'ad', attack, decay };
  } else if (compact.model === 'ahd') {
    const hold = duration('hold');
    const decay = duration('decay');
    expanded = hold && decay && { model: 'ahd', attack, hold, decay };
  } else if (compact.model === 'ar') {
    const release = duration('release');
    expanded = release && { model: 'ar', attack, release };
  } else {
    const decay = duration('decay');
    const release = duration('release');
    expanded = decay && release && {
      model: 'adsr', attack, decay, sustain: compact.sustain, release,
    };
  }
  const result = validateTrackEnvelopeV2(expanded);
  return result.valid ? result.envelope ?? null : null;
}

function assertPlaybackCompatibility(
  track: SessionTrack,
  envelope: TrackEnvelopeV2,
  playbackMode?: SamplePlaybackMode,
): void {
  const compatibility = describeEnvelopeCompatibility(
    track.sampleId,
    envelope,
    playbackMode ?? track.samplePlaybackMode ?? getEnvelopeCapability(track.sampleId).defaultPlaybackMode,
  );
  if (!compatibility.active) {
    throw new McpSessionEditError(
      compatibility.reason ?? 'Envelope is not supported by this instrument.',
      'UNSUPPORTED_ENVELOPE_CAPABILITY',
      400,
    );
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

  if (edit.operation === 'set_track_envelope') {
    const trackIndex = state.tracks.findIndex((track) => track.id === edit.track_id);
    if (trackIndex === -1) {
      throw new McpSessionEditError(`Track not found: ${edit.track_id}`, 'TRACK_NOT_FOUND', 404);
    }
    const isLegacy = edit.envelope !== null
      && !('model' in edit.envelope)
      && isTrackEnvelope(edit.envelope);
    const envelopeV2 = edit.envelope === null ? null : normalizeMcpEnvelopeV2(edit.envelope);
    if (edit.envelope !== null && !envelopeV2) {
      throw new McpSessionEditError(
        'envelope must be a valid AD, AHD, AR, or ADSR value with typed durations or duration_unit.',
        'INVALID_ENVELOPE',
        400,
      );
    }
    if (envelopeV2) assertPlaybackCompatibility(
      state.tracks[trackIndex]!,
      envelopeV2,
      edit.sample_playback_mode,
    );
    if (edit.sample_playback_mode !== undefined
      && !getEnvelopeCapability(state.tracks[trackIndex]!.sampleId)
        .samplePlaybackModes?.includes(edit.sample_playback_mode)) {
      throw new McpSessionEditError(
        `Playback mode ${edit.sample_playback_mode} is not supported by this instrument.`,
        'UNSUPPORTED_SAMPLE_PLAYBACK_MODE',
        400,
      );
    }
    if (edit.gate !== undefined
      && (!Number.isFinite(edit.gate) || edit.gate < TRACK_GATE_RANGE.min || edit.gate > TRACK_GATE_RANGE.max)) {
      throw new McpSessionEditError('gate must be between 0 and 100.', 'INVALID_TRACK_GATE', 400);
    }
    const envelope = isLegacy ? clampTrackEnvelope(edit.envelope as TrackEnvelope) : null;
    const currentTrack = state.tracks[trackIndex]!;
    const current = currentTrack.envelope;
    const currentV2 = currentTrack.envelopeV2;
    const envelopeUnchanged = edit.envelope === null
      ? current === undefined && currentV2 === undefined
      : isLegacy
        ? envelope !== null && current !== undefined
          && envelope.attack === current.attack
          && envelope.decay === current.decay
          && envelope.sustain === current.sustain
          && envelope.release === current.release
          && JSON.stringify(currentV2) === JSON.stringify(envelopeV2)
        : JSON.stringify(currentV2) === JSON.stringify(envelopeV2);
    const gateUnchanged = edit.gate === undefined || currentTrack.gate === edit.gate;
    const playbackModeUnchanged = edit.sample_playback_mode === undefined
      || currentTrack.samplePlaybackMode === edit.sample_playback_mode;
    if (envelopeUnchanged && gateUnchanged && playbackModeUnchanged) {
      return { state, events: [], changed: false };
    }
    const tracks = [...state.tracks];
    const track = { ...tracks[trackIndex]! };
    if (edit.envelope === null) {
      delete track.envelope;
      delete track.envelopeV2;
    } else {
      if (isLegacy && envelope) track.envelope = envelope;
      else delete track.envelope;
      if (envelopeV2) track.envelopeV2 = envelopeV2;
    }
    if (edit.gate !== undefined) track.gate = edit.gate;
    if (edit.sample_playback_mode !== undefined) track.samplePlaybackMode = edit.sample_playback_mode;
    tracks[trackIndex] = track;
    const events: McpEditEvent[] = isLegacy || edit.envelope === null
      ? [
          // Preserve the legacy broadcast for old clients, then send the
          // parallel v2 mutation so capable clients update the field that wins
          // effective-value precedence. Old clients receive a safe snapshot as
          // the Worker's normal capability fallback for the second event.
          { type: 'track_envelope_set', trackId: edit.track_id, envelope },
          { type: 'track_envelope_v2_set', trackId: edit.track_id, envelope: envelopeV2 },
        ]
      : [{ type: 'track_envelope_v2_set', trackId: edit.track_id, envelope: envelopeV2 }];
    if (edit.gate !== undefined) events.push({ type: 'track_gate_set', trackId: edit.track_id, gate: edit.gate });
    if (edit.sample_playback_mode !== undefined) events.push({
      type: 'track_sample_playback_mode_v2_set',
      trackId: edit.track_id,
      mode: edit.sample_playback_mode,
    });
    return {
      state: { ...state, tracks },
      events,
      changed: true,
    };
  }

  if (edit.operation === 'convert_track_envelope_units') {
    const trackIndex = state.tracks.findIndex(track => track.id === edit.track_id);
    if (trackIndex === -1) throw new McpSessionEditError(`Track not found: ${edit.track_id}`, 'TRACK_NOT_FOUND', 404);
    if (edit.target_unit !== 'seconds' && edit.target_unit !== 'steps') {
      throw new McpSessionEditError('target_unit must be seconds or steps.', 'INVALID_ENVELOPE_TIME_UNIT', 400);
    }
    const current = state.tracks[trackIndex]!.envelopeV2;
    if (!current) throw new McpSessionEditError('Track has no authored v2 envelope.', 'ENVELOPE_NOT_AUTHORED', 409);
    const envelope = convertTrackEnvelopeUnitsWithReportV2(
      current,
      edit.target_unit,
      state.tempo,
    ).envelope;
    if (JSON.stringify(envelope) === JSON.stringify(current)) return { state, events: [], changed: false };
    const tracks = [...state.tracks];
    tracks[trackIndex] = { ...tracks[trackIndex]!, envelopeV2: envelope };
    return {
      state: { ...state, tracks },
      events: [{ type: 'track_envelope_units_v2_converted', trackId: edit.track_id, envelope }],
      changed: true,
    };
  }

  if (edit.operation === 'set_track_sample_playback_mode') {
    const trackIndex = state.tracks.findIndex(track => track.id === edit.track_id);
    if (trackIndex === -1) throw new McpSessionEditError(`Track not found: ${edit.track_id}`, 'TRACK_NOT_FOUND', 404);
    if (edit.mode !== null && !isSamplePlaybackMode(edit.mode)) {
      throw new McpSessionEditError('mode must be trigger, gate, loop, or null.', 'INVALID_SAMPLE_PLAYBACK_MODE', 400);
    }
    const track = state.tracks[trackIndex]!;
    if (edit.mode !== null && !getEnvelopeCapability(track.sampleId).samplePlaybackModes?.includes(edit.mode)) {
      throw new McpSessionEditError(`Playback mode ${edit.mode} is not supported by ${track.sampleId}.`, 'UNSUPPORTED_SAMPLE_PLAYBACK_MODE', 400);
    }
    if ((track.samplePlaybackMode ?? null) === edit.mode) return { state, events: [], changed: false };
    const tracks = [...state.tracks];
    const next = { ...track };
    if (edit.mode === null) delete next.samplePlaybackMode;
    else next.samplePlaybackMode = edit.mode;
    tracks[trackIndex] = next;
    return {
      state: { ...state, tracks },
      events: [{ type: 'track_sample_playback_mode_v2_set', trackId: edit.track_id, mode: edit.mode }],
      changed: true,
    };
  }

  if (edit.operation === 'set_envelope_lock') {
    const trackIndex = state.tracks.findIndex(track => track.id === edit.track_id);
    if (trackIndex === -1) throw new McpSessionEditError(`Track not found: ${edit.track_id}`, 'TRACK_NOT_FOUND', 404);
    const track = state.tracks[trackIndex]!;
    const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
    if (!Number.isInteger(edit.step) || edit.step < 0 || edit.step >= stepCount) {
      throw new McpSessionEditError(`step must be within this track's ${stepCount}-step loop.`, 'STEP_OUTSIDE_LOOP', 400);
    }
    if (!['attack', 'hold', 'decay', 'release'].includes(edit.stage)) {
      throw new McpSessionEditError('stage must be attack, hold, decay, or release.', 'INVALID_ENVELOPE_STAGE', 400);
    }
    if (edit.duration !== null) {
      if (!isEnvelopeDuration(edit.duration)) {
        throw new McpSessionEditError('duration must contain finite value and seconds/steps unit.', 'INVALID_ENVELOPE_DURATION', 400);
      }
      const range = ENVELOPE_DURATION_RANGES_V2[edit.stage][edit.duration.unit];
      if (edit.duration.value < range.min || edit.duration.value > range.max) {
        throw new McpSessionEditError(`duration must be ${range.min}-${range.max} ${edit.duration.unit}.`, 'INVALID_ENVELOPE_DURATION', 400);
      }
      if (!getEnvelopeCapability(track.sampleId).lockableStages.includes(edit.stage)) {
        throw new McpSessionEditError(`${edit.stage} is not lockable for ${track.sampleId}.`, 'UNSUPPORTED_ENVELOPE_STAGE', 400);
      }
    }
    const parameterLocks = [...track.parameterLocks];
    const currentLock = parameterLocks[edit.step];
    const nextLock = applyEnvelopeLockDurationV2(
      currentLock,
      edit.stage,
      edit.duration,
    );
    if (JSON.stringify(nextLock) === JSON.stringify(currentLock)) {
      return { state, events: [], changed: false };
    }
    parameterLocks[edit.step] = nextLock;
    const tracks = [...state.tracks];
    tracks[trackIndex] = { ...track, parameterLocks };
    return {
      state: { ...state, tracks },
      events: [{
        type: 'envelope_lock_v2_set', trackId: edit.track_id, step: edit.step,
        stage: edit.stage, duration: edit.duration,
      }],
      changed: true,
    };
  }

  if (edit.operation === 'set_track_envelope_time_unit') {
    const trackIndex = state.tracks.findIndex((track) => track.id === edit.track_id);
    if (trackIndex === -1) {
      throw new McpSessionEditError(`Track not found: ${edit.track_id}`, 'TRACK_NOT_FOUND', 404);
    }
    if (edit.unit !== 'seconds' && edit.unit !== 'steps') {
      throw new McpSessionEditError('unit must be "seconds" or "steps".', 'INVALID_ENVELOPE_TIME_UNIT', 400);
    }
    const currentTrack = state.tracks[trackIndex]!;
    const currentEnvelope = currentTrack.envelopeV2
      ?? (currentTrack.envelope
        ? legacyTrackEnvelopeToV2(currentTrack.envelope, currentTrack.envelopeTimeUnit ?? 'seconds')
        : null);
    if (!currentEnvelope) {
      if ((currentTrack.envelopeTimeUnit ?? 'seconds') === edit.unit) {
        return { state, events: [], changed: false };
      }
      const tracks = [...state.tracks];
      tracks[trackIndex] = { ...currentTrack, envelopeTimeUnit: edit.unit };
      return {
        state: { ...state, tracks },
        events: [{ type: 'track_envelope_time_unit_set', trackId: edit.track_id, unit: edit.unit }],
        changed: true,
      };
    }
    const converted = convertTrackEnvelopeUnitsWithReportV2(
      currentEnvelope,
      edit.unit,
      state.tempo,
    ).envelope;
    if ((currentTrack.envelopeTimeUnit ?? 'seconds') === edit.unit
      && JSON.stringify(currentTrack.envelopeV2) === JSON.stringify(converted)) {
      return { state, events: [], changed: false };
    }
    const tracks = [...state.tracks];
    const next = { ...currentTrack, envelopeTimeUnit: edit.unit, envelopeV2: converted };
    if (converted.model === 'adsr') {
      next.envelope = {
        attack: converted.attack.value,
        decay: converted.decay.value,
        sustain: converted.sustain,
        release: converted.release.value,
      };
    }
    tracks[trackIndex] = next;
    return {
      state: { ...state, tracks },
      events: [
        { type: 'track_envelope_time_unit_set', trackId: edit.track_id, unit: edit.unit },
        { type: 'track_envelope_units_v2_converted', trackId: edit.track_id, envelope: converted },
      ],
      changed: true,
    };
  }

  if (edit.operation === 'set_track_gate') {
    const trackIndex = state.tracks.findIndex((track) => track.id === edit.track_id);
    if (trackIndex === -1) {
      throw new McpSessionEditError(`Track not found: ${edit.track_id}`, 'TRACK_NOT_FOUND', 404);
    }
    if (!Number.isFinite(edit.gate) || edit.gate < TRACK_GATE_RANGE.min || edit.gate > TRACK_GATE_RANGE.max) {
      throw new McpSessionEditError('gate must be between 0 and 100.', 'INVALID_TRACK_GATE', 400);
    }
    if ((state.tracks[trackIndex]!.gate ?? DEFAULT_TRACK_GATE) === edit.gate) {
      return { state, events: [], changed: false };
    }
    const tracks = [...state.tracks];
    tracks[trackIndex] = { ...tracks[trackIndex]!, gate: edit.gate };
    return {
      state: { ...state, tracks },
      events: [{ type: 'track_gate_set', trackId: edit.track_id, gate: edit.gate }],
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
