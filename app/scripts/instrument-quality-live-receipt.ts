import { getInstrumentRange } from '../src/audio/instrument-ranges';
import { SCHEDULER_BASE_MIDI_NOTE } from '../src/audio/constants';
import { SCHEDULE_AHEAD_SEC } from '../src/audio/scheduler-types';
import { MAX_STEPS } from '../src/shared/constants';
import { INSTRUMENT_GROUPS } from '../src/shared/instrument-catalog';
import { MAX_TRACKS } from '../src/types';
import type { BrowserIdentity } from './instrument-quality-matrix';

export const LIVE_RECEIPT_SCHEMA_VERSION = 5;
export const LIVE_RECEIPT_CLAIM = 'live-post-track-signal-evidence';
export const LIVE_SILENCE_PEAK_THRESHOLD = 1e-4;
export const LIVE_SILENCE_RMS_THRESHOLD = 1e-5;
export const LIVE_TEMPO = 120;
export const LIVE_STEP_COUNT = 32;
export const LIVE_PATTERN_STORAGE_STEP_COUNT = MAX_STEPS;
// Step zero is scheduled at AudioContext.currentTime and reaches production
// renderers through the scheduler worklet's MessagePort too late to preserve
// its transient. Step four is 500 ms after transport start at the pinned tempo,
// comfortably beyond the 150 ms lookahead boundary while remaining below the
// one-second arm-to-onset ceiling.
export const LIVE_ACTIVE_STEP = 4;
export const LIVE_ACTIVE_STEP_OFFSET_SECONDS = 0.5;
export const LIVE_SCHEDULER_LOOKAHEAD_SECONDS = SCHEDULE_AHEAD_SEC;
export const LIVE_SCHEDULED_ACTIVE_STEPS_PER_TRACK = 1;
export const LIVE_PATTERN_PERIOD_SECONDS = 4;
export const LIVE_PREPARATION_METHOD =
  'muted-production-play-stop-then-ui-mute-plus-track-bus-gated-isolated-trials';
export const LIVE_UNMUTE_SETTLE_SECONDS = 0.25;
export const LIVE_TRIAL_MODE = 'single-unmuted-track-plus-master-per-capture';
export const LIVE_MAX_CONCURRENT_AUDIBLE_TRACKS = 1;
export const LIVE_ISOLATION_SCOPE = 'audible-routing-only-muted-release-tails-may-remain-allocated';
export const LIVE_CAPTURE_METHOD = 'onset-aligned-audio-worklet-accumulator-v2';
export const LIVE_CAPTURE_ALIGNMENT =
  'first-isolated-track-or-master-output-frame-above-pinned-threshold';
export const LIVE_CAPTURE_DURATION_SECONDS = 2.5;
export const LIVE_CAPTURE_CHANNEL_COUNT = 2;
export const LIVE_ONSET_THRESHOLD = 1e-7;
export const LIVE_MIN_ARM_TO_ONSET_SECONDS = 0.45;
export const LIVE_MAX_ARM_TO_ONSET_SECONDS = 1;
export const LIVE_PEAK_METRIC = 'maximum-absolute-sample-over-all-captured-channel-samples';
export const LIVE_RMS_METRIC = 'root-mean-square-over-all-captured-channel-samples';
export const LIVE_RANDOM_SEED = 0x4b455942;
export const LIVE_RANDOM_ALGORITHM = 'mulberry32';
export const LIVE_GENERATED_FROM =
  'Chromium single-audible-track calibration trials for every INSTRUMENT_CATEGORIES entry; a one-active-step fixture is played through the production sequencer and onset-aligned output is captured concurrently at that track bus and masterGain';

export type LiveInstrumentType = 'sample' | 'sampled' | 'synth' | 'tone' | 'advanced';
export type LiveDispatchMethod =
  | 'playSample'
  | 'playSampledInstrument'
  | 'playSynthNote'
  | 'playToneSynth'
  | 'playAdvancedSynth';

export const LIVE_DISPATCH_METHOD_BY_INSTRUMENT_TYPE = Object.freeze({
  sample: 'playSample',
  sampled: 'playSampledInstrument',
  synth: 'playSynthNote',
  tone: 'playToneSynth',
  advanced: 'playAdvancedSynth',
} satisfies Record<LiveInstrumentType, LiveDispatchMethod>);

export interface LiveEngineDispatch {
  method: LiveDispatchMethod;
  trackId: string;
}

export interface LiveInstrumentSpec {
  sampleId: string;
  name: string;
  type: LiveInstrumentType;
  presetId: string;
  pitch: number;
}

export interface LiveInstrumentResult extends LiveInstrumentSpec {
  trackId: string;
  sessionId: string;
  peak: number;
  rms: number;
  masterPeak: number;
  masterRms: number;
  capturedFrames: number;
  channelSampleCount: number;
  armToOnsetFrames: number;
  randomCalls: number;
  preArmUiUnmutedTrackIds: string[];
  preArmCommandedTrackBusOpenIds: string[];
  observedEngineDispatches: LiveEngineDispatch[];
}

export interface LiveSessionResult {
  sessionId: string;
  instruments: string[];
  sampleRate: number;
}

export interface LiveQualityReport {
  schemaVersion: typeof LIVE_RECEIPT_SCHEMA_VERSION;
  claim: typeof LIVE_RECEIPT_CLAIM;
  generatedAt: string;
  subjectCommit: string;
  browser: BrowserIdentity & { userAgent: string };
  audioSampleRates: number[];
  generatedFrom: typeof LIVE_GENERATED_FROM;
  capture: {
    method: typeof LIVE_CAPTURE_METHOD;
    alignment: typeof LIVE_CAPTURE_ALIGNMENT;
    durationSeconds: typeof LIVE_CAPTURE_DURATION_SECONDS;
    channelCount: typeof LIVE_CAPTURE_CHANNEL_COUNT;
    onsetThreshold: typeof LIVE_ONSET_THRESHOLD;
    minArmToOnsetSeconds: typeof LIVE_MIN_ARM_TO_ONSET_SECONDS;
    maxArmToOnsetSeconds: typeof LIVE_MAX_ARM_TO_ONSET_SECONDS;
    trialMode: typeof LIVE_TRIAL_MODE;
    maxConcurrentAudibleTracks: typeof LIVE_MAX_CONCURRENT_AUDIBLE_TRACKS;
    isolationScope: typeof LIVE_ISOLATION_SCOPE;
    peakMetric: typeof LIVE_PEAK_METRIC;
    rmsMetric: typeof LIVE_RMS_METRIC;
  };
  schedule: {
    preparation: typeof LIVE_PREPARATION_METHOD;
    activeStep: typeof LIVE_ACTIVE_STEP;
    activeStepOffsetSeconds: typeof LIVE_ACTIVE_STEP_OFFSET_SECONDS;
    schedulerLookaheadSeconds: typeof LIVE_SCHEDULER_LOOKAHEAD_SECONDS;
    scheduledActiveStepsPerTrack: typeof LIVE_SCHEDULED_ACTIVE_STEPS_PER_TRACK;
    patternPeriodSeconds: typeof LIVE_PATTERN_PERIOD_SECONDS;
    patternStorageStepCount: typeof LIVE_PATTERN_STORAGE_STEP_COUNT;
    unmuteSettleSeconds: typeof LIVE_UNMUTE_SETTLE_SECONDS;
  };
  random: {
    locked: true;
    seed: typeof LIVE_RANDOM_SEED;
    algorithm: typeof LIVE_RANDOM_ALGORITHM;
  };
  silencePeakThreshold: typeof LIVE_SILENCE_PEAK_THRESHOLD;
  silenceRmsThreshold: typeof LIVE_SILENCE_RMS_THRESHOLD;
  tempo: typeof LIVE_TEMPO;
  stepCount: typeof LIVE_STEP_COUNT;
  sessions: LiveSessionResult[];
  instruments: LiveInstrumentResult[];
  diagnostics: { pageErrors: string[]; consoleErrors: string[] };
}

/**
 * A live calibration result is routing-silent when either the selected track
 * tap or its simultaneous isolated master tap lacks measurable output. Keeping
 * this separate from structural receipt validation lets a genuine routing
 * defect remain valid evidence while ensuring the ranking scores it fail-closed.
 */
export function isLiveRoutingSilent(
  result: Pick<LiveInstrumentResult, 'peak' | 'rms' | 'masterPeak' | 'masterRms'>,
  peakThreshold: number = LIVE_SILENCE_PEAK_THRESHOLD,
  rmsThreshold: number = LIVE_SILENCE_RMS_THRESHOLD,
): boolean {
  const trackSilent = result.peak <= peakThreshold && result.rms <= rmsThreshold;
  const masterSilent = result.masterPeak <= peakThreshold && result.masterRms <= rmsThreshold;
  return trackSilent || masterSilent;
}

const FULL_COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const VALID_SAMPLE_RATES = new Set([44_100, 48_000]);

function presetIdFor(sampleId: string, type: LiveInstrumentType): string {
  switch (type) {
    case 'sampled': return sampleId.slice('sampled:'.length);
    case 'synth': return sampleId.slice('synth:'.length);
    case 'tone': return sampleId.slice('tone:'.length);
    case 'advanced': return sampleId.slice('advanced:'.length);
    case 'sample': return sampleId;
  }
}

export function expectedLiveInstrumentSpecs(): LiveInstrumentSpec[] {
  const groups = Object.values(INSTRUMENT_GROUPS) as ReadonlyArray<{
    instruments: ReadonlyArray<{ id: string; name: string; type: string }>;
  }>;
  return groups
    .flatMap(group => group.instruments)
    .map(instrument => {
      const type = instrument.type as LiveInstrumentType;
      const range = getInstrumentRange(instrument.id);
      const midi = Math.min(range.maxMidi, Math.max(range.minMidi, SCHEDULER_BASE_MIDI_NOTE));
      return {
        sampleId: instrument.id,
        name: instrument.name,
        type,
        presetId: presetIdFor(instrument.id, type),
        pitch: midi - SCHEDULER_BASE_MIDI_NOTE,
      };
    })
    .sort((left, right) => left.sampleId.localeCompare(right.sampleId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNonnegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Live receipt ${label} must be a finite nonnegative number`);
  }
}

function exactIso(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validateEnergy(peak: unknown, rms: unknown, label: string): void {
  finiteNonnegative(peak, `${label}.peak`);
  finiteNonnegative(rms, `${label}.rms`);
  if (rms > peak + 1e-9) throw new Error(`Live receipt ${label} RMS exceeds peak`);
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`Live receipt ${label} must be a positive integer`);
  }
}

function validateCaptureGeometry(
  value: Record<string, unknown>,
  label: string,
  expectedFrames: number,
): void {
  positiveInteger(value.capturedFrames, `${label}.capturedFrames`);
  positiveInteger(value.channelSampleCount, `${label}.channelSampleCount`);
  if (value.capturedFrames !== expectedFrames) {
    throw new Error(
      `Live receipt ${label} captured ${value.capturedFrames} frames, expected ${expectedFrames}`,
    );
  }
  if (value.channelSampleCount !== expectedFrames * LIVE_CAPTURE_CHANNEL_COUNT) {
    throw new Error(`Live receipt ${label} does not cover every channel sample`);
  }
}

export function validateLiveQualityReport(
  value: unknown,
  expectedSubjectCommit: string,
): LiveQualityReport {
  if (!isRecord(value)) throw new Error('Live receipt is not an object');
  if (value.schemaVersion !== LIVE_RECEIPT_SCHEMA_VERSION || value.claim !== LIVE_RECEIPT_CLAIM) {
    throw new Error('Live receipt schema/claim is unsupported');
  }
  if (!exactIso(value.generatedAt)) throw new Error('Live receipt generatedAt is not canonical ISO-8601');
  if (!FULL_COMMIT_ID.test(expectedSubjectCommit) || value.subjectCommit !== expectedSubjectCommit) {
    throw new Error('Live receipt subject commit does not match the selected full commit');
  }
  if (!isRecord(value.browser)
    || value.browser.name !== 'chromium'
    || typeof value.browser.version !== 'string'
    || value.browser.version.trim().length === 0
    || value.browser.version === 'unknown'
    || typeof value.browser.userAgent !== 'string'
    || value.browser.userAgent.trim().length === 0) {
    throw new Error('Live receipt requires complete Chromium browser identity');
  }
  if (!Array.isArray(value.audioSampleRates)
    || value.audioSampleRates.length === 0
    || value.audioSampleRates.some(rate => !Number.isInteger(rate) || !VALID_SAMPLE_RATES.has(rate as number))
    || new Set(value.audioSampleRates).size !== value.audioSampleRates.length
    || JSON.stringify(value.audioSampleRates) !== JSON.stringify([...value.audioSampleRates].sort((a, b) => (a as number) - (b as number)))) {
    throw new Error('Live receipt audioSampleRates must be unique, sorted, and supported');
  }
  if (value.generatedFrom !== LIVE_GENERATED_FROM
    || !isRecord(value.capture)
    || value.capture.method !== LIVE_CAPTURE_METHOD
    || value.capture.alignment !== LIVE_CAPTURE_ALIGNMENT
    || value.capture.durationSeconds !== LIVE_CAPTURE_DURATION_SECONDS
    || value.capture.channelCount !== LIVE_CAPTURE_CHANNEL_COUNT
    || value.capture.onsetThreshold !== LIVE_ONSET_THRESHOLD
    || value.capture.minArmToOnsetSeconds !== LIVE_MIN_ARM_TO_ONSET_SECONDS
    || value.capture.maxArmToOnsetSeconds !== LIVE_MAX_ARM_TO_ONSET_SECONDS
    || value.capture.trialMode !== LIVE_TRIAL_MODE
    || value.capture.maxConcurrentAudibleTracks !== LIVE_MAX_CONCURRENT_AUDIBLE_TRACKS
    || value.capture.isolationScope !== LIVE_ISOLATION_SCOPE
    || value.capture.peakMetric !== LIVE_PEAK_METRIC
    || value.capture.rmsMetric !== LIVE_RMS_METRIC
    || !isRecord(value.schedule)
    || value.schedule.preparation !== LIVE_PREPARATION_METHOD
    || value.schedule.activeStep !== LIVE_ACTIVE_STEP
    || value.schedule.activeStepOffsetSeconds !== LIVE_ACTIVE_STEP_OFFSET_SECONDS
    || value.schedule.schedulerLookaheadSeconds !== LIVE_SCHEDULER_LOOKAHEAD_SECONDS
    || value.schedule.scheduledActiveStepsPerTrack !== LIVE_SCHEDULED_ACTIVE_STEPS_PER_TRACK
    || value.schedule.patternPeriodSeconds !== LIVE_PATTERN_PERIOD_SECONDS
    || value.schedule.patternStorageStepCount !== LIVE_PATTERN_STORAGE_STEP_COUNT
    || value.schedule.unmuteSettleSeconds !== LIVE_UNMUTE_SETTLE_SECONDS
    || !isRecord(value.random)
    || value.random.locked !== true
    || value.random.seed !== LIVE_RANDOM_SEED
    || value.random.algorithm !== LIVE_RANDOM_ALGORITHM
    || value.silencePeakThreshold !== LIVE_SILENCE_PEAK_THRESHOLD
    || value.silenceRmsThreshold !== LIVE_SILENCE_RMS_THRESHOLD
    || value.tempo !== LIVE_TEMPO
    || value.stepCount !== LIVE_STEP_COUNT) {
    throw new Error('Live receipt capture settings or thresholds differ from the pinned evaluator');
  }
  if (!isRecord(value.diagnostics)
    || !Array.isArray(value.diagnostics.pageErrors)
    || !Array.isArray(value.diagnostics.consoleErrors)
    || !value.diagnostics.pageErrors.every(error => typeof error === 'string')
    || !value.diagnostics.consoleErrors.every(error => typeof error === 'string')) {
    throw new Error('Live receipt diagnostics are malformed');
  }
  if (value.diagnostics.pageErrors.length > 0 || value.diagnostics.consoleErrors.length > 0) {
    throw new Error('Live receipt contains browser/runtime diagnostics and cannot earn evidence credit');
  }

  const expected = expectedLiveInstrumentSpecs();
  if (expected.length !== 99) throw new Error(`Pinned live evaluator expected 99 catalogue instruments, found ${expected.length}`);
  if (!Array.isArray(value.instruments) || value.instruments.length !== expected.length) {
    throw new Error(`Live receipt must contain exactly ${expected.length} instrument results`);
  }
  const expectedById = new Map(expected.map(spec => [spec.sampleId, spec]));
  const seenIds = new Set<string>();
  const trackIds = new Set<string>();
  const instruments = value.instruments as unknown[];
  for (const item of instruments) {
    if (!isRecord(item) || typeof item.sampleId !== 'string') throw new Error('Live receipt instrument is malformed');
    if (seenIds.has(item.sampleId)) throw new Error(`Live receipt duplicates instrument ${item.sampleId}`);
    seenIds.add(item.sampleId);
    const spec = expectedById.get(item.sampleId);
    if (!spec) throw new Error(`Live receipt contains unexpected instrument ${item.sampleId}`);
    for (const key of ['name', 'type', 'presetId', 'pitch'] as const) {
      if (item[key] !== spec[key]) throw new Error(`Live receipt ${item.sampleId} has mismatched ${key}`);
    }
    if (typeof item.trackId !== 'string' || item.trackId.trim().length === 0 || trackIds.has(item.trackId)) {
      throw new Error(`Live receipt ${item.sampleId} has invalid or duplicate trackId`);
    }
    trackIds.add(item.trackId);
    if (typeof item.sessionId !== 'string' || item.sessionId.trim().length === 0) {
      throw new Error(`Live receipt ${item.sampleId} has invalid sessionId`);
    }
    validateEnergy(item.peak, item.rms, `instrument ${item.sampleId}`);
    validateEnergy(item.masterPeak, item.masterRms, `instrument ${item.sampleId} master`);
    positiveInteger(item.capturedFrames, `instrument ${item.sampleId}.capturedFrames`);
    positiveInteger(item.channelSampleCount, `instrument ${item.sampleId}.channelSampleCount`);
    positiveInteger(item.armToOnsetFrames, `instrument ${item.sampleId}.armToOnsetFrames`);
    positiveInteger(item.randomCalls, `instrument ${item.sampleId}.randomCalls`);
    const expectedIsolationIds = JSON.stringify([item.trackId]);
    if (!Array.isArray(item.preArmUiUnmutedTrackIds)
      || !item.preArmUiUnmutedTrackIds.every(id => typeof id === 'string')
      || JSON.stringify(item.preArmUiUnmutedTrackIds) !== expectedIsolationIds) {
      throw new Error(`Live receipt instrument ${item.sampleId} UI-unmuted snapshot is not isolated`);
    }
    if (!Array.isArray(item.preArmCommandedTrackBusOpenIds)
      || !item.preArmCommandedTrackBusOpenIds.every(id => typeof id === 'string')
      || JSON.stringify(item.preArmCommandedTrackBusOpenIds) !== expectedIsolationIds) {
      throw new Error(`Live receipt instrument ${item.sampleId} commanded TrackBus snapshot is not isolated`);
    }
    if (!Array.isArray(item.observedEngineDispatches)
      || item.observedEngineDispatches.length !== 1
      || !isRecord(item.observedEngineDispatches[0])
      || item.observedEngineDispatches[0].trackId !== item.trackId
      || item.observedEngineDispatches[0].method !== LIVE_DISPATCH_METHOD_BY_INSTRUMENT_TYPE[spec.type]) {
      throw new Error(`Live receipt instrument ${item.sampleId} did not observe exactly one expected engine dispatch`);
    }
  }
  const missing = expected.filter(spec => !seenIds.has(spec.sampleId));
  if (missing.length > 0) throw new Error(`Live receipt is missing ${missing.map(spec => spec.sampleId).join(', ')}`);

  const expectedSessionCount = Math.ceil(expected.length / MAX_TRACKS);
  if (!Array.isArray(value.sessions) || value.sessions.length !== expectedSessionCount) {
    throw new Error(`Live receipt must contain exactly ${expectedSessionCount} sessions`);
  }
  const sessionIds = new Set<string>();
  const sessionInstrumentIds = new Set<string>();
  for (const [index, session] of (value.sessions as unknown[]).entries()) {
    if (!isRecord(session)
      || typeof session.sessionId !== 'string'
      || session.sessionId.trim().length === 0
      || sessionIds.has(session.sessionId)
      || !Array.isArray(session.instruments)
      || !session.instruments.every(id => typeof id === 'string')) {
      throw new Error(`Live receipt session ${index} is malformed or duplicated`);
    }
    sessionIds.add(session.sessionId);
    if (!Number.isInteger(session.sampleRate) || !VALID_SAMPLE_RATES.has(session.sampleRate as number)) {
      throw new Error(`Live receipt session ${session.sessionId} has an unsupported sample rate`);
    }
    const expectedFrames = Math.round(
      LIVE_CAPTURE_DURATION_SECONDS * (session.sampleRate as number),
    );
    const expectedIds = expected.slice(index * MAX_TRACKS, (index + 1) * MAX_TRACKS).map(spec => spec.sampleId);
    if (JSON.stringify(session.instruments) !== JSON.stringify(expectedIds)) {
      throw new Error(`Live receipt session ${session.sessionId} membership differs from the pinned batch`);
    }
    let previousRandomCalls = -1;
    for (const id of session.instruments as string[]) {
      if (sessionInstrumentIds.has(id)) throw new Error(`Live receipt session membership duplicates ${id}`);
      sessionInstrumentIds.add(id);
      const result = instruments.find(candidate => isRecord(candidate) && candidate.sampleId === id) as Record<string, unknown>;
      if (result.sessionId !== session.sessionId) {
        throw new Error(`Live receipt ${id} disagrees with its declared session`);
      }
      validateCaptureGeometry(result, `instrument ${id}`, expectedFrames);
      if ((result.armToOnsetFrames as number) < Math.floor(
        LIVE_MIN_ARM_TO_ONSET_SECONDS * (session.sampleRate as number),
      )) {
        throw new Error(`Live receipt instrument ${id} preceded the minimum arm-to-onset interval`);
      }
      if ((result.armToOnsetFrames as number) > Math.ceil(
        LIVE_MAX_ARM_TO_ONSET_SECONDS * (session.sampleRate as number),
      )) {
        throw new Error(`Live receipt instrument ${id} exceeded the maximum arm-to-onset interval`);
      }
      if ((result.randomCalls as number) < previousRandomCalls) {
        throw new Error(`Live receipt session ${session.sessionId} random call counts are not nondecreasing`);
      }
      previousRandomCalls = result.randomCalls as number;
    }
  }
  if (sessionInstrumentIds.size !== expected.length) throw new Error('Live receipt session union is incomplete');
  const sessionSampleRates = [...new Set(
    (value.sessions as Array<Record<string, unknown>>).map(session => session.sampleRate as number),
  )].sort((left, right) => left - right);
  if (JSON.stringify(value.audioSampleRates) !== JSON.stringify(sessionSampleRates)) {
    throw new Error('Live receipt audioSampleRates do not match session capture rates');
  }
  return value as unknown as LiveQualityReport;
}
