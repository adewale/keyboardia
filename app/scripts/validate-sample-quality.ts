#!/usr/bin/env npx tsx
/**
 * Full sampled-instrument quality audit.
 *
 * This is a manifest-driven, decode-real-audio audit. It intentionally splits
 * hard failures from review flags: objective defects can fail CI, while musical
 * quality questions are reported for A/B listening rather than auto-rejected.
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
  UNPITCHED_INSTRUMENTS,
  analyzeDecodedSample,
  classifySampleIssues,
  mixToMono,
  waveformCorrelation,
  type DecodedAudioLike,
  type QualityIssue,
  type QualityThresholds,
  type SampleContext,
  type SampleQualityMetrics,
} from './sample-quality-core';

const INSTRUMENTS_DIR = 'public/instruments';
const DEFAULT_JSON_REPORT = 'test-results/sample-quality/metrics.json';
const DEFAULT_MARKDOWN_REPORT = 'test-results/sample-quality/SAMPLE-QUALITY.md';

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
}

interface Manifest {
  id: string;
  name: string;
  samples: ManifestSample[];
  playableRange?: { min: number; max: number };
  playbackNote?: number;
}

interface DecodeAudioContextLike {
  decodeAudioData(buffer: ArrayBuffer): Promise<DecodedAudioLike>;
  close?: () => Promise<void>;
}

interface SampleMetricEntry {
  path: string;
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
  roundRobinReviewCount: number;
  maxLoopDiffRatio: number | null;
  minStereoCorrelation: number | null;
}

interface SampleQualityReport {
  version: 1;
  generatedAt: string;
  thresholds: QualityThresholds;
  totals: {
    instruments: number;
    samples: number;
    files: number;
    errors: number;
    reviewFlags: number;
  };
  issues: QualityIssue[];
  instruments: InstrumentSummary[];
  samples: SampleQualityMetrics[];
}

interface CliOptions {
  instruments: Set<string> | null;
  strict: boolean;
  writeReports: boolean;
  jsonReport: string;
  markdownReport: string;
}

function parseArgs(argv: string[]): CliOptions {
  const instruments = new Set<string>();
  let sawInstrumentFilter = false;
  let strict = false;
  let writeReports = true;
  let jsonReport = DEFAULT_JSON_REPORT;
  let markdownReport = DEFAULT_MARKDOWN_REPORT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--instrument' && argv[i + 1]) {
      sawInstrumentFilter = true;
      instruments.add(argv[++i]);
    } else if (arg.startsWith('--instrument=')) {
      sawInstrumentFilter = true;
      instruments.add(arg.slice('--instrument='.length));
    } else if (arg === '--strict' || arg === '--fail-on-review') {
      strict = true;
    } else if (arg === '--no-write') {
      writeReports = false;
    } else if (arg === '--json' && argv[i + 1]) {
      jsonReport = argv[++i];
    } else if (arg.startsWith('--json=')) {
      jsonReport = arg.slice('--json='.length);
    } else if (arg === '--markdown' && argv[i + 1]) {
      markdownReport = argv[++i];
    } else if (arg.startsWith('--markdown=')) {
      markdownReport = arg.slice('--markdown='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return {
    instruments: sawInstrumentFilter ? instruments : null,
    strict,
    writeReports,
    jsonReport,
    markdownReport,
  };
}

function printHelp(): void {
  console.log(`\n${colors.bold}Sample Quality Audit${colors.reset}\n`);
  console.log('Usage: npx tsx scripts/validate-sample-quality.ts [options]\n');
  console.log('Options:');
  console.log('  --instrument <id>     Audit one instrument; repeatable');
  console.log('  --strict              Exit non-zero on review flags as well as errors');
  console.log('  --no-write            Do not write JSON/Markdown reports');
  console.log('  --json <path>         JSON report path');
  console.log('  --markdown <path>     Markdown report path');
}

function readManifests(options: CliOptions): Manifest[] {
  const root = path.join(process.cwd(), INSTRUMENTS_DIR);
  return fs.readdirSync(root)
    .filter(entry => fs.statSync(path.join(root, entry)).isDirectory())
    .filter(entry => !options.instruments || options.instruments.has(entry))
    .sort()
    .flatMap(entry => {
      const manifestPath = path.join(root, entry, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return [];
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
      return [manifest];
    });
}

async function createAudioContext(): Promise<DecodeAudioContextLike> {
  const webAudio = await import('node-web-audio-api').catch((error: unknown) => {
    throw new Error(`node-web-audio-api is required for sample-quality decoding: ${String(error)}`);
  }) as { OfflineAudioContext: new (channels: number, length: number, sampleRate: number) => DecodeAudioContextLike };
  return new webAudio.OfflineAudioContext(1, 1, 44100);
}

async function decodeFile(audioContext: DecodeAudioContextLike, filePath: string): Promise<DecodedAudioLike> {
  const bytes = fs.readFileSync(filePath);
  const arrayBuffer = new Uint8Array(bytes).buffer;
  return audioContext.decodeAudioData(arrayBuffer);
}

function snippetFromDecoded(decoded: DecodedAudioLike, metrics: SampleQualityMetrics): Float32Array {
  const mono = mixToMono(decoded);
  const start = metrics.activeStartMs === null
    ? 0
    : Math.min(mono.length - 1, Math.max(0, Math.floor((metrics.activeStartMs / 1000) * decoded.sampleRate)));
  const length = Math.min(Math.floor(decoded.sampleRate * 0.12), mono.length - start);
  return mono.slice(start, start + length);
}

function velocityKey(metrics: SampleQualityMetrics): string {
  return `${metrics.velocityMin ?? 0}-${metrics.velocityMax ?? 127}`;
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

function addVelocityIssues(
  instrumentId: string,
  entries: SampleMetricEntry[],
  thresholds: QualityThresholds,
  issues: QualityIssue[]
): void {
  const byNote = new Map<number, SampleMetricEntry[]>();
  for (const entry of entries) {
    if (entry.metrics.velocityMin === undefined && entry.metrics.velocityMax === undefined) continue;
    const current = byNote.get(entry.metrics.note) ?? [];
    current.push(entry);
    byNote.set(entry.metrics.note, current);
  }

  for (const [note, noteEntries] of byNote) {
    const sorted = [...noteEntries].sort((a, b) => (a.metrics.velocityMin ?? 0) - (b.metrics.velocityMin ?? 0));
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1].metrics;
      const current = sorted[i].metrics;
      if (current.activeRmsDb + thresholds.velocityInversionDb < previous.activeRmsDb) {
        issues.push({
          severity: 'review',
          code: 'VELOCITY_RMS_INVERSION',
          instrumentId,
          file: current.file,
          message: `Velocity layer for note ${note} is ${(previous.activeRmsDb - current.activeRmsDb).toFixed(1)} dB quieter than the lower layer`,
          value: current.activeRmsDb - previous.activeRmsDb,
          threshold: `>= -${thresholds.velocityInversionDb} dB`,
        });
      }
    }
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
    const step = Math.abs(current.activeRmsDb - previous.activeRmsDb);
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

function addRoundRobinIssues(
  entries: SampleMetricEntry[],
  snippets: Map<string, Float32Array>,
  thresholds: QualityThresholds,
  issues: QualityIssue[]
): void {
  const groups = new Map<string, SampleMetricEntry[]>();
  for (const entry of entries) {
    const key = `${entry.metrics.instrumentId}:${entry.metrics.note}:${velocityKey(entry.metrics)}`;
    const current = groups.get(key) ?? [];
    current.push(entry);
    groups.set(key, current);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const levels = group.map(entry => entry.metrics.activeRmsDb);
    const spread = Math.max(...levels) - Math.min(...levels);
    if (spread > thresholds.roundRobinLevelSpreadDb) {
      const first = group[0].metrics;
      issues.push({
        severity: 'review',
        code: 'ROUND_ROBIN_LEVEL_SPREAD',
        instrumentId: first.instrumentId,
        file: first.file,
        message: `Same note/velocity alternates differ by ${spread.toFixed(1)} dB active RMS`,
        value: spread,
        threshold: thresholds.roundRobinLevelSpreadDb,
      });
    }
    let maxCorrelation = -Infinity;
    let correlatedFile = group[0].metrics.file;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = snippets.get(group[i].path);
        const b = snippets.get(group[j].path);
        if (!a || !b) continue;
        const correlation = waveformCorrelation(a, b);
        if (correlation !== null && correlation > maxCorrelation) {
          maxCorrelation = correlation;
          correlatedFile = group[j].metrics.file;
        }
      }
    }
    if (maxCorrelation > thresholds.roundRobinTooSimilarCorrelation) {
      const first = group[0].metrics;
      issues.push({
        severity: 'review',
        code: 'ROUND_ROBIN_TOO_SIMILAR',
        instrumentId: first.instrumentId,
        file: correlatedFile,
        message: `Same note/velocity alternates are nearly identical (corr ${maxCorrelation.toFixed(4)})`,
        value: maxCorrelation,
        threshold: thresholds.roundRobinTooSimilarCorrelation,
      });
    }
  }
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
    const loopDiffs = instrumentEntries
      .map(entry => entry.metrics.loop?.windowDiffRatio ?? null)
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
      maxLeadingSilenceMs: Math.max(...instrumentEntries.map(entry => entry.metrics.leadingSilenceMs)),
      worstPitchCents: worstPitch?.foldedCents ?? null,
      worstPitchConfidence: worstPitch?.confidence ?? null,
      worstNoteLevelStepDb: maxIssueValue(instrumentIssues, 'NOTE_LEVEL_STEP'),
      velocityInversions: instrumentIssues.filter(issue => issue.code === 'VELOCITY_RMS_INVERSION').length,
      roundRobinReviewCount: instrumentIssues.filter(issue => issue.code.startsWith('ROUND_ROBIN')).length,
      maxLoopDiffRatio: loopDiffs.length === 0 ? null : Math.max(...loopDiffs),
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

function markdownEscape(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function renderMarkdown(report: SampleQualityReport): string {
  const topIssues = [...report.issues]
    .sort((a, b) => (a.severity === b.severity ? a.instrumentId.localeCompare(b.instrumentId) : a.severity === 'error' ? -1 : 1))
    .slice(0, 80);
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
  lines.push(`- Errors: ${report.totals.errors}`);
  lines.push(`- Review flags: ${report.totals.reviewFlags}`);
  lines.push('');
  lines.push('## Instrument overview');
  lines.push('');
  lines.push('| Instrument | Samples | Errors | Review | Peak dBFS | Max lead ms | Worst pitch ¢ | Level step dB | Loop diff % | Min stereo corr |');
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
      row.maxLoopDiffRatio === null ? '—' : (row.maxLoopDiffRatio * 100).toFixed(1),
      formatNumber(row.minStereoCorrelation, 3),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  lines.push('## Top issues');
  lines.push('');
  if (topIssues.length === 0) {
    lines.push('No errors or review flags.');
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
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- `error` means objective decode/measurement defects that should block CI.');
  lines.push('- `review` means measurable risk that needs A/B listening or source-specific judgment.');
  lines.push('- Metrics are generated from decoded PCM via Web Audio in Node; browser codec support is covered by the Playwright decode smoke test.');
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
  const thresholds = DEFAULT_QUALITY_THRESHOLDS;
  const entries: SampleMetricEntry[] = [];
  const snippets = new Map<string, Float32Array>();
  const issues: QualityIssue[] = [];

  console.log(`\n${colors.bold}🎧 SAMPLE QUALITY AUDIT${colors.reset}\n`);
  console.log(`${colors.dim}Analyzing decoded sample metrics for ${manifests.length} instrument(s)${colors.reset}\n`);

  const audioContext = await createAudioContext();
  try {
    for (const manifest of manifests) {
      const instrumentDir = path.join(process.cwd(), INSTRUMENTS_DIR, manifest.id);
      const pitched = !UNPITCHED_INSTRUMENTS.has(manifest.id);
      for (const sample of manifest.samples) {
        const filePath = path.join(instrumentDir, sample.file);
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
        };
        try {
          const decoded = await decodeFile(audioContext, filePath);
          const metrics = analyzeDecodedSample(context, decoded);
          entries.push({ path: filePath, metrics });
          snippets.set(filePath, snippetFromDecoded(decoded, metrics));
          issues.push(...classifySampleIssues(metrics, thresholds));
        } catch (error) {
          issues.push({
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

  addGroupIssues(entries, thresholds, issues);
  addRoundRobinIssues(entries, snippets, thresholds, issues);

  const instrumentSummaries = buildInstrumentSummaries(entries, issues);
  const report: SampleQualityReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    thresholds,
    totals: {
      instruments: manifests.length,
      samples: manifests.reduce((sum, manifest) => sum + manifest.samples.length, 0),
      files: new Set(entries.map(entry => `${entry.metrics.instrumentId}/${entry.metrics.file}`)).size,
      errors: issues.filter(issue => issue.severity === 'error').length,
      reviewFlags: issues.filter(issue => issue.severity === 'review').length,
    },
    issues: issues.sort((a, b) => (a.severity === b.severity ? a.instrumentId.localeCompare(b.instrumentId) : a.severity === 'error' ? -1 : 1)),
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
  console.log(`  ${errors === 0 ? colors.green : colors.red}Errors:${colors.reset} ${errors}`);
  console.log(`  ${reviewFlags === 0 ? colors.green : colors.yellow}Review flags:${colors.reset} ${reviewFlags}`);
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
