import {
  durationToSeconds,
  resolveEnvelopeV2,
  type EnvelopeModel,
  type ResolvedEnvelopeV2,
  type TrackEnvelopeV2,
} from './envelope-contract-v2';

export const ENVELOPE_EPSILON_V2 = 0.0001;
export const ENVELOPE_STOP_GUARD_SECONDS_V2 = 0.01;
export const DEFAULT_GATE_PERCENT_V2 = 90;

export interface EnvelopeOracleInputV2 {
  envelope: TrackEnvelopeV2;
  bpm: number;
  onsetSeconds: number;
  /** Velocity/track-volume-scaled peak. Shape resolution happens before this. */
  peak?: number;
  /** Explicit scheduler-owned note-off. Takes precedence over the grid gate. */
  noteOffSeconds?: number;
  /** Number of cells in the onset plus tied continuation run. */
  tiedSteps?: number;
  gatePercent?: number;
  stopGuardSeconds?: number;
}

export interface EnvelopeOracleTimelineV2 {
  model: EnvelopeModel;
  envelope: ResolvedEnvelopeV2;
  onsetSeconds: number;
  attackEndSeconds: number;
  holdEndSeconds?: number;
  decayEndSeconds?: number;
  releaseStartSeconds?: number;
  releaseStartAmplitude?: number;
  releaseEndSeconds?: number;
  completionSeconds: number;
  stopSeconds: number;
  peak: number;
  sustainLevel?: number;
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite value >= 0; received ${value}`);
  }
}

function linear(start: number, end: number, progress: number): number {
  if (progress <= 0) return start;
  if (progress >= 1) return end;
  return start + (end - start) * progress;
}

function boundedExponential(start: number, end: number, progress: number): number {
  if (progress <= 0) return start;
  if (progress >= 1) return end;
  if (start <= 0 || end <= 0) return linear(start, end, progress);
  return start * ((end / start) ** progress);
}

export function resolveGateNoteOffSecondsV2(
  onsetSeconds: number,
  bpm: number,
  tiedSteps = 1,
  gatePercent = DEFAULT_GATE_PERCENT_V2,
): number {
  assertFiniteNonNegative('onsetSeconds', onsetSeconds);
  if (!Number.isInteger(tiedSteps) || tiedSteps < 1) {
    throw new RangeError(`tiedSteps must be a positive integer; received ${tiedSteps}`);
  }
  if (!Number.isFinite(gatePercent) || gatePercent < 0 || gatePercent > 100) {
    throw new RangeError(`gatePercent must be within 0–100; received ${gatePercent}`);
  }
  const stepSeconds = durationToSeconds({ value: 1, unit: 'steps' }, bpm);
  return onsetSeconds + ((tiedSteps - 1) + gatePercent / 100) * stepSeconds;
}

function amplitudeBeforeRelease(
  envelope: ResolvedEnvelopeV2,
  onsetSeconds: number,
  peak: number,
  timeSeconds: number,
): number {
  const attackEnd = onsetSeconds + envelope.attackSeconds;
  if (timeSeconds < onsetSeconds) return 0;
  if (envelope.attackSeconds > 0 && timeSeconds < attackEnd) {
    return linear(
      ENVELOPE_EPSILON_V2,
      peak,
      (timeSeconds - onsetSeconds) / envelope.attackSeconds,
    );
  }

  if (envelope.model === 'ar') return peak;
  if (envelope.model === 'adsr') {
    const decaySeconds = envelope.decaySeconds ?? 0;
    const sustainLevel = Math.max(peak * (envelope.sustain ?? 0), ENVELOPE_EPSILON_V2);
    const decayEnd = attackEnd + decaySeconds;
    if (decaySeconds > 0 && timeSeconds < decayEnd) {
      return linear(peak, sustainLevel, (timeSeconds - attackEnd) / decaySeconds);
    }
    return sustainLevel;
  }
  return peak;
}

export function buildEnvelopeOracleTimelineV2(
  input: EnvelopeOracleInputV2,
): EnvelopeOracleTimelineV2 {
  assertFiniteNonNegative('onsetSeconds', input.onsetSeconds);
  const peak = input.peak ?? 1;
  assertFiniteNonNegative('peak', peak);
  const stopGuardSeconds = input.stopGuardSeconds ?? ENVELOPE_STOP_GUARD_SECONDS_V2;
  assertFiniteNonNegative('stopGuardSeconds', stopGuardSeconds);

  const envelope = resolveEnvelopeV2(input.envelope, input.bpm);
  const attackEndSeconds = input.onsetSeconds + envelope.attackSeconds;
  let completionSeconds: number;
  let holdEndSeconds: number | undefined;
  let decayEndSeconds: number | undefined;
  let releaseStartSeconds: number | undefined;
  let releaseStartAmplitude: number | undefined;
  let releaseEndSeconds: number | undefined;
  let sustainLevel: number | undefined;

  if (envelope.model === 'ad') {
    decayEndSeconds = attackEndSeconds + (envelope.decaySeconds ?? 0);
    completionSeconds = decayEndSeconds;
  } else if (envelope.model === 'ahd') {
    holdEndSeconds = attackEndSeconds + (envelope.holdSeconds ?? 0);
    decayEndSeconds = holdEndSeconds + (envelope.decaySeconds ?? 0);
    completionSeconds = decayEndSeconds;
  } else {
    releaseStartSeconds = input.noteOffSeconds ?? resolveGateNoteOffSecondsV2(
      input.onsetSeconds,
      input.bpm,
      input.tiedSteps,
      input.gatePercent,
    );
    if (releaseStartSeconds < input.onsetSeconds) {
      throw new RangeError('noteOffSeconds cannot precede onsetSeconds');
    }
    releaseStartAmplitude = amplitudeBeforeRelease(
      envelope,
      input.onsetSeconds,
      peak,
      releaseStartSeconds,
    );
    releaseEndSeconds = releaseStartSeconds + (envelope.releaseSeconds ?? 0);
    completionSeconds = releaseEndSeconds;
    if (envelope.model === 'adsr') {
      decayEndSeconds = attackEndSeconds + (envelope.decaySeconds ?? 0);
      sustainLevel = Math.max(peak * (envelope.sustain ?? 0), ENVELOPE_EPSILON_V2);
    }
  }

  return {
    model: envelope.model,
    envelope,
    onsetSeconds: input.onsetSeconds,
    attackEndSeconds,
    ...(holdEndSeconds !== undefined ? { holdEndSeconds } : {}),
    ...(decayEndSeconds !== undefined ? { decayEndSeconds } : {}),
    ...(releaseStartSeconds !== undefined ? { releaseStartSeconds } : {}),
    ...(releaseStartAmplitude !== undefined ? { releaseStartAmplitude } : {}),
    ...(releaseEndSeconds !== undefined ? { releaseEndSeconds } : {}),
    completionSeconds,
    stopSeconds: completionSeconds + stopGuardSeconds,
    peak,
    ...(sustainLevel !== undefined ? { sustainLevel } : {}),
  };
}

export function amplitudeAtEnvelopeTimeV2(
  timeline: EnvelopeOracleTimelineV2,
  timeSeconds: number,
): number {
  if (!Number.isFinite(timeSeconds)) {
    throw new RangeError(`timeSeconds must be finite; received ${timeSeconds}`);
  }
  if (timeSeconds < timeline.onsetSeconds || timeSeconds >= timeline.stopSeconds) return 0;

  const { envelope } = timeline;
  if (envelope.attackSeconds > 0 && timeSeconds < timeline.attackEndSeconds) {
    return linear(
      ENVELOPE_EPSILON_V2,
      timeline.peak,
      (timeSeconds - timeline.onsetSeconds) / envelope.attackSeconds,
    );
  }

  if (timeline.model === 'ad') {
    const decaySeconds = envelope.decaySeconds ?? 0;
    if (decaySeconds > 0 && timeSeconds < (timeline.decayEndSeconds ?? 0)) {
      return linear(
        timeline.peak,
        ENVELOPE_EPSILON_V2,
        (timeSeconds - timeline.attackEndSeconds) / decaySeconds,
      );
    }
    return ENVELOPE_EPSILON_V2;
  }

  if (timeline.model === 'ahd') {
    if (timeSeconds < (timeline.holdEndSeconds ?? timeline.attackEndSeconds)) {
      return timeline.peak;
    }
    const decaySeconds = envelope.decaySeconds ?? 0;
    if (decaySeconds > 0 && timeSeconds < (timeline.decayEndSeconds ?? 0)) {
      return linear(
        timeline.peak,
        ENVELOPE_EPSILON_V2,
        (timeSeconds - (timeline.holdEndSeconds ?? timeline.attackEndSeconds)) / decaySeconds,
      );
    }
    return ENVELOPE_EPSILON_V2;
  }

  if (timeSeconds < (timeline.releaseStartSeconds ?? Number.POSITIVE_INFINITY)) {
    return amplitudeBeforeRelease(envelope, timeline.onsetSeconds, timeline.peak, timeSeconds);
  }
  const releaseSeconds = envelope.releaseSeconds ?? 0;
  if (releaseSeconds === 0 || timeSeconds >= (timeline.releaseEndSeconds ?? 0)) {
    return ENVELOPE_EPSILON_V2;
  }
  return boundedExponential(
    timeline.releaseStartAmplitude ?? ENVELOPE_EPSILON_V2,
    ENVELOPE_EPSILON_V2,
    (timeSeconds - (timeline.releaseStartSeconds ?? timeSeconds)) / releaseSeconds,
  );
}
