#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPORT_PATH = path.resolve('test-results', 'sample-quality', 'post-curation-unwaived.json');
const INSTRUMENT_ROOT = path.resolve('public', 'instruments');
const RECEIPT_PATH = path.resolve('sample-pipeline', 'enrichment', 'mapping-calibration.json');
const CURATION_PATH = path.resolve('sample-pipeline', 'enrichment', 'technical-curation.json');
const MAX_ADJACENT_STEP_DB = 2.8;

interface Mapping { note: number; file: string; velocityMin?: number; velocityMax?: number; gainDb?: number; [key: string]: unknown }
interface Manifest { id: string; gainDb?: number; samples: Mapping[]; [key: string]: unknown }
interface Metric { instrumentId: string; file: string; note: number; velocityMin?: number; velocityMax?: number; activeRmsDb: number }
interface Audit { samples: Metric[]; issues: Array<{ code: string }> }
interface Layer { key: string; note: number; velocityMin: number; velocityMax: number; mappings: Mapping[]; deliveredDb: number; correctionDb: number }

function readJson<T>(filename: string): T { return JSON.parse(fs.readFileSync(filename, 'utf8')) as T; }
function writeJson(filename: string, value: unknown): void { fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`); }
function sha256(filename: string): string { return createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }
function mappingKey(mapping: Pick<Mapping, 'note' | 'file' | 'velocityMin' | 'velocityMax'>): string {
  return `${mapping.note}/${mapping.velocityMin ?? 0}-${mapping.velocityMax ?? 127}/${mapping.file}`;
}
function layerKey(mapping: Pick<Mapping, 'note' | 'velocityMin' | 'velocityMax'>): string {
  return `${mapping.note}/${mapping.velocityMin ?? 0}-${mapping.velocityMax ?? 127}`;
}

/** Minimal weighted pool-adjacent-violators correction for a nondecreasing curve. */
function isotonicTargets(layers: Layer[]): number[] {
  const blocks = layers.map((layer, index) => ({ start: index, end: index, mean: layer.deliveredDb, weight: layer.mappings.length }));
  for (let index = 1; index < blocks.length;) {
    if (blocks[index - 1].mean <= blocks[index].mean) { index++; continue; }
    const left = blocks[index - 1];
    const right = blocks[index];
    const weight = left.weight + right.weight;
    blocks.splice(index - 1, 2, {
      start: left.start,
      end: right.end,
      mean: (left.mean * left.weight + right.mean * right.weight) / weight,
      weight,
    });
    if (index > 1) index--;
  }
  const targets = new Array<number>(layers.length);
  for (const block of blocks) for (let index = block.start; index <= block.end; index++) targets[index] = block.mean;
  return targets;
}

const audit = readJson<Audit>(REPORT_PATH);
const metricLookup = new Map(audit.samples.map(metric => [`${metric.instrumentId}/${mappingKey(metric)}`, metric]));
const receipts: Record<string, unknown>[] = [];

for (const directoryName of fs.readdirSync(INSTRUMENT_ROOT).sort()) {
  const manifestPath = path.join(INSTRUMENT_ROOT, directoryName, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = readJson<Manifest>(manifestPath);
  const layersByKey = new Map<string, Layer>();
  for (const mapping of manifest.samples) {
    const metric = metricLookup.get(`${manifest.id}/${mappingKey(mapping)}`);
    if (!metric) continue;
    const key = layerKey(mapping);
    const layer = layersByKey.get(key) ?? {
      key,
      note: mapping.note,
      velocityMin: mapping.velocityMin ?? 0,
      velocityMax: mapping.velocityMax ?? 127,
      mappings: [],
      deliveredDb: 0,
      correctionDb: 0,
    };
    layer.mappings.push(mapping);
    layersByKey.set(key, layer);
  }
  for (const layer of layersByKey.values()) {
    layer.deliveredDb = layer.mappings.reduce((sum, mapping) => {
      const metric = metricLookup.get(`${manifest.id}/${mappingKey(mapping)}`)!;
      return sum + metric.activeRmsDb + (manifest.gainDb ?? 0) + (mapping.gainDb ?? 0);
    }, 0) / layer.mappings.length;
  }

  const byNote = new Map<number, Layer[]>();
  for (const layer of layersByKey.values()) byNote.set(layer.note, [...(byNote.get(layer.note) ?? []), layer]);
  for (const layers of byNote.values()) {
    layers.sort((left, right) => left.velocityMin - right.velocityMin || left.velocityMax - right.velocityMax);
    const targets = isotonicTargets(layers);
    layers.forEach((layer, index) => { layer.correctionDb += targets[index] - layer.deliveredDb; });
  }

  const loudestLayers = [...byNote.entries()].map(([note, layers]) => ({
    note,
    layer: [...layers].sort((left, right) => right.velocityMin - left.velocityMin || right.velocityMax - left.velocityMax)[0],
  })).sort((left, right) => left.note - right.note);
  for (let index = 1; index < loudestLayers.length; index++) {
    const previous = loudestLayers[index - 1].layer;
    const current = loudestLayers[index].layer;
    const previousLevel = previous.deliveredDb + previous.correctionDb;
    const currentLevel = current.deliveredDb + current.correctionDb;
    const bounded = Math.max(previousLevel - MAX_ADJACENT_STEP_DB, Math.min(previousLevel + MAX_ADJACENT_STEP_DB, currentLevel));
    const noteCorrection = bounded - currentLevel;
    for (const layer of byNote.get(loudestLayers[index].note) ?? []) layer.correctionDb += noteCorrection;
  }

  const corrections: Array<{ layer: string; gainDb: number }> = [];
  for (const layer of layersByKey.values()) {
    if (Math.abs(layer.correctionDb) < 0.0005) continue;
    const rounded = Math.round(layer.correctionDb * 1000) / 1000;
    for (const mapping of layer.mappings) mapping.gainDb = Math.round(((mapping.gainDb ?? 0) + rounded) * 1000) / 1000;
    corrections.push({ layer: layer.key, gainDb: rounded });
  }
  if (corrections.length === 0) continue;
  writeJson(manifestPath, manifest);
  receipts.push({ id: manifest.id, corrections, maxAbsoluteCorrectionDb: Math.max(...corrections.map(item => Math.abs(item.gainDb))), manifestSha256: sha256(manifestPath) });
}

writeJson(RECEIPT_PATH, {
  version: 1,
  generatedAt: new Date().toISOString(),
  policy: {
    velocity: 'minimal weighted isotonic correction to delivered layer RMS',
    notes: `forward minimum correction limiting adjacent loudest-layer steps to ${MAX_ADJACENT_STEP_DB} dB`,
    arrangementAwareness: false,
    collisionAwareness: false,
  },
  instruments: receipts,
});

if (fs.existsSync(CURATION_PATH)) {
  const curation = readJson<{ instruments: Array<{ id: string; manifestSha256: string }> }>(CURATION_PATH);
  for (const entry of curation.instruments) entry.manifestSha256 = sha256(path.join(INSTRUMENT_ROOT, entry.id, 'manifest.json'));
  writeJson(CURATION_PATH, curation);
}

console.log(`Applied static source-map calibration to ${receipts.length} manifests`);
