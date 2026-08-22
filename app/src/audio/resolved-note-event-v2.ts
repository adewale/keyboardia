/**
 * Runtime-neutral note-event resolution shared by both schedulers.
 *
 * This module deliberately has no Web Audio, DOM, timer, engine, or state-store
 * dependencies. Its result can cross an AudioWorklet MessagePort unchanged.
 * Renderers may initially consume only the compatibility fields (`time`,
 * `duration`, and `envelopeLock`); the explicit v2 fields keep the scheduling
 * decision observable while the managed-voice adapters are introduced.
 */

import {
  durationToSeconds,
  resolveEnvelopeV2,
  type EnvelopeDuration,
  type EnvelopeDurationUnit,
  type ResolvedEnvelopeV2,
  type SamplePlaybackMode,
  type TrackEnvelopeV2,
} from '../shared/envelope-contract-v2';
import { DEFAULT_TRACK_GATE, getEffectiveTrackEnvelopeV2 } from '../shared/envelope';
import { calculateSwingDelay } from './timing-calculations';
import type { TrackEnvelope } from '../shared/sync-types';

export interface SchedulerDurationLocksV2 {
  attack?: number;
  hold?: number;
  decay?: number;
  release?: number;
}

export interface SchedulerParameterLockV2 extends SchedulerDurationLocksV2 {
  pitch?: number;
  volume?: number;
  tie?: boolean;
  attackDuration?: EnvelopeDuration;
  holdDuration?: EnvelopeDuration;
  decayDuration?: EnvelopeDuration;
  releaseDuration?: EnvelopeDuration;
}

/** The smallest track shape needed to resolve one note onset. */
export interface SchedulerTrackV2 {
  id: string;
  sampleId: string;
  steps: readonly boolean[];
  parameterLocks: readonly (SchedulerParameterLockV2 | null)[];
  stepCount?: number;
  muted: boolean;
  soloed: boolean;
  transpose?: number;
  swing?: number;
  gate?: number;
  envelope?: TrackEnvelope;
  envelopeTimeUnit?: EnvelopeDurationUnit;
  envelopeV2?: TrackEnvelopeV2;
  /** Canonical state field. Resolved note events expose this as `playbackMode`. */
  samplePlaybackMode?: SamplePlaybackMode;
  /** Known latency of the simple-sample large-pitch worklet path. */
  largePitchShiftLatencySeconds?: number;
}

/** Cursor retained by a scheduler between adjacent scheduling iterations. */
export interface ActiveNoteCursorV2 {
  scheduleOrdinal: number;
  pitchSemitones: number;
  voiceId: string;
  /** Number of adjacent tied scheduler iterations still owned by this voice. */
  continuationsRemaining: number;
}

export interface ResolvedDurationLocksSecondsV2 {
  attackSeconds?: number;
  holdSeconds?: number;
  decaySeconds?: number;
  releaseSeconds?: number;
}

/**
 * Serializable contract emitted by both the main-thread and worklet schedulers.
 * `noteId` is a compatibility alias for renderers that have not adopted the
 * explicit `voiceId` name yet.
 */
export interface ResolvedNoteEventV2 {
  type: 'note';
  contractVersion: 2;
  trackId: string;
  sampleId: string;
  voiceId: string;
  noteId: string;
  playbackEpoch: number;
  scheduleOrdinal: number;
  globalStep: number;
  trackStep: number;
  tiedSteps: number;
  pitchSemitones: number;
  volumeMultiplier: number;
  playbackMode: SamplePlaybackMode;
  gatePercent: number;
  /** Intended source onset on the AudioContext clock. */
  time: number;
  onsetSeconds: number;
  /** Intended audible onset, including a known renderer pipeline latency. */
  audibleAnchorSeconds: number;
  /** Null for trigger playback, whose source lifetime is not gate-owned. */
  noteOffSeconds: number | null;
  /**
   * Compatibility duration consumed by current adapters. For trigger playback
   * this is the complete tied span and is independent of gate percentage.
   */
  duration: number;
  durationSeconds: number;
  /** Onset-owned authored locks retained for the current engine boundary. */
  envelopeLock?: SchedulerDurationLocksV2;
  /** The same locks snapshotted into seconds at onset for v2 adapters/tests. */
  resolvedDurationLocks?: ResolvedDurationLocksSecondsV2;
  /** Effective track/preset envelope with onset locks snapshotted into seconds. */
  resolvedEnvelope: ResolvedEnvelopeV2;
  /** True only when a track override or onset lock authored this curve. */
  authoredEnvelope: boolean;
}

export type NoteEventResolutionV2 =
  | { kind: 'silent' }
  | { kind: 'tie-continuation'; activeNote: ActiveNoteCursorV2 }
  | { kind: 'note'; event: ResolvedNoteEventV2; activeNote: ActiveNoteCursorV2 };

export interface ResolveNoteEventInputV2 {
  track: SchedulerTrackV2;
  globalStep: number;
  scheduleOrdinal: number;
  playbackEpoch: number;
  stepTimeSeconds: number;
  stepDurationSeconds: number;
  globalSwing: number;
  anySoloed: boolean;
  activeNote?: ActiveNoteCursorV2;
  loopRegion?: { start: number; end: number } | null;
  maxSteps: number;
  defaultStepCount: number;
  defaultGatePercent?: number;
  defaultPlaybackMode?: SamplePlaybackMode;
  /** Optional explicit tempo snapshot; inferred from step duration when absent. */
  tempoBpm?: number;
  /** Known renderer delay such as pitch-worklet grain latency. */
  audibleOutputLatencySeconds?: number;
  /** Explicit scheduler-owned early note-off; ignored by trigger playback. */
  explicitNoteOffSeconds?: number;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function bounded(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positiveStepCount(track: SchedulerTrackV2, fallback: number): number {
  const candidate = track.stepCount ?? fallback;
  if (Number.isInteger(candidate) && candidate > 0) return candidate;
  return Math.max(1, track.steps.length || fallback || 1);
}

function trackStepAt(globalStep: number, stepCount: number): number {
  return ((globalStep % stepCount) + stepCount) % stepCount;
}

function nextGlobalStep(
  globalStep: number,
  loopRegion: ResolveNoteEventInputV2['loopRegion'],
  maxSteps: number,
): number {
  if (loopRegion) {
    return globalStep >= loopRegion.end ? loopRegion.start : globalStep + 1;
  }
  return (globalStep + 1) % Math.max(1, maxSteps);
}

function countTiedSteps(
  track: SchedulerTrackV2,
  globalStep: number,
  stepCount: number,
  loopRegion: ResolveNoteEventInputV2['loopRegion'],
  maxSteps: number,
): number {
  let tiedSteps = 1;
  let cursor = globalStep;
  const cycleSteps = loopRegion
    ? Math.max(1, loopRegion.end - loopRegion.start + 1)
    : Math.max(1, Math.min(stepCount, maxSteps));

  // Bound a cyclic all-tied pattern to one effective playback cycle. The
  // cursor expires at this boundary so the next cycle emits a fresh onset.
  while (tiedSteps < cycleSteps) {
    cursor = nextGlobalStep(cursor, loopRegion, maxSteps);
    const nextTrackStep = trackStepAt(cursor, stepCount);
    const lock = track.parameterLocks[nextTrackStep];
    if (track.steps[nextTrackStep] !== true || lock?.tie !== true) break;
    tiedSteps += 1;
  }
  return tiedSteps;
}

function authoredDurationLocks(
  lock: SchedulerParameterLockV2 | null | undefined,
): SchedulerDurationLocksV2 | undefined {
  if (!lock) return undefined;
  const result: SchedulerDurationLocksV2 = {};
  for (const stage of ['attack', 'hold', 'decay', 'release'] as const) {
    const value = lock[stage];
    if (value !== undefined && Number.isFinite(value)) result[stage] = Math.max(0, value);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function resolveDurationLocks(
  lock: SchedulerParameterLockV2 | null | undefined,
  unit: EnvelopeDurationUnit,
  stepDurationSeconds: number,
): ResolvedDurationLocksSecondsV2 | undefined {
  if (!lock) return undefined;
  const scale = unit === 'steps' ? stepDurationSeconds : 1;
  const result: ResolvedDurationLocksSecondsV2 = {};
  const resolveStage = (
    typed: EnvelopeDuration | undefined,
    legacy: number | undefined,
  ): number | undefined => {
    if (typed) return typed.unit === 'steps' ? typed.value * stepDurationSeconds : typed.value;
    return legacy !== undefined && Number.isFinite(legacy) ? Math.max(0, legacy) * scale : undefined;
  };
  const attack = resolveStage(lock.attackDuration, lock.attack);
  const hold = resolveStage(lock.holdDuration, lock.hold);
  const decay = resolveStage(lock.decayDuration, lock.decay);
  const release = resolveStage(lock.releaseDuration, lock.release);
  if (attack !== undefined) result.attackSeconds = attack;
  if (hold !== undefined) result.holdSeconds = hold;
  if (decay !== undefined) result.decaySeconds = decay;
  if (release !== undefined) result.releaseSeconds = release;
  return Object.keys(result).length > 0 ? result : undefined;
}

function effectiveTempoBpm(input: ResolveNoteEventInputV2, stepDurationSeconds: number): number {
  if (input.tempoBpm !== undefined && Number.isFinite(input.tempoBpm) && input.tempoBpm > 0) {
    return input.tempoBpm;
  }
  return stepDurationSeconds > 0 ? 60 / (stepDurationSeconds * 4) : 120;
}

function applyDurationLocks(
  envelope: ResolvedEnvelopeV2,
  locks: ResolvedDurationLocksSecondsV2 | undefined,
): ResolvedEnvelopeV2 {
  if (!locks) return envelope;
  const resolved: ResolvedEnvelopeV2 = { ...envelope };
  if (locks.attackSeconds !== undefined) resolved.attackSeconds = locks.attackSeconds;
  if ('holdSeconds' in resolved && locks.holdSeconds !== undefined) {
    resolved.holdSeconds = locks.holdSeconds;
  }
  if ('decaySeconds' in resolved && locks.decaySeconds !== undefined) {
    resolved.decaySeconds = locks.decaySeconds;
  }
  if ('releaseSeconds' in resolved && locks.releaseSeconds !== undefined) {
    resolved.releaseSeconds = locks.releaseSeconds;
  }
  return resolved;
}

export function makeVoiceIdV2(
  trackId: string,
  playbackEpoch: number,
  scheduleOrdinal: number,
): string {
  if (!Number.isSafeInteger(playbackEpoch) || playbackEpoch < 0) {
    throw new RangeError(`playbackEpoch must be a non-negative safe integer; received ${playbackEpoch}`);
  }
  if (!Number.isSafeInteger(scheduleOrdinal) || scheduleOrdinal < 0) {
    throw new RangeError(`scheduleOrdinal must be a non-negative safe integer; received ${scheduleOrdinal}`);
  }
  return `${trackId}:voice:${playbackEpoch}:${scheduleOrdinal}`;
}

/** Resolve the complete scheduler-owned portion of a note event exactly once. */
export function resolveNoteEventV2(input: ResolveNoteEventInputV2): NoteEventResolutionV2 {
  const { track } = input;
  const shouldPlay = input.anySoloed ? track.soloed : !track.muted;
  if (!shouldPlay) return { kind: 'silent' };

  const stepCount = positiveStepCount(track, input.defaultStepCount);
  const trackStep = trackStepAt(input.globalStep, stepCount);
  if (trackStep >= track.steps.length || track.steps[trackStep] !== true) {
    return { kind: 'silent' };
  }

  const lock = track.parameterLocks[trackStep];
  const pitchSemitones = finiteOr(track.transpose, 0) + finiteOr(lock?.pitch, 0);

  // A continuation owns neither a new voice nor locks. The monotonic ordinal
  // identifies the actual previous scheduling iteration across all wrap modes.
  if (
    lock?.tie === true
    && input.activeNote?.scheduleOrdinal === input.scheduleOrdinal - 1
    && input.activeNote.continuationsRemaining > 0
  ) {
    return {
      kind: 'tie-continuation',
      activeNote: {
        ...input.activeNote,
        scheduleOrdinal: input.scheduleOrdinal,
        continuationsRemaining: input.activeNote.continuationsRemaining - 1,
      },
    };
  }

  const stepDurationSeconds = Math.max(0, finiteOr(input.stepDurationSeconds, 0));
  const globalSwing = bounded(finiteOr(input.globalSwing, 0), 0, 1);
  const trackSwing = bounded(finiteOr(track.swing, 0) / 100, 0, 1);
  const onsetSeconds = finiteOr(input.stepTimeSeconds, 0)
    + calculateSwingDelay(trackStep, globalSwing, trackSwing, stepDurationSeconds);
  const inferredPipelineLatency = !track.sampleId.includes(':') && Math.abs(pitchSemitones) > 6
    ? track.largePitchShiftLatencySeconds
    : 0;
  const latencySeconds = Math.max(
    0,
    finiteOr(input.audibleOutputLatencySeconds, finiteOr(inferredPipelineLatency, 0)),
  );
  const tiedSteps = countTiedSteps(
    track,
    input.globalStep,
    stepCount,
    input.loopRegion,
    input.maxSteps,
  );
  const gatePercent = bounded(
    finiteOr(track.gate, input.defaultGatePercent ?? DEFAULT_TRACK_GATE),
    0,
    100,
  );
  const envelopeReport = getEffectiveTrackEnvelopeV2({
    sampleId: track.sampleId,
    envelope: track.envelope,
    envelopeTimeUnit: track.envelopeTimeUnit,
    envelopeV2: track.envelopeV2,
    samplePlaybackMode: track.samplePlaybackMode,
  });
  const playbackMode = envelopeReport.playbackMode ?? input.defaultPlaybackMode ?? 'gate';
  const gatedDurationSeconds = ((tiedSteps - 1) + gatePercent / 100) * stepDurationSeconds;
  const gateNoteOffSeconds = onsetSeconds + gatedDurationSeconds;
  const explicitNoteOff = input.explicitNoteOffSeconds;
  const ignoresNoteOff = playbackMode === 'trigger'
    || envelopeReport.effective.model === 'ad'
    || envelopeReport.effective.model === 'ahd';
  const noteOffSeconds = ignoresNoteOff
    ? null
    : explicitNoteOff !== undefined && Number.isFinite(explicitNoteOff)
      ? Math.max(onsetSeconds, explicitNoteOff)
      : gateNoteOffSeconds;
  const durationSeconds = noteOffSeconds === null
    ? tiedSteps * stepDurationSeconds
    : explicitNoteOff !== undefined && Number.isFinite(explicitNoteOff)
      ? Math.max(0, noteOffSeconds - onsetSeconds)
      : gatedDurationSeconds;
  const voiceId = makeVoiceIdV2(track.id, input.playbackEpoch, input.scheduleOrdinal);
  const envelopeLock = authoredDurationLocks(lock);
  const resolvedDurationLocks = resolveDurationLocks(
    lock,
    track.envelopeTimeUnit ?? 'seconds',
    stepDurationSeconds,
  );
  const tempoBpm = effectiveTempoBpm(input, stepDurationSeconds);
  // Validate the inferred/explicit tempo through the shared duration helper so
  // every renderer observes exactly the same conversion domain.
  durationToSeconds({ value: 0, unit: 'steps' }, tempoBpm);
  const resolvedEnvelope = applyDurationLocks(
    resolveEnvelopeV2(envelopeReport.effective, tempoBpm),
    resolvedDurationLocks,
  );

  const event: ResolvedNoteEventV2 = {
    type: 'note',
    contractVersion: 2,
    trackId: track.id,
    sampleId: track.sampleId,
    voiceId,
    noteId: voiceId,
    playbackEpoch: input.playbackEpoch,
    scheduleOrdinal: input.scheduleOrdinal,
    globalStep: input.globalStep,
    trackStep,
    tiedSteps,
    pitchSemitones,
    volumeMultiplier: bounded(finiteOr(lock?.volume, 1), 0, 1),
    playbackMode,
    gatePercent,
    time: onsetSeconds,
    onsetSeconds,
    audibleAnchorSeconds: onsetSeconds + latencySeconds,
    noteOffSeconds,
    duration: durationSeconds,
    durationSeconds,
    resolvedEnvelope,
    authoredEnvelope: envelopeReport.active
      && (envelopeReport.authored !== null || resolvedDurationLocks !== undefined),
    ...(envelopeLock ? { envelopeLock } : {}),
    ...(resolvedDurationLocks ? { resolvedDurationLocks } : {}),
  };

  return {
    kind: 'note',
    event,
    activeNote: {
      scheduleOrdinal: input.scheduleOrdinal,
      pitchSemitones,
      voiceId,
      continuationsRemaining: Math.max(0, tiedSteps - 1),
    },
  };
}
