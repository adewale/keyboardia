#!/usr/bin/env npx tsx
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { coverageRegressionBlockers, unresolvedSourceAuditIssues } from './sample-pipeline-cli';
import { parseSampleRecipe } from './sample-pipeline-core';
import { canonicalRecipeSha256 } from './sample-pipeline-runner';

const MAX_DECODED_PCM_BYTES = 96 * 1024 * 1024;
const EVIDENCE_FILENAMES = [
  'build-report.json',
  'objective-audit.json',
  'browser-decode.json',
  'runtime-contract.json',
  'before-after.json',
  'source-master-audit.json',
] as const;

interface PipelineEvidenceShape {
  instrumentId: string;
  buildReportSha256: string;
  outputHashes: string[];
  coverage: {
    mappings: number;
    roots: number;
    largestRootGap: number;
    worstShiftSemitones: number;
    meanShiftSemitones: number;
    completeVelocityRoots: number;
    velocityRootCompleteness: number;
    maxRoundRobins: number;
    orphanFiles: number;
    payloadBytes: number;
  };
  quality: { hardErrors: number; reviewFlags: number };
  runtime: { eventsChecked: number; silentEvents: number; maxPitchShiftSemitones: number; deterministicRoundRobinGroups: number };
}

interface BuildReport {
  generatedAt: string;
  recipeSha256: string;
  sourceRevision: string;
  outputs: Array<{ file: string; sha256: string; sizeBytes: number }>;
  delivery: { sampleRate: number };
  manifestSha256: string;
}

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(filename, 'utf8')) as T;
}

function sha256(filename: string): string {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function assertEvidence(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Candidate evidence failed closed: ${message}`);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function captureCandidateBaseline(instrumentId: string, appRoot = process.cwd()): Record<string, unknown> {
  const recipePath = path.join(appRoot, 'sample-pipeline', 'recipes', `${instrumentId}.json`);
  const pipelineRoot = path.join(appRoot, 'public', '__sample-pipeline', instrumentId);
  const candidateRoot = path.join(pipelineRoot, 'candidate');
  const buildPath = path.join(candidateRoot, 'build-report.json');
  const manifestPath = path.join(candidateRoot, 'manifest.json');
  const objectivePath = path.join(pipelineRoot, 'reports', 'objective-audit.json');
  const browserPath = path.join(pipelineRoot, 'reports', 'browser-decode.json');
  const runtimePath = path.join(pipelineRoot, 'reports', 'runtime-contract.json');
  const comparisonPath = path.join(pipelineRoot, 'reports', 'before-after.json');
  const sourceAuditPath = path.join(pipelineRoot, 'reports', 'source-master-audit.json');
  for (const filename of [recipePath, manifestPath, buildPath, objectivePath, browserPath, runtimePath, comparisonPath, sourceAuditPath]) {
    if (!fs.existsSync(filename)) throw new Error(`Decision evidence is missing: ${filename}`);
  }

  const parsed = parseSampleRecipe(readJson(recipePath));
  if (!parsed.ok) throw new Error(`Committed recipe is invalid:\n- ${parsed.errors.join('\n- ')}`);
  const recipe = parsed.value.recipe;
  assertEvidence(recipe.instrument.id === instrumentId, `recipe ID ${recipe.instrument.id} does not match ${instrumentId}`);
  const build = readJson<BuildReport>(buildPath);
  const objective = readJson<{
    instrumentId: string;
    hardErrors: number;
    reviewFlags: number;
    issues: Array<{ severity: string; code: string }>;
    entries: Array<{ file: string; metrics: { peakDb: number; channels: number; sampleRate: number; durationSec: number } }>;
  }>(objectivePath);
  const browser = readJson<{
    chromium: boolean;
    webkit: boolean;
    entries: Array<{ browser: 'chromium' | 'webkit'; file: string; ok: boolean }>;
  }>(browserPath);
  const runtime = readJson<{ before: PipelineEvidenceShape['runtime']; after: PipelineEvidenceShape['runtime'] }>(runtimePath);
  const comparison = readJson<{ before: PipelineEvidenceShape; after: PipelineEvidenceShape }>(comparisonPath);
  const sourceAudit = readJson<Parameters<typeof unresolvedSourceAuditIssues>[1]>(sourceAuditPath);
  const candidate = comparison.after;
  const current = comparison.before;
  const outputFiles = build.outputs.map(output => output.file);
  assertEvidence(build.sourceRevision === recipe.sourceRevision, 'build source revision does not match recipe');
  assertEvidence(build.recipeSha256 === canonicalRecipeSha256(recipe), 'build recipe hash does not match parsed canonical recipe');
  assertEvidence(build.manifestSha256 === sha256(manifestPath), 'build manifest hash does not match candidate manifest');
  assertEvidence(build.outputs.length > 0 && new Set(outputFiles).size === build.outputs.length, 'build output set is empty or duplicated');
  for (const output of build.outputs) {
    const filename = path.join(candidateRoot, output.file);
    assertEvidence(fs.existsSync(filename), `delivery output is missing: ${output.file}`);
    assertEvidence(fs.statSync(filename).size === output.sizeBytes, `delivery size mismatch: ${output.file}`);
    assertEvidence(sha256(filename) === output.sha256, `delivery hash mismatch: ${output.file}`);
  }
  const unresolvedSourceIssues = unresolvedSourceAuditIssues(recipe, sourceAudit);
  assertEvidence(unresolvedSourceIssues.length === 0, `lossless source audit has ${unresolvedSourceIssues.length} unremediated hard errors`);
  assertEvidence(objective.instrumentId === instrumentId && objective.hardErrors === 0, `objective audit has ${objective.hardErrors} hard errors`);
  assertEvidence(objective.issues.filter(issue => issue.severity === 'review').length === objective.reviewFlags, 'objective review count is internally inconsistent');
  assertEvidence(sorted(objective.entries.map(entry => entry.file)).join('\n') === sorted(outputFiles).join('\n'), 'objective audit does not cover each delivery file exactly once');
  assertEvidence(browser.chromium && browser.webkit, 'Chromium and WebKit summary gates must both pass');
  for (const browserName of ['chromium', 'webkit'] as const) {
    const entries = browser.entries.filter(entry => entry.browser === browserName);
    assertEvidence(entries.every(entry => entry.ok), `${browserName} contains a failed decode`);
    assertEvidence(sorted(entries.map(entry => entry.file)).join('\n') === sorted(outputFiles).join('\n'), `${browserName} does not decode each delivery file exactly once`);
  }
  assertEvidence(runtime.after.eventsChecked > 0 && runtime.after.silentEvents === 0, 'runtime contract has no events or contains silence');
  assertEvidence(candidate.instrumentId === instrumentId, 'before/after candidate instrument ID mismatch');
  assertEvidence(candidate.buildReportSha256 === sha256(buildPath), 'before/after evidence is not bound to the build report');
  assertEvidence(sorted(candidate.outputHashes).join('\n') === sorted(build.outputs.map(output => output.sha256)).join('\n'), 'before/after output hashes differ from build outputs');

  const reviewCodes: Record<string, number> = {};
  for (const issue of objective.issues.filter(issue => issue.severity === 'review')) {
    reviewCodes[issue.code] = (reviewCodes[issue.code] ?? 0) + 1;
  }
  const maxDecodedPeakDb = Math.max(...objective.entries.map(entry => entry.metrics.peakDb));
  const decodedPcmBytes = Math.ceil(objective.entries.reduce((sum, entry) => sum
    + entry.metrics.durationSec * entry.metrics.sampleRate * entry.metrics.channels * Float32Array.BYTES_PER_ELEMENT, 0));
  assertEvidence(decodedPcmBytes <= MAX_DECODED_PCM_BYTES, `decoded PCM estimate ${decodedPcmBytes} exceeds ${MAX_DECODED_PCM_BYTES}`);
  const channels = [...new Set(objective.entries.map(entry => entry.metrics.channels))].sort((a, b) => a - b);
  const sampleRates = [...new Set(objective.entries.map(entry => entry.metrics.sampleRate))].sort((a, b) => a - b);
  const chromiumDecoded = browser.entries.filter(entry => entry.browser === 'chromium' && entry.ok).length;
  const webkitDecoded = browser.entries.filter(entry => entry.browser === 'webkit' && entry.ok).length;
  const currentManifestPath = path.join(appRoot, recipe.evidence.currentInstrumentDir as string, 'manifest.json');
  const currentManifest = readJson<{ playableRange?: { min: number; max: number } }>(currentManifestPath);
  const preliminaryBlockers = coverageRegressionBlockers(
    current.coverage,
    candidate.coverage,
    currentManifest.playableRange,
    recipe.instrument.playableRange,
  );
  const status = preliminaryBlockers.length > 0 ? 'blocked' : 'decision-ready';

  return {
    version: 1,
    instrumentId,
    capturedAt: build.generatedAt,
    sourceRevision: recipe.sourceRevision,
    evidence: Object.fromEntries(EVIDENCE_FILENAMES.map(filename => [
      filename.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()).replace('.json', ''),
      `sample-pipeline/evidence/${instrumentId}/${filename}`,
    ])),
    current: {
      ...current.coverage,
      playableRange: currentManifest.playableRange,
      hardErrors: current.quality.hardErrors,
      reviewFlags: current.quality.reviewFlags,
      runtimeEventsChecked: runtime.before.eventsChecked,
      runtimeSilentEvents: runtime.before.silentEvents,
    },
    candidate: {
      recipeFileSha256: sha256(recipePath),
      recipeCanonicalSha256: build.recipeSha256,
      buildReportSha256: sha256(buildPath),
      objectiveReportSha256: sha256(objectivePath),
      browserReportSha256: sha256(browserPath),
      runtimeReportSha256: sha256(runtimePath),
      comparisonReportSha256: sha256(comparisonPath),
      sourceMasterReportSha256: sha256(sourceAuditPath),
      ...candidate.coverage,
      playableRange: recipe.instrument.playableRange,
      deliveryFiles: build.outputs.length,
      decodedPcmBytes,
      payloadBytes: build.outputs.reduce((sum, output) => sum + output.sizeBytes, 0),
      hardErrors: objective.hardErrors,
      reviewFlags: objective.reviewFlags,
      reviewCodes,
      maxDecodedPeakDb,
      runtimeEventsChecked: runtime.after.eventsChecked,
      runtimeSilentEvents: runtime.after.silentEvents,
      chromiumDecoded,
      webkitDecoded,
      sampleRates,
      channels,
    },
    absoluteDelta: {
      mappings: candidate.coverage.mappings - current.coverage.mappings,
      roots: candidate.coverage.roots - current.coverage.roots,
      largestRootGap: candidate.coverage.largestRootGap - current.coverage.largestRootGap,
      worstShiftSemitones: candidate.coverage.worstShiftSemitones - current.coverage.worstShiftSemitones,
      meanShiftSemitones: candidate.coverage.meanShiftSemitones - current.coverage.meanShiftSemitones,
      completeVelocityRoots: candidate.coverage.completeVelocityRoots - current.coverage.completeVelocityRoots,
      maxRoundRobins: candidate.coverage.maxRoundRobins - current.coverage.maxRoundRobins,
      payloadBytes: candidate.coverage.payloadBytes - current.coverage.payloadBytes,
    },
    status,
    preliminaryBlockers,
    promotionBlockedBy: [
      ...preliminaryBlockers,
      'Complete the seeded blind low/mid/high comparison.',
      'Run the actual-runtime dynamics, repetition, held-release, stereo/mono, and phrase protocol.',
      `Disposition all ${objective.reviewFlags} exact review findings against the hash-bound candidate.`,
      'Provide an accepted human decision matching the exact build-report and output hashes.',
    ],
    notes: ['Generated from exact Pipeline v2 reports. Compact reports are committed; candidate audio remains ignored and production is unchanged.'],
  };
}

export function persistCandidateEvidence(instrumentId: string, appRoot = process.cwd()): void {
  const pipelineRoot = path.join(appRoot, 'public', '__sample-pipeline', instrumentId);
  const sources: Record<(typeof EVIDENCE_FILENAMES)[number], string> = {
    'build-report.json': path.join(pipelineRoot, 'candidate', 'build-report.json'),
    'objective-audit.json': path.join(pipelineRoot, 'reports', 'objective-audit.json'),
    'browser-decode.json': path.join(pipelineRoot, 'reports', 'browser-decode.json'),
    'runtime-contract.json': path.join(pipelineRoot, 'reports', 'runtime-contract.json'),
    'before-after.json': path.join(pipelineRoot, 'reports', 'before-after.json'),
    'source-master-audit.json': path.join(pipelineRoot, 'reports', 'source-master-audit.json'),
  };
  const destination = path.join(appRoot, 'sample-pipeline', 'evidence', instrumentId);
  const staging = `${destination}.tmp-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const filename of EVIDENCE_FILENAMES) fs.copyFileSync(sources[filename], path.join(staging, filename));
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(staging, destination);
}

function main(argv = process.argv.slice(2)): void {
  const requested = argv.filter(argument => !argument.startsWith('--'));
  const candidateRoot = path.resolve('public/__sample-pipeline');
  const instruments = requested.length > 0
    ? requested
    : fs.readdirSync(candidateRoot).filter(instrumentId => fs.existsSync(path.join(candidateRoot, instrumentId, 'candidate', 'build-report.json'))).sort();
  const outputRoot = path.resolve('sample-pipeline/baselines');
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const instrumentId of instruments) {
    const baseline = captureCandidateBaseline(instrumentId);
    persistCandidateEvidence(instrumentId);
    const output = path.join(outputRoot, `${instrumentId}.json`);
    fs.writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Wrote ${output}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
