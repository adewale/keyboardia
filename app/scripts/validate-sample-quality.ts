#!/usr/bin/env npx tsx
/**
 * Full sampled-instrument quality audit.
 *
 * This is the canonical manifest-driven, decode-real-audio audit for shipped
 * samples. It intentionally splits hard failures from review flags: objective
 * defects can fail CI, while musical quality questions are reported for A/B
 * listening rather than auto-rejected. Accepted catalog quirks live in the
 * committed baseline file and become stale-waiver failures once they disappear.
 *
 * Usage:
 *   npx tsx scripts/validate-sample-quality.ts
 *   npx tsx scripts/validate-sample-quality.ts --instrument piano
 *   npx tsx scripts/validate-sample-quality.ts --strict
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  DEFAULT_QUALITY_THRESHOLDS,
  analyzeDecodedSampleWithMono,
  classifySampleIssues,
  type DecodedAudioLike,
  type QualityIssue,
  type QualityThresholds,
  type SampleContext,
  type SampleQualityMetrics,
} from './sample-quality-core';
import { findVelocityRmsInversions } from './sample-velocity-core';
import {
  compensatedSampleStartOffset,
  measureDecodedLeadingSilenceSeconds,
} from '../src/audio/sample-onset';
import {
  measurementsEqual,
  sampleQualityEvaluatorBundleSha256,
  sha256File,
  type SampleQualityBaseline,
  type SampleQualityWaiver,
} from './sample-quality-baseline-core';

const INSTRUMENTS_DIR = 'public/instruments';
const DEFAULT_JSON_REPORT = 'test-results/sample-quality/metrics.json';
const DEFAULT_MARKDOWN_REPORT = 'test-results/sample-quality/SAMPLE-QUALITY.md';
const DEFAULT_BASELINE = 'scripts/sample-quality-baseline.json';
const MAX_MARKDOWN_ISSUES = 80;

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

interface ManifestSample {
  note: number;
  file: string;
  velocityMin?: number;
  velocityMax?: number;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  gainDb?: number;
  startOffset?: number;
}

interface Manifest {
  id: string;
  name: string;
  samples: ManifestSample[];
  playableRange?: { min: number; max: number };
  playbackNote?: number;
  unpitched?: boolean;
  gainDb?: number;
  startOffset?: number;
  /** Manifest-approved ceiling for decoder-specific adaptive codec delay. */
  maxAdaptiveCodecDelay?: number;
}

interface DecodeAudioContextLike {
  decodeAudioData(buffer: ArrayBuffer): Promise<DecodedAudioLike>;
  close?: () => Promise<void>;
}

interface SampleMetricEntry {
  metrics: SampleQualityMetrics;
}

interface InstrumentSummary {
  id: string;
  name: string;
  sampleCount: number;
  fileCount: number;
  reviewCount: number;
  errorCount: number;
  maxPeakDb: number;
  maxLeadingSilenceMs: number;
  worstPitchCents: number | null;
  worstPitchConfidence: number | null;
  worstNoteLevelStepDb: number;
  velocityInversions: number;
  rangeOverextensions: number;
  maxLoopDerivativeRatio: number | null;
  minStereoCorrelation: number | null;
}

interface WaivedQualityIssue {
  issue: QualityIssue;
  waiver: SampleQualityWaiver;
}

interface SampleQualityReport {
  version: 1;
  generatedAt: string;
  thresholds: QualityThresholds;
  baseline?: string;
  totals: {
    instruments: number;
    samples: number;
    files: number;
    errors: number;
    reviewFlags: number;
    waivedIssues: number;
  };
  issues: QualityIssue[];
  waivedIssues: WaivedQualityIssue[];
  instruments: InstrumentSummary[];
  samples: SampleQualityMetrics[];
}

interface CliOptions {
  instruments: Set<string> | null;
  strict: boolean;
  writeReports: boolean;
  jsonReport: string;
  markdownReport: string;
  baselinePath: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const instruments = new Set<string>();
  let sawInstrumentFilter = false;
  let strict = false;
  let writeReports = true;
  let jsonReport = DEFAULT_JSON_REPORT;
  let markdownReport = DEFAULT_MARKDOWN_REPORT;
  let baselinePath: string | null = DEFAULT_BASELINE;

  const requireValue = (arg: string, index: number): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--instrument') {
      sawInstrumentFilter = true;
      instruments.add(requireValue(arg, i));
      i++;
    } else if (arg.startsWith('--instrument=')) {
      sawInstrumentFilter = true;
      instruments.add(arg.slice('--instrument='.length));
    } else if (arg === '--strict' || arg === '--fail-on-review') {
      strict = true;
    } else if (arg === '--no-write') {
      writeReports = false;
    } else if (arg === '--json') {
      jsonReport = requireValue(arg, i);
      i++;
    } else if (arg.startsWith('--json=')) {
      jsonReport = arg.slice('--json='.length);
    } else if (arg === '--markdown') {
      markdownReport = requireValue(arg, i);
      i++;
    } else if (arg.startsWith('--markdown=')) {
      markdownReport = arg.slice('--markdown='.length);
    } else if (arg === '--baseline') {
      baselinePath = requireValue(arg, i);
      i++;
    } else if (arg.startsWith('--baseline=')) {
      baselinePath = arg.slice('--baseline='.length);
    } else if (arg === '--no-baseline') {
      baselinePath = null;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    instruments: sawInstrumentFilter ? instruments : null,
    strict,
    writeReports,
    jsonReport,
    markdownReport,
    baselinePath,
  };
}

function printHelp(): void {
  console.log(`\n${colors.bold}Sample Quality Audit${colors.reset}\n`);
  console.log('Usage: npx tsx scripts/validate-sample-quality.ts [options]\n');
  console.log('Options:');
  console.log('  --instrument <id>     Audit one instrument; repeatable');
  console.log('  --strict              Exit non-zero on unwaived review flags as well as errors');
  console.log('  --no-baseline         Do not apply scripts/sample-quality-baseline.json waivers');
  console.log('  --baseline <path>     Baseline/waiver JSON path');
  console.log('  --no-write            Do not write JSON/Markdown reports');
  console.log('  --json <path>         JSON report path');
  console.log('  --markdown <path>     Markdown report path');
}

function readManifests(options: CliOptions): Manifest[] {
  const root = path.join(process.cwd(), INSTRUMENTS_DIR);
  const manifests = fs.readdirSync(root)
    .filter(entry => fs.statSync(path.join(root, entry)).isDirectory())
    .sort()
    .flatMap(entry => {
      const manifestPath = path.join(root, entry, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return [];
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
      return options.instruments && !options.instruments.has(manifest.id) ? [] : [manifest];
    });

  if (options.instruments) {
    const found = new Set(manifests.map(manifest => manifest.id));
    const missing = [...options.instruments].filter(instrument => !found.has(instrument));
    if (missing.length > 0) throw new Error(`Unknown instrument filter(s): ${missing.join(', ')}`);
  }

  return manifests;
}

function isBoundMeasurement(value: unknown): value is number | string | null {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function readBaseline(pathname: string | null, instruments: Set<string> | null): SampleQualityWaiver[] {
  if (pathname === null) return [];
  if (!fs.existsSync(pathname)) throw new Error(`Sample-quality baseline not found: ${pathname}`);
  const baseline = JSON.parse(fs.readFileSync(pathname, 'utf-8')) as SampleQualityBaseline;
  if (baseline.version !== 3 || !Array.isArray(baseline.waivers)) {
    throw new Error(`Invalid sample-quality baseline schema in ${pathname}`);
  }
  const evaluatorBundleSha256 = sampleQualityEvaluatorBundleSha256();
  if (baseline.evaluatorBundleSha256 !== evaluatorBundleSha256) {
    throw new Error(
      `Sample-quality baseline evaluator bundle is stale: expected ${evaluatorBundleSha256}, ` +
      `received ${baseline.evaluatorBundleSha256 ?? 'missing'}`
    );
  }
  const identities = new Set<string>();
  for (const waiver of baseline.waivers) {
    const hasMeasuredValue = Object.prototype.hasOwnProperty.call(waiver, 'measuredValue');
    const hasThreshold = Object.prototype.hasOwnProperty.call(waiver, 'threshold');
    if (!waiver.code || !waiver.instrumentId || !waiver.file || !waiver.sha256 ||
      !waiver.manifestSha256 || !waiver.reason || !hasMeasuredValue || !hasThreshold ||
      !isBoundMeasurement(waiver.measuredValue) || !isBoundMeasurement(waiver.threshold)) {
      throw new Error(`Invalid waiver in ${pathname}: ${JSON.stringify(waiver)}`);
    }
    const instrumentDir = path.resolve(INSTRUMENTS_DIR, waiver.instrumentId);
    const boundFile = path.resolve(instrumentDir, waiver.file);
    if (boundFile !== instrumentDir && !boundFile.startsWith(`${instrumentDir}${path.sep}`)) {
      throw new Error(`Waiver-bound file escapes its instrument directory: ${waiver.instrumentId}/${waiver.file}`);
    }
    if (!fs.existsSync(boundFile)) throw new Error(`Waiver-bound file is missing: ${boundFile}`);
    const actualHash = sha256File(boundFile);
    if (actualHash !== waiver.sha256) {
      throw new Error(`Waiver hash mismatch for ${waiver.instrumentId}/${waiver.file}; re-audit the changed source`);
    }
    const manifestPath = path.resolve(instrumentDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`Waiver-bound manifest is missing: ${manifestPath}`);
    if (sha256File(manifestPath) !== waiver.manifestSha256) {
      throw new Error(`Waiver manifest hash mismatch for ${waiver.instrumentId}; re-audit the changed mapping`);
    }
    const identity = `${waiver.code}\0${waiver.instrumentId}\0${waiver.file}`;
    if (identities.has(identity)) throw new Error(`Duplicate waiver in ${pathname}: ${identity.replaceAll('\0', '/')}`);
    identities.add(identity);
  }
  return instruments
    ? baseline.waivers.filter(waiver => instruments.has(waiver.instrumentId))
    : baseline.waivers;
}

async function createAudioContext(): Promise<DecodeAudioContextLike> {
  const webAudio = await import('node-web-audio-api').catch((error: unknown) => {
    throw new Error(`node-web-audio-api is required for sample-quality decoding: ${String(error)}`);
  }) as { OfflineAudioContext: new (channels: number, length: number, sampleRate: number) => DecodeAudioContextLike };
  return new webAudio.OfflineAudioContext(1, 1, 44100);
}

async function decodeFile(audioContext: DecodeAudioContextLike, filePath: string): Promise<DecodedAudioLike> {
  const bytes = fs.readFileSync(filePath);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return audioContext.decodeAudioData(arrayBuffer);
}

function addGroupIssues(
  entries: SampleMetricEntry[],
  thresholds: QualityThresholds,
  issues: QualityIssue[]
): void {
  const byInstrument = new Map<string, SampleMetricEntry[]>();
  for (const entry of entries) {
    const current = byInstrument.get(entry.metrics.instrumentId) ?? [];
    current.push(entry);
    byInstrument.set(entry.metrics.instrumentId, current);
  }

  for (const [instrumentId, instrumentEntries] of byInstrument) {
    addVelocityIssues(instrumentId, instrumentEntries, thresholds, issues);
    addLevelStepIssues(instrumentId, instrumentEntries, thresholds, issues);
  }
}

function canonicalVelocityCandidate(
  entries: SampleMetricEntry[],
  instrumentId: string,
): SampleQualityMetrics | null {
  const atCanonicalVelocity = entries
    .map(entry => entry.metrics)
    .filter(metrics => metrics.instrumentId === instrumentId)
    .filter(metrics => (metrics.velocityMin ?? 0) <= 90 && (metrics.velocityMax ?? 127) >= 90)
    .sort((left, right) =>
      Math.abs(left.note - 60) - Math.abs(right.note - 60)
      || right.note - left.note
      || left.file.localeCompare(right.file)
    );
  return atCanonicalVelocity[0] ?? null;
}

/** Enforce the plan's C4/MIDI-90 K-weighted tonal calibration contract. */
function addTonalLoudnessIssues(
  entries: SampleMetricEntry[],
  manifests: Manifest[],
  thresholds: QualityThresholds,
  issues: QualityIssue[],
): void {
  const reference = canonicalVelocityCandidate(entries, 'piano');
  if (reference?.loudnessKMax === null || reference === null) {
    issues.push({
      severity: 'error',
      code: 'LOUDNESS_REFERENCE_MISSING',
      instrumentId: 'piano',
      file: 'manifest.json',
      message: 'Piano C4/MIDI-90 K-weighted reference could not be measured',
    });
    return;
  }
  const referenceLoudness = reference.loudnessKMax + reference.playbackGainDb;
  for (const manifest of manifests) {
    if (manifest.playbackNote !== undefined || manifest.unpitched === true) continue;
    const candidate = canonicalVelocityCandidate(entries, manifest.id);
    if (candidate?.loudnessKMax === null || candidate === null) {
      issues.push({
        severity: 'error',
        code: 'LOUDNESS_MEASURE_UNAVAILABLE',
        instrumentId: manifest.id,
        file: 'manifest.json',
        message: 'Canonical C4/MIDI-90 K-weighted loudness could not be measured',
      });
      continue;
    }
    const delivered = candidate.loudnessKMax + candidate.playbackGainDb;
    const delta = delivered - referenceLoudness;
    if (Math.abs(delta) > thresholds.tonalLoudnessToleranceDb) {
      issues.push({
        severity: 'error',
        code: 'TONAL_LOUDNESS_MISMATCH',
        instrumentId: manifest.id,
        file: candidate.file,
        message: `Canonical K-weighted loudness differs from piano C4-mf by ${delta.toFixed(2)} dB after manifest trim`,
        value: delta,
        threshold: `±${thresholds.tonalLoudnessToleranceDb} dB`,
      });
    }
  }
}

function addVelocityIssues(
  instrumentId: string,
  entries: SampleMetricEntry[],
  thresholds: QualityThresholds,
  issues: QualityIssue[]
): void {
  const velocitySamples = entries
    .map(entry => ({
      ...entry.metrics,
      activeRmsDb: entry.metrics.activeRmsDb + entry.metrics.playbackGainDb,
    }))
    .filter(metrics => metrics.velocityMin !== undefined || metrics.velocityMax !== undefined);
  for (const inversion of findVelocityRmsInversions(velocitySamples, thresholds.velocityInversionDb)) {
    const representative = [...inversion.higher.samples].sort((left, right) => left.file.localeCompare(right.file))[0];
    issues.push({
      severity: 'review',
      code: 'VELOCITY_RMS_INVERSION',
      instrumentId,
      file: representative.file,
      message: `Aggregated velocity layer ${inversion.higher.velocityMin}-${inversion.higher.velocityMax} for note ${inversion.higher.note} is ${(-inversion.deltaDb).toFixed(1)} dB quieter than the lower layer`,
      value: inversion.deltaDb,
      threshold: `>= -${thresholds.velocityInversionDb} dB`,
    });
  }
}

function addLevelStepIssues(
  instrumentId: string,
  entries: SampleMetricEntry[],
  thresholds: QualityThresholds,
  issues: QualityIssue[]
): void {
  const loudestByNote = new Map<number, SampleQualityMetrics>();
  for (const entry of entries) {
    const existing = loudestByNote.get(entry.metrics.note);
    if (!existing || (entry.metrics.velocityMin ?? 0) > (existing.velocityMin ?? 0)) {
      loudestByNote.set(entry.metrics.note, entry.metrics);
    }
  }
  const sorted = [...loudestByNote.values()].sort((a, b) => a.note - b.note);
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    const previousDelivered = previous.activeRmsDb + previous.playbackGainDb;
    const currentDelivered = current.activeRmsDb + current.playbackGainDb;
    const step = Math.abs(currentDelivered - previousDelivered);
    if (step > thresholds.noteLevelStepDb) {
      issues.push({
        severity: 'review',
        code: 'NOTE_LEVEL_STEP',
        instrumentId,
        file: current.file,
        message: `Adjacent mapped notes ${previous.note}->${current.note} differ by ${step.toFixed(1)} dB active RMS`,
        value: step,
        threshold: thresholds.noteLevelStepDb,
      });
    }
  }
}

function addRangeIssues(manifests: Manifest[], thresholds: QualityThresholds, issues: QualityIssue[]): void {
  for (const manifest of manifests) {
    if (!manifest.playableRange || manifest.playbackNote !== undefined || manifest.unpitched === true) continue;
    const notes = [...new Set(manifest.samples.map(sample => sample.note))].sort((a, b) => a - b);
    if (notes.length === 0) continue;
    const overextension = Math.max(
      notes[0] - manifest.playableRange.min,
      manifest.playableRange.max - notes[notes.length - 1],
      0
    );
    if (overextension > thresholds.rangeOverextensionSemitones) {
      issues.push({
        severity: 'review',
        code: 'RANGE_OVEREXTENSION',
        instrumentId: manifest.id,
        file: 'manifest.json',
        message: `playableRange extends ${overextension} semitones past the outermost sampled note`,
        value: overextension,
        threshold: thresholds.rangeOverextensionSemitones,
      });
    }
  }
}

function issueMatchesWaiver(issue: QualityIssue, waiver: SampleQualityWaiver): boolean {
  return issue.code === waiver.code &&
    issue.instrumentId === waiver.instrumentId &&
    waiver.file === issue.file &&
    measurementsEqual(issue.value, waiver.measuredValue) &&
    measurementsEqual(issue.threshold, waiver.threshold);
}

function applyWaivers(issues: QualityIssue[], waivers: SampleQualityWaiver[]): {
  unwaivedIssues: QualityIssue[];
  waivedIssues: WaivedQualityIssue[];
} {
  if (waivers.length === 0) return { unwaivedIssues: issues, waivedIssues: [] };

  const matchedWaivers = new Set<number>();
  const unwaivedIssues: QualityIssue[] = [];
  const waivedIssues: WaivedQualityIssue[] = [];

  for (const issue of issues) {
    const waiverIndex = waivers.findIndex(waiver => issueMatchesWaiver(issue, waiver));
    if (waiverIndex === -1) {
      unwaivedIssues.push(issue);
    } else {
      matchedWaivers.add(waiverIndex);
      waivedIssues.push({ issue, waiver: waivers[waiverIndex] });
    }
  }

  for (let i = 0; i < waivers.length; i++) {
    if (matchedWaivers.has(i)) continue;
    const waiver = waivers[i];
    unwaivedIssues.push({
      severity: 'error',
      code: 'STALE_WAIVER',
      instrumentId: waiver.instrumentId,
      file: waiver.file,
      message: `Baseline waiver for ${waiver.code} no longer matches an emitted issue; remove it from ${DEFAULT_BASELINE}`,
      value: waiver.code,
    });
  }

  return { unwaivedIssues, waivedIssues };
}

function buildInstrumentSummaries(entries: SampleMetricEntry[], issues: QualityIssue[]): InstrumentSummary[] {
  const byInstrument = new Map<string, SampleMetricEntry[]>();
  for (const entry of entries) {
    const current = byInstrument.get(entry.metrics.instrumentId) ?? [];
    current.push(entry);
    byInstrument.set(entry.metrics.instrumentId, current);
  }

  return [...byInstrument.entries()].map(([id, instrumentEntries]) => {
    const instrumentIssues = issues.filter(issue => issue.instrumentId === id);
    const pitchCandidates = instrumentEntries
      .map(entry => entry.metrics.pitch)
      .filter(pitch => pitch.foldedCents !== null && pitch.confidence > 0);
    const loopDerivativeRatios = instrumentEntries
      .map(entry => entry.metrics.loop?.derivativeDiscontinuityRatio ?? null)
      .filter((value): value is number => value !== null);
    const stereoCorrelations = instrumentEntries
      .map(entry => entry.metrics.stereo?.correlation ?? null)
      .filter((value): value is number => value !== null);
    const worstPitch = pitchCandidates.length === 0
      ? null
      : pitchCandidates.reduce((worst, pitch) => Math.abs(pitch.foldedCents ?? 0) > Math.abs(worst.foldedCents ?? 0) ? pitch : worst);
    return {
      id,
      name: instrumentEntries[0].metrics.instrumentName,
      sampleCount: instrumentEntries.length,
      fileCount: new Set(instrumentEntries.map(entry => entry.metrics.file)).size,
      reviewCount: instrumentIssues.filter(issue => issue.severity === 'review').length,
      errorCount: instrumentIssues.filter(issue => issue.severity === 'error').length,
      maxPeakDb: Math.max(...instrumentEntries.map(entry => entry.metrics.peakDb)),
      maxLeadingSilenceMs: Math.max(...instrumentEntries.map(entry => entry.metrics.effectiveLeadingSilenceMs)),
      worstPitchCents: worstPitch?.foldedCents ?? null,
      worstPitchConfidence: worstPitch?.confidence ?? null,
      worstNoteLevelStepDb: maxIssueValue(instrumentIssues, 'NOTE_LEVEL_STEP'),
      velocityInversions: instrumentIssues.filter(issue => issue.code === 'VELOCITY_RMS_INVERSION').length,
      rangeOverextensions: instrumentIssues.filter(issue => issue.code === 'RANGE_OVEREXTENSION').length,
      maxLoopDerivativeRatio: loopDerivativeRatios.length === 0 ? null : Math.max(...loopDerivativeRatios),
      minStereoCorrelation: stereoCorrelations.length === 0 ? null : Math.min(...stereoCorrelations),
    } satisfies InstrumentSummary;
  }).sort((a, b) => b.errorCount - a.errorCount || b.reviewCount - a.reviewCount || a.id.localeCompare(b.id));
}

function maxIssueValue(issues: QualityIssue[], code: string): number {
  const values = issues
    .filter(issue => issue.code === code && typeof issue.value === 'number')
    .map(issue => issue.value as number);
  return values.length === 0 ? 0 : Math.max(...values);
}

function sortIssues(issues: QualityIssue[]): QualityIssue[] {
  return [...issues].sort((a, b) =>
    a.severity === b.severity
      ? `${a.instrumentId}/${a.file ?? ''}/${a.code}`.localeCompare(`${b.instrumentId}/${b.file ?? ''}/${b.code}`)
      : a.severity === 'error' ? -1 : 1
  );
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function renderMarkdown(report: SampleQualityReport): string {
  const topIssues = sortIssues(report.issues).slice(0, MAX_MARKDOWN_ISSUES);
  const omittedIssues = Math.max(0, report.issues.length - topIssues.length);
  const lines: string[] = [];
  lines.push('# Sample Quality Audit');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Instruments: ${report.totals.instruments}`);
  lines.push(`- Manifest sample mappings: ${report.totals.samples}`);
  lines.push(`- Unique files: ${report.totals.files}`);
  lines.push(`- Unwaived errors: ${report.totals.errors}`);
  lines.push(`- Unwaived review flags: ${report.totals.reviewFlags}`);
  lines.push(`- Waived baseline issues: ${report.totals.waivedIssues}`);
  if (report.baseline) lines.push(`- Baseline: \`${report.baseline}\``);
  lines.push('');
  lines.push('## Instrument overview');
  lines.push('');
  lines.push('| Instrument | Samples | Errors | Review | Peak dBFS | Max lead ms | Worst pitch ¢ | Level step dB | Loop slope ratio | Min stereo corr |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of report.instruments) {
    lines.push([
      markdownEscape(row.id),
      row.sampleCount,
      row.errorCount,
      row.reviewCount,
      formatNumber(row.maxPeakDb),
      formatNumber(row.maxLeadingSilenceMs),
      formatNumber(row.worstPitchCents),
      formatNumber(row.worstNoteLevelStepDb),
      formatNumber(row.maxLoopDerivativeRatio, 2),
      formatNumber(row.minStereoCorrelation, 3),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  lines.push('## Unwaived issues');
  lines.push('');
  if (topIssues.length === 0) {
    lines.push('No unwaived errors or review flags.');
  } else {
    lines.push('| Severity | Code | Instrument | File | Message | Value | Threshold |');
    lines.push('|---|---|---|---|---|---:|---:|');
    for (const issue of topIssues) {
      lines.push([
        issue.severity,
        issue.code,
        issue.instrumentId,
        issue.file ?? '',
        markdownEscape(issue.message),
        typeof issue.value === 'number' ? formatNumber(issue.value, 3) : issue.value ?? '',
        issue.threshold ?? '',
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    if (omittedIssues > 0) {
      lines.push('');
      lines.push(`_Showing ${topIssues.length} of ${report.issues.length} unwaived issues; ${omittedIssues} more are present in the JSON report._`);
    }
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- `error` means objective decode/measurement defects that should block CI unless explicitly waived.');
  lines.push('- `review` means measurable risk that needs A/B listening or source-specific judgment.');
  lines.push('- Baseline dispositions bind the source file, complete manifest, exact measured value/threshold, and evaluator bundle; any change fails closed.');
  lines.push('- Metrics are generated from decoded PCM via Web Audio in Node; Chromium codec support is covered by the blocking browser decode smoke test.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function writeReport(pathname: string, content: string): void {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(pathname, content);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const manifests = readManifests(options);
  const waivers = readBaseline(options.baselinePath, options.instruments);
  const thresholds = DEFAULT_QUALITY_THRESHOLDS;
  const entries: SampleMetricEntry[] = [];
  const rawIssues: QualityIssue[] = [];

  console.log(`\n${colors.bold}🎧 SAMPLE QUALITY AUDIT${colors.reset}\n`);
  console.log(`${colors.dim}Analyzing decoded sample metrics for ${manifests.length} instrument(s)${colors.reset}\n`);

  const audioContext = await createAudioContext();
  try {
    for (const manifest of manifests) {
      const instrumentDir = path.join(process.cwd(), INSTRUMENTS_DIR, manifest.id);
      const pitched = manifest.playbackNote === undefined && manifest.unpitched !== true;
      for (const sample of manifest.samples) {
        const filePath = path.join(instrumentDir, sample.file);
        try {
          const decoded = await decodeFile(audioContext, filePath);
          const configuredStart = sample.startOffset ?? manifest.startOffset;
          const adaptCodecDelay = sample.file.toLowerCase().endsWith('.m4a')
            || manifest.playbackNote !== undefined;
          const playbackStartOffset = compensatedSampleStartOffset(
            configuredStart,
            adaptCodecDelay ? measureDecodedLeadingSilenceSeconds(decoded) : 0,
            adaptCodecDelay,
            manifest.maxAdaptiveCodecDelay,
          );
          const context: SampleContext = {
            instrumentId: manifest.id,
            instrumentName: manifest.name,
            file: sample.file,
            note: sample.note,
            velocityMin: sample.velocityMin,
            velocityMax: sample.velocityMax,
            loop: sample.loop,
            loopStart: sample.loopStart,
            loopEnd: sample.loopEnd,
            pitched,
            playbackGainDb: (manifest.gainDb ?? 0) + (sample.gainDb ?? 0),
            playbackStartOffsetMs: (playbackStartOffset ?? 0) * 1000,
          };
          const { metrics } = analyzeDecodedSampleWithMono(context, decoded);
          entries.push({ metrics });
          rawIssues.push(...classifySampleIssues(metrics, thresholds));
        } catch (error) {
          rawIssues.push({
            severity: 'error',
            code: 'DECODE_FAILED',
            instrumentId: manifest.id,
            file: sample.file,
            message: `Audio decode failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      process.stdout.write(`${colors.dim}.${colors.reset}`);
    }
  } finally {
    await audioContext.close?.();
  }
  process.stdout.write('\n\n');

  addGroupIssues(entries, thresholds, rawIssues);
  addRangeIssues(manifests, thresholds, rawIssues);
  addTonalLoudnessIssues(entries, manifests, thresholds, rawIssues);

  const { unwaivedIssues, waivedIssues } = applyWaivers(sortIssues(rawIssues), waivers);
  const sortedUnwaivedIssues = sortIssues(unwaivedIssues);
  const instrumentSummaries = buildInstrumentSummaries(entries, sortedUnwaivedIssues);
  const report: SampleQualityReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    thresholds,
    baseline: options.baselinePath ?? undefined,
    totals: {
      instruments: manifests.length,
      samples: manifests.reduce((sum, manifest) => sum + manifest.samples.length, 0),
      files: new Set(entries.map(entry => `${entry.metrics.instrumentId}/${entry.metrics.file}`)).size,
      errors: sortedUnwaivedIssues.filter(issue => issue.severity === 'error').length,
      reviewFlags: sortedUnwaivedIssues.filter(issue => issue.severity === 'review').length,
      waivedIssues: waivedIssues.length,
    },
    issues: sortedUnwaivedIssues,
    waivedIssues,
    instruments: instrumentSummaries,
    samples: entries.map(entry => entry.metrics),
  };

  if (options.writeReports) {
    writeReport(options.jsonReport, `${JSON.stringify(report, null, 2)}\n`);
    writeReport(options.markdownReport, renderMarkdown(report));
  }

  const errors = report.totals.errors;
  const reviewFlags = report.totals.reviewFlags;
  console.log(`${colors.bold}SUMMARY${colors.reset}`);
  console.log(`  Instruments: ${report.totals.instruments}`);
  console.log(`  Samples: ${report.totals.samples}`);
  console.log(`  Unique files: ${report.totals.files}`);
  console.log(`  Waived baseline issues: ${report.totals.waivedIssues}`);
  console.log(`  ${errors === 0 ? colors.green : colors.red}Unwaived errors:${colors.reset} ${errors}`);
  console.log(`  ${reviewFlags === 0 ? colors.green : colors.yellow}Unwaived review flags:${colors.reset} ${reviewFlags}`);
  if (options.writeReports) {
    console.log(`\n${colors.dim}JSON: ${options.jsonReport}${colors.reset}`);
    console.log(`${colors.dim}Markdown: ${options.markdownReport}${colors.reset}`);
  }

  const worst = report.instruments.filter(row => row.errorCount > 0 || row.reviewCount > 0).slice(0, 10);
  if (worst.length > 0) {
    console.log(`\n${colors.bold}Top instruments to review${colors.reset}`);
    for (const row of worst) {
      const prefix = row.errorCount > 0 ? colors.red : colors.yellow;
      console.log(`  ${prefix}${row.id}${colors.reset}: ${row.errorCount} error(s), ${row.reviewCount} review flag(s)`);
    }
  }

  if (errors > 0 || (options.strict && reviewFlags > 0)) {
    console.log(`\n${colors.red}${colors.bold}Sample quality audit failed${colors.reset}\n`);
    process.exit(1);
  }

  console.log(`\n${colors.green}${colors.bold}Sample quality audit completed${colors.reset}\n`);
}

main().catch(error => {
  console.error(`${colors.red}${colors.bold}Sample quality audit crashed:${colors.reset} ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
