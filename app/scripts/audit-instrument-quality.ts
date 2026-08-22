#!/usr/bin/env node
/**
 * Cross-engine, all-catalogue instrument quality audit.
 *
 * This joins three kinds of evidence without pretending they are equivalent:
 * static catalogue/calibration coverage, decoded source-file analysis for
 * sampled instruments, and a real Chromium sequencer receipt for every live
 * instrument. It emits a deterministic improvement-priority ranking plus the
 * evidence confidence needed to interpret it honestly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { INSTRUMENT_GROUPS } from '../src/shared/instrument-catalog';
import { getSourceCalibration } from '../src/audio/source-calibration';
import {
  REVIEW_ISSUE_WEIGHTS,
  formatIssueActions,
  scoreInstrument,
  type AuditIssue,
  type InstrumentScore,
} from './instrument-quality-rubric';
import {
  INSTRUMENT_QUALITY_PROFILE_BY_ID,
  assertInstrumentQualityProfileCoverage,
  type InstrumentQualityProfile,
} from './instrument-quality-profiles';
import {
  isFullCommitId,
  validateDryPcmMatrixReport,
  type BrowserIdentity,
  type DryPcmInstrumentComparison,
  type DryPcmMatrixReport,
} from './instrument-quality-matrix';
import {
  isLiveRoutingSilent,
  validateLiveQualityReport,
  type LiveInstrumentResult,
  type LiveQualityReport,
} from './instrument-quality-live-receipt';
import { sampleQualityEvaluatorBundleSha256 } from './sample-quality-baseline-core';
import {
  INSTRUMENT_QUALITY_APP_ROOT,
  instrumentQualityEvaluatorDiffersFromCommit,
  instrumentQualityEvaluatorTreeSha256,
  instrumentQualityHeadCommit,
  instrumentQualitySha256File,
  instrumentQualitySubjectTreeStatus,
  resolveInstrumentQualityCommit,
} from './instrument-quality-provenance';

const APP_DIR = INSTRUMENT_QUALITY_APP_ROOT;
const DEFAULT_SAMPLE_REPORT = path.resolve(APP_DIR, 'test-results/sample-quality/metrics.json');
const DEFAULT_LIVE_REPORT = path.resolve(APP_DIR, 'reports/instrument-quality/live-master-output.json');
const DEFAULT_JSON_REPORT = path.resolve(APP_DIR, 'reports/instrument-quality/report.json');
const DEFAULT_MARKDOWN_REPORT = path.resolve(APP_DIR, 'reports/instrument-quality/INSTRUMENT-QUALITY.md');
const DEFAULT_MATRIX_REPORT = path.resolve(APP_DIR, 'reports/instrument-quality/dry-pcm-matrix.json');
const DEFAULT_MATRIX_PCM_ROOT = path.resolve(APP_DIR, 'reports/instrument-quality/dry-pcm-matrix-pcm');
const MANIFEST_ROOT = path.resolve(APP_DIR, 'public/instruments');

type InstrumentType = 'sample' | 'sampled' | 'synth' | 'tone' | 'advanced';
type EvidenceGrade = 'A' | 'B' | 'C' | 'F';

interface CliOptions {
  sampleReport: string;
  liveReport: string;
  jsonReport: string;
  markdownReport: string;
  matrixReport: string;
  matrixPcmRoot: string;
  requireEvidence: boolean;
  requireMatrix: boolean;
  evaluatorCommit: string | null;
  subjectCommit: string | null;
}

interface QualityIssue extends AuditIssue {
  instrumentId: string;
  file?: string;
  message?: string;
}

interface SampleInstrumentSummary {
  id: string;
  sampleCount: number;
  fileCount: number;
}

interface SampleQualityReport {
  version: 1;
  generatedAt: string;
  subjectCommit: string;
  subjectTreeClean: true;
  evaluatorBundleSha256: string;
  baselineSha256: string;
  totals: {
    instruments: number;
    samples: number;
    files: number;
    errors: number;
    reviewFlags: number;
    waivedIssues: number;
  };
  issues: QualityIssue[];
  waivedIssues: Array<{ issue: QualityIssue }>;
  instruments: SampleInstrumentSummary[];
  samples: Array<{
    instrumentId: string;
    file: string;
    note: number;
    velocityMin?: number;
    velocityMax?: number;
    sampleRate?: number;
  }>;
}

interface ManifestSample {
  note: number;
  file: string;
  velocityMin?: number;
  velocityMax?: number;
  roundRobinGroup?: string;
  roundRobinIndex?: number;
}

interface InstrumentManifest {
  id: string;
  samples: ManifestSample[];
  playableRange?: { min: number; max: number };
  playbackNote?: number;
  unpitched?: boolean;
}

interface ManifestCoverage {
  fileCount: number;
  rootCount: number;
  maxRootDistanceSemitones: number | null;
  medianVelocityLayers: number;
  medianRoundRobins: number;
}

interface RankedInstrument {
  rank: number;
  id: string;
  name: string;
  category: string;
  type: InstrumentType;
  score: number;
  band: InstrumentScore['band'];
  evidenceGrade: EvidenceGrade;
  evidence: string;
  live: {
    measured: boolean;
    silent: boolean;
    peakDbfs: number | null;
    rmsDbfs: number | null;
    categoryRmsDeltaDb: number | null;
  };
  sampled: {
    fileCount: number;
    rootCount: number;
    maxRootDistanceSemitones: number | null;
    medianVelocityLayers: number | null;
    medianRoundRobins: number | null;
    issueCount: number;
    issueCodes: Record<string, number>;
  } | null;
  scoreComponents: InstrumentScore['components'];
  improvements: string[];
  profile: InstrumentQualityProfile;
  dryPcmMatrix: {
    measured: boolean;
    cases: number;
    fatalFindings: number;
    fatalCodes: Record<string, number>;
    evidenceGaps: number;
    evidenceGapCodes: Record<string, number>;
    comparisons: DryPcmInstrumentComparison | null;
  };
}

interface AuditProvenance {
  evaluatorCommit: string;
  subjectCommit: string;
  evaluatorTreeSha256: string;
  evaluatorDirty: boolean;
  runtime: {
    node: string;
    platform: string;
    arch: string;
  };
  browser: BrowserIdentity | null;
  sampleRates: number[];
}

const VELOCITY_LAYER_TARGETS: Readonly<Record<string, number>> = Object.freeze({
  'acoustic-kick': 3,
  'acoustic-snare': 3,
  'acoustic-hihat-closed': 3,
  'acoustic-hihat-open': 3,
  'acoustic-ride': 3,
  'acoustic-crash': 3,
  'brushes-snare': 3,
  piano: 2,
  vibraphone: 2,
  marimba: 2,
  kalimba: 2,
  'steel-drums': 2,
  'acoustic-guitar': 2,
  'clean-guitar': 2,
  'finger-bass': 2,
  'slap-bass': 2,
  'alto-sax': 2,
  'french-horn': 2,
  'string-section': 2,
});

const ROUND_ROBIN_TARGETS: Readonly<Record<string, number>> = Object.freeze({
  'acoustic-kick': 2,
  'acoustic-snare': 2,
  'acoustic-hihat-closed': 2,
  'acoustic-hihat-open': 2,
  'acoustic-ride': 2,
  'acoustic-crash': 2,
  'finger-bass': 2,
  'steel-drums': 2,
});

const ISSUE_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  HOT_PEAK: 'restore decoded headroom from the lossless source or lower the bound delivery trim',
  CLIPPING_SAMPLES: 'replace or repair clipped source audio',
  FLAT_TOP_CLIPPING: 'replace the flat-topped source recording',
  DC_OFFSET: 'remove DC non-destructively or replace the affected takes',
  LEADING_SILENCE: 'review attacks, then apply safe per-file onset offsets or cleaner takes',
  TAIL_TRUNCATION: 'capture a natural tail or author a click-free fade/loop',
  PITCH_DEVIATION: 'verify by ear, then correct the root map/tuning or replace the take',
  LOOP_SEAM_UNCHECKED: 'make the loop seam measurable and review it in a held-note render',
  LOOP_VALUE_DISCONTINUITY: 'move or crossfade loop points to match the signal value at the boundary',
  LOOP_DERIVATIVE_DISCONTINUITY: 'move or crossfade loop points to match the signal slope at the boundary',
  NEGATIVE_PHASE_CORRELATION: 'correct stereo polarity/phase or use a more mono-compatible source',
  MONO_LOSS: 'repair stereo phase so mono fold-down does not lose material',
  VELOCITY_RMS_INVERSION: 'recalibrate velocity layers so harder strikes do not get quieter',
  NOTE_LEVEL_STEP: 'smooth adjacent-root gain calibration',
  RANGE_OVEREXTENSION: 'add outer roots or narrow the declared playable range',
  TONAL_LOUDNESS_MISMATCH: 'recalibrate canonical delivered loudness',
});

const MATRIX_GATE_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  TRUE_PEAK_OVER_0_DBTP: 'lower dry post-track gain until every matrix render stays at or below 0 dBTP',
  FLAT_TOP_CLIPPING: 'remove the clipping stage or lower the voice before the clipped stage',
  DC_OFFSET: 'remove delivered-path DC without altering the intended envelope',
  SILENT_DECLARED_NOTE: 'repair preparation, routing, or playable-range handling for the silent matrix case',
  PITCH_ERROR: 'correct oscillator/sample tuning at the failing matrix notes',
  MONO_LOSS: 'repair delivered stereo phase so the centered mono fold remains usable',
  RELEASE_RESIDUAL: 'for this declared lifecycle voice, stop or release below -40 dBFS in the pinned window beginning two seconds after note-off',
  ALTERNATE_SEED_VARIATION_MISSING: 'restore the declared seed-controlled variation mechanism; seeds A and B rendered identical PCM',
});

const MATRIX_EVIDENCE_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  PITCH_INCONCLUSIVE: 'collect reference/listening or alternate multi-harmonic pitch evidence; the monophonic estimate was inconclusive and no sound-quality penalty was assigned',
});

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    sampleReport: DEFAULT_SAMPLE_REPORT,
    liveReport: DEFAULT_LIVE_REPORT,
    jsonReport: DEFAULT_JSON_REPORT,
    markdownReport: DEFAULT_MARKDOWN_REPORT,
    matrixReport: DEFAULT_MATRIX_REPORT,
    matrixPcmRoot: DEFAULT_MATRIX_PCM_ROOT,
    requireEvidence: false,
    requireMatrix: false,
    evaluatorCommit: null,
    subjectCommit: null,
  };
  const rawValue = (argument: string, index: number): string => {
    const candidate = argv[index + 1];
    if (!candidate || candidate.startsWith('--')) throw new Error(`${argument} requires a value`);
    return candidate;
  };
  const pathname = (argument: string, index: number): string =>
    path.resolve(process.cwd(), rawValue(argument, index));

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--sample-report') {
      options.sampleReport = pathname(argument, index++);
    } else if (argument === '--live-report') {
      options.liveReport = pathname(argument, index++);
    } else if (argument === '--json') {
      options.jsonReport = pathname(argument, index++);
    } else if (argument === '--markdown') {
      options.markdownReport = pathname(argument, index++);
    } else if (argument === '--matrix-report') {
      options.matrixReport = pathname(argument, index++);
    } else if (argument === '--matrix-pcm-root') {
      options.matrixPcmRoot = pathname(argument, index++);
    } else if (argument === '--require-evidence') {
      options.requireEvidence = true;
    } else if (argument === '--require-matrix') {
      options.requireMatrix = true;
    } else if (argument === '--evaluator-commit') {
      options.evaluatorCommit = rawValue(argument, index++);
    } else if (argument === '--subject-commit') {
      options.subjectCommit = rawValue(argument, index++);
    } else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node --import tsx scripts/audit-instrument-quality.ts [options]');
      console.log('  --sample-report <path>  Decoded sample-quality JSON');
      console.log('  --live-report <path>    99-instrument Chromium output JSON');
      console.log('  --json <path>           Output machine-readable ranking');
      console.log('  --markdown <path>       Output human-readable ranking');
      console.log('  --matrix-report <path>  Dry post-track PCM matrix JSON');
      console.log('  --matrix-pcm-root <dir> Content-addressed planar Float32LE matrix sidecars');
      console.log('  --require-evidence      Fail if either dynamic receipt is absent');
      console.log('  --require-matrix        Fail unless the complete pinned PCM matrix is present');
      console.log('  --evaluator-commit <id> Pinned evaluator commit (defaults to HEAD)');
      console.log('  --subject-commit <id>   Candidate commit under evaluation (defaults to HEAD)');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function readJson<T>(pathname: string): T | null {
  if (!fs.existsSync(pathname)) return null;
  return JSON.parse(fs.readFileSync(pathname, 'utf8')) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sampleMappingKey(
  instrumentId: string,
  sample: Pick<ManifestSample, 'file' | 'note' | 'velocityMin' | 'velocityMax'>,
): string {
  return JSON.stringify([
    instrumentId,
    sample.file,
    sample.note,
    sample.velocityMin ?? null,
    sample.velocityMax ?? null,
  ]);
}

function validateFullSampleQualityReport(
  value: unknown,
  expectedSubjectCommit: string,
): SampleQualityReport {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.totals)) {
    throw new Error('Sample-quality evidence has an unsupported schema');
  }
  if (
    typeof value.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.generatedAt))
    || new Date(value.generatedAt).toISOString() !== value.generatedAt
  ) {
    throw new Error('Sample-quality evidence generatedAt is not canonical ISO-8601');
  }
  if (!isFullCommitId(expectedSubjectCommit) || value.subjectCommit !== expectedSubjectCommit) {
    throw new Error('Sample-quality evidence subject commit does not match the selected full commit');
  }
  if (value.subjectTreeClean !== true) {
    throw new Error('Sample-quality evidence was captured from a dirty subject tree');
  }
  const expectedBaselineSha256 = instrumentQualitySha256File(
    path.resolve(APP_DIR, 'scripts/sample-quality-baseline.json'),
  );
  if (
    value.evaluatorBundleSha256 !== sampleQualityEvaluatorBundleSha256(APP_DIR)
    || value.baselineSha256 !== expectedBaselineSha256
  ) {
    throw new Error('Sample-quality evidence evaluator or canonical baseline identity differs');
  }
  if (
    !Array.isArray(value.instruments)
    || !Array.isArray(value.samples)
    || !Array.isArray(value.issues)
    || !Array.isArray(value.waivedIssues)
  ) {
    throw new Error('Sample-quality evidence arrays are missing');
  }

  const catalogueGroups = Object.values(INSTRUMENT_GROUPS) as ReadonlyArray<{
    instruments: ReadonlyArray<{ id: string; type: string }>;
  }>;
  const sampledCatalogueIds = catalogueGroups
    .flatMap(group => group.instruments)
    .filter(instrument => instrument.type === 'sampled')
    .map(instrument => instrument.id.slice('sampled:'.length))
    .sort();
  const manifestIds = fs.readdirSync(MANIFEST_ROOT)
    .filter(id => fs.existsSync(path.join(MANIFEST_ROOT, id, 'manifest.json')))
    .sort();
  if (JSON.stringify(manifestIds) !== JSON.stringify(sampledCatalogueIds)) {
    throw new Error(
      `Sample-quality manifest/catalogue coverage differs: manifests=${manifestIds.length}, catalogue=${sampledCatalogueIds.length}`,
    );
  }
  const manifests = sampledCatalogueIds.map(id => {
    const manifest = manifestFor(id);
    if (!manifest || manifest.id !== id || !Array.isArray(manifest.samples)) {
      throw new Error(`Sample-quality expected manifest is invalid: ${id}`);
    }
    return manifest;
  });
  const expectedMappingCounts = new Map<string, number>();
  const expectedFiles = new Set<string>();
  const expectedById = new Map<string, { sampleCount: number; fileCount: number }>();
  for (const manifest of manifests) {
    const files = new Set<string>();
    for (const sample of manifest.samples) {
      const key = sampleMappingKey(manifest.id, sample);
      expectedMappingCounts.set(key, (expectedMappingCounts.get(key) ?? 0) + 1);
      files.add(sample.file);
      expectedFiles.add(`${manifest.id}/${sample.file}`);
    }
    expectedById.set(manifest.id, { sampleCount: manifest.samples.length, fileCount: files.size });
  }

  const summaries = value.instruments as unknown[];
  const summaryIds = new Set<string>();
  for (const summary of summaries) {
    if (
      !isRecord(summary)
      || typeof summary.id !== 'string'
      || !Number.isInteger(summary.sampleCount)
      || !Number.isInteger(summary.fileCount)
      || summaryIds.has(summary.id)
    ) {
      throw new Error('Sample-quality evidence contains a malformed or duplicate instrument summary');
    }
    const expected = expectedById.get(summary.id);
    if (!expected || summary.sampleCount !== expected.sampleCount || summary.fileCount !== expected.fileCount) {
      throw new Error(`Sample-quality evidence coverage differs for ${summary.id}`);
    }
    summaryIds.add(summary.id);
  }
  const missingSummaries = sampledCatalogueIds.filter(id => !summaryIds.has(id));
  if (missingSummaries.length > 0 || summaries.length !== sampledCatalogueIds.length) {
    throw new Error(
      `Sample-quality evidence is filtered/incomplete; missing instrument summaries: ${missingSummaries.join(', ') || 'none'}`,
    );
  }

  const actualMappingCounts = new Map<string, number>();
  for (const sample of value.samples as unknown[]) {
    if (
      !isRecord(sample)
      || typeof sample.instrumentId !== 'string'
      || typeof sample.file !== 'string'
      || !Number.isInteger(sample.note)
      || (sample.velocityMin !== undefined && !Number.isInteger(sample.velocityMin))
      || (sample.velocityMax !== undefined && !Number.isInteger(sample.velocityMax))
    ) {
      throw new Error('Sample-quality evidence contains a malformed decoded mapping');
    }
    const key = sampleMappingKey(sample.instrumentId, {
      file: sample.file,
      note: sample.note as number,
      velocityMin: sample.velocityMin as number | undefined,
      velocityMax: sample.velocityMax as number | undefined,
    });
    actualMappingCounts.set(key, (actualMappingCounts.get(key) ?? 0) + 1);
  }
  const missingMappings = [...expectedMappingCounts].filter(([key, count]) => actualMappingCounts.get(key) !== count);
  const unexpectedMappings = [...actualMappingCounts].filter(([key, count]) => expectedMappingCounts.get(key) !== count);
  if (missingMappings.length > 0 || unexpectedMappings.length > 0) {
    throw new Error(
      `Sample-quality decoded mapping coverage differs: missing=${missingMappings.length}, unexpected=${unexpectedMappings.length}`,
    );
  }

  const expectedSampleCount = manifests.reduce((total, manifest) => total + manifest.samples.length, 0);
  const totals = value.totals;
  const validIssue = (issue: unknown): issue is QualityIssue => isRecord(issue)
    && ['error', 'review'].includes(String(issue.severity))
    && typeof issue.code === 'string'
    && issue.code.length > 0
    && typeof issue.instrumentId === 'string'
    && issue.instrumentId.length > 0
    && (issue.file === undefined || typeof issue.file === 'string');
  const issues = value.issues as unknown[];
  if (issues.some(issue => !validIssue(issue))) {
    throw new Error('Sample-quality evidence contains a malformed issue');
  }
  if (value.waivedIssues.some(entry => !isRecord(entry) || !validIssue(entry.issue))) {
    throw new Error('Sample-quality evidence contains a malformed waived issue');
  }
  const errorCount = issues.filter(issue => (issue as Record<string, unknown>).severity === 'error').length;
  const reviewCount = issues.filter(issue => (issue as Record<string, unknown>).severity === 'review').length;
  if (
    totals.instruments !== sampledCatalogueIds.length
    || totals.samples !== expectedSampleCount
    || totals.files !== expectedFiles.size
    || totals.errors !== errorCount
    || totals.reviewFlags !== reviewCount
    || totals.waivedIssues !== value.waivedIssues.length
    || value.samples.length !== expectedSampleCount
  ) {
    throw new Error('Sample-quality evidence totals do not match full manifest coverage');
  }
  return value as unknown as SampleQualityReport;
}

function countCodes(codes: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const code of codes) counts[code] = (counts[code] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function db(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

function finiteRound(value: number | null, digits = 1): number | null {
  return value !== null && Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function manifestFor(instrumentId: string): InstrumentManifest | null {
  const pathname = path.join(MANIFEST_ROOT, instrumentId, 'manifest.json');
  return readJson<InstrumentManifest>(pathname);
}

function manifestCoverage(manifest: InstrumentManifest): ManifestCoverage {
  const roots = [...new Set(manifest.samples.map(sample => sample.note))].sort((left, right) => left - right);
  const files = new Set(manifest.samples.map(sample => sample.file));
  const velocityLayersByRoot = new Map<number, Set<string>>();
  const takesByLayer = new Map<string, number>();
  for (const sample of manifest.samples) {
    const layer = `${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}`;
    const layers = velocityLayersByRoot.get(sample.note) ?? new Set<string>();
    layers.add(layer);
    velocityLayersByRoot.set(sample.note, layers);
    const layerKey = `${sample.note}:${layer}`;
    takesByLayer.set(layerKey, (takesByLayer.get(layerKey) ?? 0) + 1);
  }

  let maxRootDistanceSemitones: number | null = null;
  if (
    manifest.playbackNote === undefined
    && manifest.unpitched !== true
    && roots.length > 0
    && manifest.playableRange
  ) {
    maxRootDistanceSemitones = 0;
    for (let note = manifest.playableRange.min; note <= manifest.playableRange.max; note++) {
      const distance = Math.min(...roots.map(root => Math.abs(root - note)));
      maxRootDistanceSemitones = Math.max(maxRootDistanceSemitones, distance);
    }
  }

  return {
    fileCount: files.size,
    rootCount: roots.length,
    maxRootDistanceSemitones,
    medianVelocityLayers: median([...velocityLayersByRoot.values()].map(layers => layers.size)),
    medianRoundRobins: median([...takesByLayer.values()]),
  };
}

function issueCounts(issues: readonly QualityIssue[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const issue of issues) result[issue.code] = (result[issue.code] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(result).sort((left, right) =>
      (REVIEW_ISSUE_WEIGHTS[right[0]] ?? 2) * right[1]
      - (REVIEW_ISSUE_WEIGHTS[left[0]] ?? 2) * left[1]
      || left[0].localeCompare(right[0])
    ),
  );
}

function evidenceGrade(
  type: InstrumentType,
  live: LiveInstrumentResult | null,
  sampledInstrumentDecoded: boolean,
  liveSilent: boolean,
  matrixMeasured: boolean,
): EvidenceGrade {
  if (liveSilent) return 'F';
  if (live && matrixMeasured && (type !== 'sampled' || sampledInstrumentDecoded)) return 'A';
  if (type === 'sampled' && live && sampledInstrumentDecoded) return 'A';
  if (live) return 'B';
  return 'C';
}

function improvementsFor(
  type: InstrumentType,
  score: InstrumentScore,
  peakDbfs: number | null,
  rmsDeltaDb: number | null,
  issueCodeCounts: Readonly<Record<string, number>>,
  coverage: ManifestCoverage | null,
  targetVelocityLayers: number,
  targetRoundRobins: number,
  grade: EvidenceGrade,
  matrixGateCounts: Readonly<Record<string, number>>,
  matrixEvidenceGapCounts: Readonly<Record<string, number>>,
  matrixComparison: DryPcmInstrumentComparison | null,
): string[] {
  const improvements: string[] = [];
  if (score.components.some(component => component.id === 'live-silence')) {
    improvements.push('repair live preparation/routing before judging timbre');
  }
  if (score.components.some(component => component.id === 'missing-calibration')) {
    improvements.push('add an explicit source-calibration entry');
  }
  if (peakDbfs !== null && peakDbfs > 0) {
    improvements.push(`lower the bound post-track output by at least ${Math.ceil(peakDbfs)} dB, then repeat the mix-capacity capture`);
  }
  if (rmsDeltaDb !== null && Math.abs(rmsDeltaDb) > 18) {
    improvements.push('review role-relative level calibration in an isolated, level-matched capture');
  }
  improvements.push(...formatIssueActions(issueCodeCounts, ISSUE_ACTIONS));
  improvements.push(...formatIssueActions(matrixGateCounts, MATRIX_GATE_ACTIONS));
  improvements.push(...formatIssueActions(matrixEvidenceGapCounts, MATRIX_EVIDENCE_ACTIONS));
  if (
    matrixComparison?.repeat.policy === 'alternate-seed-must-differ'
    && !matrixComparison.repeat.alternateSeedDiffers
    && (matrixGateCounts.ALTERNATE_SEED_VARIATION_MISSING ?? 0) === 0
  ) {
    improvements.push('restore the declared seed-controlled variation mechanism; seed A and B rendered identical PCM');
  }
  if (coverage && coverage.maxRootDistanceSemitones !== null && coverage.maxRootDistanceSemitones > 4) {
    improvements.push(`add roots or narrow the range so repitching stays within 4 semitones (now ${coverage.maxRootDistanceSemitones})`);
  }
  if (coverage && coverage.medianVelocityLayers < targetVelocityLayers) {
    improvements.push(`record/map genuine dynamics to reach ${targetVelocityLayers} velocity layers (median now ${coverage.medianVelocityLayers})`);
  }
  if (coverage && coverage.medianRoundRobins < targetRoundRobins) {
    improvements.push(`add alternate takes to reach ${targetRoundRobins} round robins per mapped layer (median now ${coverage.medianRoundRobins})`);
  }

  if (improvements.length === 0) {
    improvements.push('no automated technical repair identified; require level-matched blind listening before changing the timbre');
  }
  if (grade === 'B' && (type === 'tone' || type === 'advanced')) {
    improvements.push('add isolated browser PCM baselines across pitch and velocity; current evidence is one canonical live note');
  } else if (grade === 'B') {
    improvements.push('extend the per-instrument PCM baseline beyond the canonical live note');
  } else if (grade === 'C') {
    improvements.push('run the Chromium all-instrument receipt before making a quality claim');
  }
  return improvements;
}

function markdownEscape(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function relativePath(pathname: string): string {
  return path.relative(APP_DIR, pathname) || '.';
}

function renderMarkdown(
  provenance: AuditProvenance,
  generatedAt: string,
  instruments: readonly RankedInstrument[],
  sampleReport: SampleQualityReport | null,
  liveReport: LiveQualityReport | null,
  matrixReport: DryPcmMatrixReport | null,
  options: CliOptions,
): string {
  const byBand = Object.fromEntries(
    ['critical', 'high', 'medium', 'low', 'baseline'].map(band => [
      band,
      instruments.filter(instrument => instrument.band === band).length,
    ]),
  );
  const liveAudible = instruments.filter(instrument => instrument.live.measured && !instrument.live.silent).length;
  const aboveZero = instruments.filter(instrument => (instrument.live.peakDbfs ?? -Infinity) > 0).length;
  const lines: string[] = [
    '# Instrument audio-quality audit',
    '',
    `Generated for subject \`${provenance.subjectCommit}\` with evaluator \`${provenance.evaluatorCommit}\` at ${generatedAt}.`,
    '',
    `Evaluator tree SHA-256: \`${provenance.evaluatorTreeSha256}\`${provenance.evaluatorDirty ? ' (working tree differs from evaluator commit)' : ''}.`,
    '',
    '> This is a technical improvement-priority ranking, not a claim about musical taste. A score of 0 means “no defect detected by these lanes,” not “perfect sound.” Hash-bound waivers remain measured debt; they are not erased merely because CI accepts them.',
    '',
    '## Outcome',
    '',
    `- Catalogue: **${instruments.length} instruments**; live audible: **${liveAudible}/${instruments.length}**.`,
    `- Priority bands: **${byBand.critical} critical**, **${byBand.high} high**, **${byBand.medium} medium**, **${byBand.low} low**, **${byBand.baseline} baseline**.`,
    `- Canonical per-track peaks above 0 dBFS: **${aboveZero}** (the Web Audio graph floats internally, but this is still post-track headroom debt).`,
    sampleReport
      ? `- Decoded sample lane: **${sampleReport.totals.files} files / ${sampleReport.totals.waivedIssues} hash-bound review findings / ${sampleReport.totals.errors} unwaived errors / ${sampleReport.totals.reviewFlags} unwaived review flags**.`
      : `- Decoded sample lane: **not run** (expected \`${relativePath(options.sampleReport)}\`).`,
    liveReport
      ? `- Browser lane: **run**, with ${liveReport.diagnostics.pageErrors.length} page errors and ${liveReport.diagnostics.consoleErrors.length} console/readiness errors.`
      : `- Browser lane: **not run** (expected \`${relativePath(options.liveReport)}\`).`,
    matrixReport
      ? `- Dry PCM matrix: **${matrixReport.capturedCaseCount}/${matrixReport.expectedCaseCount} cases**, ${matrixReport.results.reduce((total, result) => total + result.fatalFindings.length, 0)} fatal findings and ${matrixReport.results.reduce((total, result) => total + result.evidenceGaps.length, 0)} non-scoring evidence gaps; metrics and hashes were recomputed from content-addressed planar Float32LE sidecars.`
      : `- Dry PCM matrix: **not run** (expected \`${relativePath(options.matrixReport)}\` plus sidecars under \`${relativePath(options.matrixPcmRoot)}\`; use \`--require-matrix\` for fail-closed CI).`,
    `- Runtime: **${provenance.runtime.node} / ${provenance.runtime.platform}-${provenance.runtime.arch}**; sample rates: **${provenance.sampleRates.join(', ') || 'not reported'}**; browser: **${provenance.browser ? `${provenance.browser.name} ${provenance.browser.version}` : 'not reported'}**.`,
    '',
    '## Stack-ranked instruments (worst first)',
    '',
    '| Rank | Instrument | Engine / category | Priority | Evidence | Measured reasons | What would improve it |',
    '|---:|---|---|---:|:---:|---|---|',
  ];

  for (const instrument of instruments) {
    const reasons = instrument.scoreComponents.length > 0
      ? instrument.scoreComponents.map(component => `${component.id} ${component.points}`).join('; ')
      : 'no measured deficit';
    lines.push(
      `| ${instrument.rank} | \`${instrument.id}\` (${markdownEscape(instrument.name)}) | ${instrument.type} / ${instrument.category} | **${instrument.score.toFixed(1)}** ${instrument.band} | ${instrument.evidenceGrade} | ${markdownEscape(`${instrument.evidence}; ${reasons}`)} | ${markdownEscape(instrument.improvements.join('; '))} |`,
    );
  }

  lines.push(
    '',
    '## Evidence grades',
    '',
    '- **A** — strongest applicable evidence: decoded shipped sources for sampled instruments and/or a complete dry PCM matrix, plus a real Chromium sequencer note.',
    '- **B** — real Chromium sequencer note plus static engine/configuration coverage; no complete isolated PCM sweep.',
    '- **C** — static evidence only because the live receipt was absent.',
    '- **F** — a fatal live-silence gate failed.',
    '',
    'Scores are sorted descending. Ties are resolved by weaker evidence first, then instrument ID, so the table is stable. Evidence grade does not add quality points.',
    '',
    '## Reproduce',
    '',
    '```sh',
    'cd app',
    matrixReport ? 'npm run audit:instrument-quality:full' : 'npm run audit:instrument-quality:v1',
    '```',
    '',
    'The exact weights, caps, role targets, and claim boundary are documented in `../docs/INSTRUMENT-AUDIO-QUALITY-RUBRIC.md`.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const rawSampleReport = readJson<unknown>(options.sampleReport);
  const rawLiveReport = readJson<unknown>(options.liveReport);
  const matrixReport = readJson<DryPcmMatrixReport>(options.matrixReport);
  const receiptSubjectCommit = rawLiveReport !== null
    && typeof rawLiveReport === 'object'
    && 'subjectCommit' in rawLiveReport
    && typeof rawLiveReport.subjectCommit === 'string'
    ? rawLiveReport.subjectCommit
    : null;
  const sampleReceiptSubjectCommit = rawSampleReport !== null
    && typeof rawSampleReport === 'object'
    && 'subjectCommit' in rawSampleReport
    && typeof rawSampleReport.subjectCommit === 'string'
    ? rawSampleReport.subjectCommit
    : null;
  const headCommit = instrumentQualityHeadCommit();
  const evaluatorCommit = resolveInstrumentQualityCommit(
    options.evaluatorCommit
      ?? process.env.KEYBOARDIA_EVALUATOR_COMMIT
      ?? matrixReport?.provenance?.evaluatorCommit
      ?? headCommit,
    'Evaluator commit',
  );
  const subjectCommit = resolveInstrumentQualityCommit(
    options.subjectCommit
      ?? process.env.KEYBOARDIA_SUBJECT_COMMIT
      ?? matrixReport?.provenance?.subjectCommit
      ?? receiptSubjectCommit
      ?? sampleReceiptSubjectCommit
      ?? headCommit,
    'Subject commit',
  );
  const sampleReport = rawSampleReport === null
    ? null
    : validateFullSampleQualityReport(rawSampleReport, subjectCommit);
  const liveReport = rawLiveReport === null
    ? null
    : validateLiveQualityReport(rawLiveReport, subjectCommit);
  if (sampleReport || liveReport) {
    const treeStatus = instrumentQualitySubjectTreeStatus();
    if (headCommit !== subjectCommit || treeStatus.length > 0) {
      throw new Error(
        `Dynamic audio evidence requires the selected subject commit in a clean tree; `
        + `HEAD=${headCommit}, subject=${subjectCommit}${treeStatus ? `, changes:\n${treeStatus}` : ''}`,
      );
    }
  }
  const currentEvaluatorTreeSha256 = instrumentQualityEvaluatorTreeSha256();
  const evaluatorDirty = instrumentQualityEvaluatorDiffersFromCommit(evaluatorCommit);
  if (options.requireEvidence && (!sampleReport || !liveReport)) {
    throw new Error(
      `Required evidence missing: sample=${sampleReport ? 'present' : options.sampleReport}, live=${liveReport ? 'present' : options.liveReport}`,
    );
  }
  if (options.requireMatrix && !matrixReport) {
    throw new Error(`Required dry PCM matrix evidence missing: ${options.matrixReport}`);
  }
  if (matrixReport) {
    validateDryPcmMatrixReport(matrixReport, undefined, {
      pcmArtifactRoot: options.matrixPcmRoot,
      expectedBinding: {
        evaluatorCommit,
        subjectCommit,
        evaluatorTreeSha256: currentEvaluatorTreeSha256,
        evaluatorDirty,
      },
      requirePass: options.requireMatrix,
    });
  }

  const catalogue = Object.entries(INSTRUMENT_GROUPS).flatMap(([category, group]) =>
    group.instruments.map(instrument => ({
      category,
      id: instrument.id,
      name: instrument.name,
      type: instrument.type as InstrumentType,
    })),
  );
  assertInstrumentQualityProfileCoverage(catalogue.map(item => item.id));
  const matrixResultsByInstrument = new Map<string, DryPcmMatrixReport['results']>();
  for (const result of matrixReport?.results ?? []) {
    const existing = matrixResultsByInstrument.get(result.instrumentId) ?? [];
    existing.push(result);
    matrixResultsByInstrument.set(result.instrumentId, existing);
  }
  const matrixComparisonsByInstrument = new Map(
    (matrixReport?.comparisons ?? []).map(comparison => [comparison.instrumentId, comparison]),
  );
  const categoryRmsMedians = new Map<string, number>();
  for (const category of Object.keys(INSTRUMENT_GROUPS)) {
    const categoryIds = new Set<string>(catalogue.filter(item => item.category === category).map(item => item.id));
    const values = (liveReport?.instruments ?? [])
      .filter(result => categoryIds.has(result.sampleId)
        && result.rms > 0
        && liveReport !== null
        && !isLiveRoutingSilent(
          result,
          liveReport.silencePeakThreshold,
          liveReport.silenceRmsThreshold,
        ))
      .map(result => db(result.rms));
    if (values.length > 0) categoryRmsMedians.set(category, median(values));
  }

  const liveById = new Map((liveReport?.instruments ?? []).map(result => [result.sampleId, result]));
  const sampleSummaryById = new Map((sampleReport?.instruments ?? []).map(summary => [summary.id, summary]));
  const allSampleIssues = [
    ...(sampleReport?.issues ?? []),
    ...(sampleReport?.waivedIssues.map(entry => entry.issue) ?? []),
  ];

  const unranked: Array<Omit<RankedInstrument, 'rank'>> = catalogue.map(item => {
    const profile = INSTRUMENT_QUALITY_PROFILE_BY_ID.get(item.id);
    if (!profile) throw new Error(`Missing instrument quality profile for ${item.id}`);
    const presetId = item.type === 'sampled' ? item.id.slice('sampled:'.length) : item.id;
    const manifest = item.type === 'sampled' ? manifestFor(presetId) : null;
    const coverage = manifest ? manifestCoverage(manifest) : null;
    const sampleIssues = allSampleIssues.filter(issue => issue.instrumentId === presetId);
    const unwaivedSampleIssueCount = (sampleReport?.issues ?? [])
      .filter(issue => issue.instrumentId === presetId).length;
    const dispositionAcceptedSampleIssueCount = (sampleReport?.waivedIssues ?? [])
      .filter(entry => entry.issue.instrumentId === presetId).length;
    const sampleSummary = sampleSummaryById.get(presetId);
    const live = liveById.get(item.id) ?? null;
    const liveSilent = live !== null && liveReport !== null
      ? isLiveRoutingSilent(
        live,
        liveReport.silencePeakThreshold,
        liveReport.silenceRmsThreshold,
      )
      : false;
    const peakDbfs = live ? db(live.peak) : null;
    const rmsDbfs = live ? db(live.rms) : null;
    const categoryMedian = categoryRmsMedians.get(item.category);
    const rmsDeltaDb = rmsDbfs !== null && Number.isFinite(rmsDbfs) && categoryMedian !== undefined
      ? rmsDbfs - categoryMedian
      : null;
    const targetVelocityLayers = VELOCITY_LAYER_TARGETS[presetId] ?? 0;
    const targetRoundRobins = ROUND_ROBIN_TARGETS[presetId] ?? 0;
    const matrixResults = matrixResultsByInstrument.get(item.id) ?? [];
    const matrixFatalCodes = countCodes(
      matrixResults.flatMap(result => result.fatalFindings.map(finding => finding.code)),
    );
    const matrixFatalCount = Object.values(matrixFatalCodes).reduce((total, count) => total + count, 0);
    const matrixEvidenceGapCodes = countCodes(
      matrixResults.flatMap(result => result.evidenceGaps.map(gap => gap.code)),
    );
    const matrixEvidenceGapCount = Object.values(matrixEvidenceGapCodes)
      .reduce((total, count) => total + count, 0);
    const matrixComparison = matrixComparisonsByInstrument.get(item.id) ?? null;
    const score = scoreInstrument({
      calibrationPresent: getSourceCalibration(item.id) !== null,
      liveMeasured: live !== null,
      liveSilent,
      livePeakDbfs: peakDbfs,
      categoryRmsDeltaDb: rmsDeltaDb,
      sampleFileCount: sampleSummary?.fileCount ?? coverage?.fileCount ?? 0,
      sampleIssues,
      maxRootDistanceSemitones: coverage?.maxRootDistanceSemitones ?? null,
      medianVelocityLayers: coverage?.medianVelocityLayers ?? null,
      targetVelocityLayers,
      medianRoundRobins: coverage?.medianRoundRobins ?? null,
      targetRoundRobins,
      dryPcmFatalCount: matrixFatalCount,
    });
    const grade = evidenceGrade(
      item.type,
      live,
      sampleSummary !== undefined,
      liveSilent,
      matrixResults.length > 0,
    );
    const codeCounts = issueCounts(sampleIssues);
    const evidence = item.type === 'sampled'
      ? `${coverage?.fileCount ?? 0} decoded files, ${sampleIssues.length} measured findings (${dispositionAcceptedSampleIssueCount} disposition-accepted, ${unwaivedSampleIssueCount} unwaived), live peak ${finiteRound(peakDbfs) ?? 'n/a'} dBFS`
      : `canonical live peak ${finiteRound(peakDbfs) ?? 'n/a'} dBFS, RMS ${finiteRound(rmsDbfs) ?? 'n/a'} dBFS`;
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      type: item.type,
      score: score.score,
      band: score.band,
      evidenceGrade: grade,
      evidence,
      live: {
        measured: live !== null,
        silent: liveSilent,
        peakDbfs: finiteRound(peakDbfs),
        rmsDbfs: finiteRound(rmsDbfs),
        categoryRmsDeltaDb: finiteRound(rmsDeltaDb),
      },
      sampled: coverage ? {
        fileCount: coverage.fileCount,
        rootCount: coverage.rootCount,
        maxRootDistanceSemitones: coverage.maxRootDistanceSemitones,
        medianVelocityLayers: coverage.medianVelocityLayers,
        medianRoundRobins: coverage.medianRoundRobins,
        issueCount: sampleIssues.length,
        issueCodes: codeCounts,
      } : null,
      scoreComponents: score.components,
      profile,
      dryPcmMatrix: {
        measured: matrixResults.length > 0,
        cases: matrixResults.length,
        fatalFindings: matrixFatalCount,
        fatalCodes: matrixFatalCodes,
        evidenceGaps: matrixEvidenceGapCount,
        evidenceGapCodes: matrixEvidenceGapCodes,
        comparisons: matrixComparison,
      },
      improvements: improvementsFor(
        item.type,
        score,
        peakDbfs,
        rmsDeltaDb,
        codeCounts,
        coverage,
        targetVelocityLayers,
        targetRoundRobins,
        grade,
        matrixFatalCodes,
        matrixEvidenceGapCodes,
        matrixComparison,
      ),
    };
  });

  const evidenceOrder: Readonly<Record<EvidenceGrade, number>> = { F: 0, C: 1, B: 2, A: 3 };
  unranked.sort((left, right) =>
    right.score - left.score
    || evidenceOrder[left.evidenceGrade] - evidenceOrder[right.evidenceGrade]
    || left.id.localeCompare(right.id)
  );
  const instruments: RankedInstrument[] = unranked.map((instrument, index) => ({
    rank: index + 1,
    ...instrument,
  }));

  const reportedSampleRates = [
    ...(sampleReport?.samples ?? []).map(sample => sample.sampleRate),
    ...(liveReport?.audioSampleRates ?? []),
    ...(matrixReport?.sampleRates ?? []),
  ].filter((value): value is number => value !== undefined && Number.isFinite(value));
  const provenance: AuditProvenance = {
    evaluatorCommit,
    subjectCommit,
    evaluatorTreeSha256: currentEvaluatorTreeSha256,
    evaluatorDirty,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    browser: matrixReport?.provenance.browser
      ?? liveReport?.browser
      ?? null,
    sampleRates: [...new Set(reportedSampleRates)].sort((left, right) => left - right),
  };
  const generatedAt = new Date().toISOString();
  const payload = {
    schemaVersion: 2,
    generatedAt,
    commit: subjectCommit,
    provenance,
    claim: evaluatorDirty
      ? 'unpinned-technical-improvement-priority-not-listener-preference'
      : 'pinned-technical-improvement-priority-not-listener-preference',
    inputs: {
      sampleReport: sampleReport ? {
        path: relativePath(options.sampleReport),
        sha256: instrumentQualitySha256File(options.sampleReport),
      } : null,
      liveReport: liveReport ? {
        path: relativePath(options.liveReport),
        sha256: instrumentQualitySha256File(options.liveReport),
      } : null,
      matrixReport: matrixReport ? {
        path: relativePath(options.matrixReport),
        sha256: instrumentQualitySha256File(options.matrixReport),
        profileSha256: matrixReport.profileSha256,
        planSha256: matrixReport.planSha256,
      } : null,
    },
    totals: {
      instruments: instruments.length,
      liveMeasured: instruments.filter(instrument => instrument.live.measured).length,
      liveSilent: instruments.filter(instrument => instrument.live.silent).length,
      sampledDecoded: sampleReport?.instruments.length ?? 0,
      dryPcmMeasured: instruments.filter(instrument => instrument.dryPcmMatrix.measured).length,
      dryPcmCases: instruments.reduce((total, instrument) => total + instrument.dryPcmMatrix.cases, 0),
      dryPcmFatalFindings: instruments.reduce((total, instrument) => total + instrument.dryPcmMatrix.fatalFindings, 0),
      dryPcmEvidenceGaps: instruments.reduce((total, instrument) => total + instrument.dryPcmMatrix.evidenceGaps, 0),
    },
    instruments,
  };
  const markdown = renderMarkdown(provenance, generatedAt, instruments, sampleReport, liveReport, matrixReport, options);

  fs.mkdirSync(path.dirname(options.jsonReport), { recursive: true });
  fs.mkdirSync(path.dirname(options.markdownReport), { recursive: true });
  fs.writeFileSync(options.jsonReport, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(options.markdownReport, markdown);

  console.log(markdown);
  console.log(`JSON report: ${options.jsonReport}`);
  console.log(`Markdown report: ${options.markdownReport}`);
}

main();
