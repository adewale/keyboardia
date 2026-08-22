#!/usr/bin/env node
/**
 * Reconstruct a same-evaluator instrument-quality comparison.
 *
 * The control is created from an immutable production base plus a narrow,
 * declared evaluator overlay. Both the control and candidate are captured in
 * fresh local shared clones. The resulting directory retains the raw decoded,
 * live-browser, and ranking receipts used by the comparison.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CONTROL_BASE_REF =
  '58264dd5ae274f63b1cd80b72aa823b76b21f28b';

/**
 * Only measurement, scoring, and evidence-production files belong here.
 * Production audio assets, manifests, runtime DSP, calibration, catalogue,
 * dependencies, and build configuration deliberately remain at the control
 * base revision.
 */
export const CONTROL_EVALUATOR_OVERLAY_PATHS = Object.freeze([
  'app/scripts/audit-instrument-quality.ts',
  'app/scripts/instrument-quality-provenance.ts',
  'app/scripts/instrument-quality-rubric.ts',
  'app/scripts/instrument-quality-profiles.ts',
  'app/scripts/instrument-quality-matrix.ts',
  'app/scripts/instrument-quality-matrix-cli.ts',
  'app/scripts/capture-instrument-quality-smoke.ts',
  'app/scripts/instrument-quality-live-receipt.ts',
  'app/scripts/sample-quality-core.ts',
  'app/scripts/sample-quality-baseline-core.ts',
  'app/scripts/sample-velocity-core.ts',
  'app/scripts/validate-sample-quality.ts',
  'app/scripts/bind-sample-quality-dispositions.ts',
  'app/e2e/all-instruments-master-output.spec.ts',
  'app/e2e/dry-pcm-browser-adapter.ts',
  // Evaluator-only measurement primitive; it is not imported by production.
  'app/src/test/audio-measures.ts',
  // Compatibility exception: the hardened decoded evaluator needs the newer
  // onset API. Old manifests/call sites retain the base revision's default
  // 30 ms semantics, and the generated plan records this exception visibly.
  'app/src/audio/sample-onset.ts',
] as const);

export const CONTROL_OVERLAY_EXCEPTIONS = Object.freeze([
  'app/src/test/audio-measures.ts',
  'app/src/audio/sample-onset.ts',
] as const);

export const CONTROL_SUBJECT_PATH_EXCLUSIONS = Object.freeze([
  'app/public/',
  'app/src/audio/',
  'app/src/components/',
  'app/src/shared/',
  'app/src/types.ts',
  'app/package.json',
  'app/package-lock.json',
  'app/playwright.config.ts',
  'app/vite.config.ts',
] as const);

const FULL_COMMIT = /^[a-f0-9]{40}$/;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const APP_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REPOSITORY_ROOT = path.resolve(APP_ROOT, '..');

interface CliOptions {
  baseRef: string;
  evaluatorRef: string;
  outputDir: string | null;
  planOnly: boolean;
  keepTemp: boolean;
}

export interface OverlayPlanEntry {
  path: string;
  evaluatorBlobSha256: string;
  compatibilityException: boolean;
}

export interface ReconstructionPlan {
  schemaVersion: 1;
  controlBaseCommit: string;
  candidateAndEvaluatorCommit: string;
  overlay: OverlayPlanEntry[];
  preservedSubjectPaths: readonly string[];
  exceptions: readonly string[];
}

interface AuditInstrument {
  id: string;
  score: number;
  band: 'critical' | 'high' | 'medium' | 'low' | 'baseline';
  live: { measured: boolean; silent: boolean; peakDbfs: number | null };
}

interface AuditReport {
  schemaVersion: number;
  commit: string;
  provenance: {
    evaluatorCommit: string;
    subjectCommit: string;
    evaluatorDirty: boolean;
  };
  inputs: {
    sampleReport: { sha256: string } | null;
    liveReport: { sha256: string } | null;
  };
  totals: { instruments: number; liveMeasured: number; liveSilent: number };
  instruments: AuditInstrument[];
}

interface SampleIssue {
  code: string;
}

interface SampleReport {
  version: number;
  subjectCommit: string;
  subjectTreeClean: boolean;
  evaluatorBundleSha256: string;
  baselineSha256: string | null;
  totals: {
    instruments: number;
    files: number;
    errors: number;
    reviewFlags: number;
    waivedIssues: number;
  };
  issues: SampleIssue[];
  waivedIssues: Array<{ issue: SampleIssue }>;
}

interface LiveReport {
  schemaVersion: number;
  subjectCommit: string;
  instruments: Array<{ sampleId: string; peak: number; rms: number }>;
}

export interface QualitySummary {
  catalogueInstruments: number;
  audibleInstruments: number;
  repairPriorityPoints: number;
  bands: Record<AuditInstrument['band'], number>;
  nonzeroRepairPriorityScores: number;
  canonicalLivePeaksAboveZeroDbfs: number;
  decodedFindings: number;
  decodedIssueCodes: Record<string, number>;
  nonzeroInstruments: Record<string, number>;
}

interface ArtifactSet {
  root: string;
  sample: string;
  live: string;
  ranking: string;
  rankingMarkdown: string;
  baseline: string;
}

interface ArtifactReference {
  path: string;
  sha256: string;
}

interface ArtifactHashManifest {
  sampleQuality: ArtifactReference;
  liveMasterOutput: ArtifactReference;
  instrumentQuality: ArtifactReference;
  instrumentQualityMarkdown: ArtifactReference;
  sampleQualityBaseline: ArtifactReference;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    baseRef: DEFAULT_CONTROL_BASE_REF,
    evaluatorRef: 'HEAD',
    outputDir: null,
    planOnly: false,
    keepTemp: false,
  };
  const valueAfter = (argument: string, index: number): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--base-ref') {
      options.baseRef = valueAfter(argument, index++);
    } else if (argument === '--evaluator-ref' || argument === '--candidate-ref') {
      options.evaluatorRef = valueAfter(argument, index++);
    } else if (argument === '--output-dir') {
      options.outputDir = path.resolve(valueAfter(argument, index++));
    } else if (argument === '--plan') {
      options.planOnly = true;
    } else if (argument === '--keep-temp') {
      options.keepTemp = true;
    } else if (argument === '--help' || argument === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.planOnly && options.outputDir === null) {
    throw new Error('--output-dir is required unless --plan is used');
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage:
  npm run audit:instrument-quality:control -- --output-dir <new-directory> [options]

Options:
  --base-ref <ref>       Immutable production control (default: ${DEFAULT_CONTROL_BASE_REF})
  --evaluator-ref <ref>  Candidate and evaluator lane (default: HEAD)
  --output-dir <path>    New or empty durable artifact directory (required to run)
  --plan                 Print the resolved overlay plan without cloning or capturing
  --keep-temp            Retain the exact temporary clones for diagnosis
  --help                 Show this help

The command uses local Git objects and the current checkout's installed
node_modules/Playwright browser. It does not fetch, install, or push anything.`);
}

function gitOutput(args: readonly string[], cwd = REPOSITORY_ROOT): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();
}

function gitBuffer(args: readonly string[], cwd = REPOSITORY_ROOT): Buffer {
  return execFileSync('git', [...args], { cwd, encoding: null });
}

function resolveCommit(ref: string, label: string): string {
  let commit: string;
  try {
    commit = gitOutput(['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    throw new Error(`${label} is not a locally available Git commit: ${ref}`);
  }
  if (!FULL_COMMIT.test(commit)) throw new Error(`${label} did not resolve to a full SHA-1 commit`);
  return commit;
}

function assertFrozenEvaluatorCheckout(evaluatorCommit: string): void {
  const head = gitOutput(['rev-parse', 'HEAD']);
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all']);
  if (head !== evaluatorCommit || status.length > 0) {
    throw new Error(
      'Full reconstruction requires the evaluator/candidate commit checked out '
      + `in a clean tree; HEAD=${head}, evaluator=${evaluatorCommit}`
      + `${status ? `, changes:\n${status}` : ''}. Use --plan while work is in flight.`,
    );
  }
}

function sha256Buffer(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(filename: string): string {
  return sha256Buffer(fs.readFileSync(filename));
}

function excludedSubjectPath(relativePath: string): string | null {
  return CONTROL_SUBJECT_PATH_EXCLUSIONS.find(exclusion =>
    exclusion.endsWith('/')
      ? relativePath.startsWith(exclusion)
      : relativePath === exclusion
  ) ?? null;
}

export function assertControlOverlayPaths(paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const relativePath of paths) {
    if (path.posix.isAbsolute(relativePath) || relativePath.includes('..')) {
      throw new Error(`Control overlay path is not a safe repository-relative path: ${relativePath}`);
    }
    if (seen.has(relativePath)) throw new Error(`Duplicate control overlay path: ${relativePath}`);
    seen.add(relativePath);
    const exclusion = excludedSubjectPath(relativePath);
    if (exclusion !== null && !CONTROL_OVERLAY_EXCEPTIONS.includes(
      relativePath as typeof CONTROL_OVERLAY_EXCEPTIONS[number],
    )) {
      throw new Error(
        `Control overlay ${relativePath} changes preserved subject path ${exclusion}`,
      );
    }
  }
}

export function buildReconstructionPlan(
  controlBaseCommit: string,
  candidateAndEvaluatorCommit: string,
  readEvaluatorBlob: (relativePath: string) => Buffer,
): ReconstructionPlan {
  assertControlOverlayPaths(CONTROL_EVALUATOR_OVERLAY_PATHS);
  return {
    schemaVersion: 1,
    controlBaseCommit,
    candidateAndEvaluatorCommit,
    overlay: CONTROL_EVALUATOR_OVERLAY_PATHS.map(relativePath => ({
      path: relativePath,
      evaluatorBlobSha256: sha256Buffer(readEvaluatorBlob(relativePath)),
      compatibilityException: CONTROL_OVERLAY_EXCEPTIONS.includes(
        relativePath as typeof CONTROL_OVERLAY_EXCEPTIONS[number],
      ),
    })),
    preservedSubjectPaths: CONTROL_SUBJECT_PATH_EXCLUSIONS,
    exceptions: [
      'The compatibility control overlays src/audio/sample-onset.ts because the hardened decoded evaluator requires its newer API. Base manifests and runtime call sites retain their original defaults; this is not represented as literal base-commit provenance.',
      'The compatibility control overlays src/test/audio-measures.ts; this is test-only measurement code, not delivered runtime DSP.',
      'The current checkout\'s node_modules and Playwright browser installation are reused. Runtime package/lock/config files remain those committed in each subject clone.',
      'The live lane is a deterministic technical capture in one Chromium/runtime environment, not a level-matched listening result or complete dry-PCM matrix.',
    ],
  };
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

export function summarizeQualityArtifacts(
  audit: AuditReport,
  sample: SampleReport,
  live: LiveReport,
): QualitySummary {
  const expectedSubject = audit.provenance.subjectCommit;
  if (
    audit.commit !== expectedSubject
    || sample.subjectCommit !== expectedSubject
    || live.subjectCommit !== expectedSubject
  ) {
    throw new Error('Audit, decoded, and live receipts do not bind the same subject commit');
  }
  if (audit.provenance.evaluatorDirty || sample.subjectTreeClean !== true) {
    throw new Error('Controlled comparison refuses dirty evaluator or subject receipts');
  }
  if (audit.totals.instruments !== audit.instruments.length) {
    throw new Error('Audit instrument total differs from the ranked rows');
  }
  if (audit.totals.liveMeasured !== live.instruments.length) {
    throw new Error('Audit live total differs from the raw live receipt');
  }
  if (audit.totals.liveSilent !== audit.instruments.filter(item => item.live.silent).length) {
    throw new Error('Audit live-silence total differs from the ranked rows');
  }

  const bands: QualitySummary['bands'] = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    baseline: 0,
  };
  const nonzeroInstruments: Record<string, number> = {};
  for (const instrument of audit.instruments) {
    bands[instrument.band] += 1;
    if (instrument.score > 0) nonzeroInstruments[instrument.id] = instrument.score;
  }
  const allDecodedIssues = [
    ...sample.issues,
    ...sample.waivedIssues.map(entry => entry.issue),
  ];
  const decodedIssueCodes: Record<string, number> = {};
  for (const issue of allDecodedIssues) {
    decodedIssueCodes[issue.code] = (decodedIssueCodes[issue.code] ?? 0) + 1;
  }

  return {
    catalogueInstruments: audit.totals.instruments,
    audibleInstruments: audit.totals.liveMeasured - audit.totals.liveSilent,
    repairPriorityPoints: round(
      audit.instruments.reduce((total, instrument) => total + instrument.score, 0),
    ),
    bands,
    nonzeroRepairPriorityScores: Object.keys(nonzeroInstruments).length,
    canonicalLivePeaksAboveZeroDbfs: audit.instruments.filter(
      instrument => instrument.live.peakDbfs !== null && instrument.live.peakDbfs > 0,
    ).length,
    decodedFindings: allDecodedIssues.length,
    decodedIssueCodes: Object.fromEntries(
      Object.entries(decodedIssueCodes).sort(([left], [right]) => left.localeCompare(right)),
    ),
    nonzeroInstruments: Object.fromEntries(
      Object.entries(nonzeroInstruments).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function compareQualitySummaries(
  control: QualitySummary,
  candidate: QualitySummary,
): Record<string, unknown> {
  const issueCodes = new Set([
    ...Object.keys(control.decodedIssueCodes),
    ...Object.keys(candidate.decodedIssueCodes),
  ]);
  const issueDelta = Object.fromEntries(
    [...issueCodes].sort().map(code => [
      code,
      (candidate.decodedIssueCodes[code] ?? 0) - (control.decodedIssueCodes[code] ?? 0),
    ]).filter(([, value]) => value !== 0),
  );
  return {
    repairPriorityPoints: round(
      candidate.repairPriorityPoints - control.repairPriorityPoints,
    ),
    repairPriorityPercent: control.repairPriorityPoints === 0
      ? null
      : round(
        (candidate.repairPriorityPoints - control.repairPriorityPoints)
          * 100 / control.repairPriorityPoints,
      ),
    decodedFindings: candidate.decodedFindings - control.decodedFindings,
    decodedFindingsPercent: control.decodedFindings === 0
      ? null
      : round(
        (candidate.decodedFindings - control.decodedFindings)
          * 100 / control.decodedFindings,
      ),
    nonzeroRepairPriorityScores:
      candidate.nonzeroRepairPriorityScores - control.nonzeroRepairPriorityScores,
    bands: Object.fromEntries(
      (Object.keys(control.bands) as Array<keyof QualitySummary['bands']>).map(band => [
        band,
        candidate.bands[band] - control.bands[band],
      ]),
    ),
    canonicalLivePeaksAboveZeroDbfs:
      candidate.canonicalLivePeaksAboveZeroDbfs
      - control.canonicalLivePeaksAboveZeroDbfs,
    decodedIssueCodes: issueDelta,
  };
}

function ensureOutputDirectory(outputDir: string): void {
  if (fs.existsSync(outputDir)) {
    if (!fs.statSync(outputDir).isDirectory()) {
      throw new Error(`Output path is not a directory: ${outputDir}`);
    }
    if (fs.readdirSync(outputDir).length > 0) {
      throw new Error(`Output directory must be new or empty: ${outputDir}`);
    }
  } else {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

function run(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  acceptedStatuses: readonly number[] = [0],
): void {
  console.log(`\n[control-reconstruction] ${executable} ${args.join(' ')}`);
  const result = spawnSync(executable, [...args], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status === null || !acceptedStatuses.includes(result.status)) {
    throw new Error(
      `${executable} exited with ${result.status ?? `signal ${result.signal ?? 'unknown'}`}`,
    );
  }
}

function prepareClone(
  cloneRoot: string,
  commit: string,
  sourceNodeModules: string,
): void {
  run('git', ['clone', '--shared', '--no-checkout', '--quiet', REPOSITORY_ROOT, cloneRoot], REPOSITORY_ROOT);
  run('git', ['checkout', '--detach', commit], cloneRoot);
  fs.appendFileSync(
    path.join(cloneRoot, '.git', 'info', 'exclude'),
    '\napp/node_modules\n',
  );
  fs.symlinkSync(sourceNodeModules, path.join(cloneRoot, 'app', 'node_modules'), 'dir');
}

function overlayEvaluator(
  cloneRoot: string,
  evaluatorCommit: string,
  plan: ReconstructionPlan,
): void {
  for (const entry of plan.overlay) {
    const source = gitBuffer(['show', `${evaluatorCommit}:${entry.path}`]);
    if (sha256Buffer(source) !== entry.evaluatorBlobSha256) {
      throw new Error(`Evaluator blob changed while reconstructing: ${entry.path}`);
    }
    const destination = path.join(cloneRoot, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, source);
  }
}

function commitEnvironment(sourceCommit: string, secondsAfter = 0): NodeJS.ProcessEnv {
  const sourceDate = gitOutput(['show', '-s', '--format=%cI', sourceCommit]);
  const timestamp = new Date(sourceDate);
  timestamp.setSeconds(timestamp.getSeconds() + secondsAfter);
  const date = timestamp.toISOString();
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'Keyboardia Audio Control Reconstructor',
    GIT_AUTHOR_EMAIL: 'audio-control@keyboardia.invalid',
    GIT_COMMITTER_NAME: 'Keyboardia Audio Control Reconstructor',
    GIT_COMMITTER_EMAIL: 'audio-control@keyboardia.invalid',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

function commitAll(cloneRoot: string, message: string, env: NodeJS.ProcessEnv): string {
  run('git', ['add', '--all'], cloneRoot, env);
  run('git', ['commit', '--quiet', '-m', message], cloneRoot, env);
  return gitOutput(['rev-parse', 'HEAD'], cloneRoot);
}

function assertClean(cloneRoot: string, label: string): void {
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all'], cloneRoot);
  if (status) throw new Error(`${label} clone is not clean:\n${status}`);
}

function artifactSet(outputDir: string, lane: 'control' | 'candidate'): ArtifactSet {
  const root = path.join(outputDir, lane);
  fs.mkdirSync(root, { recursive: true });
  return {
    root,
    sample: path.join(root, 'sample-quality.json'),
    live: path.join(root, 'live-master-output.json'),
    ranking: path.join(root, 'instrument-quality.json'),
    rankingMarkdown: path.join(root, 'INSTRUMENT-QUALITY.md'),
    baseline: path.join(root, 'sample-quality-baseline.json'),
  };
}

function captureLane(
  cloneRoot: string,
  subjectCommit: string,
  evaluatorCommit: string,
  artifacts: ArtifactSet,
): void {
  const appRoot = path.join(cloneRoot, 'app');
  assertClean(cloneRoot, path.basename(artifacts.root));
  run('node', [
    '--import', 'tsx', 'scripts/validate-sample-quality.ts', '--strict',
    '--json', artifacts.sample,
    '--markdown', path.join(artifacts.root, 'SAMPLE-QUALITY.md'),
  ], appRoot);
  assertClean(cloneRoot, path.basename(artifacts.root));

  const playwrightOutput = path.join(artifacts.root, 'playwright');
  run('npx', [
    'playwright', 'test', 'e2e/all-instruments-master-output.spec.ts',
    '--project=chromium', '--workers=1', '--no-deps',
  ], appRoot, {
    ...process.env,
    USE_MOCK_API: '1',
    E2E_SERIAL: '1',
    KEYBOARDIA_INSTRUMENT_QUALITY_REPORT_DIR: artifacts.root,
    PLAYWRIGHT_OUTPUT_DIR: path.join(playwrightOutput, 'test-results'),
    PLAYWRIGHT_HTML_REPORT: path.join(playwrightOutput, 'html'),
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(playwrightOutput, 'results.json'),
  });
  assertClean(cloneRoot, path.basename(artifacts.root));

  run('node', [
    '--import', 'tsx', 'scripts/audit-instrument-quality.ts',
    '--require-evidence',
    '--sample-report', artifacts.sample,
    '--live-report', artifacts.live,
    '--matrix-report', path.join(artifacts.root, 'complete-matrix-not-supplied.json'),
    '--json', artifacts.ranking,
    '--markdown', artifacts.rankingMarkdown,
    '--subject-commit', subjectCommit,
    '--evaluator-commit', evaluatorCommit,
  ], appRoot);
  assertClean(cloneRoot, path.basename(artifacts.root));

  fs.copyFileSync(
    path.join(appRoot, 'scripts', 'sample-quality-baseline.json'),
    artifacts.baseline,
  );
}

function bindControlBaseline(
  cloneRoot: string,
  evaluatorCommit: string,
  controlArtifacts: ArtifactSet,
): string {
  const appRoot = path.join(cloneRoot, 'app');
  const unboundJson = path.join(controlArtifacts.root, 'sample-quality-unbound.json');
  run('node', [
    '--import', 'tsx', 'scripts/validate-sample-quality.ts', '--no-baseline',
    '--json', unboundJson,
    '--markdown', path.join(controlArtifacts.root, 'SAMPLE-QUALITY-UNBOUND.md'),
  ], appRoot, process.env, [0, 1]);
  if (!fs.existsSync(unboundJson)) {
    throw new Error('Unbound sample-quality evaluator did not emit its raw receipt');
  }
  run('node', [
    '--import', 'tsx', 'scripts/bind-sample-quality-dispositions.ts', unboundJson,
  ], appRoot);
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all'], cloneRoot);
  if (!isExpectedControlBaselineBindingStatus(status)) {
    throw new Error(`Baseline binding changed unexpected control paths:\n${status || '(none)'}`);
  }
  return commitAll(
    cloneRoot,
    'chore: bind reconstructed control dispositions',
    commitEnvironment(evaluatorCommit, 1),
  );
}

export function isExpectedControlBaselineBindingStatus(status: string): boolean {
  // gitOutput() trims the command result, so porcelain's leading worktree
  // status column is intentionally absent here. The remaining single `M`
  // still proves the binder changed exactly one unstaged file.
  return status === 'M app/scripts/sample-quality-baseline.json';
}

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(filename, 'utf8')) as T;
}

function validateAndSummarize(artifacts: ArtifactSet): QualitySummary {
  const audit = readJson<AuditReport>(artifacts.ranking);
  const sample = readJson<SampleReport>(artifacts.sample);
  const live = readJson<LiveReport>(artifacts.live);
  if (audit.inputs.sampleReport?.sha256 !== sha256File(artifacts.sample)) {
    throw new Error(`${path.basename(artifacts.root)} ranking does not bind its decoded receipt`);
  }
  if (audit.inputs.liveReport?.sha256 !== sha256File(artifacts.live)) {
    throw new Error(`${path.basename(artifacts.root)} ranking does not bind its live receipt`);
  }
  if (sample.baselineSha256 !== sha256File(artifacts.baseline)) {
    throw new Error(`${path.basename(artifacts.root)} decoded receipt does not bind its baseline`);
  }
  return summarizeQualityArtifacts(audit, sample, live);
}

function artifactReference(outputDir: string, filename: string): ArtifactReference {
  return {
    path: path.relative(outputDir, filename).replaceAll(path.sep, '/'),
    sha256: sha256File(filename),
  };
}

function artifactHashes(outputDir: string, artifacts: ArtifactSet): ArtifactHashManifest {
  return {
    sampleQuality: artifactReference(outputDir, artifacts.sample),
    liveMasterOutput: artifactReference(outputDir, artifacts.live),
    instrumentQuality: artifactReference(outputDir, artifacts.ranking),
    instrumentQualityMarkdown: artifactReference(outputDir, artifacts.rankingMarkdown),
    sampleQualityBaseline: artifactReference(outputDir, artifacts.baseline),
  };
}

function safeRemoveTemporaryRoot(tempRoot: string): void {
  const resolved = path.resolve(tempRoot);
  const expectedParent = path.resolve(os.tmpdir());
  if (
    path.dirname(resolved) !== expectedParent
    || !path.basename(resolved).startsWith('keyboardia-audio-control-')
  ) {
    throw new Error(`Refusing to remove unexpected temporary path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const controlBaseCommit = resolveCommit(options.baseRef, 'Control base');
  const evaluatorCommit = resolveCommit(options.evaluatorRef, 'Evaluator/candidate');
  const plan = buildReconstructionPlan(
    controlBaseCommit,
    evaluatorCommit,
    relativePath => gitBuffer(['show', `${evaluatorCommit}:${relativePath}`]),
  );
  if (options.planOnly) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  assertFrozenEvaluatorCheckout(evaluatorCommit);

  const outputDir = options.outputDir!;
  ensureOutputDirectory(outputDir);
  fs.writeFileSync(
    path.join(outputDir, 'reconstruction-plan.json'),
    `${JSON.stringify(plan, null, 2)}\n`,
  );

  const sourceNodeModules = path.join(APP_ROOT, 'node_modules');
  if (!fs.existsSync(sourceNodeModules)) {
    throw new Error(
      `Installed dependencies are required at ${sourceNodeModules}; run npm ci separately first`,
    );
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-audio-control-'));
  const controlClone = path.join(tempRoot, 'control');
  const candidateClone = path.join(tempRoot, 'candidate');
  try {
    const controlArtifacts = artifactSet(outputDir, 'control');
    const candidateArtifacts = artifactSet(outputDir, 'candidate');

    prepareClone(controlClone, controlBaseCommit, sourceNodeModules);
    overlayEvaluator(controlClone, evaluatorCommit, plan);
    const overlayCommit = commitAll(
      controlClone,
      'chore: construct same-evaluator audio control',
      commitEnvironment(evaluatorCommit),
    );
    const compatibilityCommit = bindControlBaseline(
      controlClone,
      evaluatorCommit,
      controlArtifacts,
    );
    captureLane(controlClone, compatibilityCommit, compatibilityCommit, controlArtifacts);

    prepareClone(candidateClone, evaluatorCommit, sourceNodeModules);
    captureLane(candidateClone, evaluatorCommit, evaluatorCommit, candidateArtifacts);

    const control = validateAndSummarize(controlArtifacts);
    const candidate = validateAndSummarize(candidateArtifacts);
    const summary = {
      schemaVersion: 2,
      claim: 'reconstructed-same-evaluator-technical-comparison-not-listening-or-complete-matrix-evidence',
      generatedAt: new Date().toISOString(),
      method: {
        controlBaseCommit,
        candidateAndEvaluatorCommit: evaluatorCommit,
        compatibilityOverlayCommit: overlayCommit,
        compatibilitySubjectCommit: compatibilityCommit,
        reconstructionPlan: {
          path: 'reconstruction-plan.json',
          sha256: sha256File(path.join(outputDir, 'reconstruction-plan.json')),
        },
        exceptions: plan.exceptions,
      },
      artifacts: {
        control: artifactHashes(outputDir, controlArtifacts),
        candidate: artifactHashes(outputDir, candidateArtifacts),
      },
      control,
      candidate,
      delta: compareQualitySummaries(control, candidate),
    };
    const summaryPath = path.join(outputDir, 'controlled-comparison.json');
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`\nControlled comparison: ${summaryPath}`);
    console.log(JSON.stringify({ control, candidate, delta: summary.delta }, null, 2));
  } finally {
    if (options.keepTemp) {
      console.log(`Temporary clones retained at ${tempRoot}`);
    } else {
      safeRemoveTemporaryRoot(tempRoot);
    }
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(SCRIPT_PATH)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
