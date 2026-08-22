#!/usr/bin/env npx tsx

/**
 * Velocity → Cutoff Design Simulation
 *
 * `measure-velocity-timbre.ts` shows that 20 of 26 sampled instruments respond
 * to velocity with gain only. This script asks what a per-voice lowpass would
 * buy them, and picks the sweep depth from measurement rather than taste.
 *
 * Curve under test, matching the SF2 default modulator's shape (velocity
 * darkens rather than brightens) while preserving existing sessions:
 *
 *   cutoff(v) = anchor * 2 ** (-octaves * (1 - v / BYPASS_VELOCITY))
 *
 * with the filter BYPASSED at v >= BYPASS_VELOCITY. That constant is
 * DEFAULT_STEP_MIDI_VELOCITY, so unlocked steps — every step without an
 * explicit volume lock — render through an unchanged graph. The anchor is
 * derived per instrument from its own measured brightness, so a dark bass and
 * a bright kalimba get proportionate treatment instead of one global corner.
 *
 * Target: land the simulated centroid drop in the same band as the
 * instruments that already carry real velocity layers (piano 31.5%,
 * vibraphone 30.5%, alto-sax 26.2%).
 *
 * Run: npx tsx scripts/simulate-velocity-filter.ts [--output path.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { OfflineAudioContext } from 'node-web-audio-api';
import { rmsDb, spectralCentroidHz } from '../src/test/audio-measures';
import { DEFAULT_STEP_MIDI_VELOCITY } from '../src/shared/constants';
import {
  velocitySampleCutoffAt,
  VELOCITY_FILTER_OCTAVES,
} from '../src/audio/velocity-sample-filter';

const INSTRUMENTS_DIR = 'public/instruments';
const SAMPLE_RATE = 48_000;
const CENTROID_WINDOW_SEC = 0.25;
const ONSET_SKIP_SEC = 0.02;
const MEASURABLE_FLOOR_DB = -70;
/** Butterworth: no resonant peak to colour the measurement. */
const FILTER_Q = Math.SQRT1_2;
/** Anchor sits an octave above the instrument's own dry centroid. */
const ANCHOR_RATIO = 2;
/** Soft strike the drop is reported at. */
const PROBE_VELOCITY = 40;
const OCTAVE_CANDIDATES = [1.5, 2, 2.5];
/** Instruments measured as gain-only, i.e. the ones this would change. */
const TARGETS = [
  'string-section', 'hammond-organ', 'clean-guitar', 'acoustic-guitar',
  'finger-bass', 'kalimba', 'steel-drums', 'slap-bass', 'french-horn',
];
const SAMPLES_PER_INSTRUMENT = 6;

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

// The curve itself ships in src/audio/velocity-sample-filter.ts; this script
// only explores anchors and sweep depths through the same implementation the
// engine runs, so the numbers here cannot drift from production.

async function render(buffer: AudioBuffer, cutoffHz: number | null): Promise<Float32Array> {
  const length = Math.min(
    buffer.length,
    Math.floor(SAMPLE_RATE * (CENTROID_WINDOW_SEC + ONSET_SKIP_SEC + 0.03)),
  );
  const context = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = context.createBufferSource();
  source.buffer = buffer;
  if (cutoffHz === null) {
    source.connect(context.destination);
  } else {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffHz;
    filter.Q.value = FILTER_Q;
    source.connect(filter);
    filter.connect(context.destination);
  }
  source.start(0);
  return toMono(await context.startRendering() as unknown as AudioBuffer);
}

function centroidOf(samples: Float32Array): number | null {
  const start = Math.floor(SAMPLE_RATE * ONSET_SKIP_SEC);
  const end = Math.min(samples.length, start + Math.floor(SAMPLE_RATE * CENTROID_WINDOW_SEC));
  if (end - start < 1024) return null;
  const window = samples.subarray(start, end);
  if (rmsDb(window) <= MEASURABLE_FLOOR_DB) return null;
  return spectralCentroidHz(window, SAMPLE_RATE);
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

async function simulate(id: string) {
  const dir = path.join(INSTRUMENTS_DIR, id);
  const files = fs.readdirSync(dir)
    .filter((file) => /\.(mp3|m4a|wav|ogg)$/.test(file))
    .sort()
    .slice(0, SAMPLES_PER_INSTRUMENT);

  const dryCentroids: number[] = [];
  const wetCentroids = OCTAVE_CANDIDATES.map<number[]>(() => []);
  for (const file of files) {
    const buffer = await decode(path.join(dir, file));
    const dry = centroidOf(await render(buffer, null));
    if (dry === null) continue;
    dryCentroids.push(dry);
    const anchor = ANCHOR_RATIO * dry;
    for (let i = 0; i < OCTAVE_CANDIDATES.length; i++) {
      const cutoff = velocitySampleCutoffAt(anchor, PROBE_VELOCITY, OCTAVE_CANDIDATES[i]);
      const wet = centroidOf(await render(buffer, cutoff));
      if (wet !== null) wetCentroids[i].push(wet);
    }
  }
  if (!dryCentroids.length) return null;

  const dry = mean(dryCentroids);
  return {
    id,
    samplesMeasured: dryCentroids.length,
    anchorHz: Math.round(ANCHOR_RATIO * dry),
    centroidAtDefaultVelocityHz: Math.round(dry),
    byOctaves: Object.fromEntries(OCTAVE_CANDIDATES.map((octaves, i) => {
      const wet = mean(wetCentroids[i]);
      return [octaves, {
        centroidHz: Math.round(wet),
        dropPct: Number((((dry - wet) / dry) * 100).toFixed(1)),
      }];
    })),
  };
}

/** Mean dry/wet centroids for one instrument at a given absolute anchor. */
async function measureDropAtAnchor(id: string, anchorHz: number): Promise<number | null> {
  const dir = path.join(INSTRUMENTS_DIR, id);
  const files = fs.readdirSync(dir)
    .filter((file) => /\.(mp3|m4a|wav|ogg)$/.test(file))
    .sort()
    .slice(0, SAMPLES_PER_INSTRUMENT);
  const dryCentroids: number[] = [];
  const wetCentroids: number[] = [];
  for (const file of files) {
    const buffer = await decode(path.join(dir, file));
    const dry = centroidOf(await render(buffer, null));
    if (dry === null) continue;
    const cutoff = velocitySampleCutoffAt(anchorHz, PROBE_VELOCITY, VELOCITY_FILTER_OCTAVES);
    const wet = centroidOf(await render(buffer, cutoff));
    if (wet === null) continue;
    dryCentroids.push(dry);
    wetCentroids.push(wet);
  }
  if (!dryCentroids.length) return null;
  return ((mean(dryCentroids) - mean(wetCentroids)) / mean(dryCentroids)) * 100;
}

/**
 * Solve the manifest anchor per instrument: bisect until the centroid drop at
 * the probe velocity sits at SOLVE_TARGET_DROP_PCT (mid-band of the 26-35%
 * acceptance window in specs/PHASE-44-SOUND-CHANGES.md §3). Drop decreases
 * monotonically as the anchor rises.
 */
const SOLVE_TARGET_DROP_PCT = 30;
const SOLVE_TOLERANCE_PCT = 0.5;

async function solveAnchors(): Promise<void> {
  console.log(`instrument,anchorHz,drop@v${PROBE_VELOCITY}_pct`);
  for (const id of TARGETS) {
    let low = 120;
    let high = 19_000;
    let anchor = 0;
    let drop: number | null = null;
    for (let iteration = 0; iteration < 18; iteration++) {
      anchor = Math.sqrt(low * high);
      drop = await measureDropAtAnchor(id, anchor);
      if (drop === null) break;
      if (Math.abs(drop - SOLVE_TARGET_DROP_PCT) <= SOLVE_TOLERANCE_PCT) break;
      if (drop > SOLVE_TARGET_DROP_PCT) low = anchor; else high = anchor;
    }
    console.log(`${id},${Math.round(anchor)},${drop === null ? 'unmeasurable' : drop.toFixed(1)}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--solve')) {
    await solveAnchors();
    return;
  }
  const results = [];
  for (const id of TARGETS) {
    const result = await simulate(id);
    if (result) results.push(result);
  }

  const payload = {
    measuredAt: new Date().toISOString().slice(0, 10),
    bypassVelocity: DEFAULT_STEP_MIDI_VELOCITY,
    probeVelocity: PROBE_VELOCITY,
    anchorRatio: ANCHOR_RATIO,
    octaveCandidates: OCTAVE_CANDIDATES,
    instruments: results,
  };

  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex === -1 ? null : process.argv[outputIndex + 1];
  if (outputIndex !== -1 && !outputPath) throw new Error('--output requires a path');
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const pad = (value: string, width: number) => value.padEnd(width);
  console.log(
    pad('instrument', 20) + pad('anchor Hz', 11) + pad(`centroid@v${DEFAULT_STEP_MIDI_VELOCITY}`, 14)
    + OCTAVE_CANDIDATES.map((o) => pad(`drop@v${PROBE_VELOCITY} ${o}oct`, 17)).join(''),
  );
  for (const r of results) {
    console.log(
      pad(r.id, 20) + pad(String(r.anchorHz), 11) + pad(String(r.centroidAtDefaultVelocityHz), 14)
      + OCTAVE_CANDIDATES.map((o) => pad(`${r.byOctaves[o].dropPct}%`, 17)).join(''),
    );
  }
}

await main();
