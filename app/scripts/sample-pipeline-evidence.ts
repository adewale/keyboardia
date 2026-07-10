import type {
  InstrumentManifestPlan,
  SampleRecipe,
  Sha256,
} from './sample-pipeline-core';
import type {
  CandidateObjectiveEvidence,
  SampleLabCatalog,
  SampleSource,
} from './sample-lab-core';

export interface PhysicalAudioFile {
  file: string;
  sizeBytes: number;
}

export interface CoverageMetrics {
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
}

export interface PipelineQualitySummary {
  hardErrors: number;
  reviewFlags: number;
}

export interface RuntimeContractMetrics {
  eventsChecked: number;
  silentEvents: number;
  maxPitchShiftSemitones: number;
  deterministicRoundRobinGroups: number;
}

export interface PipelineEvidence {
  instrumentId: string;
  buildReportSha256: Sha256;
  outputHashes: Sha256[];
  coverage: CoverageMetrics;
  quality: PipelineQualitySummary;
  runtime: RuntimeContractMetrics;
  reviewFindings: string[];
  requiredAnchorIds: string[];
  pitchSpanSemitones: number;
  browser: { chromium: boolean; webkit: boolean };
}

export interface PipelineEvidenceComparison {
  before: PipelineEvidence;
  after: PipelineEvidence;
  coverageDelta: CoverageMetrics;
  qualityDelta: PipelineQualitySummary;
  runtimeDelta: RuntimeContractMetrics;
}

export interface ListeningDecision {
  version: 1;
  candidateId: string;
  buildReportSha256: Sha256;
  outputHashes: Sha256[];
  decision: 'accepted' | 'rejected';
  reviewer: string;
  reviewedAt: string;
  anchorsReviewed: string[];
  pitchSpanSemitones: number;
  reviewDispositions: Record<string, string>;
  notes: string;
}

export type ListeningDecisionParseResult =
  | { ok: true; value: ListeningDecision }
  | { ok: false; errors: string[] };

export interface PromotionGateResult {
  ok: boolean;
  blockers: string[];
}

function velocityComplete(samples: InstrumentManifestPlan['samples']): boolean {
  const covered = new Uint8Array(128);
  for (const sample of samples) {
    const min = sample.velocityMin ?? 0;
    const max = sample.velocityMax ?? 127;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 127 || min > max) return false;
    for (let velocity = min; velocity <= max; velocity++) covered[velocity] = 1;
  }
  return covered.every(value => value === 1);
}

export function computeCoverageMetrics(
  manifest: InstrumentManifestPlan,
  files: readonly PhysicalAudioFile[]
): CoverageMetrics {
  const roots = [...new Set(manifest.samples.map(sample => sample.note))].sort((a, b) => a - b);
  const playableMin = manifest.playableRange?.min ?? roots[0] ?? 0;
  const playableMax = manifest.playableRange?.max ?? roots.at(-1) ?? playableMin;
  const distances = roots.length === 0
    ? [0]
    : Array.from({ length: Math.max(0, playableMax - playableMin + 1) }, (_, index) => {
        const note = playableMin + index;
        return Math.min(...roots.map(root => Math.abs(note - root)));
      });
  const largestRootGap = roots.slice(1).reduce((largest, root, index) => Math.max(largest, root - roots[index]), 0);
  const byRoot = new Map<number, InstrumentManifestPlan['samples']>();
  for (const root of roots) byRoot.set(root, manifest.samples.filter(sample => sample.note === root));
  const completeVelocityRoots = [...byRoot.values()].filter(velocityComplete).length;
  const roundRobinGroups = new Map<string, number>();
  for (const sample of manifest.samples) {
    const key = `${sample.note}:${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}:${sample.roundRobinGroup ?? 'single'}`;
    roundRobinGroups.set(key, (roundRobinGroups.get(key) ?? 0) + 1);
  }
  const referenced = new Set(manifest.samples.map(sample => sample.file));
  return {
    mappings: manifest.samples.length,
    roots: roots.length,
    largestRootGap,
    worstShiftSemitones: Math.max(...distances),
    meanShiftSemitones: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
    completeVelocityRoots,
    velocityRootCompleteness: roots.length === 0 ? 0 : completeVelocityRoots / roots.length,
    maxRoundRobins: Math.max(1, ...roundRobinGroups.values()),
    orphanFiles: files.filter(file => !referenced.has(file.file)).length,
    payloadBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
  };
}

function numericDelta<T extends Record<string, number>>(before: T, after: T): T {
  return Object.fromEntries(
    Object.keys(before).map(key => [key, after[key] - before[key]])
  ) as T;
}

export function computeRuntimeContract(manifest: InstrumentManifestPlan): RuntimeContractMetrics {
  const roots = [...new Set(manifest.samples.map(sample => sample.note))].sort((a, b) => a - b);
  const min = manifest.playableRange?.min ?? roots[0] ?? 0;
  const max = manifest.playableRange?.max ?? roots.at(-1) ?? min;
  let eventsChecked = 0;
  let silentEvents = 0;
  let maxPitchShiftSemitones = 0;
  for (let note = min; note <= max; note++) {
    const nearest = roots.reduce<number | undefined>((best, root) => {
      if (best === undefined) return root;
      const distance = Math.abs(note - root);
      const bestDistance = Math.abs(note - best);
      return distance < bestDistance || (distance === bestDistance && root > best) ? root : best;
    }, undefined);
    for (let velocity = 0; velocity <= 127; velocity++) {
      eventsChecked++;
      if (nearest === undefined) {
        silentEvents++;
        continue;
      }
      const layers = manifest.samples.filter(sample => sample.note === nearest);
      const matchingRanges = new Set(layers
        .filter(sample => velocity >= (sample.velocityMin ?? 0) && velocity <= (sample.velocityMax ?? 127))
        .map(sample => `${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}`));
      if (matchingRanges.size !== 1) silentEvents++;
      maxPitchShiftSemitones = Math.max(maxPitchShiftSemitones, Math.abs(note - nearest));
    }
  }
  const roundRobinGroups = new Set(manifest.samples
    .filter(sample => sample.roundRobinGroup !== undefined)
    .map(sample => `${sample.note}:${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}:${sample.articulation ?? 'default'}:${sample.roundRobinGroup}`));
  return { eventsChecked, silentEvents, maxPitchShiftSemitones, deterministicRoundRobinGroups: roundRobinGroups.size };
}

export function comparePipelineEvidence(
  before: PipelineEvidence,
  after: PipelineEvidence
): PipelineEvidenceComparison {
  if (before.instrumentId !== after.instrumentId) {
    throw new Error(`Cannot compare different instruments: ${before.instrumentId} vs ${after.instrumentId}`);
  }
  return {
    before,
    after,
    coverageDelta: numericDelta(before.coverage, after.coverage),
    qualityDelta: numericDelta(before.quality, after.quality),
    runtimeDelta: numericDelta(before.runtime, after.runtime),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha(value: unknown): value is Sha256 {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function parseListeningDecision(input: unknown): ListeningDecisionParseResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['decision must be an object'] };
  if (input.version !== 1) errors.push('version must be 1');
  if (!isNonEmptyString(input.candidateId)) errors.push('candidateId must be a non-empty string');
  if (!isSha(input.buildReportSha256)) errors.push('buildReportSha256 must be a lowercase SHA-256 digest');
  if (!Array.isArray(input.outputHashes) || input.outputHashes.length === 0 || input.outputHashes.some(hash => !isSha(hash))) {
    errors.push('outputHashes must be a non-empty array of lowercase SHA-256 digests');
  }
  if (input.decision !== 'accepted' && input.decision !== 'rejected') errors.push('decision must be accepted or rejected');
  if (!isNonEmptyString(input.reviewer)) errors.push('reviewer must be a non-empty string');
  if (!isNonEmptyString(input.reviewedAt) || !Number.isFinite(Date.parse(String(input.reviewedAt)))) {
    errors.push('reviewedAt must be an ISO date-time');
  }
  if (!Array.isArray(input.anchorsReviewed) || input.anchorsReviewed.length < 3 || input.anchorsReviewed.some(anchor => !isNonEmptyString(anchor))) {
    errors.push('anchorsReviewed must contain at least three named anchors');
  }
  if (!Number.isFinite(input.pitchSpanSemitones) || Number(input.pitchSpanSemitones) < 12) {
    errors.push('pitchSpanSemitones must span at least one octave');
  }
  if (!isRecord(input.reviewDispositions)
      || Object.values(input.reviewDispositions).some(disposition => !isNonEmptyString(disposition))) {
    errors.push('reviewDispositions must map every reported review finding to a non-empty disposition');
  }
  if (!isNonEmptyString(input.notes)) errors.push('notes must be a non-empty string');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as ListeningDecision };
}

function sameHashSet(left: readonly Sha256[], right: readonly Sha256[]): boolean {
  return left.length === right.length
    && [...left].sort().every((hash, index) => hash === [...right].sort()[index]);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export function evaluatePromotionGates(
  before: PipelineEvidence,
  candidate: PipelineEvidence,
  decision: ListeningDecision
): PromotionGateResult {
  const blockers: string[] = [];
  if (before.instrumentId !== candidate.instrumentId) blockers.push('Before/after instrument IDs do not match');
  if (candidate.quality.hardErrors > 0) blockers.push(`Candidate has ${candidate.quality.hardErrors} hard audio error(s)`);
  if (candidate.runtime.silentEvents > 0) blockers.push(`Candidate runtime contract has ${candidate.runtime.silentEvents} unmapped event(s)`);
  if (candidate.coverage.orphanFiles > 0) blockers.push(`Candidate has ${candidate.coverage.orphanFiles} orphan audio file(s)`);
  if (candidate.coverage.worstShiftSemitones > before.coverage.worstShiftSemitones) blockers.push('Worst pitch-shift distance regressed');
  if (candidate.coverage.velocityRootCompleteness < before.coverage.velocityRootCompleteness) blockers.push('Velocity-root completeness regressed');
  if (!candidate.browser.chromium) blockers.push('Chromium browser decode evidence is missing');
  if (!candidate.browser.webkit) blockers.push('WebKit browser decode evidence is missing');
  if (decision.decision !== 'accepted') blockers.push('Listening decision is not accepted');
  if (decision.candidateId !== candidate.instrumentId) blockers.push('Listening decision candidate ID does not match');
  if (decision.buildReportSha256 !== candidate.buildReportSha256) blockers.push('Listening decision build report hash does not match');
  if (!sameHashSet(decision.outputHashes, candidate.outputHashes)) blockers.push('Listening decision output hashes do not match');
  if (!sameStringSet(decision.anchorsReviewed, candidate.requiredAnchorIds)) {
    blockers.push('Listening decision does not cover the exact required anchors');
  }
  if (decision.pitchSpanSemitones !== candidate.pitchSpanSemitones) {
    blockers.push('Listening decision pitch span does not match the recipe anchors');
  }
  const dispositions = decision.reviewDispositions;
  for (const finding of candidate.reviewFindings) {
    if (!isNonEmptyString(dispositions[finding])) blockers.push(`Review finding is not dispositioned: ${finding}`);
  }
  const unexpectedDispositions = Object.keys(dispositions).filter(finding => !candidate.reviewFindings.includes(finding));
  if (unexpectedDispositions.length > 0) blockers.push(`Decision contains stale review disposition(s): ${unexpectedDispositions.join(', ')}`);
  return { ok: blockers.length === 0, blockers };
}

function rootUrl(base: string, relative: string): string {
  return `${base.replace(/\/$/, '')}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

export function createListeningCatalog(options: {
  recipe: SampleRecipe;
  source: SampleSource;
  candidateBaseUrl: string;
  currentBaseUrl: string;
  objective: CandidateObjectiveEvidence;
  randomizationSeed?: string;
}): SampleLabCatalog {
  const { recipe, source, candidateBaseUrl, currentBaseUrl, objective } = options;
  const mappingsByOutput = new Map(recipe.mapping.samples.map(sample => [sample.output, sample]));
  const comparisons = recipe.evidence.anchors.map(anchor => ({
    id: anchor.id,
    targetMidi: anchor.targetMidi,
    ...(anchor.velocity !== undefined ? { velocity: anchor.velocity } : {}),
    candidate: {
      url: rootUrl(candidateBaseUrl, anchor.candidateOutput),
      rootMidi: anchor.candidateRootMidi,
      label: `${recipe.instrument.name} candidate`,
    },
    current: {
      url: rootUrl(currentBaseUrl, anchor.currentFile),
      rootMidi: anchor.currentRootMidi,
      label: `${recipe.instrument.name} current`,
    },
  }));
  const auditFiles = [...mappingsByOutput.values()].map(sample => ({
    url: rootUrl(candidateBaseUrl, sample.output),
    rootMidi: sample.rootMidi,
  }));
  return {
    version: 1,
    ...(options.randomizationSeed ? { randomizationSeed: options.randomizationSeed } : {}),
    sources: [source],
    candidates: [{
      id: recipe.instrument.id,
      label: `${recipe.instrument.name} pipeline candidate`,
      targetInstrument: recipe.instrument.id,
      sourceId: source.id,
      status: 'listening',
      objective,
      auditFiles,
      comparisons,
      notes: [`Source revision: ${recipe.sourceRevision}`],
    }],
  };
}
