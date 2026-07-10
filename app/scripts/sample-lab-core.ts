export const ALLOWED_SAMPLE_LICENSES = [
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Unlicense',
] as const;

export type AllowedSampleLicense = typeof ALLOWED_SAMPLE_LICENSES[number];
export type CandidateStatus = 'discovered' | 'needs-provenance' | 'smoke-tested' | 'listening' | 'accepted' | 'rejected';

export interface SampleLicenseEvidence {
  spdx: AllowedSampleLicense;
  scope: 'samples' | 'archive';
  evidenceUrl: string;
  /** A commit, release, or content hash that makes the evidence reproducible. */
  evidenceRevision: string;
  attribution: string;
  caveats?: string[];
}

export interface SampleSource {
  id: string;
  name: string;
  homepage: string;
  revision: string;
  downloadUrl?: string;
  archiveSha256?: string;
  license: SampleLicenseEvidence;
  targets: string[];
  formats: Array<'sfz' | 'sf2' | 'wav' | 'flac' | 'aiff' | 'other'>;
  notes?: string[];
}

export interface ComparisonAudioRef {
  url: string;
  /** MIDI pitch actually present in this file, before browser playback-rate matching. */
  rootMidi: number;
  label?: string;
}

export interface ComparisonAnchor {
  id: string;
  targetMidi: number;
  velocity?: number;
  candidate: ComparisonAudioRef;
  current: ComparisonAudioRef;
}

export interface CandidateObjectiveEvidence {
  hardErrors: number;
  reviewFlags: number;
  browserDecode: boolean;
  report?: string;
}

export interface SampleCandidate {
  id: string;
  label: string;
  targetInstrument: string;
  sourceId: string;
  status: CandidateStatus;
  objective?: CandidateObjectiveEvidence;
  comparisons: ComparisonAnchor[];
  notes?: string[];
  rejectionReason?: string;
}

export interface SampleLabCatalog {
  version: 1;
  sources: SampleSource[];
  candidates: SampleCandidate[];
}

export type CatalogParseResult =
  | { ok: true; value: SampleLabCatalog }
  | { ok: false; errors: string[] };

export type CandidateReadinessLevel = 'blocked' | 'intake' | 'reviewable' | 'decision-ready';

export interface CandidateReadiness {
  level: CandidateReadinessLevel;
  blockers: string[];
  reviewNotes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalAudioUrl(value: unknown): value is string {
  if (!isNonEmptyString(value) || !value.startsWith('/') || value.startsWith('//') || /[?#]/.test(value)) return false;
  try {
    const segments = value.split('/').map(segment => decodeURIComponent(segment));
    if (segments.some(segment => segment === '.' || segment === '..')) return false;
  } catch {
    return false;
  }
  return /\.(?:mp3|m4a|wav|flac|ogg|aiff?|webm)$/i.test(value);
}

function isMidi(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 127;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validateStringArray(value: unknown, path: string, errors: string[], allowed?: readonly string[]): void {
  if (!Array.isArray(value) || value.some(item => !isNonEmptyString(item))) {
    errors.push(`${path} must be an array of non-empty strings`);
    return;
  }
  if (allowed) {
    value.forEach((item, index) => {
      if (!allowed.includes(item)) errors.push(`${path}[${index}] has unsupported value ${JSON.stringify(item)}`);
    });
  }
}

function validateAudioRef(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isLocalAudioUrl(value.url)) errors.push(`${path}.url must be a root-relative local audio URL`);
  if (!isMidi(value.rootMidi)) errors.push(`${path}.rootMidi must be a MIDI integer from 0 to 127`);
  if (value.label !== undefined && !isNonEmptyString(value.label)) errors.push(`${path}.label must be a non-empty string`);
}

function validateSource(value: unknown, index: number, errors: string[]): void {
  const base = `sources[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${base} must be an object`);
    return;
  }
  for (const field of ['id', 'name', 'revision'] as const) {
    if (!isNonEmptyString(value[field])) errors.push(`${base}.${field} must be a non-empty string`);
  }
  if (!isHttpUrl(value.homepage)) errors.push(`${base}.homepage must be an http(s) URL`);
  if ((value.downloadUrl === undefined) !== (value.archiveSha256 === undefined)) {
    errors.push(`${base}.downloadUrl and archiveSha256 must be recorded together`);
  }
  if (value.downloadUrl !== undefined && !isHttpUrl(value.downloadUrl)) {
    errors.push(`${base}.downloadUrl must be an http(s) URL`);
  }
  if (value.archiveSha256 !== undefined && (typeof value.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.archiveSha256))) {
    errors.push(`${base}.archiveSha256 must be a 64-character SHA-256 hex digest`);
  }
  validateStringArray(value.targets, `${base}.targets`, errors);
  validateStringArray(value.formats, `${base}.formats`, errors, ['sfz', 'sf2', 'wav', 'flac', 'aiff', 'other']);
  if (value.notes !== undefined) validateStringArray(value.notes, `${base}.notes`, errors);

  const license = value.license;
  if (!isRecord(license)) {
    errors.push(`${base}.license must be an object`);
    return;
  }
  if (!ALLOWED_SAMPLE_LICENSES.includes(license.spdx as AllowedSampleLicense)) {
    errors.push(`${base}.license.spdx must be CC0, CC-BY, or another explicitly allowed permissive sample license`);
  }
  if (license.scope !== 'samples' && license.scope !== 'archive') {
    errors.push(`${base}.license.scope must cover samples or the whole archive`);
  }
  if (!isHttpUrl(license.evidenceUrl)) errors.push(`${base}.license.evidenceUrl must be an http(s) URL`);
  if (!isNonEmptyString(license.evidenceRevision)) errors.push(`${base}.license.evidenceRevision is required`);
  if (!isNonEmptyString(license.attribution)) errors.push(`${base}.license.attribution is required even for CC0 sources`);
  if (license.caveats !== undefined) validateStringArray(license.caveats, `${base}.license.caveats`, errors);
}

function validateCandidate(value: unknown, index: number, errors: string[]): void {
  const base = `candidates[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${base} must be an object`);
    return;
  }
  for (const field of ['id', 'label', 'targetInstrument', 'sourceId'] as const) {
    if (!isNonEmptyString(value[field])) errors.push(`${base}.${field} must be a non-empty string`);
  }
  const statuses: CandidateStatus[] = ['discovered', 'needs-provenance', 'smoke-tested', 'listening', 'accepted', 'rejected'];
  if (!statuses.includes(value.status as CandidateStatus)) errors.push(`${base}.status is unsupported`);
  if (value.notes !== undefined) validateStringArray(value.notes, `${base}.notes`, errors);
  if (value.rejectionReason !== undefined && !isNonEmptyString(value.rejectionReason)) {
    errors.push(`${base}.rejectionReason must be a non-empty string`);
  }
  if (value.status === 'rejected' && !isNonEmptyString(value.rejectionReason)) {
    errors.push(`${base}.rejectionReason is required for rejected candidates`);
  }

  if (value.objective !== undefined) {
    if (!isRecord(value.objective)) {
      errors.push(`${base}.objective must be an object`);
    } else {
      if (!isNonNegativeInteger(value.objective.hardErrors)) errors.push(`${base}.objective.hardErrors must be a non-negative integer`);
      if (!isNonNegativeInteger(value.objective.reviewFlags)) errors.push(`${base}.objective.reviewFlags must be a non-negative integer`);
      if (typeof value.objective.browserDecode !== 'boolean') errors.push(`${base}.objective.browserDecode must be boolean`);
      if (value.objective.report !== undefined && !isNonEmptyString(value.objective.report)) errors.push(`${base}.objective.report must be a non-empty string`);
    }
  }

  if (!Array.isArray(value.comparisons)) {
    errors.push(`${base}.comparisons must be an array`);
    return;
  }
  const anchorIds = new Set<string>();
  value.comparisons.forEach((anchor, anchorIndex) => {
    const path = `${base}.comparisons[${anchorIndex}]`;
    if (!isRecord(anchor)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!isNonEmptyString(anchor.id)) errors.push(`${path}.id must be a non-empty string`);
    else if (anchorIds.has(anchor.id)) errors.push(`${path}.id duplicates ${anchor.id}`);
    else anchorIds.add(anchor.id);
    if (!isMidi(anchor.targetMidi)) errors.push(`${path}.targetMidi must be a MIDI integer from 0 to 127`);
    if (anchor.velocity !== undefined && !isMidi(anchor.velocity)) errors.push(`${path}.velocity must be an integer from 0 to 127`);
    validateAudioRef(anchor.candidate, `${path}.candidate`, errors);
    validateAudioRef(anchor.current, `${path}.current`, errors);
  });
}

/** Parse the committed JSON trust boundary and return all actionable errors at once. */
export function parseSampleLabCatalog(input: unknown): CatalogParseResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['catalog must be an object'] };
  if (input.version !== 1) errors.push('catalog.version must be 1');
  if (!Array.isArray(input.sources)) errors.push('catalog.sources must be an array');
  else input.sources.forEach((source, index) => validateSource(source, index, errors));
  if (!Array.isArray(input.candidates)) errors.push('catalog.candidates must be an array');
  else input.candidates.forEach((candidate, index) => validateCandidate(candidate, index, errors));

  if (Array.isArray(input.sources)) {
    const seen = new Set<string>();
    input.sources.forEach(source => {
      if (!isRecord(source) || !isNonEmptyString(source.id)) return;
      if (seen.has(source.id)) errors.push(`duplicate source id: ${source.id}`);
      seen.add(source.id);
    });
  }
  if (Array.isArray(input.candidates)) {
    const seen = new Set<string>();
    const sourceIds = new Set(
      Array.isArray(input.sources)
        ? input.sources.filter(isRecord).map(source => source.id).filter(isNonEmptyString)
        : []
    );
    input.candidates.forEach(candidate => {
      if (!isRecord(candidate) || !isNonEmptyString(candidate.id)) return;
      if (seen.has(candidate.id)) errors.push(`duplicate candidate id: ${candidate.id}`);
      seen.add(candidate.id);
      if (isNonEmptyString(candidate.sourceId) && !sourceIds.has(candidate.sourceId)) {
        errors.push(`candidate ${candidate.id} references unknown source ${candidate.sourceId}`);
      }
    });
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as SampleLabCatalog };
}

export function evaluateCandidateReadiness(candidate: SampleCandidate, sources: SampleSource[]): CandidateReadiness {
  const blockers: string[] = [];
  const reviewNotes: string[] = [];
  const source = sources.find(item => item.id === candidate.sourceId);
  if (!source) blockers.push(`Unknown source: ${candidate.sourceId}`);

  if (candidate.status === 'needs-provenance') blockers.push('License provenance is incomplete');
  if (candidate.status === 'rejected') blockers.push(`Candidate rejected: ${candidate.rejectionReason ?? 'no reason recorded'}`);
  if (!candidate.objective) {
    blockers.push('Objective audit has not run');
  } else {
    if (candidate.objective.hardErrors > 0) {
      blockers.push(`Objective audit has ${candidate.objective.hardErrors} hard ${candidate.objective.hardErrors === 1 ? 'error' : 'errors'}`);
    }
    if (!candidate.objective.browserDecode) blockers.push('Browser decode has not passed');
    if (candidate.objective.reviewFlags > 0) reviewNotes.push(`${candidate.objective.reviewFlags} objective review flag(s) need human disposition`);
  }

  if (candidate.comparisons.length === 0) blockers.push('No pitch-matched listening anchor is available');
  const uniqueTargets = new Set(candidate.comparisons.map(anchor => anchor.targetMidi));
  if (uniqueTargets.size < 3) blockers.push('Need at least 3 pitch-matched anchors for a promotion decision');
  const sortedTargets = [...uniqueTargets].sort((a, b) => a - b);
  if (sortedTargets.length >= 3 && sortedTargets.at(-1)! - sortedTargets[0] < 12) {
    blockers.push('Pitch anchors must span at least one octave');
  }

  const hardBlockers = blockers.filter(blocker =>
    !blocker.startsWith('Need at least 3 pitch-matched anchors') &&
    !blocker.startsWith('Pitch anchors must span')
  );
  if (hardBlockers.length > 0) return { level: 'blocked', blockers, reviewNotes };
  if (candidate.comparisons.length === 0) return { level: 'intake', blockers, reviewNotes };
  if (uniqueTargets.size < 3 || sortedTargets.at(-1)! - sortedTargets[0] < 12) {
    return { level: 'reviewable', blockers, reviewNotes };
  }
  return { level: 'decision-ready', blockers: [], reviewNotes };
}

export function playbackRateForTarget(targetMidi: number, rootMidi: number): number {
  return 2 ** ((targetMidi - rootMidi) / 12);
}

export interface SfzRegion {
  sample?: string;
  rootMidi?: number;
  loKey?: number;
  hiKey?: number;
  loVel: number;
  hiVel: number;
  sequencePosition?: number;
  sequenceLength?: number;
  randomLow?: number;
  randomHigh?: number;
}

export interface SfzSummary {
  regions: number;
  uniqueSamples: number;
  uniqueRootNotes: number;
  minRootMidi: number | null;
  maxRootMidi: number | null;
  maxVelocityLayers: number;
  maxRoundRobins: number;
  warnings: string[];
}

function stripSfzComments(input: string): string {
  return input
    .split(/\r?\n/)
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function parseOpcodes(segment: string): Record<string, string> {
  const opcodes: Record<string, string> = {};
  const regex = /([a-zA-Z_][\w]*)=([\s\S]*?)(?=\s+[a-zA-Z_][\w]*=|$)/g;
  for (const match of segment.matchAll(regex)) opcodes[match[1].toLowerCase()] = match[2].trim();
  return opcodes;
}

function noteNameToMidi(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (/^-?\d+$/.test(value)) {
    const midi = Number(value);
    return isMidi(midi) ? midi : undefined;
  }
  const match = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(value.trim());
  if (!match) return undefined;
  const pitchClasses: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pitch = pitchClasses[match[1].toUpperCase()];
  if (match[2] === '#') pitch += 1;
  if (match[2] === 'b') pitch -= 1;
  const midi = (Number(match[3]) + 1) * 12 + pitch;
  return isMidi(midi) ? midi : undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return number > 0 ? number : undefined;
}

function unitInterval(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined;
}

function velocity(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return isMidi(number) ? number : fallback;
}

function joinSamplePath(defaultPath: string, sample: string | undefined): string | undefined {
  if (!sample) return undefined;
  if (!defaultPath) return sample.replace(/\\/g, '/');
  return `${defaultPath.replace(/[\\/]$/, '')}/${sample.replace(/^[\\/]/, '')}`.replace(/\\/g, '/');
}

/**
 * Parse the SFZ mapping features useful for candidate discovery. This is not an
 * audio engine: unsupported opcodes are intentionally retained only through
 * inheritance long enough to extract sample, key, velocity, and sequence data.
 */
export function parseSfz(input: string): SfzRegion[] {
  const source = stripSfzComments(input);
  const header = /<(control|global|master|group|region)>/gi;
  const blocks: Array<{ type: string; body: string }> = [];
  const matches = [...source.matchAll(header)];
  for (let i = 0; i < matches.length; i++) {
    blocks.push({
      type: matches[i][1].toLowerCase(),
      body: source.slice((matches[i].index ?? 0) + matches[i][0].length, matches[i + 1]?.index ?? source.length),
    });
  }

  let defaultPath = '';
  let globalOps: Record<string, string> = {};
  let masterOps: Record<string, string> = {};
  let groupOps: Record<string, string> = {};
  const regions: SfzRegion[] = [];

  for (const block of blocks) {
    const ops = parseOpcodes(block.body);
    if (block.type === 'control') {
      if (ops.default_path !== undefined) defaultPath = ops.default_path;
      continue;
    }
    if (block.type === 'global') {
      globalOps = { ...globalOps, ...ops };
      masterOps = {};
      groupOps = {};
      continue;
    }
    if (block.type === 'master') {
      masterOps = { ...ops };
      groupOps = {};
      continue;
    }
    if (block.type === 'group') {
      groupOps = { ...ops };
      continue;
    }
    const merged = { ...globalOps, ...masterOps, ...groupOps, ...ops };
    const key = noteNameToMidi(merged.key);
    const rootMidi = noteNameToMidi(merged.pitch_keycenter) ?? key;
    regions.push({
      sample: joinSamplePath(defaultPath, merged.sample),
      rootMidi,
      loKey: noteNameToMidi(merged.lokey) ?? key,
      hiKey: noteNameToMidi(merged.hikey) ?? key,
      loVel: velocity(merged.lovel, 0),
      hiVel: velocity(merged.hivel, 127),
      sequencePosition: positiveInteger(merged.seq_position),
      sequenceLength: positiveInteger(merged.seq_length),
      randomLow: unitInterval(merged.lorand),
      randomHigh: unitInterval(merged.hirand),
    });
  }
  return regions;
}

export function summarizeSfz(regions: SfzRegion[]): SfzSummary {
  const warnings: string[] = [];
  regions.forEach((region, index) => {
    if (!region.sample) warnings.push(`Region ${index + 1} has no sample`);
    if (region.rootMidi === undefined) warnings.push(`Region ${index + 1} has no root pitch`);
    if (region.loVel > region.hiVel) warnings.push(`Region ${index + 1} has inverted velocity bounds`);
  });
  const samples = new Set(regions.map(region => region.sample).filter(isNonEmptyString));
  const roots = regions.map(region => region.rootMidi).filter((note): note is number => note !== undefined);
  const velocityByRoot = new Map<number, Set<string>>();
  const randomRangesByLayer = new Map<string, Set<string>>();
  let maxRoundRobins = 1;
  for (const region of regions) {
    if (region.rootMidi !== undefined) {
      const layer = `${region.loVel}-${region.hiVel}`;
      const layers = velocityByRoot.get(region.rootMidi) ?? new Set<string>();
      layers.add(layer);
      velocityByRoot.set(region.rootMidi, layers);
      if (region.randomLow !== undefined || region.randomHigh !== undefined) {
        const key = `${region.rootMidi}:${layer}`;
        const ranges = randomRangesByLayer.get(key) ?? new Set<string>();
        ranges.add(`${region.randomLow ?? 0}-${region.randomHigh ?? 1}`);
        randomRangesByLayer.set(key, ranges);
      }
    }
    const filenameRoundRobin = /(?:^|[_-])rr(\d+)(?:\D|$)/i.exec(region.sample ?? '');
    maxRoundRobins = Math.max(
      maxRoundRobins,
      region.sequenceLength ?? region.sequencePosition ?? 1,
      filenameRoundRobin ? Number(filenameRoundRobin[1]) : 1
    );
  }
  for (const ranges of randomRangesByLayer.values()) maxRoundRobins = Math.max(maxRoundRobins, ranges.size);
  return {
    regions: regions.length,
    uniqueSamples: samples.size,
    uniqueRootNotes: new Set(roots).size,
    minRootMidi: roots.length > 0 ? Math.min(...roots) : null,
    maxRootMidi: roots.length > 0 ? Math.max(...roots) : null,
    maxVelocityLayers: Math.max(0, ...[...velocityByRoot.values()].map(layers => layers.size)),
    maxRoundRobins: regions.length > 0 ? maxRoundRobins : 0,
    warnings,
  };
}
