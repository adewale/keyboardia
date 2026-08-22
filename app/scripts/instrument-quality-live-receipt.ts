import { getInstrumentRange } from '../src/audio/instrument-ranges';
import { SCHEDULER_BASE_MIDI_NOTE } from '../src/audio/constants';
import { INSTRUMENT_GROUPS } from '../src/shared/instrument-catalog';
import { MAX_TRACKS } from '../src/types';
import type { BrowserIdentity } from './instrument-quality-matrix';

export const LIVE_RECEIPT_SCHEMA_VERSION = 2;
export const LIVE_RECEIPT_CLAIM = 'live-post-track-signal-evidence';
export const LIVE_SILENCE_PEAK_THRESHOLD = 1e-4;
export const LIVE_SILENCE_RMS_THRESHOLD = 1e-5;
export const LIVE_TEMPO = 120;
export const LIVE_STEP_COUNT = 4;
export const LIVE_CAPTURE_METHOD = 'continuous-audio-worklet-accumulator-v1';
export const LIVE_CAPTURE_DURATION_SECONDS = 2.5;
export const LIVE_CAPTURE_CHANNEL_COUNT = 2;
export const LIVE_PEAK_METRIC = 'maximum-absolute-sample-over-all-captured-channel-samples';
export const LIVE_RMS_METRIC = 'root-mean-square-over-all-captured-channel-samples';
export const LIVE_GENERATED_FROM =
  'Chromium live sequencer sessions for every INSTRUMENT_CATEGORIES entry; continuous per-track bus + masterGain AudioWorklet accumulation';

export type LiveInstrumentType = 'sample' | 'sampled' | 'synth' | 'tone' | 'advanced';

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
  capturedFrames: number;
  channelSampleCount: number;
}

export interface LiveSessionResult {
  sessionId: string;
  instruments: string[];
  sampleRate: number;
  masterPeak: number;
  masterRms: number;
  capturedFrames: number;
  channelSampleCount: number;
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
    durationSeconds: typeof LIVE_CAPTURE_DURATION_SECONDS;
    channelCount: typeof LIVE_CAPTURE_CHANNEL_COUNT;
    peakMetric: typeof LIVE_PEAK_METRIC;
    rmsMetric: typeof LIVE_RMS_METRIC;
  };
  silencePeakThreshold: typeof LIVE_SILENCE_PEAK_THRESHOLD;
  silenceRmsThreshold: typeof LIVE_SILENCE_RMS_THRESHOLD;
  tempo: typeof LIVE_TEMPO;
  stepCount: typeof LIVE_STEP_COUNT;
  sessions: LiveSessionResult[];
  instruments: LiveInstrumentResult[];
  diagnostics: { pageErrors: string[]; consoleErrors: string[] };
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
    || value.capture.durationSeconds !== LIVE_CAPTURE_DURATION_SECONDS
    || value.capture.channelCount !== LIVE_CAPTURE_CHANNEL_COUNT
    || value.capture.peakMetric !== LIVE_PEAK_METRIC
    || value.capture.rmsMetric !== LIVE_RMS_METRIC
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
    positiveInteger(item.capturedFrames, `instrument ${item.sampleId}.capturedFrames`);
    positiveInteger(item.channelSampleCount, `instrument ${item.sampleId}.channelSampleCount`);
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
    validateEnergy(session.masterPeak, session.masterRms, `session ${session.sessionId}`);
    validateCaptureGeometry(session, `session ${session.sessionId}`, expectedFrames);
    const expectedIds = expected.slice(index * MAX_TRACKS, (index + 1) * MAX_TRACKS).map(spec => spec.sampleId);
    if (JSON.stringify(session.instruments) !== JSON.stringify(expectedIds)) {
      throw new Error(`Live receipt session ${session.sessionId} membership differs from the pinned batch`);
    }
    for (const id of session.instruments as string[]) {
      if (sessionInstrumentIds.has(id)) throw new Error(`Live receipt session membership duplicates ${id}`);
      sessionInstrumentIds.add(id);
      const result = instruments.find(candidate => isRecord(candidate) && candidate.sampleId === id) as Record<string, unknown>;
      if (result.sessionId !== session.sessionId) {
        throw new Error(`Live receipt ${id} disagrees with its declared session`);
      }
      validateCaptureGeometry(result, `instrument ${id}`, expectedFrames);
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
