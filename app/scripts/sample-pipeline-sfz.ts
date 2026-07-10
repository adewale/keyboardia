import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseSfz, type SfzRegion } from './sample-lab-core';
import {
  importSfzMappings,
  type DeliveryPolicy,
  type ExplicitSampleMapping,
  type RecipeSource,
  type RelativeSourcePath,
  type Sha256,
  type SourceId,
} from './sample-pipeline-core';

export type SfzPreprocessResult =
  | { ok: true; value: string }
  | { ok: false; errors: string[] };

export interface GenerateSfzImportOptions {
  sfzFile: string;
  sourceRoot: string;
  articulation: string;
  container: DeliveryPolicy['container'];
  randomPolicy: 'reject' | 'deterministic-round-robin';
  velocityZeroPolicy?: 'reject' | 'extend-lowest-layer';
  includeRoots?: readonly number[];
  mappedRootMidi?: number;
  samplePathIncludes?: string;
}

export interface GeneratedSfzImport {
  sfzFile: string;
  preprocessedSfzSha256: string;
  sources: RecipeSource[];
  mappings: ExplicitSampleMapping[];
  warnings: string[];
}

export type GenerateSfzImportResult =
  | { ok: true; value: GeneratedSfzImport }
  | { ok: false; errors: string[] };

function within(root: string, filename: string): boolean {
  const relative = path.relative(root, filename);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Check both the caller-visible path and the filesystem's canonical path.
 * The source root itself may be reached through an OS alias such as macOS
 * `/tmp`, but no component below that trust boundary may be a symlink.
 */
function containedExistingPathError(root: string, filename: string, label: string): string | undefined {
  if (!within(root, filename)) return `${label} escapes its declared root: ${filename}`;
  if (!fs.existsSync(filename)) return undefined;
  const relative = path.relative(root, filename);
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fs.lstatSync(cursor).isSymbolicLink()) return `${label} must not traverse symbolic links: ${filename}`;
  }
  const canonicalRoot = fs.realpathSync(root);
  const canonicalFilename = fs.realpathSync(filename);
  if (!within(canonicalRoot, canonicalFilename)) return `${label} escapes its canonical root: ${filename}`;
  return undefined;
}

function expandMacros(input: string, macros: ReadonlyMap<string, string>): string {
  let expanded = input;
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    expanded = expanded.replace(/\$([A-Za-z_][\w]*)/g, (token, name: string) => {
      const replacement = macros.get(name);
      if (replacement === undefined) return token;
      changed = true;
      return replacement;
    });
    if (!changed) break;
  }
  return expanded;
}

/**
 * Resolve SFZ includes and #define directives in source order. Some real-world
 * SFZ maps place directives mid-line, so this intentionally does not assume a
 * C-preprocessor line grammar.
 */
export function preprocessSfzFile(filename: string, includeRoot = path.dirname(path.resolve(filename))): SfzPreprocessResult {
  const entry = path.resolve(filename);
  const boundary = path.resolve(includeRoot);
  const macros = new Map<string, string>();
  const errors: string[] = [];

  const visit = (current: string, stack: readonly string[]): string => {
    const absolute = path.resolve(current);
    const containmentError = containedExistingPathError(boundary, absolute, 'SFZ include');
    if (containmentError) {
      errors.push(containmentError);
      return '';
    }
    if (stack.includes(absolute)) {
      errors.push(`Circular SFZ include: ${[...stack, absolute].join(' -> ')}`);
      return '';
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      errors.push(`SFZ include does not exist: ${absolute}`);
      return '';
    }

    const source = fs.readFileSync(absolute, 'utf8')
      .split(/\r?\n/)
      .map(line => line.replace(/\/\/.*$/, ''))
      .join('\n');
    const directive = /#define\s+\$([A-Za-z_][\w]*)\s+([^\s]+)|#include\s+"([^"]+)"/g;
    let output = '';
    let cursor = 0;
    for (const match of source.matchAll(directive)) {
      output += expandMacros(source.slice(cursor, match.index), macros);
      if (match[1] !== undefined) {
        macros.set(match[1], expandMacros(match[2], macros));
      } else {
        const includePath = expandMacros(match[3], macros).replaceAll('\\', path.sep);
        const siblingRelative = path.resolve(path.dirname(absolute), includePath);
        const entryRelative = path.resolve(boundary, includePath);
        // SFZ archives disagree on include roots: some includes are relative to
        // the including file, while ARIA-style maps commonly keep every
        // include path relative to the entry map. Prefer the local path when
        // it exists and otherwise resolve against the entry map directory.
        const included = fs.existsSync(siblingRelative) ? siblingRelative : entryRelative;
        output += visit(included, [...stack, absolute]);
      }
      cursor = (match.index ?? 0) + match[0].length;
    }
    output += expandMacros(source.slice(cursor), macros);
    return output;
  };

  const value = visit(entry, []);
  const unresolved = [...new Set(value.match(/\$[A-Za-z_][\w]*/g) ?? [])];
  if (unresolved.length > 0) errors.push(`Unresolved SFZ macros: ${unresolved.join(', ')}`);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

function mappingOpcodeErrors(source: string): string[] {
  const errors: string[] = [];
  const midiOpcodes = new Set(['key', 'pitch_keycenter', 'lokey', 'hikey']);
  const velocityOpcodes = new Set(['lovel', 'hivel']);
  const sequenceOpcodes = new Set(['seq_position', 'seq_length']);
  const randomOpcodes = new Set(['lorand', 'hirand']);
  const gainOpcodes = new Set(['volume', 'group_volume']);
  const opcode = /\b(key|pitch_keycenter|lokey|hikey|lovel|hivel|seq_position|seq_length|lorand|hirand|volume|group_volume)=([^\s<]+)/gi;
  for (const match of source.matchAll(opcode)) {
    const name = match[1].toLowerCase();
    const value = match[2];
    if (midiOpcodes.has(name)) {
      const numeric = /^-?\d+$/.test(value) ? Number(value) : undefined;
      const noteName = /^[A-Ga-g][#b]?-?\d+$/.test(value);
      if (!noteName && (numeric === undefined || numeric < 0 || numeric > 127)) {
        errors.push(`${name} has invalid MIDI note: ${value}`);
      }
    } else if (velocityOpcodes.has(name)) {
      if (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > 127) {
        errors.push(`${name} has invalid MIDI velocity: ${value}`);
      }
    } else if (sequenceOpcodes.has(name)) {
      if (!/^\d+$/.test(value) || Number(value) < 1) errors.push(`${name} must be a positive integer: ${value}`);
    } else if (randomOpcodes.has(name)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) errors.push(`${name} must be from 0 to 1: ${value}`);
    } else if (gainOpcodes.has(name)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < -24 || numeric > 24) errors.push(`${name} must be a finite dB gain from -24 to 24: ${value}`);
    }
  }
  return errors;
}

function normalizedSamplePath(sample: string, sfzFile: string, sourceRoot: string): string | undefined {
  const raw = sample.replaceAll('\\', '/').replace(/^\.\//, '');
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw) || raw.includes('\0')) return undefined;
  const absolute = path.resolve(path.dirname(sfzFile), ...raw.split('/'));
  if (!within(sourceRoot, absolute)) return undefined;
  const normalized = path.relative(sourceRoot, absolute).replaceAll(path.sep, '/');
  const segments = normalized.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')
      || path.posix.normalize(normalized) !== normalized) return undefined;
  return normalized;
}

function normalizedRecipeSourcePath(sample: string): string | undefined {
  const normalized = sample.replaceAll('\\', '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (path.posix.isAbsolute(normalized)
      || normalized.includes('\0')
      || segments.some(segment => segment === '' || segment === '.' || segment === '..')
      || path.posix.normalize(normalized) !== normalized) return undefined;
  return normalized;
}

function normalizeVelocityCoverage(
  regions: readonly SfzRegion[],
  articulation: string,
  zeroPolicy: GenerateSfzImportOptions['velocityZeroPolicy'],
): { regions: SfzRegion[]; errors: string[]; warnings: string[] } {
  const normalized = regions.map(region => ({ ...region }));
  const errors: string[] = [];
  const warnings: string[] = [];
  const byRoot = new Map<number, SfzRegion[]>();
  for (const region of normalized) {
    if (region.rootMidi === undefined) continue;
    const group = byRoot.get(region.rootMidi) ?? [];
    group.push(region);
    byRoot.set(region.rootMidi, group);
  }
  for (const [root, group] of byRoot) {
    const lowest = Math.min(...group.map(region => region.loVel));
    if (lowest === 1 && zeroPolicy === 'extend-lowest-layer') {
      group.filter(region => region.loVel === 1).forEach(region => { region.loVel = 0; });
      warnings.push(`${articulation}:${root}: explicitly extended the lowest SFZ velocity layer from 1 down to 0 for Keyboardia's 0..127 event domain`);
    } else if (lowest !== 0) {
      errors.push(`SFZ velocity coverage for ${articulation}:${root} starts at ${lowest}; pass an explicit supported velocity-zero policy or fix the mapping`);
    }
    const ranges = [...new Map(group.map(region => [`${region.loVel}-${region.hiVel}`, { min: region.loVel, max: region.hiVel }])).values()]
      .sort((left, right) => left.min - right.min || left.max - right.max);
    if (ranges.length === 0 || ranges.at(-1)!.max !== 127
        || ranges.some((range, index) => index > 0 && range.min !== ranges[index - 1].max + 1)) {
      errors.push(`SFZ velocity ranges for ${articulation}:${root} do not cover 0..127 exactly once`);
    }
  }
  return { regions: normalized, errors, warnings };
}

function convertRandomRegions(
  regions: readonly SfzRegion[],
  articulation: string,
  policy: GenerateSfzImportOptions['randomPolicy'],
): { regions: SfzRegion[]; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const converted = regions.map(region => ({ ...region }));
  const groups = new Map<string, Array<{ region: SfzRegion; index: number }>>();
  converted.forEach((region, index) => {
    if (region.randomLow === undefined && region.randomHigh === undefined) return;
    const key = `${articulation}:${region.rootMidi ?? 'unknown'}:${region.loVel}-${region.hiVel}`;
    const group = groups.get(key) ?? [];
    group.push({ region, index });
    groups.set(key, group);
  });

  if (policy === 'reject') {
    for (const group of groups.values()) {
      for (const { index } of group) errors.push(`sfz region ${index + 1} uses random ranges; explicit deterministic-round-robin conversion policy is required`);
    }
    return { regions: converted, errors, warnings };
  }

  const epsilon = 1e-8;
  for (const [identity, group] of groups) {
    const incomplete = group.some(({ region }) => region.randomLow === undefined || region.randomHigh === undefined);
    if (incomplete) {
      errors.push(`SFZ random group ${identity} has incomplete lorand/hirand pairs`);
      continue;
    }
    const sorted = [...group].sort((left, right) => left.region.randomLow! - right.region.randomLow!);
    const contiguous = Math.abs(sorted[0].region.randomLow!) <= epsilon
      && Math.abs(sorted.at(-1)!.region.randomHigh! - 1) <= epsilon
      && sorted.every(({ region }, index) => region.randomLow! < region.randomHigh!
        && (index === 0 || Math.abs(region.randomLow! - sorted[index - 1].region.randomHigh!) <= epsilon));
    if (!contiguous) {
      errors.push(`SFZ random group ${identity} ranges do not form contiguous 0..1 coverage`);
      continue;
    }
    sorted.forEach(({ region }, index) => {
      region.sequencePosition = index + 1;
      region.sequenceLength = sorted.length;
      delete region.randomLow;
      delete region.randomHigh;
    });
    warnings.push(`${identity}: explicitly converted ${sorted.length} contiguous SFZ random ranges to deterministic round robin`);
  }
  return { regions: converted, errors, warnings };
}

function sourceId(index: number): SourceId {
  return `source-${String(index + 1).padStart(4, '0')}` as SourceId;
}

export async function generateSfzImport(options: GenerateSfzImportOptions): Promise<GenerateSfzImportResult> {
  const errors: string[] = [];
  const sourceRoot = path.resolve(options.sourceRoot);
  const sfzFile = path.resolve(options.sfzFile);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    return { ok: false, errors: [`Source root is not a directory: ${sourceRoot}`] };
  }
  if (!within(sourceRoot, sfzFile)) errors.push(`SFZ file must be inside source root: ${sfzFile}`);
  const sfzContainmentError = containedExistingPathError(sourceRoot, sfzFile, 'SFZ file');
  if (sfzContainmentError) errors.push(sfzContainmentError);
  if (!options.articulation.trim()) errors.push('Articulation must be non-empty');
  if (options.mappedRootMidi !== undefined && (!Number.isInteger(options.mappedRootMidi) || options.mappedRootMidi < 0 || options.mappedRootMidi > 127)) {
    errors.push('mappedRootMidi must be an integer from 0 to 127');
  }

  const preprocessed = preprocessSfzFile(sfzFile, sourceRoot);
  if (!preprocessed.ok) return { ok: false, errors: [...errors, ...preprocessed.errors] };
  errors.push(...mappingOpcodeErrors(preprocessed.value));
  let regions = parseSfz(preprocessed.value).map(region => {
    if (!region.sample) return region;
    const normalized = normalizedSamplePath(region.sample, sfzFile, sourceRoot);
    return normalized === undefined ? region : { ...region, sample: normalized };
  });
  if (options.includeRoots) {
    const roots = new Set(options.includeRoots);
    regions = regions.filter(region => region.rootMidi !== undefined && roots.has(region.rootMidi));
  }
  if (options.samplePathIncludes) regions = regions.filter(region => region.sample?.includes(options.samplePathIncludes!));
  if (options.mappedRootMidi !== undefined) regions = regions.map(region => ({ ...region, rootMidi: options.mappedRootMidi }));
  if (regions.length === 0) errors.push('SFZ selection contains no regions');

  const coverage = normalizeVelocityCoverage(regions, options.articulation, options.velocityZeroPolicy ?? 'reject');
  errors.push(...coverage.errors);
  const converted = convertRandomRegions(coverage.regions, options.articulation, options.randomPolicy);
  errors.push(...converted.errors);

  const samplePaths = new Set<string>();
  for (const [index, region] of regions.entries()) {
    if (!region.sample) {
      errors.push(`sfz region ${index + 1} has no sample opcode`);
      continue;
    }
    const normalized = normalizedRecipeSourcePath(region.sample);
    if (!normalized) {
      errors.push(`sfz region ${index + 1} sample must be a normalized relative path without traversal: ${region.sample}`);
      const outside = path.resolve(sourceRoot, region.sample);
      if (!fs.existsSync(outside)) errors.push(`sfz region ${index + 1} master does not exist: ${region.sample}`);
      continue;
    }
    if (!/\.(?:wav|flac|aiff?)$/i.test(normalized)) errors.push(`sfz region ${index + 1} sample is not a lossless WAV, FLAC, or AIFF master: ${normalized}`);
    samplePaths.add(normalized);
  }

  const sortedPaths = [...samplePaths].sort((left, right) => left.localeCompare(right));
  const sources: RecipeSource[] = [];
  for (const [index, relative] of sortedPaths.entries()) {
    const absolute = path.resolve(sourceRoot, ...relative.split('/'));
    if (!within(sourceRoot, absolute)) {
      errors.push(`Source path escapes source root: ${relative}`);
      continue;
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      errors.push(`SFZ master does not exist: ${relative}`);
      continue;
    }
    const containmentError = containedExistingPathError(sourceRoot, absolute, 'SFZ master');
    if (containmentError) {
      errors.push(containmentError);
      continue;
    }
    sources.push({
      id: sourceId(index),
      path: relative as RelativeSourcePath,
      sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') as Sha256,
    });
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  const imported = importSfzMappings({
    regions: converted.regions,
    sources,
    container: options.container,
    articulation: options.articulation,
  });
  if (!imported.ok) return { ok: false, errors: imported.errors };
  return {
    ok: true,
    value: {
      sfzFile: path.relative(sourceRoot, sfzFile).replaceAll(path.sep, '/'),
      preprocessedSfzSha256: createHash('sha256').update(preprocessed.value).digest('hex'),
      sources,
      mappings: imported.mappings,
      warnings: [...coverage.warnings, ...converted.warnings, ...imported.warnings],
    },
  };
}
