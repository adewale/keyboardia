import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type InstrumentId = Brand<string, 'InstrumentId'>;
export type SourceId = Brand<string, 'SourceId'>;
export type RelativeSourcePath = Brand<string, 'RelativeSourcePath'>;
export type RelativeOutputPath = Brand<string, 'RelativeOutputPath'>;
export type Sha256 = Brand<string, 'Sha256'>;
export type MidiNote = Brand<number, 'MidiNote'>;
export type MidiVelocity = Brand<number, 'MidiVelocity'>;
export type FiniteDb = Brand<number, 'FiniteDb'>;

export interface RecipeSource {
  id: SourceId;
  path: RelativeSourcePath;
  sha256: Sha256;
}

export interface VelocityRange {
  min: MidiVelocity;
  max: MidiVelocity;
}

export interface RoundRobinSpec {
  group: string;
  index: number;
  count: number;
}

export interface SampleProcessing {
  trimStartSec?: number;
  trimEndSec?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}

export interface SamplePlayback {
  gainDb?: FiniteDb;
  tuneCents?: number;
  startOffsetSec?: number;
  endOffsetSec?: number;
  loopStartSec?: number;
  loopEndSec?: number;
}

export interface ExplicitSampleMapping {
  sourceId: SourceId;
  output: RelativeOutputPath;
  rootMidi: MidiNote;
  velocity: VelocityRange;
  articulation: string;
  roundRobin?: RoundRobinSpec;
  processing?: SampleProcessing;
  playback?: SamplePlayback;
}

export type ChannelPolicy =
  | { mode: 'preserve' }
  | { mode: 'mono'; method: 'average' | 'equal-power' };

export type DeliveryPolicy =
  | {
      codec: 'aac';
      container: 'm4a';
      sampleRate: 44100 | 48000;
      channels: ChannelPolicy;
      bitrateKbps: number;
    }
  | {
      codec: 'mp3';
      container: 'mp3';
      sampleRate: 44100 | 48000;
      channels: ChannelPolicy;
      bitrateKbps: number;
    }
  | {
      codec: 'wav';
      container: 'wav';
      sampleRate: 44100 | 48000;
      channels: ChannelPolicy;
    };

export type LevelingPolicy =
  | { mode: 'preserve-source' }
  | {
      mode: 'group-relative';
      anchorSourceId: SourceId;
      measuredPeakDb: FiniteDb;
      ceilingDb: FiniteDb;
      deliveryCeilingDb: FiniteDb;
      groupGainDb: FiniteDb;
    };

export interface ComparisonAnchorRecipe {
  id: string;
  targetMidi: MidiNote;
  velocity?: MidiVelocity;
  currentFile: RelativeSourcePath;
  currentRootMidi: MidiNote;
  candidateOutput: RelativeOutputPath;
  candidateRootMidi: MidiNote;
}

export interface SampleRecipe {
  version: 1;
  instrument: {
    id: InstrumentId;
    name: string;
    releaseTime: number;
    playableRange?: { min: MidiNote; max: MidiNote };
    playbackNote?: MidiNote;
    chokeGroup?: string;
    unpitched?: boolean;
    gainDb?: FiniteDb;
    velocityCrossfade?: number;
    priorityNotes?: MidiNote[];
    credits: { source: string; url: string; license: string };
  };
  sourceRevision: string;
  sources: RecipeSource[];
  mapping: { mode: 'explicit'; samples: ExplicitSampleMapping[] };
  delivery: DeliveryPolicy;
  leveling: LevelingPolicy;
  evidence: {
    sampleLabSourceId: string;
    currentInstrumentDir: RelativeSourcePath;
    anchors: ComparisonAnchorRecipe[];
  };
}

export interface ParsedSampleRecipe {
  readonly state: 'parsed';
  readonly recipe: SampleRecipe;
}

export interface VerifiedSource extends RecipeSource {
  absolutePath: string;
  actualSha256: Sha256;
  sizeBytes: number;
}

export interface VerifiedSampleRecipe {
  readonly state: 'verified';
  readonly recipe: SampleRecipe;
  readonly sourceRoot: string;
  readonly sources: VerifiedSource[];
}

export interface ManifestSamplePlan {
  note: number;
  file: string;
  velocityMin: number;
  velocityMax: number;
  articulation?: string;
  gainDb?: number;
  tuneCents?: number;
  startOffset?: number;
  endOffset?: number;
  roundRobinGroup?: string;
  roundRobinIndex?: number;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
}

export interface InstrumentManifestPlan {
  id: string;
  name: string;
  type: 'sampled';
  releaseTime: number;
  playableRange?: { min: number; max: number };
  playbackNote?: number;
  chokeGroup?: string;
  unpitched?: boolean;
  gainDb?: number;
  velocityCrossfade?: number;
  priorityNotes?: number[];
  credits: { source: string; url: string; license: string };
  samples: ManifestSamplePlan[];
}

export interface PlannedRender {
  sourceId: SourceId;
  sourcePath: string;
  outputPath: string;
  outputFile: RelativeOutputPath;
  command: 'ffmpeg';
  args: string[];
}

export interface PlannedSampleBuild {
  readonly state: 'planned';
  readonly verified: VerifiedSampleRecipe;
  readonly outputRoot: string;
  readonly renders: PlannedRender[];
  readonly manifest: InstrumentManifestPlan;
}

export type ParseRecipeResult =
  | { ok: true; value: ParsedSampleRecipe }
  | { ok: false; errors: string[] };

export type VerifySourcesResult =
  | { ok: true; value: VerifiedSampleRecipe }
  | { ok: false; errors: string[] };

export interface SfzRegionForImport {
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

export type SfzMappingImportResult =
  | { ok: true; mappings: ExplicitSampleMapping[]; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/**
 * Import mapping identity from SFZ opcodes without inferring notes or velocity
 * from filenames. Source IDs and hashes still come from the recipe's explicit
 * immutable source list; output names derive from those IDs, not audio names.
 */
export function importSfzMappings(options: {
  regions: readonly SfzRegionForImport[];
  sources: readonly RecipeSource[];
  container: DeliveryPolicy['container'];
  articulation: string;
}): SfzMappingImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourcesByPath = new Map(options.sources.map(source => [source.path as string, source]));
  const usedSources = new Set<string>();
  const mappings: ExplicitSampleMapping[] = [];
  options.regions.forEach((region, index) => {
    const field = `sfz region ${index + 1}`;
    if (!region.sample) {
      errors.push(`${field} has no sample opcode`);
      return;
    }
    const normalizedSample = region.sample.replaceAll('\\', '/').replace(/^\.\//, '');
    const source = sourcesByPath.get(normalizedSample);
    if (!source) {
      errors.push(`${field} sample is not in the immutable source list: ${normalizedSample}`);
      return;
    }
    if (!Number.isInteger(region.rootMidi) || region.rootMidi! < 0 || region.rootMidi! > 127) {
      errors.push(`${field} has no valid pitch_keycenter/key opcode`);
      return;
    }
    if (!Number.isInteger(region.loVel) || !Number.isInteger(region.hiVel)
        || region.loVel < 0 || region.hiVel > 127 || region.loVel > region.hiVel) {
      errors.push(`${field} has invalid velocity bounds`);
      return;
    }
    if (region.randomLow !== undefined || region.randomHigh !== undefined) {
      errors.push(`${field} uses random ranges; disposition to deterministic seq_position mappings is required`);
      return;
    }
    let roundRobin: RoundRobinSpec | undefined;
    if (region.sequencePosition !== undefined || region.sequenceLength !== undefined) {
      if (!Number.isInteger(region.sequencePosition) || !Number.isInteger(region.sequenceLength)
          || region.sequencePosition! < 1 || region.sequenceLength! < 1
          || region.sequencePosition! > region.sequenceLength!) {
        errors.push(`${field} has incomplete/invalid seq_position and seq_length`);
        return;
      }
      roundRobin = {
        group: `${options.articulation}-${region.rootMidi}-${region.loVel}-${region.hiVel}`,
        index: region.sequencePosition! - 1,
        count: region.sequenceLength!,
      };
    }
    if (region.loKey !== undefined || region.hiKey !== undefined) {
      warnings.push(`${field} key range ${region.loKey ?? '?'}-${region.hiKey ?? '?'} imported as root ${region.rootMidi}; review nearest-root boundaries`);
    }
    usedSources.add(source.id);
    mappings.push({
      sourceId: source.id,
      output: `${source.id}.${options.container}` as RelativeOutputPath,
      rootMidi: region.rootMidi as MidiNote,
      velocity: { min: region.loVel as MidiVelocity, max: region.hiVel as MidiVelocity },
      articulation: options.articulation,
      roundRobin,
    });
  });
  for (const source of options.sources) {
    if (!usedSources.has(source.id)) warnings.push(`immutable source ${source.id} is not selected by the SFZ import`);
  }
  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, mappings, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  errors: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${field}.${key} is not a recognized field`);
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readString(value: unknown, field: string, errors: string[]): string | undefined {
  if (!nonEmptyString(value)) {
    errors.push(`${field} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function readId<T extends string>(value: unknown, field: string, errors: string[]): Brand<string, T> | undefined {
  const text = readString(value, field, errors);
  if (text === undefined) return undefined;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(text)) {
    errors.push(`${field} must use lowercase letters, digits, and hyphens`);
    return undefined;
  }
  return text as Brand<string, T>;
}

function readRelativePath<T extends 'RelativeSourcePath' | 'RelativeOutputPath'>(
  value: unknown,
  field: string,
  errors: string[],
  _brand: T
): Brand<string, T> | undefined {
  const text = readString(value, field, errors);
  if (text === undefined) return undefined;
  const segments = text.split('/');
  const invalid = path.posix.isAbsolute(text)
    || text.includes('\\')
    || text.includes('\0')
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
    || path.posix.normalize(text) !== text;
  if (invalid) {
    errors.push(`${field} must be a normalized relative path without traversal`);
    return undefined;
  }
  return text as Brand<string, T>;
}

function readSha(value: unknown, field: string, errors: string[]): Sha256 | undefined {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    errors.push(`${field} must be a lowercase 64-character SHA-256 digest`);
    return undefined;
  }
  return value as Sha256;
}

function readIntegerInRange<T extends 'MidiNote' | 'MidiVelocity'>(
  value: unknown,
  field: string,
  min: number,
  max: number,
  errors: string[],
  _brand: T
): Brand<number, T> | undefined {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    errors.push(`${field} must be an integer from ${min} to ${max}`);
    return undefined;
  }
  return Number(value) as Brand<number, T>;
}

function readBoundedFinite(
  value: unknown,
  field: string,
  min: number,
  max: number,
  errors: string[]
): number | undefined {
  if (!finiteNumber(value) || value < min || value > max) {
    errors.push(`${field} must be a finite number from ${min} to ${max}`);
    return undefined;
  }
  return value;
}

function readOptionalBoundedFinite(
  value: unknown,
  field: string,
  min: number,
  max: number,
  errors: string[]
): number | undefined {
  return value === undefined ? undefined : readBoundedFinite(value, field, min, max, errors);
}

function parseCredits(value: unknown, field: string, errors: string[]): SampleRecipe['instrument']['credits'] | undefined {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return undefined;
  }
  rejectUnknownFields(value, field, ['source', 'url', 'license'], errors);
  const source = readString(value.source, `${field}.source`, errors);
  const url = readString(value.url, `${field}.url`, errors);
  const license = readString(value.license, `${field}.license`, errors);
  if (url !== undefined) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol');
    } catch {
      errors.push(`${field}.url must be an http(s) URL`);
    }
  }
  return source && url && license ? { source, url, license } : undefined;
}

function parseInstrument(value: unknown, errors: string[]): SampleRecipe['instrument'] | undefined {
  if (!isRecord(value)) {
    errors.push('instrument must be an object');
    return undefined;
  }
  rejectUnknownFields(value, 'instrument', [
    'id', 'name', 'releaseTime', 'playableRange', 'playbackNote', 'chokeGroup', 'unpitched',
    'gainDb', 'velocityCrossfade', 'priorityNotes', 'credits',
  ], errors);
  const id = readId<'InstrumentId'>(value.id, 'instrument.id', errors);
  const name = readString(value.name, 'instrument.name', errors);
  const releaseTime = readBoundedFinite(value.releaseTime, 'instrument.releaseTime', 0, 30, errors);
  const credits = parseCredits(value.credits, 'instrument.credits', errors);
  let playableRange: { min: MidiNote; max: MidiNote } | undefined;
  if (value.playableRange !== undefined) {
    if (!isRecord(value.playableRange)) {
      errors.push('instrument.playableRange must be an object');
    } else {
      rejectUnknownFields(value.playableRange, 'instrument.playableRange', ['min', 'max'], errors);
      const min = readIntegerInRange<'MidiNote'>(value.playableRange.min, 'instrument.playableRange.min', 0, 127, errors, 'MidiNote');
      const max = readIntegerInRange<'MidiNote'>(value.playableRange.max, 'instrument.playableRange.max', 0, 127, errors, 'MidiNote');
      if (min !== undefined && max !== undefined) {
        if (min > max) errors.push('instrument.playableRange.min must not exceed max');
        else playableRange = { min, max };
      }
    }
  }
  const playbackNote = value.playbackNote === undefined
    ? undefined
    : readIntegerInRange<'MidiNote'>(value.playbackNote, 'instrument.playbackNote', 0, 127, errors, 'MidiNote');
  const chokeGroup = value.chokeGroup === undefined
    ? undefined
    : readString(value.chokeGroup, 'instrument.chokeGroup', errors);
  let unpitched: boolean | undefined;
  if (value.unpitched !== undefined) {
    if (typeof value.unpitched !== 'boolean') errors.push('instrument.unpitched must be boolean');
    else unpitched = value.unpitched;
  }
  const gainDb = value.gainDb === undefined
    ? undefined
    : readBoundedFinite(value.gainDb, 'instrument.gainDb', -24, 24, errors) as FiniteDb | undefined;
  const velocityCrossfade = value.velocityCrossfade === undefined
    ? undefined
    : readBoundedFinite(value.velocityCrossfade, 'instrument.velocityCrossfade', 0, 32, errors);
  let priorityNotes: MidiNote[] | undefined;
  if (value.priorityNotes !== undefined) {
    if (!Array.isArray(value.priorityNotes) || value.priorityNotes.length === 0) {
      errors.push('instrument.priorityNotes must be a non-empty array');
    } else {
      const parsed = value.priorityNotes.flatMap((note, index) => {
        const midi = readIntegerInRange<'MidiNote'>(note, `instrument.priorityNotes[${index}]`, 0, 127, errors, 'MidiNote');
        return midi === undefined ? [] : [midi];
      });
      if (new Set(parsed).size !== parsed.length) errors.push('instrument.priorityNotes must be unique');
      if (parsed.length > 0) priorityNotes = parsed;
    }
  }
  if (!id || !name || releaseTime === undefined || !credits) return undefined;
  return {
    id,
    name,
    releaseTime,
    playableRange,
    playbackNote,
    chokeGroup,
    unpitched,
    gainDb,
    velocityCrossfade,
    priorityNotes,
    credits,
  };
}

function parseSources(value: unknown, errors: string[]): RecipeSource[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('sources must be a non-empty array');
    return [];
  }
  const sources: RecipeSource[] = [];
  const ids = new Set<string>();
  value.forEach((raw, index) => {
    const field = `sources[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${field} must be an object`);
      return;
    }
    rejectUnknownFields(raw, field, ['id', 'path', 'sha256'], errors);
    const id = readId<'SourceId'>(raw.id, `${field}.id`, errors);
    const sourcePath = readRelativePath(raw.path, `${field}.path`, errors, 'RelativeSourcePath');
    const sha256 = readSha(raw.sha256, `${field}.sha256`, errors);
    if (sourcePath && !/\.(?:wav|flac|aiff?)$/i.test(sourcePath)) {
      errors.push(`${field}.path must identify a lossless WAV, FLAC, or AIFF master`);
    }
    if (id) {
      if (ids.has(id)) errors.push(`duplicate source id: ${id}`);
      ids.add(id);
    }
    if (id && sourcePath && sha256) sources.push({ id, path: sourcePath, sha256 });
  });
  return sources;
}

function parseVelocity(value: unknown, field: string, errors: string[]): VelocityRange | undefined {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return undefined;
  }
  rejectUnknownFields(value, field, ['min', 'max'], errors);
  const min = readIntegerInRange<'MidiVelocity'>(value.min, `${field}.min`, 0, 127, errors, 'MidiVelocity');
  const max = readIntegerInRange<'MidiVelocity'>(value.max, `${field}.max`, 0, 127, errors, 'MidiVelocity');
  if (min === undefined || max === undefined) return undefined;
  if (min > max) {
    errors.push(`${field}.min must not exceed max`);
    return undefined;
  }
  return { min, max };
}

function parseRoundRobin(value: unknown, field: string, errors: string[]): RoundRobinSpec | undefined {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return undefined;
  }
  rejectUnknownFields(value, field, ['group', 'index', 'count'], errors);
  const group = readString(value.group, `${field}.group`, errors);
  const index = readIntegerInRange<'MidiNote'>(value.index, `${field}.index`, 0, 127, errors, 'MidiNote');
  const count = readIntegerInRange<'MidiNote'>(value.count, `${field}.count`, 1, 128, errors, 'MidiNote');
  if (!group || index === undefined || count === undefined) return undefined;
  if (index >= count) {
    errors.push(`${field}.index must be less than count`);
    return undefined;
  }
  return { group, index, count };
}

function parseProcessing(value: unknown, field: string, errors: string[]): SampleProcessing | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return undefined;
  }
  rejectUnknownFields(value, field, ['trimStartSec', 'trimEndSec', 'fadeInSec', 'fadeOutSec'], errors);
  const processing: SampleProcessing = {
    trimStartSec: readOptionalBoundedFinite(value.trimStartSec, `${field}.trimStartSec`, 0, 3600, errors),
    trimEndSec: readOptionalBoundedFinite(value.trimEndSec, `${field}.trimEndSec`, 0, 3600, errors),
    fadeInSec: readOptionalBoundedFinite(value.fadeInSec, `${field}.fadeInSec`, 0, 30, errors),
    fadeOutSec: readOptionalBoundedFinite(value.fadeOutSec, `${field}.fadeOutSec`, 0, 30, errors),
  };
  if (processing.trimStartSec !== undefined && processing.trimEndSec !== undefined && processing.trimStartSec >= processing.trimEndSec) {
    errors.push(`${field}.trimStartSec must be less than trimEndSec`);
  }
  return processing;
}

function parsePlayback(value: unknown, field: string, errors: string[]): SamplePlayback | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return undefined;
  }
  rejectUnknownFields(value, field, [
    'gainDb', 'tuneCents', 'startOffsetSec', 'endOffsetSec', 'loopStartSec', 'loopEndSec',
  ], errors);
  const gainDb = value.gainDb === undefined
    ? undefined
    : readBoundedFinite(value.gainDb, `${field}.gainDb`, -24, 24, errors) as FiniteDb | undefined;
  const tuneCents = readOptionalBoundedFinite(value.tuneCents, `${field}.tuneCents`, -100, 100, errors);
  const startOffsetSec = readOptionalBoundedFinite(value.startOffsetSec, `${field}.startOffsetSec`, 0, 3600, errors);
  const endOffsetSec = readOptionalBoundedFinite(value.endOffsetSec, `${field}.endOffsetSec`, 0, 3600, errors);
  const loopStartSec = readOptionalBoundedFinite(value.loopStartSec, `${field}.loopStartSec`, 0, 3600, errors);
  const loopEndSec = readOptionalBoundedFinite(value.loopEndSec, `${field}.loopEndSec`, 0, 3600, errors);
  if (startOffsetSec !== undefined && endOffsetSec !== undefined && startOffsetSec >= endOffsetSec) {
    errors.push(`${field}.startOffsetSec must be less than endOffsetSec`);
  }
  if (loopEndSec !== undefined && loopStartSec === undefined) errors.push(`${field}.loopEndSec requires loopStartSec`);
  if (loopStartSec !== undefined && loopEndSec !== undefined && loopStartSec >= loopEndSec) {
    errors.push(`${field}.loopStartSec must be less than loopEndSec`);
  }
  return { gainDb, tuneCents, startOffsetSec, endOffsetSec, loopStartSec, loopEndSec };
}

function parseMappings(value: unknown, sources: RecipeSource[], errors: string[]): ExplicitSampleMapping[] {
  if (!isRecord(value)) {
    errors.push('mapping must be an object');
    return [];
  }
  rejectUnknownFields(value, 'mapping', ['mode', 'samples'], errors);
  if (value.mode !== 'explicit') {
    errors.push('mapping.mode must be "explicit"');
    return [];
  }
  if (!Array.isArray(value.samples) || value.samples.length === 0) {
    errors.push('mapping.samples must be a non-empty array');
    return [];
  }
  const sourceIds = new Set(sources.map(source => source.id));
  const outputs = new Map<string, string>();
  const identities = new Set<string>();
  const samples: ExplicitSampleMapping[] = [];
  value.samples.forEach((raw, index) => {
    const field = `mapping.samples[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${field} must be an object`);
      return;
    }
    rejectUnknownFields(raw, field, [
      'sourceId', 'output', 'rootMidi', 'velocity', 'articulation', 'roundRobin', 'processing', 'playback',
    ], errors);
    const sourceId = readId<'SourceId'>(raw.sourceId, `${field}.sourceId`, errors);
    const output = readRelativePath(raw.output, `${field}.output`, errors, 'RelativeOutputPath');
    const rootMidi = readIntegerInRange<'MidiNote'>(raw.rootMidi, `${field}.rootMidi`, 0, 127, errors, 'MidiNote');
    const velocity = parseVelocity(raw.velocity, `${field}.velocity`, errors);
    const articulation = raw.articulation === undefined
      ? 'default'
      : readString(raw.articulation, `${field}.articulation`, errors);
    const roundRobin = raw.roundRobin === undefined
      ? undefined
      : parseRoundRobin(raw.roundRobin, `${field}.roundRobin`, errors);
    const processing = parseProcessing(raw.processing, `${field}.processing`, errors);
    const playback = parsePlayback(raw.playback, `${field}.playback`, errors);
    if (sourceId && !sourceIds.has(sourceId)) errors.push(`${field}.sourceId references unknown source ${sourceId}`);
    if (output && sourceId) {
      const priorSource = outputs.get(output);
      if (priorSource !== undefined && priorSource !== sourceId) {
        errors.push(`output path collision: ${output} is produced by both ${priorSource} and ${sourceId}`);
      } else {
        outputs.set(output, sourceId);
      }
    }
    if (sourceId && output && rootMidi !== undefined && velocity && articulation) {
      const rrIdentity = roundRobin ? `${roundRobin.group}:${roundRobin.index}` : 'single';
      const identity = `${rootMidi}:${velocity.min}-${velocity.max}:${articulation}:${rrIdentity}`;
      if (identities.has(identity)) errors.push(`duplicate sample identity: ${identity}`);
      identities.add(identity);
      samples.push({ sourceId, output, rootMidi, velocity, articulation, roundRobin, processing, playback });
    }
  });
  for (const source of sources) {
    const references = samples.filter(sample => sample.sourceId === source.id);
    const outputsForSource = new Set(references.map(sample => sample.output));
    const processingForSource = new Set(references.map(sample => JSON.stringify(sample.processing ?? {})));
    if (references.length === 0 || outputsForSource.size !== 1 || processingForSource.size !== 1) {
      errors.push(`source ${source.id} must produce exactly one delivery output with one render policy; mapped ${references.length} identities to ${outputsForSource.size} outputs`);
    }
  }
  return samples;
}

function parseDelivery(value: unknown, errors: string[]): DeliveryPolicy | undefined {
  if (!isRecord(value)) {
    errors.push('delivery must be an object');
    return undefined;
  }
  rejectUnknownFields(value, 'delivery', ['codec', 'container', 'bitrateKbps', 'sampleRate', 'channels'], errors);
  const codec = value.codec;
  const container = value.container;
  if (codec !== 'aac' && codec !== 'mp3' && codec !== 'wav') errors.push('delivery.codec must be aac, mp3, or wav');
  if (container !== 'm4a' && container !== 'mp3' && container !== 'wav') errors.push('delivery.container must be m4a, mp3, or wav');
  if ((codec === 'aac' && container !== 'm4a') || (codec === 'mp3' && container !== 'mp3') || (codec === 'wav' && container !== 'wav')) {
    errors.push('delivery codec/container pair is incompatible');
  }
  const sampleRate = value.sampleRate === 44100 || value.sampleRate === 48000
    ? value.sampleRate
    : undefined;
  if (!sampleRate) errors.push('delivery.sampleRate must be 44100 or 48000');
  let channels: ChannelPolicy | undefined;
  if (!isRecord(value.channels)) {
    errors.push('delivery.channels must be an object');
  } else if ((rejectUnknownFields(value.channels, 'delivery.channels', ['mode', 'method'], errors), value.channels.mode === 'preserve')) {
    channels = { mode: 'preserve' };
  } else if (value.channels.mode === 'mono' && (value.channels.method === 'average' || value.channels.method === 'equal-power')) {
    channels = { mode: 'mono', method: value.channels.method };
  } else {
    errors.push('delivery.channels must explicitly preserve or declare a mono downmix method');
  }
  if (!codec || !container || !sampleRate || !channels) return undefined;
  if (codec === 'wav') return { codec, container: 'wav', sampleRate, channels };
  const bitrateKbps = readBoundedFinite(value.bitrateKbps, 'delivery.bitrateKbps', 64, 320, errors);
  if (bitrateKbps === undefined) return undefined;
  if (codec === 'aac' && container === 'm4a') return { codec, container, sampleRate, channels, bitrateKbps };
  if (codec === 'mp3' && container === 'mp3') return { codec, container, sampleRate, channels, bitrateKbps };
  return undefined;
}

function parseLeveling(value: unknown, sources: RecipeSource[], errors: string[]): LevelingPolicy | undefined {
  if (!isRecord(value)) {
    errors.push('leveling must be an object');
    return undefined;
  }
  rejectUnknownFields(value, 'leveling', [
    'mode', 'anchorSourceId', 'measuredPeakDb', 'ceilingDb', 'deliveryCeilingDb', 'groupGainDb',
  ], errors);
  if (value.mode === 'preserve-source') return { mode: 'preserve-source' };
  if (value.mode === 'group-relative') {
    const anchorSourceId = readId<'SourceId'>(value.anchorSourceId, 'leveling.anchorSourceId', errors);
    const measuredPeakDb = readBoundedFinite(value.measuredPeakDb, 'leveling.measuredPeakDb', -120, 0, errors) as FiniteDb | undefined;
    const ceilingDb = readBoundedFinite(value.ceilingDb, 'leveling.ceilingDb', -24, 0, errors) as FiniteDb | undefined;
    const deliveryCeilingDb = readBoundedFinite(value.deliveryCeilingDb, 'leveling.deliveryCeilingDb', -24, 0, errors) as FiniteDb | undefined;
    const groupGainDb = readBoundedFinite(value.groupGainDb, 'leveling.groupGainDb', -24, 0, errors) as FiniteDb | undefined;
    if (anchorSourceId && !sources.some(source => source.id === anchorSourceId)) {
      errors.push(`leveling.anchorSourceId references unknown source ${anchorSourceId}`);
    }
    if (measuredPeakDb !== undefined && ceilingDb !== undefined && groupGainDb !== undefined) {
      const expected = Math.min(0, ceilingDb - measuredPeakDb);
      if (Math.abs(groupGainDb - expected) > 0.01) {
        errors.push(`leveling.groupGainDb must equal the declared group ceiling minus anchor peak (${expected.toFixed(2)} dB)`);
      }
    }
    return anchorSourceId && measuredPeakDb !== undefined && ceilingDb !== undefined && deliveryCeilingDb !== undefined && groupGainDb !== undefined
      ? { mode: 'group-relative', anchorSourceId, measuredPeakDb, ceilingDb, deliveryCeilingDb, groupGainDb }
      : undefined;
  }
  errors.push('leveling.mode must be preserve-source or group-relative');
  return undefined;
}

function parseEvidence(value: unknown, errors: string[]): SampleRecipe['evidence'] | undefined {
  if (!isRecord(value)) {
    errors.push('evidence must be an object');
    return undefined;
  }
  rejectUnknownFields(value, 'evidence', ['sampleLabSourceId', 'currentInstrumentDir', 'anchors'], errors);
  const sampleLabSourceId = readId<'SourceId'>(value.sampleLabSourceId, 'evidence.sampleLabSourceId', errors);
  const currentInstrumentDir = readRelativePath(value.currentInstrumentDir, 'evidence.currentInstrumentDir', errors, 'RelativeSourcePath');
  if (!Array.isArray(value.anchors) || value.anchors.length === 0) {
    errors.push('evidence.anchors must be a non-empty array');
    return undefined;
  }
  const ids = new Set<string>();
  const anchors: ComparisonAnchorRecipe[] = [];
  value.anchors.forEach((raw, index) => {
    const field = `evidence.anchors[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${field} must be an object`);
      return;
    }
    rejectUnknownFields(raw, field, [
      'id', 'targetMidi', 'velocity', 'currentFile', 'currentRootMidi', 'candidateOutput', 'candidateRootMidi',
    ], errors);
    const id = readString(raw.id, `${field}.id`, errors);
    const targetMidi = readIntegerInRange<'MidiNote'>(raw.targetMidi, `${field}.targetMidi`, 0, 127, errors, 'MidiNote');
    const velocity = raw.velocity === undefined
      ? undefined
      : readIntegerInRange<'MidiVelocity'>(raw.velocity, `${field}.velocity`, 0, 127, errors, 'MidiVelocity');
    const currentFile = readRelativePath(raw.currentFile, `${field}.currentFile`, errors, 'RelativeSourcePath');
    const currentRootMidi = readIntegerInRange<'MidiNote'>(raw.currentRootMidi, `${field}.currentRootMidi`, 0, 127, errors, 'MidiNote');
    const candidateOutput = readRelativePath(raw.candidateOutput, `${field}.candidateOutput`, errors, 'RelativeOutputPath');
    const candidateRootMidi = readIntegerInRange<'MidiNote'>(raw.candidateRootMidi, `${field}.candidateRootMidi`, 0, 127, errors, 'MidiNote');
    if (id) {
      if (ids.has(id)) errors.push(`duplicate evidence anchor id: ${id}`);
      ids.add(id);
    }
    if (id && targetMidi !== undefined && currentFile && currentRootMidi !== undefined && candidateOutput && candidateRootMidi !== undefined) {
      anchors.push({ id, targetMidi, velocity, currentFile, currentRootMidi, candidateOutput, candidateRootMidi });
    }
  });
  if (anchors.length < 3) errors.push('evidence.anchors must contain at least three pitch-matched anchors');
  if (anchors.length >= 2) {
    const targets = anchors.map(anchor => anchor.targetMidi);
    if (Math.max(...targets) - Math.min(...targets) < 12) {
      errors.push('evidence.anchors must span at least one octave');
    }
  }
  return sampleLabSourceId && currentInstrumentDir && anchors.length > 0
    ? { sampleLabSourceId, currentInstrumentDir, anchors }
    : undefined;
}

function validateMappingInvariants(recipeParts: {
  samples: ExplicitSampleMapping[];
  delivery?: DeliveryPolicy;
  playableRange?: { min: MidiNote; max: MidiNote };
  priorityNotes?: MidiNote[];
}, errors: string[]): void {
  const extension = recipeParts.delivery?.container;
  const groups = new Map<string, ExplicitSampleMapping[]>();
  for (const sample of recipeParts.samples) {
    if (extension && path.posix.extname(sample.output).toLowerCase() !== `.${extension}`) {
      errors.push(`mapping output ${sample.output} must use .${extension} for the declared delivery`);
    }
    if (recipeParts.playableRange && (sample.rootMidi < recipeParts.playableRange.min || sample.rootMidi > recipeParts.playableRange.max)) {
      errors.push(`mapping root ${sample.rootMidi} is outside instrument.playableRange`);
    }
    const key = `${sample.rootMidi}:${sample.articulation}`;
    const current = groups.get(key) ?? [];
    current.push(sample);
    groups.set(key, current);
  }
  const mappedNotes = new Set(recipeParts.samples.map(sample => sample.rootMidi));
  for (const priority of recipeParts.priorityNotes ?? []) {
    if (!mappedNotes.has(priority)) errors.push(`instrument.priorityNotes contains unmapped note ${priority}`);
  }
  for (const [key, samples] of groups) {
    const velocityGroups = new Map<string, ExplicitSampleMapping[]>();
    for (const sample of samples) {
      const range = `${sample.velocity.min}-${sample.velocity.max}`;
      const current = velocityGroups.get(range) ?? [];
      current.push(sample);
      velocityGroups.set(range, current);
    }
    const ranges = [...velocityGroups.entries()]
      .map(([range, variants]) => ({
        min: variants[0].velocity.min,
        max: variants[0].velocity.max,
        variants,
        range,
      }))
      .sort((a, b) => a.min - b.min);
    let expected = 0;
    for (const range of ranges) {
      if (range.min !== expected) {
        errors.push(`velocity coverage for ${key} must be contiguous 0-127; expected ${expected}, got ${range.min}`);
      }
      expected = range.max + 1;
      if (range.variants.length > 1 || range.variants[0].roundRobin) {
        const variants = [...range.variants].sort((a, b) => (a.roundRobin?.index ?? -1) - (b.roundRobin?.index ?? -1));
        const expectedCount = variants[0].roundRobin?.count;
        const expectedGroup = variants[0].roundRobin?.group;
        if (!expectedCount || !expectedGroup || variants.length !== expectedCount || variants.some((variant, index) =>
          variant.roundRobin?.group !== expectedGroup
          || variant.roundRobin?.count !== expectedCount
          || variant.roundRobin?.index !== index
        )) {
          errors.push(`round robin for ${key} velocity ${range.range} must use one group and contain every index 0..count-1 exactly once`);
        }
      }
    }
    if (expected !== 128) errors.push(`velocity coverage for ${key} must end at 127; ended at ${expected - 1}`);
  }
}

export function parseSampleRecipe(input: unknown): ParseRecipeResult {
  try {
    const errors: string[] = [];
    if (!isRecord(input)) return { ok: false, errors: ['recipe must be an object'] };
    rejectUnknownFields(input, 'recipe', [
      'version', 'instrument', 'sourceRevision', 'sources', 'mapping', 'delivery', 'leveling', 'evidence',
    ], errors);
    if (input.version !== 1) errors.push('version must be 1');
    const instrument = parseInstrument(input.instrument, errors);
    const sourceRevision = readString(input.sourceRevision, 'sourceRevision', errors);
    const sources = parseSources(input.sources, errors);
    const samples = parseMappings(input.mapping, sources, errors);
    const delivery = parseDelivery(input.delivery, errors);
    const leveling = parseLeveling(input.leveling, sources, errors);
    const evidence = parseEvidence(input.evidence, errors);
    validateMappingInvariants({
      samples,
      delivery,
      playableRange: instrument?.playableRange,
      priorityNotes: instrument?.priorityNotes,
    }, errors);
    if (errors.length > 0 || !instrument || !sourceRevision || sources.length === 0 || samples.length === 0 || !delivery || !leveling || !evidence) {
      return { ok: false, errors };
    }
    return {
      ok: true,
      value: {
        state: 'parsed',
        recipe: {
          version: 1,
          instrument,
          sourceRevision,
          sources,
          mapping: { mode: 'explicit', samples },
          delivery,
          leveling,
          evidence,
        },
      },
    };
  } catch (error) {
    return { ok: false, errors: [`recipe parser internal error: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

async function sha256File(filename: string): Promise<Sha256> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex') as Sha256;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function hasLosslessContainerSignature(filename: string): boolean {
  const bytes = Buffer.alloc(12);
  const fd = fs.openSync(filename, 'r');
  let read = 0;
  try {
    read = fs.readSync(fd, bytes, 0, bytes.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (read < 4) return false;
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.flac') return bytes.subarray(0, 4).toString('ascii') === 'fLaC';
  if (extension === '.wav') {
    return read >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WAVE';
  }
  if (extension === '.aif' || extension === '.aiff') {
    const form = bytes.subarray(0, 4).toString('ascii');
    const type = bytes.subarray(8, 12).toString('ascii');
    return read >= 12 && form === 'FORM' && (type === 'AIFF' || type === 'AIFC');
  }
  return false;
}

export async function verifyRecipeSources(parsed: ParsedSampleRecipe, sourceRoot: string): Promise<VerifySourcesResult> {
  const requestedRoot = path.resolve(sourceRoot);
  const errors: string[] = [];
  let absoluteRoot: string;
  try {
    absoluteRoot = fs.realpathSync(requestedRoot);
  } catch {
    return { ok: false, errors: [`source root not found: ${requestedRoot}`] };
  }
  const productionRoot = path.resolve(parsed.recipe.evidence.currentInstrumentDir);
  const verified: VerifiedSource[] = [];
  for (const source of parsed.recipe.sources) {
    const requestedPath = path.resolve(absoluteRoot, ...source.path.split('/'));
    if (!isWithin(absoluteRoot, requestedPath)) {
      errors.push(`${source.id}: source path escapes source root`);
      continue;
    }
    let absolutePath: string;
    let stat: fs.Stats;
    try {
      if (fs.lstatSync(requestedPath).isSymbolicLink()) {
        errors.push(`${source.id}: symbolic-link masters are not allowed: ${source.path}`);
        continue;
      }
      absolutePath = fs.realpathSync(requestedPath);
      stat = fs.statSync(absolutePath);
    } catch {
      errors.push(`${source.id}: source file not found: ${source.path}`);
      continue;
    }
    if (!isWithin(absoluteRoot, absolutePath)) {
      errors.push(`${source.id}: resolved source path escapes source root`);
      continue;
    }
    if (absolutePath === productionRoot || isWithin(productionRoot, absolutePath)) {
      errors.push(`${source.id}: immutable masters must not be read from production: ${source.path}`);
      continue;
    }
    if (!stat.isFile()) {
      errors.push(`${source.id}: source is not a regular file: ${source.path}`);
      continue;
    }
    if (!hasLosslessContainerSignature(absolutePath)) {
      errors.push(`${source.id}: source bytes do not match the declared lossless container: ${source.path}`);
      continue;
    }
    const actualSha256 = await sha256File(absolutePath);
    if (actualSha256 !== source.sha256) {
      errors.push(`${source.id}: SHA-256 mismatch for ${source.path}; expected ${source.sha256}, got ${actualSha256}`);
      continue;
    }
    verified.push({ ...source, absolutePath, actualSha256, sizeBytes: stat.size });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { state: 'verified', recipe: parsed.recipe, sourceRoot: absoluteRoot, sources: verified } };
}

function channelFilters(policy: ChannelPolicy): string[] {
  if (policy.mode === 'preserve') return [];
  return [policy.method === 'equal-power'
    ? 'pan=mono|c0=0.70710678*c0+0.70710678*c1'
    : 'pan=mono|c0=0.5*c0+0.5*c1'];
}

function processingFilters(processing: SampleProcessing | undefined): string[] {
  if (!processing) return [];
  const filters: string[] = [];
  if (processing.trimStartSec !== undefined || processing.trimEndSec !== undefined) {
    const parts = ['atrim'];
    if (processing.trimStartSec !== undefined) parts.push(`start=${processing.trimStartSec}`);
    if (processing.trimEndSec !== undefined) parts.push(`end=${processing.trimEndSec}`);
    filters.push(parts.join(':'));
    filters.push('asetpts=PTS-STARTPTS');
  }
  if (processing.fadeInSec && processing.fadeInSec > 0) filters.push(`afade=t=in:st=0:d=${processing.fadeInSec}`);
  if (processing.fadeOutSec && processing.fadeOutSec > 0) {
    filters.push('areverse', `afade=t=in:st=0:d=${processing.fadeOutSec}`, 'areverse');
  }
  return filters;
}

function codecArgs(policy: DeliveryPolicy): string[] {
  if (policy.codec === 'aac') return ['-c:a', 'aac', '-b:a', `${policy.bitrateKbps}k`, '-movflags', '+faststart'];
  if (policy.codec === 'mp3') return ['-c:a', 'libmp3lame', '-b:a', `${policy.bitrateKbps}k`];
  return ['-c:a', 'pcm_s24le'];
}

function buildRenderArgs(
  sourcePath: string,
  outputPath: string,
  mapping: ExplicitSampleMapping,
  delivery: DeliveryPolicy,
  leveling: LevelingPolicy
): string[] {
  const filters = [
    ...processingFilters(mapping.processing),
    ...(leveling.mode === 'group-relative' ? [`volume=${leveling.groupGainDb}dB`] : []),
    ...channelFilters(delivery.channels),
  ];
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', sourcePath,
    ...(filters.length > 0 ? ['-af', filters.join(',')] : []),
    '-vn', '-map_metadata', '-1', '-ar', String(delivery.sampleRate),
    ...codecArgs(delivery),
    outputPath,
  ];
}

function manifestSample(mapping: ExplicitSampleMapping): ManifestSamplePlan {
  return {
    note: mapping.rootMidi,
    file: mapping.output,
    velocityMin: mapping.velocity.min,
    velocityMax: mapping.velocity.max,
    ...(mapping.articulation !== 'default' ? { articulation: mapping.articulation } : {}),
    ...(mapping.playback?.gainDb !== undefined ? { gainDb: mapping.playback.gainDb } : {}),
    ...(mapping.playback?.tuneCents !== undefined ? { tuneCents: mapping.playback.tuneCents } : {}),
    ...(mapping.playback?.startOffsetSec !== undefined ? { startOffset: mapping.playback.startOffsetSec } : {}),
    ...(mapping.playback?.endOffsetSec !== undefined ? { endOffset: mapping.playback.endOffsetSec } : {}),
    ...(mapping.playback?.loopStartSec !== undefined ? {
      loop: true,
      loopStart: mapping.playback.loopStartSec,
      ...(mapping.playback.loopEndSec !== undefined ? { loopEnd: mapping.playback.loopEndSec } : {}),
    } : {}),
    ...(mapping.roundRobin ? {
      roundRobinGroup: mapping.roundRobin.group,
      roundRobinIndex: mapping.roundRobin.index,
    } : {}),
  };
}

export function planSampleBuild(verified: VerifiedSampleRecipe, outputRoot: string): PlannedSampleBuild {
  const absoluteOutputRoot = path.resolve(outputRoot);
  if (isWithin(verified.sourceRoot, absoluteOutputRoot) || isWithin(absoluteOutputRoot, verified.sourceRoot) || absoluteOutputRoot === verified.sourceRoot) {
    throw new Error('candidate output and immutable source roots must not overlap');
  }
  const sources = new Map(verified.sources.map(source => [source.id, source]));
  const renderMappings = [...new Map(verified.recipe.mapping.samples.map(mapping => [
    `${mapping.sourceId}:${mapping.output}`,
    mapping,
  ])).values()];
  const renders = renderMappings.map(mapping => {
    const source = sources.get(mapping.sourceId);
    if (!source) throw new Error(`verified source missing: ${mapping.sourceId}`);
    const outputPath = path.resolve(absoluteOutputRoot, ...mapping.output.split('/'));
    if (!isWithin(absoluteOutputRoot, outputPath)) throw new Error(`output escapes candidate root: ${mapping.output}`);
    return {
      sourceId: mapping.sourceId,
      sourcePath: source.absolutePath,
      outputPath,
      outputFile: mapping.output,
      command: 'ffmpeg' as const,
      args: buildRenderArgs(
        source.absolutePath,
        outputPath,
        mapping,
        verified.recipe.delivery,
        verified.recipe.leveling
      ),
    };
  });
  const { instrument } = verified.recipe;
  return {
    state: 'planned',
    verified,
    outputRoot: absoluteOutputRoot,
    renders,
    manifest: {
      id: instrument.id,
      name: instrument.name,
      type: 'sampled',
      releaseTime: instrument.releaseTime,
      ...(instrument.playableRange ? { playableRange: instrument.playableRange } : {}),
      ...(instrument.playbackNote !== undefined ? { playbackNote: instrument.playbackNote } : {}),
      ...(instrument.chokeGroup !== undefined ? { chokeGroup: instrument.chokeGroup } : {}),
      ...(instrument.unpitched !== undefined ? { unpitched: instrument.unpitched } : {}),
      ...(instrument.gainDb !== undefined ? { gainDb: instrument.gainDb } : {}),
      ...(instrument.velocityCrossfade !== undefined ? { velocityCrossfade: instrument.velocityCrossfade } : {}),
      ...(instrument.priorityNotes !== undefined ? { priorityNotes: instrument.priorityNotes } : {}),
      credits: instrument.credits,
      samples: verified.recipe.mapping.samples.map(manifestSample),
    },
  };
}
