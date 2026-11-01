import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseSampleRecipe,
  planSampleBuild,
  verifyRecipeSources,
  type InstrumentManifestPlan,
  type PlannedSampleBuild,
  type SampleRecipe,
  type Sha256,
} from './sample-pipeline-core';
import {
  executePlannedBuild,
  loadRenderedBuild,
  SpawnProcessRunner,
  type ProcessRunner,
  type RenderedSampleBuild,
} from './sample-pipeline-runner';
import {
  auditDecodedMappings,
  browserDecodeMappings,
  type BrowserDecodeReport,
  type PipelineAuditReport,
} from './sample-pipeline-audit';
import {
  comparePipelineEvidence,
  computeCoverageMetrics,
  computeRuntimeContract,
  createListeningCatalog,
  evaluatePromotionGates,
  parseListeningDecision,
  type PipelineEvidence,
  type PipelineEvidenceComparison,
} from './sample-pipeline-evidence';
import { buildSampleLabFiles } from './sample-lab-build';
import { parseSampleLabCatalog, type SampleLabCatalog } from './sample-lab-core';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aif', '.aiff', '.ogg']);

/**
 * Immutable masters are always audited. A measured DC offset may proceed only
 * when that exact source has one explicit removeDc render policy; every other
 * hard source defect remains blocking.
 */
export function unresolvedSourceAuditIssues(recipe: SampleRecipe, report: PipelineAuditReport): PipelineAuditReport['issues'] {
  const sourcePathById = new Map(recipe.sources.map(source => [source.id, source.path as string]));
  const dcRemediatedPaths = new Set(recipe.mapping.samples
    .filter(mapping => mapping.processing?.removeDc === true)
    .map(mapping => sourcePathById.get(mapping.sourceId))
    .filter((sourcePath): sourcePath is string => sourcePath !== undefined));
  // QualityIssue.file is optional, and an issue with no file cannot name a
  // remediated source, so it stays blocking. Set.has(undefined) was already
  // false at runtime; this only makes the requirement explicit.
  return report.issues.filter(issue => issue.severity === 'error'
    && !(issue.code === 'DC_OFFSET'
      && issue.file !== undefined
      && dcRemediatedPaths.has(issue.file)));
}

export interface FullPipelineOptions {
  command: 'full';
  recipePath: string;
  sourceRoot: string;
  output?: string;
  dryRun: boolean;
  promote: boolean;
  decisionPath?: string;
}

export type SamplePipelineCliOptions = FullPipelineOptions | { command: 'help' };

function nextValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseSamplePipelineArgs(argv: string[]): SamplePipelineCliOptions {
  const command = argv[0] ?? 'help';
  if (command === 'help' || command === '--help' || command === '-h') return { command: 'help' };
  if (command !== 'full') throw new Error(`Unknown samples command: ${command}; only "full" is supported`);
  let recipePath: string | undefined;
  let sourceRoot: string | undefined;
  let output: string | undefined;
  let decisionPath: string | undefined;
  let dryRun = false;
  let promote = false;
  const unexpected: string[] = [];
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--recipe') {
      recipePath = nextValue(argv, index, arg);
      index++;
    } else if (arg.startsWith('--recipe=')) recipePath = arg.slice('--recipe='.length);
    else if (arg === '--source-root') {
      sourceRoot = nextValue(argv, index, arg);
      index++;
    } else if (arg.startsWith('--source-root=')) sourceRoot = arg.slice('--source-root='.length);
    else if (arg === '--output') {
      output = nextValue(argv, index, arg);
      index++;
    } else if (arg.startsWith('--output=')) output = arg.slice('--output='.length);
    else if (arg === '--decision') {
      decisionPath = nextValue(argv, index, arg);
      index++;
    } else if (arg.startsWith('--decision=')) decisionPath = arg.slice('--decision='.length);
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--promote') promote = true;
    else unexpected.push(arg);
  }
  if (!recipePath) throw new Error('samples full requires --recipe <versioned-recipe.json>');
  if (!sourceRoot) throw new Error('samples full requires --source-root <immutable-master-directory>');
  if (unexpected.length > 0) throw new Error(`Unknown/legacy full arguments: ${unexpected.join(' ')}; use --recipe and --source-root`);
  if (promote && !decisionPath) throw new Error('--promote requires --decision <accepted-review.json>');
  return {
    command: 'full',
    recipePath,
    sourceRoot,
    ...(output ? { output } : {}),
    dryRun,
    promote,
    ...(decisionPath ? { decisionPath } : {}),
  };
}

export interface FullPipelineDependencies {
  processRunner: ProcessRunner;
  execute: typeof executePlannedBuild;
  load: typeof loadRenderedBuild;
  audit: typeof auditDecodedMappings;
  browserDecode: typeof browserDecodeMappings;
  buildLab: typeof buildSampleLabFiles;
  now: () => Date;
  log: (message: string) => void;
}

const defaultDependencies: FullPipelineDependencies = {
  processRunner: new SpawnProcessRunner(),
  execute: executePlannedBuild,
  load: loadRenderedBuild,
  audit: auditDecodedMappings,
  browserDecode: browserDecodeMappings,
  buildLab: buildSampleLabFiles,
  now: () => new Date(),
  log: message => console.log(message),
};

export interface FullPipelineResult {
  state: 'planned' | 'decision-ready' | 'promoted';
  plan: PlannedSampleBuild;
  rendered?: RenderedSampleBuild;
  comparison?: PipelineEvidenceComparison;
  audit?: PipelineAuditReport;
  browser?: BrowserDecodeReport;
  outputRoot: string;
  listeningPage?: string;
}

function sha256File(filename: string): Sha256 {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex') as Sha256;
}

function readJson(filename: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON ${filename}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(filename: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function readInstrumentManifest(filename: string): InstrumentManifestPlan {
  const value = readJson(filename);
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { samples?: unknown }).samples)) {
    throw new Error(`Invalid current instrument manifest: ${filename}`);
  }
  return value as InstrumentManifestPlan;
}

function listAudioFiles(root: string): Array<{ file: string; sizeBytes: number }> {
  if (!fs.existsSync(root)) return [];
  const files: Array<{ file: string; sizeBytes: number }> = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push({ file: path.relative(root, absolute).split(path.sep).join('/'), sizeBytes: fs.statSync(absolute).size });
      }
    }
  };
  visit(root);
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

function referencedHashes(manifest: InstrumentManifestPlan, root: string): Sha256[] {
  return [...new Set(manifest.samples.map(sample => sample.file))]
    .sort()
    .map(file => sha256File(path.join(root, ...file.split('/'))));
}

function asPublicUrl(root: string): string {
  const publicRoot = path.resolve('public');
  const absolute = path.resolve(root);
  const relative = path.relative(publicRoot, absolute);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Listening candidate must be inside ${publicRoot}; got ${absolute}`);
  }
  return `/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function readSourceCatalog(filename = 'sample-lab/catalog.json'): SampleLabCatalog {
  const parsed = parseSampleLabCatalog(readJson(filename));
  if (!parsed.ok) throw new Error(`Invalid Sample Lab catalog:\n- ${parsed.errors.join('\n- ')}`);
  return parsed.value;
}

function makeEvidence(options: {
  manifest: InstrumentManifestPlan;
  root: string;
  reportHash: Sha256;
  audit: PipelineAuditReport;
  browser: { chromium: boolean; webkit: boolean };
  requiredAnchorIds: string[];
  pitchSpanSemitones: number;
}): PipelineEvidence {
  return {
    instrumentId: options.manifest.id,
    buildReportSha256: options.reportHash,
    outputHashes: referencedHashes(options.manifest, options.root),
    coverage: computeCoverageMetrics(options.manifest, listAudioFiles(options.root)),
    quality: { hardErrors: options.audit.hardErrors, reviewFlags: options.audit.reviewFlags },
    runtime: computeRuntimeContract(options.manifest),
    reviewFindings: options.audit.entries.flatMap(entry => entry.issues
      .filter(issue => issue.severity === 'review')
      .map(issue => `${entry.file}: ${issue.code}`)),
    requiredAnchorIds: options.requiredAnchorIds,
    pitchSpanSemitones: options.pitchSpanSemitones,
    browser: options.browser,
  };
}

export function playableRangeRegression(
  current: InstrumentManifestPlan['playableRange'],
  candidate: InstrumentManifestPlan['playableRange'],
): string | undefined {
  if (!current) return undefined;
  if (!candidate || candidate.min > current.min || candidate.max < current.max) {
    return `playable range regressed from ${current.min}..${current.max} to ${candidate ? `${candidate.min}..${candidate.max}` : 'unspecified'}`;
  }
  return undefined;
}

export function coverageRegressionBlockers(
  before: PipelineEvidence['coverage'],
  candidate: PipelineEvidence['coverage'],
  currentRange: InstrumentManifestPlan['playableRange'],
  candidateRange: InstrumentManifestPlan['playableRange'],
): string[] {
  const blockers: string[] = [];
  if (candidate.orphanFiles > 0) blockers.push(`${candidate.orphanFiles} candidate orphan file(s)`);
  if (candidate.worstShiftSemitones > before.worstShiftSemitones) blockers.push('worst pitch-shift distance regressed');
  if (candidate.velocityRootCompleteness < before.velocityRootCompleteness) blockers.push('velocity-root completeness regressed');
  const rangeBlocker = playableRangeRegression(currentRange, candidateRange);
  if (rangeBlocker) blockers.push(rangeBlocker);
  return blockers;
}

function preliminaryBlockers(
  before: PipelineEvidence,
  candidate: PipelineEvidence,
  currentManifest: InstrumentManifestPlan,
  candidateManifest: InstrumentManifestPlan,
): string[] {
  const blockers: string[] = [];
  if (candidate.quality.hardErrors > 0) blockers.push(`${candidate.quality.hardErrors} candidate hard error(s)`);
  if (candidate.runtime.silentEvents > 0) blockers.push(`${candidate.runtime.silentEvents} candidate runtime mapping failure(s)`);
  if (!candidate.browser.chromium || !candidate.browser.webkit) blockers.push('Chromium and WebKit decode must both pass');
  blockers.push(...coverageRegressionBlockers(
    before.coverage,
    candidate.coverage,
    currentManifest.playableRange,
    candidateManifest.playableRange,
  ));
  return blockers;
}

function decisionTemplate(candidate: PipelineEvidence, anchorIds: string[], pitchSpanSemitones: number, reviewFindings: string[]): unknown {
  return {
    version: 1,
    candidateId: candidate.instrumentId,
    buildReportSha256: candidate.buildReportSha256,
    outputHashes: candidate.outputHashes,
    decision: 'replace-with-accepted-or-rejected',
    reviewer: '',
    reviewedAt: '',
    anchorsReviewed: anchorIds,
    pitchSpanSemitones,
    reviewDispositions: Object.fromEntries(reviewFindings.map(finding => [finding, ''])),
    notes: '',
  };
}

function promoteCandidate(options: {
  rendered: RenderedSampleBuild;
  destination: string;
  evidence: PipelineEvidenceComparison;
  decision: unknown;
}): void {
  const parsedDecision = parseListeningDecision(options.decision);
  if (!parsedDecision.ok) throw new Error(`Invalid listening decision:\n- ${parsedDecision.errors.join('\n- ')}`);
  const gates = evaluatePromotionGates(options.evidence.before, options.evidence.after, parsedDecision.value);
  if (!gates.ok) throw new Error(`Promotion blocked:\n- ${gates.blockers.join('\n- ')}`);

  // Re-open and hash every approved byte immediately before promotion. This closes
  // the audit-to-copy mutation window and also validates recipe/report staleness.
  const rendered = loadRenderedBuild(options.rendered.plan);
  const destination = path.resolve(options.destination);
  const parent = path.dirname(destination);
  const id = randomUUID();
  const staging = path.join(parent, `.${path.basename(destination)}.promote-${id}`);
  const backup = path.join(parent, `.${path.basename(destination)}.backup-${id}`);
  const decisionPath = path.resolve('sample-pipeline', 'decisions', `${rendered.manifest.id}.json`);
  const decisionTemp = `${decisionPath}.${id}.tmp`;
  const decisionBackup = `${decisionPath}.${id}.backup`;
  if (!fs.existsSync(destination)) throw new Error(`Production instrument directory does not exist: ${destination}`);
  fs.mkdirSync(staging);
  try {
    for (const output of rendered.outputs) {
      const source = path.join(rendered.plan.outputRoot, ...output.file.split('/'));
      const target = path.join(staging, ...output.file.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      if (sha256File(target) !== output.sha256) throw new Error(`promotion copy hash mismatch: ${output.file}`);
    }
    const manifestSource = path.join(rendered.plan.outputRoot, 'manifest.json');
    const manifestTarget = path.join(staging, 'manifest.json');
    fs.copyFileSync(manifestSource, manifestTarget);
    const buildReportSource = path.join(rendered.plan.outputRoot, 'build-report.json');
    const buildReportTarget = path.join(staging, 'build-report.json');
    if (sha256File(buildReportSource) !== options.evidence.after.buildReportSha256) {
      throw new Error('promotion source build-report hash changed after authorization');
    }
    fs.copyFileSync(buildReportSource, buildReportTarget);
    if (sha256File(manifestTarget) !== rendered.report.manifestSha256) throw new Error('promotion manifest hash mismatch');
    if (sha256File(buildReportTarget) !== options.evidence.after.buildReportSha256) throw new Error('promotion build-report hash mismatch');

    fs.mkdirSync(path.dirname(decisionPath), { recursive: true });
    fs.writeFileSync(decisionTemp, `${JSON.stringify({
      version: 1,
      decision: parsedDecision.value,
      evidence: options.evidence,
      buildReport: rendered.report,
    }, null, 2)}\n`, { flag: 'wx' });

    fs.renameSync(destination, backup);
    fs.renameSync(staging, destination);
    if (fs.existsSync(decisionPath)) fs.renameSync(decisionPath, decisionBackup);
    fs.renameSync(decisionTemp, decisionPath);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(decisionTemp, { force: true });
    if (fs.existsSync(backup)) {
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(backup, destination);
    }
    if (fs.existsSync(decisionBackup)) {
      fs.rmSync(decisionPath, { force: true });
      fs.renameSync(decisionBackup, decisionPath);
    }
    throw error;
  }
  // Cleanup is deliberately outside the rollback transaction. Once production
  // and its decision are installed, a partial backup deletion must never cause
  // the valid destination to be removed and replaced by a damaged backup.
  try {
    fs.rmSync(backup, { recursive: true, force: true });
    fs.rmSync(decisionBackup, { force: true });
  } catch (error) {
    console.warn(`Promotion succeeded but backup cleanup needs attention: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runFullPipeline(
  options: FullPipelineOptions,
  dependencies: Partial<FullPipelineDependencies> = {}
): Promise<FullPipelineResult> {
  const deps = { ...defaultDependencies, ...dependencies };
  const parsed = parseSampleRecipe(readJson(options.recipePath));
  if (!parsed.ok) throw new Error(`Invalid sample recipe:\n- ${parsed.errors.join('\n- ')}`);
  const verified = await verifyRecipeSources(parsed.value, options.sourceRoot);
  if (!verified.ok) throw new Error(`Source verification failed:\n- ${verified.errors.join('\n- ')}`);
  const outputRoot = path.resolve(options.output ?? path.join('public', '__sample-pipeline', parsed.value.recipe.instrument.id, 'candidate'));
  const pipelineRoot = path.dirname(outputRoot);
  const plan = planSampleBuild(verified.value, outputRoot);
  if (options.dryRun) {
    deps.log(JSON.stringify({ state: plan.state, outputRoot: plan.outputRoot, renders: plan.renders, manifest: plan.manifest }, null, 2));
    return { state: 'planned', plan, outputRoot };
  }

  const sourceManifest: InstrumentManifestPlan = {
    ...plan.manifest,
    samples: parsed.value.recipe.mapping.samples.map(mapping => ({
      note: mapping.rootMidi,
      file: verified.value.sources.find(source => source.id === mapping.sourceId)!.path as InstrumentManifestPlan['samples'][number]['file'],
      velocityMin: mapping.velocity.min,
      velocityMax: mapping.velocity.max,
      ...(mapping.articulation !== 'default' ? { articulation: mapping.articulation } : {}),
      ...(mapping.roundRobin ? { roundRobinGroup: mapping.roundRobin.group, roundRobinIndex: mapping.roundRobin.index } : {}),
    })),
  };
  const sourceAudit = await deps.audit(sourceManifest, verified.value.sourceRoot);
  writeJson(path.join(pipelineRoot, 'reports', 'source-master-audit.json'), sourceAudit);
  const unresolvedSourceIssues = unresolvedSourceAuditIssues(parsed.value.recipe, sourceAudit);
  if (unresolvedSourceIssues.length > 0) {
    const details = unresolvedSourceIssues.map(issue => `${issue.file}: ${issue.code} (${issue.message})`);
    throw new Error(`Immutable masters failed objective gates with ${unresolvedSourceIssues.length} unremediated hard error(s):\n- ${details.join('\n- ')}`);
  }
  if (parsed.value.recipe.leveling.mode === 'group-relative') {
    const anchor = parsed.value.recipe.leveling.anchorSourceId;
    const anchorPath = verified.value.sources.find(source => source.id === anchor)!.path;
    const metric = sourceAudit.entries.find(entry => entry.file === anchorPath)?.metrics;
    if (!metric || Math.abs(metric.peakDb - parsed.value.recipe.leveling.measuredPeakDb) > 0.1) {
      throw new Error(`Group-leveling anchor measurement is stale for ${anchor}; expected ${parsed.value.recipe.leveling.measuredPeakDb} dB, measured ${metric?.peakDb ?? 'missing'} dB`);
    }
    const loudestPeak = Math.max(...sourceAudit.entries.map(entry => entry.metrics.peakDb));
    if (metric.peakDb < loudestPeak - 0.1) throw new Error(`Group-leveling anchor ${anchor} is not the loudest selected source`);
  }

  const rendered = options.promote && fs.existsSync(outputRoot)
    ? deps.load(plan)
    : await deps.execute(plan, deps.processRunner, { now: deps.now });
  const currentRoot = path.resolve(parsed.value.recipe.evidence.currentInstrumentDir);
  const currentManifest = readInstrumentManifest(path.join(currentRoot, 'manifest.json'));
  if (currentManifest.id !== rendered.manifest.id) {
    throw new Error(`Recipe/current instrument mismatch: ${rendered.manifest.id} vs ${currentManifest.id}`);
  }
  const expectedSourceChannels = Object.fromEntries(parsed.value.recipe.mapping.samples.map(mapping => {
    const sourcePath = verified.value.sources.find(source => source.id === mapping.sourceId)!.path;
    const channels = sourceAudit.entries.find(entry => entry.file === sourcePath)?.metrics.channels;
    return [mapping.output, channels ?? 0];
  }));
  const [beforeAudit, candidateAudit, browser] = await Promise.all([
    deps.audit(currentManifest, currentRoot),
    deps.audit(rendered.manifest, outputRoot, undefined, {
      delivery: parsed.value.recipe.delivery,
      leveling: parsed.value.recipe.leveling,
      expectedSourceChannels,
    }),
    deps.browserDecode(rendered.manifest, outputRoot, parsed.value.recipe.delivery),
  ]);
  const requiredAnchorIds = parsed.value.recipe.evidence.anchors.map(anchor => anchor.id);
  const anchorTargets = parsed.value.recipe.evidence.anchors.map(anchor => anchor.targetMidi);
  const pitchSpanSemitones = Math.max(...anchorTargets) - Math.min(...anchorTargets);
  const before = makeEvidence({
    manifest: currentManifest,
    root: currentRoot,
    reportHash: sha256File(path.join(currentRoot, 'manifest.json')),
    audit: beforeAudit,
    browser: { chromium: true, webkit: true },
    requiredAnchorIds,
    pitchSpanSemitones,
  });
  const candidate = makeEvidence({
    manifest: rendered.manifest,
    root: outputRoot,
    reportHash: sha256File(path.join(outputRoot, 'build-report.json')),
    audit: candidateAudit,
    browser,
    requiredAnchorIds,
    pitchSpanSemitones,
  });
  const comparison = comparePipelineEvidence(before, candidate);
  const reportsRoot = path.join(pipelineRoot, 'reports');
  writeJson(path.join(reportsRoot, 'source-master-audit.json'), sourceAudit);
  writeJson(path.join(reportsRoot, 'objective-audit.json'), candidateAudit);
  writeJson(path.join(reportsRoot, 'browser-decode.json'), browser);
  writeJson(path.join(reportsRoot, 'before-after.json'), comparison);
  writeJson(path.join(reportsRoot, 'runtime-contract.json'), {
    version: 1,
    before: before.runtime,
    after: candidate.runtime,
    delta: comparison.runtimeDelta,
  });

  const blockers = preliminaryBlockers(before, candidate, currentManifest, rendered.manifest);
  if (blockers.length > 0) {
    throw new Error(`Candidate failed pre-listening gates:\n- ${blockers.join('\n- ')}`);
  }

  const sourceCatalog = readSourceCatalog();
  const source = sourceCatalog.sources.find(item => item.id === parsed.value.recipe.evidence.sampleLabSourceId);
  if (!source) throw new Error(`Unknown Sample Lab source: ${parsed.value.recipe.evidence.sampleLabSourceId}`);
  const catalog = createListeningCatalog({
    recipe: parsed.value.recipe,
    source,
    candidateBaseUrl: asPublicUrl(outputRoot),
    currentBaseUrl: asPublicUrl(currentRoot),
    randomizationSeed: candidate.buildReportSha256,
    objective: {
      hardErrors: candidateAudit.hardErrors,
      reviewFlags: candidateAudit.reviewFlags,
      browserDecode: browser.chromium && browser.webkit,
      report: asPublicUrl(path.join(reportsRoot, 'objective-audit.json')),
    },
  });
  const catalogPath = path.join(pipelineRoot, 'listening-catalog.json');
  writeJson(catalogPath, catalog);
  const built = deps.buildLab(catalog, path.join(pipelineRoot, 'lab'));
  writeJson(
    path.join(pipelineRoot, 'listening-decision.template.json'),
    decisionTemplate(candidate, requiredAnchorIds, pitchSpanSemitones, candidate.reviewFindings)
  );

  if (options.promote) {
    promoteCandidate({
      rendered,
      destination: currentRoot,
      evidence: comparison,
      decision: readJson(options.decisionPath!),
    });
    return { state: 'promoted', plan, rendered, comparison, audit: candidateAudit, browser, outputRoot, listeningPage: built.html };
  }
  return { state: 'decision-ready', plan, rendered, comparison, audit: candidateAudit, browser, outputRoot, listeningPage: built.html };
}

export function samplePipelineUsage(): string {
  return `Keyboardia Sample Pipeline v2\n\nUsage:\n  npm run samples -- full --recipe <recipe.json> --source-root <immutable-masters> [--output <candidate-dir>] [--dry-run]\n  npm run samples -- full --recipe <recipe.json> --source-root <immutable-masters> --promote --decision <accepted-review.json>\n\nThe default full command renders to ignored candidate storage, runs numerical and Chromium/WebKit gates, and builds a blinded Sample Lab bundle. It never overwrites production without an exact-hash accepted decision.`;
}
