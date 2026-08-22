#!/usr/bin/env npx tsx

/**
 * Velocity Timbre and Sustain Measurement
 *
 * `report-velocity-coverage.ts` reports how many velocity layers each sampled
 * instrument *declares*. This script reports what those layers actually
 * deliver acoustically, plus how long each instrument can hold a note before
 * its sample runs out.
 *
 * Two measurements per instrument:
 *
 * 1. `centroidSpreadPct` — spread of the post-onset spectral centroid across
 *    velocity layers. A single-layer instrument is 0 by construction: velocity
 *    scales gain and nothing else, so soft notes are quieter but never darker.
 *    Layered instruments show what real dynamic recordings buy.
 *
 * 2. `usableSeconds` — time until the sample sits below -60 dBFS relative to
 *    its own peak. A note held longer than this goes silent mid-note, because
 *    only mappings carrying a LoopSpec repeat (see sampled-instrument.ts).
 *
 * Run: npx tsx scripts/measure-velocity-timbre.ts [--output path.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { OfflineAudioContext } from 'node-web-audio-api';
import { rmsDb, spectralCentroidHz } from '../src/test/audio-measures';

const INSTRUMENTS_DIR = 'public/instruments';
const SAMPLE_RATE = 48_000;
/** Post-onset window the centroid is taken over, so attack length cannot bias it. */
const CENTROID_WINDOW_SEC = 0.25;
const ONSET_SKIP_SEC = 0.02;
const SILENCE_FLOOR_DB = -60;
/** Below this the window is treated as silence rather than measured. */
const MEASURABLE_FLOOR_DB = -70;

interface ManifestSampleMapping {
  note: number;
  file?: string;
  offset?: number;
  duration?: number;
  startOffset?: number;
  endOffset?: number;
  velocityMin?: number;
  velocityMax?: number;
}

interface MeasurementManifest {
  id: string;
  sprite?: string;
  startOffset?: number;
  samples: ManifestSampleMapping[];
}

export interface ManifestMeasurementTarget {
  file: string;
  note: number;
  layer: string;
  startSeconds: number;
  endSeconds?: number;
}

export interface InstrumentMeasurement {
  id: string;
  files: number;
  layers: string[];
  centroidByLayerHz: Record<string, number>;
  centroidSpreadPct: number | null;
  usableSeconds: { min: number; median: number; max: number };
}

function decodeContext() {
  return new OfflineAudioContext(1, 128, SAMPLE_RATE) as unknown as {
    decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer>;
  };
}

async function decode(file: string): Promise<AudioBuffer> {
  const raw = fs.readFileSync(file);
  const view = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  return decodeContext().decodeAudioData(view as ArrayBuffer);
}

function toMono(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = new Float32Array(buffer.length);
    buffer.copyFromChannel(data, channel);
    for (let i = 0; i < buffer.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

/** Last moment a 20 ms window still exceeds the floor, relative to peak. */
function usableSeconds(samples: Float32Array, sampleRate: number): number {
  const window = Math.floor(sampleRate * 0.02);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak === 0) return 0;
  const threshold = peak * 10 ** (SILENCE_FLOOR_DB / 20);
  let last = 0;
  for (let start = 0; start + window < samples.length; start += window) {
    let localPeak = 0;
    for (let i = start; i < start + window; i++) {
      localPeak = Math.max(localPeak, Math.abs(samples[i]));
    }
    if (localPeak > threshold) last = start + window;
  }
  return last / sampleRate;
}

function postOnsetCentroid(samples: Float32Array, sampleRate: number): number | null {
  const start = Math.floor(sampleRate * ONSET_SKIP_SEC);
  const end = Math.min(samples.length, start + Math.floor(sampleRate * CENTROID_WINDOW_SEC));
  if (end - start < 1024) return null;
  const window = samples.subarray(start, end);
  if (rmsDb(window) <= MEASURABLE_FLOOR_DB) return null;
  return spectralCentroidHz(window, sampleRate);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Turn the authoritative playback manifest into acoustic measurement targets.
 * Filename spelling and unreferenced files are deliberately irrelevant.
 */
export function manifestMeasurementTargets(
  manifest: MeasurementManifest,
): ManifestMeasurementTarget[] {
  return manifest.samples.map((mapping) => {
    const startSeconds = manifest.sprite
      ? mapping.offset ?? 0
      : mapping.startOffset ?? manifest.startOffset ?? 0;
    const endSeconds = manifest.sprite
      ? (mapping.duration === undefined ? undefined : startSeconds + mapping.duration)
      : mapping.endOffset;
    return {
      file: manifest.sprite ?? (() => {
        if (!mapping.file) throw new Error(`${manifest.id}: sample at note ${mapping.note} has no file`);
        return mapping.file;
      })(),
      note: mapping.note,
      layer: `${mapping.velocityMin ?? 0}-${mapping.velocityMax ?? 127}`,
      startSeconds,
      endSeconds,
    };
  });
}

function mappedSamples(buffer: AudioBuffer, target: ManifestMeasurementTarget): Float32Array {
  const full = toMono(buffer);
  const start = Math.max(0, Math.floor(target.startSeconds * buffer.sampleRate));
  const end = target.endSeconds === undefined
    ? full.length
    : Math.min(full.length, Math.ceil(target.endSeconds * buffer.sampleRate));
  return full.subarray(start, Math.max(start, end));
}

export async function measureInstrument(id: string): Promise<InstrumentMeasurement | null> {
  const dir = path.join(INSTRUMENTS_DIR, id);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  ) as MeasurementManifest;
  const targets = manifestMeasurementTargets(manifest);
  if (!targets.length) return null;

  const usable: number[] = [];
  const centroids = new Map<string, number[]>();
  const decoded = new Map<string, AudioBuffer>();
  for (const target of targets) {
    let buffer = decoded.get(target.file);
    if (!buffer) {
      buffer = await decode(path.join(dir, target.file));
      decoded.set(target.file, buffer);
    }
    const samples = mappedSamples(buffer, target);
    usable.push(usableSeconds(samples, buffer.sampleRate));
    const centroid = postOnsetCentroid(samples, buffer.sampleRate);
    if (centroid === null) continue;
    if (!centroids.has(target.layer)) centroids.set(target.layer, []);
    centroids.get(target.layer)!.push(centroid);
  }

  usable.sort((a, b) => a - b);
  const centroidByLayerHz: Record<string, number> = {};
  for (const [layer, values] of centroids) centroidByLayerHz[layer] = mean(values);
  const values = Object.values(centroidByLayerHz);
  const spread = values.length > 1
    ? ((Math.max(...values) - Math.min(...values)) / Math.max(...values)) * 100
    : null;

  return {
    id,
    files: decoded.size,
    layers: [...centroids.keys()].sort(),
    centroidByLayerHz,
    centroidSpreadPct: spread,
    usableSeconds: {
      min: usable[0],
      median: usable[Math.floor(usable.length / 2)],
      max: usable[usable.length - 1],
    },
  };
}

async function main(): Promise<void> {
  const ids = fs.readdirSync(INSTRUMENTS_DIR)
    .filter((entry) => fs.statSync(path.join(INSTRUMENTS_DIR, entry)).isDirectory())
    .sort();

  const measurements: InstrumentMeasurement[] = [];
  for (const id of ids) {
    const measurement = await measureInstrument(id);
    if (measurement) measurements.push(measurement);
  }

  const gainOnly = measurements.filter((m) => m.centroidSpreadPct === null);
  const result = {
    measuredAt: new Date().toISOString().slice(0, 10),
    sampleRate: SAMPLE_RATE,
    centroidWindowSec: CENTROID_WINDOW_SEC,
    silenceFloorDb: SILENCE_FLOOR_DB,
    summary: {
      instruments: measurements.length,
      gainOnlyInstruments: gainOnly.length,
      gainOnlyIds: gainOnly.map((m) => m.id),
    },
    instruments: measurements,
  };

  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex === -1 ? null : process.argv[outputIndex + 1];
  if (outputIndex !== -1 && !outputPath) throw new Error('--output requires a path');
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const pad = (value: string, width: number) => value.padEnd(width);
  console.log(`${pad('instrument', 24)}${pad('layers', 14)}${pad('spread%', 11)}${pad('usable s (min/med/max)', 24)}`);
  for (const m of measurements) {
    console.log(
      pad(m.id, 24)
      + pad(m.layers.join('|'), 14)
      + pad(m.centroidSpreadPct === null ? 'gain-only' : m.centroidSpreadPct.toFixed(1), 11)
      + pad(`${m.usableSeconds.min.toFixed(2)}/${m.usableSeconds.median.toFixed(2)}/${m.usableSeconds.max.toFixed(2)}`, 24),
    );
  }
  console.log(`\n${gainOnly.length}/${measurements.length} instruments respond to velocity with gain only.`);
}

// Run only when invoked directly; validate-sustain-ceiling.ts imports the
// measurement core above without triggering a full-library sweep.
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
