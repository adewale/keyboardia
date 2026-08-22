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
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { INSTRUMENT_GROUPS } from '../src/shared/instrument-catalog';
import { getSourceCalibration } from '../src/audio/source-calibration';
import {
  REVIEW_ISSUE_WEIGHTS,
  scoreInstrument,
  type AuditIssue,
  type InstrumentScore,
} from './instrument-quality-rubric';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(THIS_DIR, '..');
const DEFAULT_SAMPLE_REPORT = path.resolve(APP_DIR, 'test-results/sample-quality/metrics.json');
const DEFAULT_LIVE_REPORT = path.resolve(APP_DIR, 'test-results/audio-output/all-instruments-master-output.json');
const DEFAULT_JSON_REPORT = path.resolve(APP_DIR, 'test-results/instrument-quality/report.json');
const DEFAULT_MARKDOWN_REPORT = path.resolve(APP_DIR, 'test-results/instrument-quality/INSTRUMENT-QUALITY.md');
const MANIFEST_ROOT = path.resolve(APP_DIR, 'public/instruments');

type InstrumentType = 'sample' | 'sampled' | 'synth' | 'tone' | 'advanced';
type EvidenceGrade = 'A' | 'B' | 'C' | 'F';

interface CliOptions {
  sampleReport: string;
  liveReport: string;
  jsonReport: string;
  markdownReport: string;
  requireEvidence: boolean;
}

interface QualityIssue extends AuditIssue {
  instrumentId: string;
  file?: string;
  message?: string;
}

interface SampleInstrumentSummary {
  id: string;
  fileCount: number;
}

interface SampleQualityReport {
  generatedAt: string;
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
}

interface LiveInstrumentResult {
  sampleId: string;
  peak: number;
  rms: number;
}

interface LiveQualityReport {
  silencePeakThreshold: number;
  silenceRmsThreshold: number;
  diagnostics: {
    pageErrors: string[];
    consoleErrors: string[];
  };
  instruments: LiveInstrumentResult[];
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
  LOOP_SEAM_DIFF: 'move or crossfade loop points to reduce the seam discontinuity',
  LOOP_SEAM_CORRELATION: 'move or crossfade loop points to make held notes continuous',
  NEGATIVE_PHASE_CORRELATION: 'correct stereo polarity/phase or use a more mono-compatible source',
  MONO_LOSS: 'repair stereo phase so mono fold-down does not lose material',
  VELOCITY_RMS_INVERSION: 'recalibrate velocity layers so harder strikes do not get quieter',
  NOTE_LEVEL_STEP: 'smooth adjacent-root gain calibration',
  RANGE_OVEREXTENSION: 'add outer roots or narrow the declared playable range',
  TONAL_LOUDNESS_MISMATCH: 'recalibrate canonical delivered loudness',
});

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    sampleReport: DEFAULT_SAMPLE_REPORT,
    liveReport: DEFAULT_LIVE_REPORT,
    jsonReport: DEFAULT_JSON_REPORT,
    markdownReport: DEFAULT_MARKDOWN_REPORT,
    requireEvidence: false,
  };
  const value = (argument: string, index: number): string => {
    const candidate = argv[index + 1];
    if (!candidate || candidate.startsWith('--')) throw new Error(`${argument} requires a path`);
    return path.resolve(process.cwd(), candidate);
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--sample-report') {
      options.sampleReport = value(argument, index++);
    } else if (argument === '--live-report') {
      options.liveReport = value(argument, index++);
    } else if (argument === '--json') {
      options.jsonReport = value(argument, index++);
    } else if (argument === '--markdown') {
      options.markdownReport = value(argument, index++);
    } else if (argument === '--require-evidence') {
      options.requireEvidence = true;
    } else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node --import tsx scripts/audit-instrument-quality.ts [options]');
      console.log('  --sample-report <path>  Decoded sample-quality JSON');
      console.log('  --live-report <path>    99-instrument Chromium output JSON');
      console.log('  --json <path>           Output machine-readable ranking');
      console.log('  --markdown <path>       Output human-readable ranking');
      console.log('  --require-evidence      Fail if either dynamic receipt is absent');
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

function topIssueActions(counts: Readonly<Record<string, number>>): string[] {
  return Object.entries(counts)
    .slice(0, 2)
    .map(([code, count]) => `${ISSUE_ACTIONS[code] ?? `investigate ${code.toLowerCase()}`} (${count})`);
}

function evidenceGrade(
  type: InstrumentType,
  live: LiveInstrumentResult | null,
  sampleReport: SampleQualityReport | null,
  liveSilent: boolean,
): EvidenceGrade {
  if (liveSilent) return 'F';
  if (type === 'sampled' && live && sampleReport) return 'A';
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
): string[] {
  const improvements: string[] = [];
  if (score.components.some(component => component.id === 'live-silence')) {
    improvements.push('repair live preparation/routing before judging timbre');
  }
  if (score.components.some(component => component.id === 'missing-calibration')) {
    improvements.push('add an explicit source-calibration entry');
  }
  if (peakDbfs !== null && peakDbfs > 0) {
    improvements.push(`lower the source trim by at least ${Math.ceil(peakDbfs)} dB, then repeat the mix-capacity capture`);
  }
  if (rmsDeltaDb !== null && Math.abs(rmsDeltaDb) > 18) {
    improvements.push('review role-relative level calibration in an isolated, level-matched capture');
  }
  improvements.push(...topIssueActions(issueCodeCounts));
  if (coverage && coverage.maxRootDistanceSemitones !== null && coverage.maxRootDistanceSemitones > 4) {
    improvements.push(`add roots or narrow the range so repitching stays within 4 semitones (now ${coverage.maxRootDistanceSemitones})`);
  }
  if (coverage && coverage.medianVelocityLayers < targetVelocityLayers) {
    improvements.push(`record/map genuine dynamics to reach ${targetVelocityLayers} velocity layers (median now ${coverage.medianVelocityLayers})`);
  }
  if (coverage && coverage.medianRoundRobins < targetRoundRobins) {
    improvements.push(`add alternate takes to reach ${targetRoundRobins} round robins per mapped layer (median now ${coverage.medianRoundRobins})`);
  }

  // PR #87 documents shared envelope defects that still reproduce on main.
  // They remain recommendations rather than per-preset score points until a
  // rendered release matrix can attribute their audible effect fairly.
  if (type === 'advanced') {
    improvements.push('fix the shared zero-release fallback and move voice cleanup onto the audio clock');
  } else if (type === 'synth') {
    improvements.push('move voice cleanup onto the audio clock and unify release semantics across engines');
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
  return improvements.slice(0, 6);
}

function markdownEscape(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function relativePath(pathname: string): string {
  return path.relative(APP_DIR, pathname) || '.';
}

function renderMarkdown(
  commit: string,
  generatedAt: string,
  instruments: readonly RankedInstrument[],
  sampleReport: SampleQualityReport | null,
  liveReport: LiveQualityReport | null,
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
    `Generated from \`${commit}\` at ${generatedAt}.`,
    '',
    '> This is a technical improvement-priority ranking, not a claim about musical taste. A score of 0 means “no defect detected by these lanes,” not “perfect sound.” Hash-bound waivers remain measured debt; they are not erased merely because CI accepts them.',
    '',
    '## Outcome',
    '',
    `- Catalogue: **${instruments.length} instruments**; live audible: **${liveAudible}/${instruments.length}**.`,
    `- Priority bands: **${byBand.critical} critical**, **${byBand.high} high**, **${byBand.medium} medium**, **${byBand.low} low**, **${byBand.baseline} baseline**.`,
    `- Canonical per-track peaks above 0 dBFS: **${aboveZero}** (the Web Audio graph floats internally, but this is still source-headroom debt).`,
    sampleReport
      ? `- Decoded sample lane: **${sampleReport.totals.files} files / ${sampleReport.totals.waivedIssues} hash-bound review findings / ${sampleReport.totals.errors} unwaived errors / ${sampleReport.totals.reviewFlags} unwaived review flags**.`
      : `- Decoded sample lane: **not run** (expected \`${relativePath(options.sampleReport)}\`).`,
    liveReport
      ? `- Browser lane: **run**, with ${liveReport.diagnostics.pageErrors.length} page errors and ${liveReport.diagnostics.consoleErrors.length} console/readiness errors.`
      : `- Browser lane: **not run** (expected \`${relativePath(options.liveReport)}\`).`,
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
    '- **A** — decoded every shipped source file plus a real Chromium sequencer note.',
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
    'npm run audit:instrument-quality:full',
    '```',
    '',
    'The exact weights, caps, role targets, and claim boundary are documented in `../docs/INSTRUMENT-AUDIO-QUALITY-RUBRIC.md`.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const sampleReport = readJson<SampleQualityReport>(options.sampleReport);
  const liveReport = readJson<LiveQualityReport>(options.liveReport);
  if (options.requireEvidence && (!sampleReport || !liveReport)) {
    throw new Error(
      `Required evidence missing: sample=${sampleReport ? 'present' : options.sampleReport}, live=${liveReport ? 'present' : options.liveReport}`,
    );
  }

  const catalogue = Object.entries(INSTRUMENT_GROUPS).flatMap(([category, group]) =>
    group.instruments.map(instrument => ({
      category,
      id: instrument.id,
      name: instrument.name,
      type: instrument.type as InstrumentType,
    })),
  );
  const categoryRmsMedians = new Map<string, number>();
  for (const category of Object.keys(INSTRUMENT_GROUPS)) {
    const categoryIds = new Set<string>(catalogue.filter(item => item.category === category).map(item => item.id));
    const values = (liveReport?.instruments ?? [])
      .filter(result => categoryIds.has(result.sampleId) && result.rms > 0)
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
    const presetId = item.type === 'sampled' ? item.id.slice('sampled:'.length) : item.id;
    const manifest = item.type === 'sampled' ? manifestFor(presetId) : null;
    const coverage = manifest ? manifestCoverage(manifest) : null;
    const sampleIssues = allSampleIssues.filter(issue => issue.instrumentId === presetId);
    const sampleSummary = sampleSummaryById.get(presetId);
    const live = liveById.get(item.id) ?? null;
    const liveSilent = live !== null && liveReport !== null
      ? live.peak <= liveReport.silencePeakThreshold && live.rms <= liveReport.silenceRmsThreshold
      : false;
    const peakDbfs = live ? db(live.peak) : null;
    const rmsDbfs = live ? db(live.rms) : null;
    const categoryMedian = categoryRmsMedians.get(item.category);
    const rmsDeltaDb = rmsDbfs !== null && Number.isFinite(rmsDbfs) && categoryMedian !== undefined
      ? rmsDbfs - categoryMedian
      : null;
    const targetVelocityLayers = VELOCITY_LAYER_TARGETS[presetId] ?? 0;
    const targetRoundRobins = ROUND_ROBIN_TARGETS[presetId] ?? 0;
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
    });
    const grade = evidenceGrade(item.type, live, sampleReport, liveSilent);
    const codeCounts = issueCounts(sampleIssues);
    const evidence = item.type === 'sampled'
      ? `${coverage?.fileCount ?? 0} decoded files, ${sampleIssues.length} accepted+unwaived findings, live peak ${finiteRound(peakDbfs) ?? 'n/a'} dBFS`
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

  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: APP_DIR, encoding: 'utf8' }).trim();
  const generatedAt = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    generatedAt,
    commit,
    claim: 'technical-improvement-priority-not-listener-preference',
    inputs: {
      sampleReport: sampleReport ? relativePath(options.sampleReport) : null,
      liveReport: liveReport ? relativePath(options.liveReport) : null,
    },
    totals: {
      instruments: instruments.length,
      liveMeasured: instruments.filter(instrument => instrument.live.measured).length,
      liveSilent: instruments.filter(instrument => instrument.live.silent).length,
      sampledDecoded: instruments.filter(instrument => instrument.evidenceGrade === 'A').length,
    },
    instruments,
  };
  const markdown = renderMarkdown(commit, generatedAt, instruments, sampleReport, liveReport, options);

  fs.mkdirSync(path.dirname(options.jsonReport), { recursive: true });
  fs.mkdirSync(path.dirname(options.markdownReport), { recursive: true });
  fs.writeFileSync(options.jsonReport, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(options.markdownReport, markdown);

  console.log(markdown);
  console.log(`JSON report: ${options.jsonReport}`);
  console.log(`Markdown report: ${options.markdownReport}`);
}

main();
