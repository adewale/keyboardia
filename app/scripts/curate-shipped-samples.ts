#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('public', 'instruments');
const ARCHIVE = path.resolve('sample-pipeline', 'enrichment', 'unshipped-delivery');
const REPORT = path.resolve('test-results', 'sample-quality', 'pre-curation.json');
const OUTPUT = path.resolve('sample-pipeline', 'enrichment', 'technical-curation.json');
const IDS = [
  'acoustic-kick', 'acoustic-snare', 'acoustic-hihat-closed',
  'acoustic-hihat-open', 'acoustic-ride', 'acoustic-crash',
  'finger-bass', 'steel-drums',
] as const;

interface Mapping {
  note: number;
  file: string;
  velocityMin?: number;
  velocityMax?: number;
  articulation?: string;
  roundRobinGroup?: string;
  roundRobinIndex?: number;
  gainDb?: number;
  [key: string]: unknown;
}
interface Manifest { samples: Mapping[]; credits?: { changes?: string; [key: string]: unknown }; [key: string]: unknown }
interface Metric { instrumentId: string; file: string; activeRmsDb: number; effectiveLeadingSilenceMs: number; peakDb: number; dcOffsetDb: number }
interface Issue { severity: 'error' | 'review'; instrumentId: string; file?: string; code: string }
interface Audit { samples: Metric[]; issues: Issue[] }

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(filename, 'utf8')) as T;
}
function sha256(filename: string): string {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}
function writeJson(filename: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

const audit = readJson<Audit>(REPORT);
const metrics = new Map(audit.samples.map(metric => [`${metric.instrumentId}/${metric.file}`, metric]));
const issueCount = new Map<string, number>();
for (const issue of audit.issues) {
  if (!issue.file) continue;
  const key = `${issue.instrumentId}/${issue.file}`;
  issueCount.set(key, (issueCount.get(key) ?? 0) + (issue.severity === 'error' ? 100 : 1));
}

function groupKey(mapping: Mapping): string {
  return `${mapping.note}:${mapping.velocityMin ?? 0}-${mapping.velocityMax ?? 127}:${mapping.articulation ?? 'default'}`;
}

function choose(instrumentId: string, mappings: Mapping[], count: number): Mapping[] {
  const groupMedian = median(mappings.map(mapping => metrics.get(`${instrumentId}/${mapping.file}`)?.activeRmsDb ?? -120));
  return [...mappings].sort((left, right) => {
    const leftMetric = metrics.get(`${instrumentId}/${left.file}`);
    const rightMetric = metrics.get(`${instrumentId}/${right.file}`);
    const score = (mapping: Mapping, metric: Metric | undefined): number =>
      (issueCount.get(`${instrumentId}/${mapping.file}`) ?? 0) * 100
      + Math.abs((metric?.activeRmsDb ?? -120) - groupMedian) * 4
      + Math.max(0, metric?.effectiveLeadingSilenceMs ?? 0)
      + Math.max(0, (metric?.peakDb ?? -120) + 2.5) * 20
      + Math.max(0, (metric?.dcOffsetDb ?? -120) + 60) * 5;
    return score(left, leftMetric) - score(right, rightMetric)
      || left.file.localeCompare(right.file);
  }).slice(0, count);
}

function curateSnare(mappings: Mapping[]): Mapping[] {
  const zones = [[0, 31], [32, 63], [64, 95], [96, 127]] as const;
  return zones.flatMap(([velocityMin, velocityMax], zoneIndex) => {
    const inZone = mappings.filter(mapping => {
      const centre = ((mapping.velocityMin ?? 0) + (mapping.velocityMax ?? 127)) / 2;
      return centre >= velocityMin && centre <= velocityMax;
    });
    return choose('acoustic-snare', inZone, 4).map((mapping, roundRobinIndex) => ({
      ...mapping,
      velocityMin,
      velocityMax,
      roundRobinGroup: `snare-38-zone-${zoneIndex}`,
      roundRobinIndex,
    }));
  });
}

function curateGrouped(instrumentId: string, mappings: Mapping[]): Mapping[] {
  const groups = new Map<string, Mapping[]>();
  for (const mapping of mappings) {
    const key = groupKey(mapping);
    groups.set(key, [...(groups.get(key) ?? []), mapping]);
  }
  return [...groups.entries()].flatMap(([key, group]) => choose(instrumentId, group, 2)
    .map((mapping, roundRobinIndex) => ({
      ...mapping,
      roundRobinGroup: mapping.roundRobinGroup ?? `${instrumentId}-${key}`,
      roundRobinIndex,
    })));
}

const before = { files: 0, mappings: 0, payloadBytes: 0 };
const after = { files: 0, mappings: 0, payloadBytes: 0 };
const instrumentReceipts: Record<string, unknown>[] = [];

for (const instrumentId of IDS) {
  const directory = path.join(ROOT, instrumentId);
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = readJson<Manifest>(manifestPath);
  const originalMappings = manifest.samples;
  const originalFiles = fs.readdirSync(directory).filter(file => /\.(?:m4a|mp3|wav)$/i.test(file)).sort();
  const selectedMappings = instrumentId === 'acoustic-snare'
    ? curateSnare(originalMappings)
    : instrumentId === 'finger-bass' || instrumentId === 'steel-drums'
      ? curateGrouped(instrumentId, originalMappings)
      : originalMappings;
  const selectedFiles = new Set(selectedMappings.map(mapping => mapping.file));
  const excludedFiles = originalFiles.filter(file => !selectedFiles.has(file));

  const originalPayload = originalFiles.reduce((sum, file) => sum + fs.statSync(path.join(directory, file)).size, 0);
  for (const file of excludedFiles) {
    const source = path.join(directory, file);
    const destination = path.join(ARCHIVE, instrumentId, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination)) fs.renameSync(source, destination);
  }

  manifest.samples = selectedMappings;
  if (manifest.credits) {
    manifest.credits.changes = `${manifest.credits.changes ?? ''} Delivery curated by objective defect, onset, headroom, DC, and within-layer level consistency metrics; at most two variants per tonal layer, four per snare velocity zone.`.trim();
  }
  writeJson(manifestPath, manifest);

  const shippedFiles = originalFiles.filter(file => selectedFiles.has(file));
  const shippedPayload = shippedFiles.reduce((sum, file) => sum + fs.statSync(path.join(directory, file)).size, 0);
  before.files += originalFiles.length;
  before.mappings += originalMappings.length;
  before.payloadBytes += originalPayload;
  after.files += shippedFiles.length;
  after.mappings += selectedMappings.length;
  after.payloadBytes += shippedPayload;
  instrumentReceipts.push({
    id: instrumentId,
    before: { files: originalFiles.length, mappings: originalMappings.length, payloadBytes: originalPayload },
    after: { files: shippedFiles.length, mappings: selectedMappings.length, payloadBytes: shippedPayload },
    manifestSha256: sha256(manifestPath),
    shipped: shippedFiles.map(file => ({ file, sha256: sha256(path.join(directory, file)) })),
    unshipped: excludedFiles.map(file => ({ file, sha256: sha256(path.join(ARCHIVE, instrumentId, file)) })),
  });
}

writeJson(OUTPUT, {
  version: 1,
  generatedAt: new Date().toISOString(),
  policy: {
    acousticKit: 'retain complete enriched velocity/round-robin sets except snare',
    acousticSnare: 'four broad velocity zones, four technically ranked variants per zone',
    tonalLibraries: 'retain every note and velocity zone, at most two technically ranked variants per zone',
    ranking: ['hard/review issue count', 'within-layer RMS consistency', 'effective onset', 'headroom', 'DC offset', 'stable filename'],
    perceptualPreferenceClaimed: false,
  },
  before,
  after,
  reduction: {
    files: before.files - after.files,
    mappings: before.mappings - after.mappings,
    payloadBytes: before.payloadBytes - after.payloadBytes,
    payloadPercent: ((before.payloadBytes - after.payloadBytes) / before.payloadBytes) * 100,
  },
  instruments: instrumentReceipts,
});

console.log(`Curated ${before.files} -> ${after.files} shipped files and ${before.mappings} -> ${after.mappings} mappings`);
console.log(`Shipped payload ${before.payloadBytes} -> ${after.payloadBytes} bytes`);
