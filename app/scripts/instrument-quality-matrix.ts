import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getInstrumentRange } from '../src/audio/instrument-ranges';
import {
  dcOffset,
  peakDbfs,
  rmsDb,
  truePeakDbfs,
} from '../src/test/audio-measures';
import {
  analyzeDecodedSampleWithMono,
  estimateAbsolutePitch,
  type DecodedAudioLike,
} from './sample-quality-core';
import {
  INSTRUMENT_QUALITY_PROFILES,
  type InstrumentQualityProfile,
} from './instrument-quality-profiles';

export const MATRIX_SCHEMA_VERSION = 3;
export const MATRIX_VELOCITIES = [32, 64, 90, 127] as const;
export const MATRIX_REPEAT_COUNT = 16;
export const MATRIX_RANDOM_SEED = 0x4b_42_44_51;
export const MATRIX_ALTERNATE_SEED = 0x51_44_42_4b;
/** A deterministic/offline receipt cannot shift even one requested frame. */
export const MAX_RENDER_FRAME_DRIFT = 0;
export const MATRIX_SAMPLE_RATE = 44_100;

export type MatrixFamily =
  | 'canonical'
  | 'range'
  | 'velocity'
  | 'release'
  | 'repeat-seed-a'
  | 'repeat-seed-b'
  | 'repeat-seed-a-replay'
  | 'polyphony'
  | 'stereo';

export interface MatrixNoteEvent {
  /** MIDI delivered to the sequencer/runtime API. */
  midi: number;
  /** Audible/manifest MIDI after SampledInstrument playbackNote translation. */
  targetMidi: number;
  velocity: number;
  startSeconds: number;
  gateSeconds: number;
}

/**
 * Engine-neutral instruction consumed by an offline or Playwright capture
 * adapter. The adapter must solo the instrument and tap post-track, pre-master
 * PCM. It must not substitute a mock oscillator or an effects-on master mix.
 */
export interface DryPcmMatrixCase {
  id: string;
  instrumentId: string;
  family: MatrixFamily;
  variant: string;
  dry: true;
  effectsEnabled: false;
  pan: 0;
  sampleRate: typeof MATRIX_SAMPLE_RATE;
  durationSeconds: number;
  notes: readonly MatrixNoteEvent[];
  random: {
    locked: boolean;
    seed: number | null;
    replayOf: string | null;
  };
}

export interface DryPcmCapture {
  /** Unique adapter-issued identifier proving each case was a distinct attempt. */
  captureAttemptId: string;
  sampleRate: number;
  channels: readonly Float32Array[];
  /** Requested contiguous frame count. */
  frameCount: number;
  /** Frames actually received from the renderer/worklet. */
  capturedFrameCount: number;
  /** Absolute render-frame drift reported by the capture implementation. */
  maxRenderFrameDrift: number;
}

export interface BrowserIdentity {
  name: string;
  version: string;
  userAgent?: string;
}

export interface MatrixProvenance {
  evaluatorCommit: string;
  subjectCommit: string;
  evaluatorTreeSha256: string;
  generatedAt: string;
  runtime: {
    node: string;
    platform: string;
    arch: string;
  };
  capture: {
    mode: 'offline' | 'chromium-worklet';
    adapter: string;
    adapterSha256: string;
  };
  browser: BrowserIdentity | null;
}

export type DryPcmFatalCode =
  | 'TRUE_PEAK_OVER_0_DBTP'
  | 'FLAT_TOP_CLIPPING'
  | 'DC_OFFSET'
  | 'SILENT_DECLARED_NOTE'
  | 'PITCH_ERROR'
  | 'MONO_LOSS'
  | 'RELEASE_RESIDUAL'
  | 'ALTERNATE_SEED_VARIATION_MISSING';

export type DryPcmEvidenceGapCode = 'PITCH_INCONCLUSIVE';

export interface DryPcmGateFinding {
  code: DryPcmFatalCode;
  message: string;
  value: number;
  threshold: number;
}

export interface DryPcmEvidenceGap {
  code: DryPcmEvidenceGapCode;
  message: string;
  value: number;
  threshold: number;
}

export interface DryPcmMetrics {
  peakDbfs: number | null;
  truePeakDbtp: number | null;
  rmsDbfs: number | null;
  activeRmsDbfs: number | null;
  loudnessKMax: number | null;
  dcOffsetDbfs: number;
  leadingSilenceMs: number;
  tailLevelDbRelativePeak: number | null;
  flatTopRuns: number;
  clippingSamples: number;
  spectralCentroidHz: number | null;
  /** Raw estimate relative to target MIDI, before the profile policy. */
  pitchObservedCents: number | null;
  /** Error after applying the preregistered profile pitch reference. */
  pitchErrorCents: number | null;
  pitchConfidence: number;
  stereoCorrelation: number | null;
  monoLossDb: number | null;
  releaseResidualDbfs: number | null;
}

export interface DryPcmCaseResult {
  caseId: string;
  instrumentId: string;
  family: MatrixFamily;
  variant: string;
  captureAttemptId: string;
  pcmSha256: string;
  sampleRate: number;
  channels: number;
  frameCount: number;
  capturedFrameCount: number;
  maxRenderFrameDrift: number;
  metrics: DryPcmMetrics;
  fatalFindings: DryPcmGateFinding[];
  evidenceGaps: DryPcmEvidenceGap[];
}

export interface DryPcmInstrumentComparison {
  instrumentId: string;
  velocity: {
    policy: 'measure-only';
    activeRmsDbfs: Array<{ velocity: number; value: number | null }>;
    consecutiveActiveRmsDeltaDb: Array<{ from: number; to: number; value: number | null }>;
    loudnessKMax: Array<{ velocity: number; value: number | null }>;
    spectralCentroidHz: Array<{ velocity: number; value: number | null }>;
  };
  repeat: {
    policy: InstrumentQualityProfile['variationPolicy'];
    seedAReplayExact: boolean;
    alternateSeedDiffers: boolean;
  };
  polyphony: {
    policy: 'aggregate-safety-only';
    voiceCount: number;
    activeRmsDeltaFromCanonicalDb: number | null;
    loudnessDeltaFromCanonicalDb: number | null;
    truePeakDeltaFromCanonicalDb: number | null;
  };
  stereo: {
    policy: 'mono-fold-only';
    correlation: number | null;
    monoLossDb: number | null;
  };
  spectral: {
    policy: 'descriptive-only';
    canonicalCentroidHz: number | null;
  };
}

export interface DryPcmMatrixReport {
  schemaVersion: typeof MATRIX_SCHEMA_VERSION;
  claim: 'dry-post-track-technical-evidence';
  provenance: MatrixProvenance;
  profileSha256: string;
  planSha256: string;
  profileCount: number;
  expectedCaseCount: number;
  capturedCaseCount: number;
  sampleRates: number[];
  complete: boolean;
  results: DryPcmCaseResult[];
  comparisons: DryPcmInstrumentComparison[];
}

const finite = (value: number): number | null => Number.isFinite(value) ? Number(value.toFixed(6)) : null;
const FULL_COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FATAL_CODES = new Set<DryPcmFatalCode>([
  'TRUE_PEAK_OVER_0_DBTP', 'FLAT_TOP_CLIPPING', 'DC_OFFSET',
  'SILENT_DECLARED_NOTE', 'PITCH_ERROR',
  'MONO_LOSS', 'RELEASE_RESIDUAL', 'ALTERNATE_SEED_VARIATION_MISSING',
]);
const EVIDENCE_GAP_CODES = new Set<DryPcmEvidenceGapCode>(['PITCH_INCONCLUSIVE']);
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(THIS_DIR, '..');

interface MatrixSampleManifest {
  playbackNote?: number;
  samples: Array<{ note: number }>;
}

const manifestCache = new Map<string, MatrixSampleManifest | null>();

function sampledManifest(profileId: string): MatrixSampleManifest | null {
  if (!profileId.startsWith('sampled:')) return null;
  if (manifestCache.has(profileId)) return manifestCache.get(profileId)!;
  const pathname = path.resolve(APP_ROOT, 'public/instruments', profileId.slice('sampled:'.length), 'manifest.json');
  const manifest = fs.existsSync(pathname)
    ? JSON.parse(fs.readFileSync(pathname, 'utf8')) as MatrixSampleManifest
    : null;
  manifestCache.set(profileId, manifest);
  return manifest;
}

export function schedulerMidiForTargetMidi(targetMidi: number, playbackNote?: number): number {
  return playbackNote === undefined ? targetMidi : 60 + targetMidi - playbackNote;
}

function noteEvent(
  profile: InstrumentQualityProfile,
  targetMidi: number,
  velocity: number,
  startSeconds: number,
  gateSeconds: number,
): MatrixNoteEvent {
  return {
    midi: schedulerMidiForTargetMidi(targetMidi, sampledManifest(profile.id)?.playbackNote),
    targetMidi,
    velocity,
    startSeconds,
    gateSeconds,
  };
}

function pitchErrorCents(
  profile: InstrumentQualityProfile,
  observedCents: number | null,
): number | null {
  if (observedCents === null) return null;
  switch (profile.pitchReference) {
    case 'absolute-fundamental':
      return observedCents;
    case 'fundamental-one-octave-below':
      return observedCents + 1200;
    case 'harmonic-pitch-class':
      return ((observedCents + 600) % 1200 + 1200) % 1200 - 600;
    case 'not-applicable':
      return null;
  }
}

export function isFullCommitId(value: string): boolean {
  return FULL_COMMIT_ID.test(value);
}

export function validateMatrixProvenance(provenance: MatrixProvenance): void {
  if (!provenance || !isFullCommitId(provenance.evaluatorCommit) || !isFullCommitId(provenance.subjectCommit)) {
    throw new Error('Dry PCM matrix requires full evaluator and subject commit IDs');
  }
  if (!SHA256.test(provenance.evaluatorTreeSha256)) {
    throw new Error('Dry PCM matrix requires a valid evaluator tree SHA-256');
  }
  if (
    typeof provenance.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(provenance.generatedAt))
    || new Date(provenance.generatedAt).toISOString() !== provenance.generatedAt
  ) {
    throw new Error('Dry PCM matrix requires an ISO-8601 generatedAt timestamp');
  }
  for (const [name, value] of Object.entries(provenance.runtime ?? {})) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Dry PCM matrix runtime ${name} is missing`);
    }
  }
  if (!provenance.runtime?.node || !provenance.runtime.platform || !provenance.runtime.arch) {
    throw new Error('Dry PCM matrix runtime identity is incomplete');
  }
  if (
    !provenance.capture
    || !['offline', 'chromium-worklet'].includes(provenance.capture.mode)
    || typeof provenance.capture.adapter !== 'string'
    || provenance.capture.adapter.trim().length === 0
    || !SHA256.test(provenance.capture.adapterSha256)
  ) {
    throw new Error('Dry PCM matrix capture-adapter identity is invalid');
  }
  if (provenance.capture.mode === 'chromium-worklet' && provenance.browser === null) {
    throw new Error('Chromium worklet capture requires browser identity');
  }
  if (provenance.browser !== null) {
    if (
      typeof provenance.browser.name !== 'string'
      || provenance.browser.name.trim().length === 0
      || typeof provenance.browser.version !== 'string'
      || provenance.browser.version.trim().length === 0
      || (provenance.browser.userAgent !== undefined
        && (typeof provenance.browser.userAgent !== 'string' || provenance.browser.userAgent.trim().length === 0))
    ) {
      throw new Error('Dry PCM matrix browser identity is invalid');
    }
  }
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function qualityProfileSha256(
  profiles: readonly InstrumentQualityProfile[] = INSTRUMENT_QUALITY_PROFILES,
): string {
  return stableHash(profiles);
}

function rangeNotes(profile: InstrumentQualityProfile): Array<{ variant: string; midi: number }> {
  const { minMidi, maxMidi } = getInstrumentRange(profile.id);
  const span = maxMidi - minMidi;
  if (!Number.isInteger(minMidi) || !Number.isInteger(maxMidi) || span < 5) {
    throw new Error(`Quality matrix needs at least six integer notes for ${profile.id}: [${minMidi}, ${maxMidi}]`);
  }
  const anchors = [
    { variant: 'min', midi: minMidi },
    { variant: 'q1', midi: Math.round(minMidi + span * 0.25) },
    { variant: 'mid', midi: Math.round(minMidi + span * 0.5) },
    { variant: 'q3', midi: Math.round(minMidi + span * 0.75) },
    { variant: 'max', midi: maxMidi },
  ];
  const manifestRoots = sampledManifest(profile.id)?.samples
    .map(sample => sample.note)
    .filter(Number.isInteger);
  const usedBeforeStress = new Set(anchors.map(anchor => anchor.midi));
  const stressCandidates = Array.from({ length: span + 1 }, (_, offset) => minMidi + offset)
    .filter(midi => !usedBeforeStress.has(midi));
  if (manifestRoots && manifestRoots.length > 0) {
    const nearestRootDistance = (midi: number): number =>
      Math.min(...manifestRoots.map(root => Math.abs(root - midi)));
    stressCandidates.sort((left, right) =>
      nearestRootDistance(right) - nearestRootDistance(left)
      || (profile.rangeStress === 'low-interior' ? left - right : right - left)
    );
    anchors.push({ variant: 'worst-root-distance', midi: stressCandidates[0] });
  } else {
    const preferred = profile.rangeStress === 'low-interior'
      ? Math.round(minMidi + span * 0.125)
      : Math.round(minMidi + span * 0.875);
    anchors.push({
      variant: 'interior-stress',
      midi: stressCandidates.sort((left, right) => Math.abs(left - preferred) - Math.abs(right - preferred))[0],
    });
  }
  const used = new Set<number>();
  for (const anchor of anchors) {
    if (!used.has(anchor.midi)) {
      used.add(anchor.midi);
      continue;
    }
    const replacement = Array.from({ length: span + 1 }, (_, offset) => minMidi + offset)
      .find(note => !used.has(note));
    if (replacement === undefined) throw new Error(`Could not create six unique range anchors for ${profile.id}`);
    anchor.midi = replacement;
    used.add(replacement);
  }
  return anchors;
}

function singleNoteCase(
  profile: InstrumentQualityProfile,
  family: MatrixFamily,
  variant: string,
  midi: number,
  velocity: number,
): DryPcmMatrixCase {
  const durationSeconds = profile.render.gateSeconds + profile.render.tailSeconds;
  return {
    id: `${profile.id}/${family}/${variant}`,
    instrumentId: profile.id,
    family,
    variant,
    dry: true,
    effectsEnabled: false,
    pan: 0,
    sampleRate: MATRIX_SAMPLE_RATE,
    durationSeconds,
    notes: [noteEvent(profile, midi, velocity, 0, profile.render.gateSeconds)],
    random: { locked: true, seed: MATRIX_RANDOM_SEED, replayOf: null },
  };
}

export function buildInstrumentMatrixCases(profile: InstrumentQualityProfile): DryPcmMatrixCase[] {
  const canonical = singleNoteCase(
    profile,
    'canonical',
    'midi-90',
    profile.render.canonicalMidi,
    90,
  );
  const range = rangeNotes(profile).map(anchor => singleNoteCase(
    profile,
    'range',
    `${anchor.variant}-${anchor.midi}`,
    anchor.midi,
    90,
  ));
  const velocity = MATRIX_VELOCITIES.map(value => singleNoteCase(
    profile,
    'velocity',
    `midi-${value}`,
    profile.render.canonicalMidi,
    value,
  ));
  const release = singleNoteCase(
    profile,
    'release',
    `gate-${profile.render.gateSeconds}`,
    profile.render.canonicalMidi,
    90,
  );
  const repeatDuration = (MATRIX_REPEAT_COUNT - 1) * profile.render.repeatIntervalSeconds
    + profile.render.gateSeconds + profile.render.tailSeconds;
  const repeatedNotes: MatrixNoteEvent[] = Array.from({ length: MATRIX_REPEAT_COUNT }, (_, index) =>
    noteEvent(
      profile,
      profile.render.canonicalMidi,
      90,
      index * profile.render.repeatIntervalSeconds,
      Math.min(profile.render.gateSeconds, profile.render.repeatIntervalSeconds * 0.9),
    )
  );
  const repeat = (family: Extract<MatrixFamily, `repeat-${string}`>): DryPcmMatrixCase => {
    const replayOf = family === 'repeat-seed-a-replay'
      ? `${profile.id}/repeat-seed-a/16-hits`
      : null;
    const seed = family === 'repeat-seed-b' ? MATRIX_ALTERNATE_SEED : MATRIX_RANDOM_SEED;
    return {
      id: `${profile.id}/${family}/16-hits`,
      instrumentId: profile.id,
      family,
      variant: '16-hits',
      dry: true,
      effectsEnabled: false,
      pan: 0,
      sampleRate: MATRIX_SAMPLE_RATE,
      durationSeconds: repeatDuration,
      notes: repeatedNotes,
      // Each case is a distinct fresh/reset capture attempt. A and its replay
      // must be bit-exact; B makes declared seed-controlled variation testable
      // without relying on unrecorded entropy.
      random: { locked: true, seed, replayOf },
    };
  };
  const polyphonyNotes = profile.render.polyphonyMidi.map(midi =>
    noteEvent(profile, midi, 90, 0, profile.render.gateSeconds)
  );
  const polyphony: DryPcmMatrixCase = {
    id: `${profile.id}/polyphony/${polyphonyNotes.length}-voices`,
    instrumentId: profile.id,
    family: 'polyphony',
    variant: `${polyphonyNotes.length}-voices`,
    dry: true,
    effectsEnabled: false,
    pan: 0,
    sampleRate: MATRIX_SAMPLE_RATE,
    durationSeconds: profile.render.gateSeconds + profile.render.tailSeconds,
    notes: polyphonyNotes,
    random: { locked: true, seed: MATRIX_RANDOM_SEED, replayOf: null },
  };
  const stereo = singleNoteCase(
    profile,
    'stereo',
    profile.stereoPolicy,
    profile.render.canonicalMidi,
    90,
  );
  return [
    canonical,
    ...range,
    ...velocity,
    release,
    repeat('repeat-seed-a'),
    repeat('repeat-seed-b'),
    repeat('repeat-seed-a-replay'),
    polyphony,
    stereo,
  ];
}

export function buildDryPcmMatrixPlan(
  profiles: readonly InstrumentQualityProfile[] = INSTRUMENT_QUALITY_PROFILES,
): DryPcmMatrixCase[] {
  const plan = profiles.flatMap(buildInstrumentMatrixCases);
  const ids = plan.map(item => item.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) throw new Error(`Duplicate dry PCM matrix cases: ${[...new Set(duplicates)].join(', ')}`);
  return plan;
}

export function matrixPlanSha256(plan: readonly DryPcmMatrixCase[]): string {
  return stableHash(plan);
}

export function expectedMatrixFrameCount(matrixCase: DryPcmMatrixCase, sampleRate: number): number {
  return Math.round(matrixCase.durationSeconds * sampleRate);
}

function validateCapture(capture: DryPcmCapture, matrixCase: DryPcmMatrixCase): void {
  if (typeof capture.captureAttemptId !== 'string' || capture.captureAttemptId.trim().length === 0) {
    throw new Error(`${matrixCase.id}: capture attempt ID is missing`);
  }
  if (capture.sampleRate !== matrixCase.sampleRate) {
    throw new Error(`${matrixCase.id}: sample rate ${capture.sampleRate} does not match pinned ${matrixCase.sampleRate}`);
  }
  const expectedFrames = expectedMatrixFrameCount(matrixCase, capture.sampleRate);
  if (capture.frameCount !== expectedFrames) {
    throw new Error(`${matrixCase.id}: frame count ${capture.frameCount} does not match ${expectedFrames} requested frames`);
  }
  if (!Number.isInteger(capture.capturedFrameCount) || capture.capturedFrameCount !== capture.frameCount) {
    throw new Error(`${matrixCase.id}: incomplete capture ${capture.capturedFrameCount}/${capture.frameCount} frames`);
  }
  if (
    !Number.isInteger(capture.maxRenderFrameDrift)
    || capture.maxRenderFrameDrift < 0
    || capture.maxRenderFrameDrift > MAX_RENDER_FRAME_DRIFT
  ) {
    throw new Error(`${matrixCase.id}: render-frame drift ${capture.maxRenderFrameDrift} exceeds ${MAX_RENDER_FRAME_DRIFT}`);
  }
  if (capture.channels.length < 1 || capture.channels.length > 2) {
    throw new Error(`${matrixCase.id}: capture must contain one or two channels`);
  }
  for (const [channelIndex, channel] of capture.channels.entries()) {
    if (channel.length !== capture.frameCount) {
      throw new Error(`${matrixCase.id}: channel ${channelIndex} has ${channel.length}/${capture.frameCount} frames`);
    }
    for (let frame = 0; frame < channel.length; frame++) {
      if (!Number.isFinite(channel[frame])) {
        throw new Error(`${matrixCase.id}: non-finite PCM at channel ${channelIndex}, frame ${frame}`);
      }
    }
  }
}

export function pcmSha256(capture: DryPcmCapture): string {
  const hash = createHash('sha256');
  hash.update(`${capture.sampleRate}:${capture.channels.length}:${capture.frameCount}:f32le\n`);
  const bytes = Buffer.allocUnsafe(capture.frameCount * 4);
  for (const channel of capture.channels) {
    for (let frame = 0; frame < channel.length; frame++) bytes.writeFloatLE(channel[frame], frame * 4);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function releaseResidualDb(samples: Float32Array, sampleRate: number, noteOffSeconds: number): number {
  const start = Math.round((noteOffSeconds + 2) * sampleRate);
  const end = Math.min(samples.length, start + Math.max(1, Math.round(sampleRate * 0.1)));
  if (start >= samples.length || end <= start) return Number.POSITIVE_INFINITY;
  return rmsDb(samples, { start, end });
}

export function analyzeDryPcmCapture(
  profile: InstrumentQualityProfile,
  matrixCase: DryPcmMatrixCase,
  capture: DryPcmCapture,
): {
  metrics: DryPcmMetrics;
  fatalFindings: DryPcmGateFinding[];
  evidenceGaps: DryPcmEvidenceGap[];
} {
  validateCapture(capture, matrixCase);
  const decoded: DecodedAudioLike = {
    numberOfChannels: capture.channels.length,
    sampleRate: capture.sampleRate,
    length: capture.frameCount,
    duration: capture.frameCount / capture.sampleRate,
    getChannelData: channel => capture.channels[channel] as Float32Array,
  };
  const analyzed = analyzeDecodedSampleWithMono({
    instrumentId: profile.id,
    instrumentName: profile.id,
    file: matrixCase.id,
    note: matrixCase.notes[0]?.targetMidi ?? profile.render.canonicalMidi,
    pitched: profile.pitchMode === 'tonal',
  }, decoded);
  const sampleMetrics = analyzed.metrics;
  const absolutePitch = profile.pitchMode === 'tonal'
    ? estimateAbsolutePitch(
      analyzed.mono,
      capture.sampleRate,
      matrixCase.notes[0]?.targetMidi ?? profile.render.canonicalMidi,
      sampleMetrics.activeStartMs === null
        ? null
        : Math.round(sampleMetrics.activeStartMs * capture.sampleRate / 1000),
      sampleMetrics.activeEndMs === null
        ? null
        : Math.round(sampleMetrics.activeEndMs * capture.sampleRate / 1000),
    )
    : null;
  const channelTruePeaks = capture.channels.map(channel => truePeakDbfs(channel));
  const truePeak = Math.max(...channelTruePeaks);
  const residual = matrixCase.family === 'release'
    ? Math.max(...capture.channels.map(channel => releaseResidualDb(
      channel,
      capture.sampleRate,
      (matrixCase.notes[0]?.startSeconds ?? 0) + (matrixCase.notes[0]?.gateSeconds ?? 0),
    )))
    : null;
  const worstChannelDcDb = Math.max(...capture.channels.map(channel => {
    const absolute = Math.abs(dcOffset(channel));
    return absolute > 0 ? 20 * Math.log10(absolute) : -120;
  }));
  const evaluatedPitchError = pitchErrorCents(profile, absolutePitch?.rawCents ?? null);
  const metrics: DryPcmMetrics = {
    peakDbfs: finite(Math.max(...capture.channels.map(channel => peakDbfs(channel)))),
    truePeakDbtp: finite(truePeak),
    rmsDbfs: finite(sampleMetrics.rmsDb),
    activeRmsDbfs: finite(sampleMetrics.activeRmsDb),
    loudnessKMax: sampleMetrics.loudnessKMax === null ? null : finite(sampleMetrics.loudnessKMax),
    dcOffsetDbfs: finite(worstChannelDcDb) ?? -120,
    leadingSilenceMs: sampleMetrics.leadingSilenceMs,
    tailLevelDbRelativePeak: sampleMetrics.tailLevelDbRelPeak,
    flatTopRuns: sampleMetrics.flatTopRuns,
    clippingSamples: sampleMetrics.clippingSamples,
    spectralCentroidHz: sampleMetrics.spectral.centroidHz,
    pitchObservedCents: absolutePitch?.rawCents ?? null,
    pitchErrorCents: evaluatedPitchError,
    pitchConfidence: absolutePitch?.confidence ?? 0,
    stereoCorrelation: sampleMetrics.stereo?.correlation ?? null,
    monoLossDb: sampleMetrics.stereo?.monoLossDb ?? null,
    releaseResidualDbfs: residual === null ? null : finite(residual),
  };
  const fatalFindings: DryPcmGateFinding[] = [];
  const evidenceGaps: DryPcmEvidenceGap[] = [];
  const add = (code: DryPcmFatalCode, message: string, value: number, threshold: number): void => {
    fatalFindings.push({ code, message, value: Number(value.toFixed(6)), threshold });
  };
  if (truePeak > 0) add('TRUE_PEAK_OVER_0_DBTP', `True peak is ${truePeak.toFixed(2)} dBTP`, truePeak, 0);
  if (sampleMetrics.flatTopRuns > 3) {
    add('FLAT_TOP_CLIPPING', `${sampleMetrics.flatTopRuns} flat-top runs`, sampleMetrics.flatTopRuns, 3);
  }
  if (worstChannelDcDb > -40) {
    add('DC_OFFSET', `Worst-channel DC offset is ${worstChannelDcDb.toFixed(2)} dBFS`, worstChannelDcDb, -40);
  }
  if (sampleMetrics.peak < 0.0001 && 10 ** (sampleMetrics.rmsDb / 20) < 0.00001) {
    add('SILENT_DECLARED_NOTE', 'Declared matrix note is silent', sampleMetrics.peak, 0.0001);
  }
  const pitchGateFamily = matrixCase.family === 'canonical'
    || matrixCase.family === 'range'
    || matrixCase.family === 'velocity'
    || matrixCase.family === 'release'
    || matrixCase.family === 'stereo';
  if (profile.pitchMode === 'tonal' && pitchGateFamily) {
    if (absolutePitch === null || absolutePitch.rawCents === null || absolutePitch.confidence < 0.8) {
      evidenceGaps.push({
        code: 'PITCH_INCONCLUSIVE',
        message: `Pitch evidence is inconclusive for ${profile.pitchReference}`,
        value: Number((absolutePitch?.confidence ?? 0).toFixed(6)),
        threshold: 0.8,
      });
    } else if (evaluatedPitchError !== null && Math.abs(evaluatedPitchError) > 50) {
      add(
        'PITCH_ERROR',
        `High-confidence ${profile.pitchReference} pitch error is ${evaluatedPitchError.toFixed(1)} cents`,
        Math.abs(evaluatedPitchError),
        50,
      );
    }
  }
  if (matrixCase.family === 'stereo' && (sampleMetrics.stereo?.monoLossDb ?? 0) < -3) {
    add(
      'MONO_LOSS',
      `Mono fold-down loses ${Math.abs(sampleMetrics.stereo!.monoLossDb!).toFixed(2)} dB`,
      Math.abs(sampleMetrics.stereo!.monoLossDb!),
      3,
    );
  }
  if (profile.releasePolicy === 'lifecycle' && residual !== null && residual > -40) {
    add('RELEASE_RESIDUAL', `Release remains at ${residual.toFixed(2)} dBFS`, residual, -40);
  }
  return { metrics, fatalFindings, evidenceGaps };
}

export function validateMatrixCoverage(
  plan: readonly DryPcmMatrixCase[],
  results: readonly Pick<DryPcmCaseResult, 'caseId'>[],
): void {
  const expected = new Set(plan.map(matrixCase => matrixCase.id));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unexpected: string[] = [];
  for (const result of results) {
    if (seen.has(result.caseId)) duplicates.push(result.caseId);
    seen.add(result.caseId);
    if (!expected.has(result.caseId)) unexpected.push(result.caseId);
  }
  const missing = [...expected].filter(id => !seen.has(id));
  if (missing.length > 0 || unexpected.length > 0 || duplicates.length > 0) {
    throw new Error(
      `Dry PCM matrix coverage failure: missing=${missing.length} [${missing.slice(0, 5).join(', ')}], `
      + `unexpected=${unexpected.length} [${unexpected.slice(0, 5).join(', ')}], `
      + `duplicates=${duplicates.length} [${duplicates.slice(0, 5).join(', ')}]`,
    );
  }
}

function metricDelta(to: number | null, from: number | null): number | null {
  return to === null || from === null ? null : finite(to - from);
}

function resultFor(
  resultsById: ReadonlyMap<string, DryPcmCaseResult>,
  caseId: string,
): DryPcmCaseResult {
  const result = resultsById.get(caseId);
  if (!result) throw new Error(`Missing matrix result needed for comparison: ${caseId}`);
  return result;
}

/**
 * Cross-case comparisons whose claims are intentionally narrow. Velocity,
 * polyphony, stereo, and spectrum remain descriptive. Exact A/replay identity
 * is a capture-conformance requirement, while A/B inequality only establishes
 * that a declared seed-controlled mechanism changed PCM—not audible variety.
 */
export function buildDryPcmInstrumentComparisons(
  profiles: readonly InstrumentQualityProfile[],
  results: readonly DryPcmCaseResult[],
): DryPcmInstrumentComparison[] {
  const resultsById = new Map(results.map(result => [result.caseId, result]));
  return profiles.map(profile => {
    const velocityResults = MATRIX_VELOCITIES.map(velocity => ({
      velocity,
      result: resultFor(resultsById, `${profile.id}/velocity/midi-${velocity}`),
    }));
    const seedA = resultFor(resultsById, `${profile.id}/repeat-seed-a/16-hits`);
    const seedB = resultFor(resultsById, `${profile.id}/repeat-seed-b/16-hits`);
    const seedAReplay = resultFor(resultsById, `${profile.id}/repeat-seed-a-replay/16-hits`);
    const canonical = resultFor(resultsById, `${profile.id}/canonical/midi-90`);
    const polyphony = resultFor(
      resultsById,
      `${profile.id}/polyphony/${profile.render.polyphonyMidi.length}-voices`,
    );
    const stereo = resultFor(resultsById, `${profile.id}/stereo/${profile.stereoPolicy}`);
    const geometryMatches = seedA.sampleRate === seedAReplay.sampleRate
      && seedA.channels === seedAReplay.channels
      && seedA.frameCount === seedAReplay.frameCount;
    const seedAReplayExact = geometryMatches && seedA.pcmSha256 === seedAReplay.pcmSha256;
    if (!seedAReplayExact) {
      throw new Error(
        `${profile.id}: seed-A replay is not bit-exact; receipt cannot attribute this harness/determinism failure to audio quality`,
      );
    }
    return {
      instrumentId: profile.id,
      velocity: {
        policy: 'measure-only',
        activeRmsDbfs: velocityResults.map(({ velocity, result }) => ({
          velocity,
          value: result.metrics.activeRmsDbfs,
        })),
        consecutiveActiveRmsDeltaDb: velocityResults.slice(1).map(({ velocity, result }, index) => ({
          from: velocityResults[index].velocity,
          to: velocity,
          value: metricDelta(result.metrics.activeRmsDbfs, velocityResults[index].result.metrics.activeRmsDbfs),
        })),
        loudnessKMax: velocityResults.map(({ velocity, result }) => ({
          velocity,
          value: result.metrics.loudnessKMax,
        })),
        spectralCentroidHz: velocityResults.map(({ velocity, result }) => ({
          velocity,
          value: result.metrics.spectralCentroidHz,
        })),
      },
      repeat: {
        policy: profile.variationPolicy,
        seedAReplayExact,
        alternateSeedDiffers: seedA.pcmSha256 !== seedB.pcmSha256,
      },
      polyphony: {
        policy: 'aggregate-safety-only',
        voiceCount: profile.render.polyphonyMidi.length,
        activeRmsDeltaFromCanonicalDb: metricDelta(
          polyphony.metrics.activeRmsDbfs,
          canonical.metrics.activeRmsDbfs,
        ),
        loudnessDeltaFromCanonicalDb: metricDelta(
          polyphony.metrics.loudnessKMax,
          canonical.metrics.loudnessKMax,
        ),
        truePeakDeltaFromCanonicalDb: metricDelta(
          polyphony.metrics.truePeakDbtp,
          canonical.metrics.truePeakDbtp,
        ),
      },
      stereo: {
        policy: 'mono-fold-only',
        correlation: stereo.metrics.stereoCorrelation,
        monoLossDb: stereo.metrics.monoLossDb,
      },
      spectral: {
        policy: 'descriptive-only',
        canonicalCentroidHz: canonical.metrics.spectralCentroidHz,
      },
    };
  });
}

function applyAlternateSeedFindings(
  profiles: readonly InstrumentQualityProfile[],
  results: DryPcmCaseResult[],
): void {
  const resultsById = new Map(results.map(result => [result.caseId, result]));
  for (const profile of profiles) {
    const seedA = resultFor(resultsById, `${profile.id}/repeat-seed-a/16-hits`);
    const seedB = resultFor(resultsById, `${profile.id}/repeat-seed-b/16-hits`);
    seedB.fatalFindings = seedB.fatalFindings.filter(
      finding => finding.code !== 'ALTERNATE_SEED_VARIATION_MISSING',
    );
    if (
      profile.variationPolicy === 'alternate-seed-must-differ'
      && seedA.pcmSha256 === seedB.pcmSha256
    ) {
      seedB.fatalFindings.push({
        code: 'ALTERNATE_SEED_VARIATION_MISSING',
        message: 'Declared seed-controlled variation mechanism produced identical PCM for seeds A and B',
        value: 0,
        threshold: 1,
      });
    }
  }
}

export async function runDryPcmMatrix(options: {
  capture: (matrixCase: DryPcmMatrixCase) => Promise<DryPcmCapture>;
  provenance: MatrixProvenance;
  profiles?: readonly InstrumentQualityProfile[];
}): Promise<DryPcmMatrixReport> {
  const profiles = options.profiles ?? INSTRUMENT_QUALITY_PROFILES;
  validateMatrixProvenance(options.provenance);
  const plan = buildDryPcmMatrixPlan(profiles);
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  const results: DryPcmCaseResult[] = [];
  for (const matrixCase of plan) {
    const profile = profileById.get(matrixCase.instrumentId);
    if (!profile) throw new Error(`Missing profile while running ${matrixCase.id}`);
    const capture = await options.capture(matrixCase);
    const analyzed = analyzeDryPcmCapture(profile, matrixCase, capture);
    results.push({
      caseId: matrixCase.id,
      instrumentId: matrixCase.instrumentId,
      family: matrixCase.family,
      variant: matrixCase.variant,
      captureAttemptId: capture.captureAttemptId,
      pcmSha256: pcmSha256(capture),
      sampleRate: capture.sampleRate,
      channels: capture.channels.length,
      frameCount: capture.frameCount,
      capturedFrameCount: capture.capturedFrameCount,
      maxRenderFrameDrift: capture.maxRenderFrameDrift,
      metrics: analyzed.metrics,
      fatalFindings: analyzed.fatalFindings,
      evidenceGaps: analyzed.evidenceGaps,
    });
  }
  validateMatrixCoverage(plan, results);
  if (new Set(results.map(result => result.captureAttemptId)).size !== results.length) {
    throw new Error('Dry PCM matrix capture attempt IDs must be unique');
  }
  applyAlternateSeedFindings(profiles, results);
  const comparisons = buildDryPcmInstrumentComparisons(profiles, results);
  const report: DryPcmMatrixReport = {
    schemaVersion: MATRIX_SCHEMA_VERSION,
    claim: 'dry-post-track-technical-evidence',
    provenance: options.provenance,
    profileSha256: qualityProfileSha256(profiles),
    planSha256: matrixPlanSha256(plan),
    profileCount: profiles.length,
    expectedCaseCount: plan.length,
    capturedCaseCount: results.length,
    sampleRates: [...new Set(results.map(result => result.sampleRate))].sort((left, right) => left - right),
    complete: true,
    results,
    comparisons,
  };
  validateDryPcmMatrixReport(report, profiles);
  return report;
}

export function validateDryPcmMatrixReport(
  report: DryPcmMatrixReport,
  profiles: readonly InstrumentQualityProfile[] = INSTRUMENT_QUALITY_PROFILES,
  expectedBinding?: {
    evaluatorCommit: string;
    subjectCommit: string;
    evaluatorTreeSha256: string;
    evaluatorDirty: boolean;
  },
): void {
  if (!report || typeof report !== 'object') throw new Error('Dry PCM matrix report is not an object');
  if (report.schemaVersion !== MATRIX_SCHEMA_VERSION) {
    throw new Error(`Unsupported dry PCM matrix schema ${report.schemaVersion}`);
  }
  if (report.claim !== 'dry-post-track-technical-evidence') {
    throw new Error(`Unsupported dry PCM matrix claim ${String(report.claim)}`);
  }
  if (!report.complete) throw new Error('Dry PCM matrix report declares incomplete coverage');
  validateMatrixProvenance(report.provenance);
  if (expectedBinding) {
    if (expectedBinding.evaluatorDirty) {
      throw new Error('Pinned matrix verification rejects a dirty evaluator tree');
    }
    if (
      report.provenance.evaluatorCommit !== expectedBinding.evaluatorCommit
      || report.provenance.subjectCommit !== expectedBinding.subjectCommit
      || report.provenance.evaluatorTreeSha256 !== expectedBinding.evaluatorTreeSha256
    ) {
      throw new Error('Dry PCM matrix provenance does not match the pinned evaluator/subject binding');
    }
  }
  const plan = buildDryPcmMatrixPlan(profiles);
  if (report.profileCount !== profiles.length || report.profileSha256 !== qualityProfileSha256(profiles)) {
    throw new Error('Dry PCM matrix profile identity does not match the pinned evaluator');
  }
  if (report.expectedCaseCount !== plan.length || report.planSha256 !== matrixPlanSha256(plan)) {
    throw new Error('Dry PCM matrix plan identity does not match the pinned evaluator');
  }
  const resultCount = Array.isArray(report.results) ? report.results.length : -1;
  if (resultCount < 0 || report.capturedCaseCount !== resultCount || report.capturedCaseCount !== report.expectedCaseCount) {
    throw new Error(`Dry PCM matrix count mismatch: ${report.capturedCaseCount}/${resultCount}`);
  }
  validateMatrixCoverage(plan, report.results);
  const planById = new Map(plan.map(matrixCase => [matrixCase.id, matrixCase]));
  const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
  const attemptIds = new Set<string>();
  const nullableMetricKeys: Array<keyof DryPcmMetrics> = [
    'peakDbfs', 'truePeakDbtp', 'rmsDbfs', 'activeRmsDbfs', 'loudnessKMax',
    'tailLevelDbRelativePeak', 'spectralCentroidHz', 'pitchObservedCents', 'pitchErrorCents',
    'stereoCorrelation', 'monoLossDb', 'releaseResidualDbfs',
  ];
  for (const result of report.results) {
    const matrixCase = planById.get(result.caseId)!;
    if (
      result.instrumentId !== matrixCase.instrumentId
      || result.family !== matrixCase.family
      || result.variant !== matrixCase.variant
    ) {
      throw new Error(`${result.caseId}: result identity does not match matrix plan`);
    }
    if (!SHA256.test(result.pcmSha256)) {
      throw new Error(`${result.caseId}: invalid PCM SHA-256`);
    }
    if (
      typeof result.captureAttemptId !== 'string'
      || result.captureAttemptId.trim().length === 0
      || attemptIds.has(result.captureAttemptId)
    ) {
      throw new Error(`${result.caseId}: invalid or duplicate capture attempt ID`);
    }
    attemptIds.add(result.captureAttemptId);
    if (result.sampleRate !== matrixCase.sampleRate) {
      throw new Error(`${result.caseId}: receipt sample rate does not match pinned plan`);
    }
    const expectedFrames = expectedMatrixFrameCount(matrixCase, result.sampleRate);
    if (result.frameCount !== expectedFrames || result.capturedFrameCount !== result.frameCount) {
      throw new Error(`${result.caseId}: incomplete frame receipt`);
    }
    if (
      !Number.isInteger(result.maxRenderFrameDrift)
      || result.maxRenderFrameDrift < 0
      || result.maxRenderFrameDrift > MAX_RENDER_FRAME_DRIFT
    ) {
      throw new Error(`${result.caseId}: invalid render-frame drift`);
    }
    if (!Number.isInteger(result.channels) || result.channels < 1 || result.channels > 2) {
      throw new Error(`${result.caseId}: invalid channel count`);
    }
    if (!result.metrics || typeof result.metrics !== 'object') {
      throw new Error(`${result.caseId}: metrics object is missing`);
    }
    for (const key of nullableMetricKeys) {
      const value = result.metrics[key];
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error(`${result.caseId}: metric ${key} must be finite or null`);
      }
    }
    for (const key of ['dcOffsetDbfs', 'leadingSilenceMs', 'pitchConfidence'] as const) {
      const value = result.metrics[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${result.caseId}: metric ${key} must be finite`);
      }
    }
    if (
      result.metrics.leadingSilenceMs < 0
      || result.metrics.pitchConfidence < 0
      || result.metrics.pitchConfidence > 1
      || !Number.isInteger(result.metrics.flatTopRuns)
      || result.metrics.flatTopRuns < 0
      || !Number.isInteger(result.metrics.clippingSamples)
      || result.metrics.clippingSamples < 0
    ) {
      throw new Error(`${result.caseId}: metric bounds are invalid`);
    }
    if (!Array.isArray(result.fatalFindings)) throw new Error(`${result.caseId}: fatal findings are missing`);
    const actualCodes = result.fatalFindings.map(finding => finding.code);
    if (new Set(actualCodes).size !== actualCodes.length) {
      throw new Error(`${result.caseId}: duplicate fatal finding code`);
    }
    for (const finding of result.fatalFindings) {
      if (
        !FATAL_CODES.has(finding.code)
        || typeof finding.message !== 'string'
        || finding.message.trim().length === 0
        || !Number.isFinite(finding.value)
        || !Number.isFinite(finding.threshold)
      ) {
        throw new Error(`${result.caseId}: invalid fatal finding`);
      }
    }
    if (!Array.isArray(result.evidenceGaps)) throw new Error(`${result.caseId}: evidence gaps are missing`);
    const actualGapCodes = result.evidenceGaps.map(gap => gap.code);
    if (new Set(actualGapCodes).size !== actualGapCodes.length) {
      throw new Error(`${result.caseId}: duplicate evidence-gap code`);
    }
    for (const gap of result.evidenceGaps) {
      if (
        !EVIDENCE_GAP_CODES.has(gap.code)
        || typeof gap.message !== 'string'
        || gap.message.trim().length === 0
        || !Number.isFinite(gap.value)
        || !Number.isFinite(gap.threshold)
      ) throw new Error(`${result.caseId}: invalid evidence gap`);
    }
    const profile = profilesById.get(result.instrumentId)!;
    const expectedCodes: DryPcmFatalCode[] = [];
    if ((result.metrics.truePeakDbtp ?? -Infinity) > 0) expectedCodes.push('TRUE_PEAK_OVER_0_DBTP');
    if (result.metrics.flatTopRuns > 3) expectedCodes.push('FLAT_TOP_CLIPPING');
    if (result.metrics.dcOffsetDbfs > -40) expectedCodes.push('DC_OFFSET');
    if (
      (result.metrics.peakDbfs === null || result.metrics.peakDbfs < -80)
      && (result.metrics.rmsDbfs === null || result.metrics.rmsDbfs < -100)
    ) expectedCodes.push('SILENT_DECLARED_NOTE');
    const pitchGateFamily = ['canonical', 'range', 'velocity', 'release', 'stereo'].includes(matrixCase.family);
    if (profile.pitchMode === 'tonal' && pitchGateFamily) {
      if (result.metrics.pitchErrorCents !== null && result.metrics.pitchConfidence >= 0.8
        && Math.abs(result.metrics.pitchErrorCents) > 50) {
        expectedCodes.push('PITCH_ERROR');
      }
    }
    if (matrixCase.family === 'stereo' && (result.metrics.monoLossDb ?? 0) < -3) {
      expectedCodes.push('MONO_LOSS');
    }
    if (
      matrixCase.family === 'release'
      && profile.releasePolicy === 'lifecycle'
      && (result.metrics.releaseResidualDbfs ?? -Infinity) > -40
    ) expectedCodes.push('RELEASE_RESIDUAL');
    const technicalActualCodes = actualCodes.filter(code => code !== 'ALTERNATE_SEED_VARIATION_MISSING');
    if ([...technicalActualCodes].sort().join('\0') !== expectedCodes.sort().join('\0')) {
      throw new Error(`${result.caseId}: fatal findings do not match measured gate metrics`);
    }
    const expectedGapCodes: DryPcmEvidenceGapCode[] = [];
    if (
      profile.pitchMode === 'tonal'
      && pitchGateFamily
      && (result.metrics.pitchObservedCents === null || result.metrics.pitchConfidence < 0.8)
    ) expectedGapCodes.push('PITCH_INCONCLUSIVE');
    if (actualGapCodes.sort().join('\0') !== expectedGapCodes.sort().join('\0')) {
      throw new Error(`${result.caseId}: evidence gaps do not match measured pitch evidence`);
    }
  }
  const expectedSampleRates = [...new Set(report.results.map(result => result.sampleRate))]
    .sort((left, right) => left - right);
  if (
    !Array.isArray(report.sampleRates)
    || report.sampleRates.some(rate => !Number.isInteger(rate))
    || JSON.stringify(report.sampleRates) !== JSON.stringify(expectedSampleRates)
  ) {
    throw new Error('Dry PCM matrix sampleRates do not match result receipts');
  }
  const expectedComparisons = buildDryPcmInstrumentComparisons(profiles, report.results);
  if (!Array.isArray(report.comparisons) || stableHash(report.comparisons) !== stableHash(expectedComparisons)) {
    throw new Error('Dry PCM matrix cross-case comparisons do not match case metrics/hashes');
  }
  const resultsById = new Map(report.results.map(result => [result.caseId, result]));
  for (const profile of profiles) {
    const comparison = expectedComparisons.find(candidate => candidate.instrumentId === profile.id)!;
    const expectedMissing = profile.variationPolicy === 'alternate-seed-must-differ'
      && !comparison.repeat.alternateSeedDiffers;
    const seedB = resultFor(resultsById, `${profile.id}/repeat-seed-b/16-hits`);
    const actualMissing = seedB.fatalFindings.some(
      finding => finding.code === 'ALTERNATE_SEED_VARIATION_MISSING',
    );
    const misplaced = report.results.some(result =>
      result.caseId !== seedB.caseId
      && result.instrumentId === profile.id
      && result.fatalFindings.some(finding => finding.code === 'ALTERNATE_SEED_VARIATION_MISSING')
    );
    if (actualMissing !== expectedMissing || misplaced) {
      throw new Error(`${profile.id}: alternate-seed variation finding does not match A/B PCM hashes`);
    }
  }
}
