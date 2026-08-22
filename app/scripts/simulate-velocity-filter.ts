#!/usr/bin/env npx tsx

/**
 * Velocity-filter calibration against production playback mappings.
 *
 * Every probe is a playable MIDI note, resolved to the same nearest manifest
 * mapping and pitch ratio used by SampledInstrument. This intentionally avoids
 * directory order, unreferenced files, and native-pitch-only measurements.
 *
 * Run:
 *   npx tsx scripts/simulate-velocity-filter.ts
 *   npx tsx scripts/simulate-velocity-filter.ts --solve
 *   npx tsx scripts/simulate-velocity-filter.ts --solve --output <calibration.json>
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OfflineAudioContext } from 'node-web-audio-api';
import { rmsDb, spectralCentroidHz } from '../src/test/audio-measures';
import { nearestSampleNote } from '../src/audio/sample-selection';
import {
  velocitySampleCutoffForNoteAt,
  VELOCITY_FILTER_OCTAVES,
  VELOCITY_FILTER_Q,
} from '../src/audio/velocity-sample-filter';

const INSTRUMENTS_DIR = 'public/instruments';
const sampleRateArg = process.argv.indexOf('--sample-rate');
const SAMPLE_RATE = sampleRateArg === -1 ? 48_000 : Number(process.argv[sampleRateArg + 1]);
if (SAMPLE_RATE !== 44_100 && SAMPLE_RATE !== 48_000) {
  throw new Error('--sample-rate must be 44100 or 48000');
}
const CENTROID_WINDOW_SEC = 0.25;
const ONSET_SKIP_SEC = 0.02;
const MEASURABLE_FLOOR_DB = -70;
const PROBE_VELOCITY = 40;
const TARGET_DROP_MIN_PCT = 26;
const TARGET_DROP_MAX_PCT = 35;
const SOLVE_TARGET_DROP_PCT = 30;
const SOLVE_TOLERANCE_PCT = 0.25;
const REPRESENTATIVE_NOTE_COUNT = 5;
const TARGET_IDS = [
  'acoustic-guitar',
  'clean-guitar',
  'hammond-organ',
  'kalimba',
  'slap-bass',
  'string-section',
] as const;
const CALIBRATION = JSON.parse(
  fs.readFileSync(
    SAMPLE_RATE === 44_100
      ? 'src/audio/velocity-filter-anchors.json'
      : 'src/audio/velocity-filter-anchors-48000.json',
    'utf8',
  ),
) as Record<string, Record<string, number>>;

interface Mapping {
  note: number;
  file?: string;
  velocityMin?: number;
  velocityMax?: number;
  tuneCents?: number;
  startOffset?: number;
  endOffset?: number;
  offset?: number;
  duration?: number;
}

interface Manifest {
  id: string;
  sprite?: string;
  startOffset?: number;
  playableRange?: { min: number; max: number };
  samples: Mapping[];
}

interface Probe {
  midiNote: number;
  mapping: Mapping;
  file: string;
  playbackRate: number;
  startSeconds: number;
  durationSeconds?: number;
}

function loadManifest(id: string): Manifest {
  return JSON.parse(
    fs.readFileSync(path.join(INSTRUMENTS_DIR, id, 'manifest.json'), 'utf8'),
  ) as Manifest;
}

export function representativeMidiNotes(manifest: Manifest): number[] {
  const sampledNotes = manifest.samples.map(mapping => mapping.note);
  const min = manifest.playableRange?.min ?? Math.min(...sampledNotes);
  const max = manifest.playableRange?.max ?? Math.max(...sampledNotes);
  return [...new Set(Array.from({ length: REPRESENTATIVE_NOTE_COUNT }, (_, index) => (
    Math.round(min + (max - min) * index / (REPRESENTATIVE_NOTE_COUNT - 1))
  )))];
}

function playableMidiNotes(manifest: Manifest): number[] {
  if (!manifest.playableRange) {
    return [...new Set(manifest.samples.map(mapping => mapping.note))].sort((a, b) => a - b);
  }
  return Array.from(
    { length: manifest.playableRange.max - manifest.playableRange.min + 1 },
    (_, index) => manifest.playableRange!.min + index,
  );
}

function nearestMapping(manifest: Manifest, midiNote: number): Mapping {
  const nearestNote = nearestSampleNote(manifest.samples.map(mapping => mapping.note), midiNote);
  const mapping = manifest.samples.find(candidate => candidate.note === nearestNote);
  if (!mapping) throw new Error(`${manifest.id}: no sample mapping for MIDI note ${midiNote}`);
  return mapping;
}

function playbackProbe(manifest: Manifest, midiNote: number): Probe {
  const mapping = nearestMapping(manifest, midiNote);
  const file = manifest.sprite ?? mapping.file;
  if (!file) throw new Error(`${manifest.id}: mapping at ${mapping.note} has no delivery file`);
  const startSeconds = manifest.sprite
    ? mapping.offset ?? 0
    : mapping.startOffset ?? manifest.startOffset ?? 0;
  const durationSeconds = manifest.sprite
    ? mapping.duration
    : (mapping.endOffset === undefined ? undefined : mapping.endOffset - startSeconds);
  return {
    midiNote,
    mapping,
    file,
    playbackRate: 2 ** ((midiNote - mapping.note) / 12 + (mapping.tuneCents ?? 0) / 1200),
    startSeconds,
    durationSeconds,
  };
}

export function playbackProbes(manifest: Manifest): Probe[] {
  return representativeMidiNotes(manifest).map(midiNote => playbackProbe(manifest, midiNote));
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

async function render(
  buffer: AudioBuffer,
  probe: Probe,
  cutoffHz: number | null,
): Promise<Float32Array> {
  const length = Math.floor(SAMPLE_RATE * (CENTROID_WINDOW_SEC + ONSET_SKIP_SEC + 0.03));
  const context = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = probe.playbackRate;
  if (cutoffHz === null) {
    source.connect(context.destination);
  } else {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffHz;
    filter.Q.value = VELOCITY_FILTER_Q;
    source.connect(filter);
    filter.connect(context.destination);
  }
  if (probe.durationSeconds === undefined) source.start(0, probe.startSeconds);
  else source.start(0, probe.startSeconds, probe.durationSeconds);
  return toMono(await context.startRendering() as unknown as AudioBuffer);
}

function centroidOf(samples: Float32Array): number | null {
  const start = Math.floor(SAMPLE_RATE * ONSET_SKIP_SEC);
  const end = Math.min(samples.length, start + Math.floor(SAMPLE_RATE * CENTROID_WINDOW_SEC));
  const window = samples.subarray(start, end);
  if (window.length < 1024 || rmsDb(window) <= MEASURABLE_FLOOR_DB) return null;
  return spectralCentroidHz(window, SAMPLE_RATE);
}

async function dropsAtCurrentAnchors(id: string) {
  const manifest = loadManifest(id);
  const anchors = CALIBRATION[id];
  if (!anchors) throw new Error(`${id}: no checked-in calibration`);
  const decoded = new Map<string, AudioBuffer>();
  const notes: Array<{ midiNote: number; dryHz: number; wetHz: number; dropPct: number }> = [];
  for (const probe of playableMidiNotes(manifest).map(note => playbackProbe(manifest, note))) {
    let buffer = decoded.get(probe.file);
    if (!buffer) {
      buffer = await decode(path.join(INSTRUMENTS_DIR, id, probe.file));
      decoded.set(probe.file, buffer);
    }
    const anchor = anchors[String(probe.midiNote)];
    if (anchor === undefined) throw new Error(`${id}: missing anchor for playable note ${probe.midiNote}`);
    const cutoff = velocitySampleCutoffForNoteAt(
      anchor,
      PROBE_VELOCITY,
      probe.midiNote,
      probe.midiNote,
      VELOCITY_FILTER_OCTAVES,
    );
    const dry = centroidOf(await render(buffer, probe, null));
    const wet = centroidOf(await render(buffer, probe, cutoff));
    if (dry === null || wet === null) continue;
    notes.push({ midiNote: probe.midiNote, dryHz: dry, wetHz: wet, dropPct: (dry - wet) / dry * 100 });
  }
  return { id, meanDropPct: notes.reduce((sum, note) => sum + note.dropPct, 0) / notes.length, notes };
}

function targetIds(): string[] {
  return [...TARGET_IDS];
}

async function solveAnchors(): Promise<Record<string, Record<string, number>>> {
  const solved: Record<string, Record<string, number>> = {};
  for (const id of targetIds()) {
    const manifest = loadManifest(id);
    const anchors: Record<string, number> = {};
    const playableNotes = playableMidiNotes(manifest);
    for (const midiNote of playableNotes) {
      const probe = playbackProbe(manifest, midiNote);
      const buffer = await decode(path.join(INSTRUMENTS_DIR, id, probe.file));
      const dry = centroidOf(await render(buffer, probe, null));
      if (dry === null) throw new Error(`${id}@${midiNote}: dry sample is not measurable`);
      let low = 100;
      let high = 42_000;
      let anchor = Math.sqrt(low * high);
      for (let iteration = 0; iteration < 18; iteration++) {
        anchor = Math.sqrt(low * high);
        const cutoff = velocitySampleCutoffForNoteAt(
          anchor,
          PROBE_VELOCITY,
          midiNote,
          midiNote,
          VELOCITY_FILTER_OCTAVES,
        );
        const wet = centroidOf(await render(buffer, probe, cutoff));
        if (wet === null) throw new Error(`${id}@${midiNote}: filtered sample is not measurable`);
        const drop = (dry - wet) / dry * 100;
        if (Math.abs(drop - SOLVE_TARGET_DROP_PCT) <= SOLVE_TOLERANCE_PCT) break;
        if (drop > SOLVE_TARGET_DROP_PCT) low = anchor;
        else high = anchor;
      }
      anchors[String(midiNote)] = Math.round(anchor);
    }
    solved[id] = anchors;
  }
  return solved;
}

async function reportCurrent(): Promise<void> {
  let failed = false;
  console.log(`instrument,calibratedNotes,meanDropPct,minDropPct,minNote,maxDropPct,maxNote`);
  for (const id of targetIds()) {
    const anchors = CALIBRATION[id];
    const result = await dropsAtCurrentAnchors(id);
    const drops = result.notes.map(note => note.dropPct);
    const min = Math.min(...drops);
    const max = Math.max(...drops);
    const minNote = result.notes[drops.indexOf(min)].midiNote;
    const maxNote = result.notes[drops.indexOf(max)].midiNote;
    const passes = min >= TARGET_DROP_MIN_PCT && max <= TARGET_DROP_MAX_PCT;
    if (!passes) failed = true;
    console.log([
      id,
      Object.keys(anchors).length,
      result.meanDropPct.toFixed(1),
      min.toFixed(1),
      minNote,
      max.toFixed(1),
      maxNote,
    ].join(','));
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--solve')) {
    const solved = await solveAnchors();
    const outputArg = process.argv.indexOf('--output');
    if (outputArg !== -1) {
      const outputPath = process.argv[outputArg + 1];
      if (!outputPath) throw new Error('--output requires a path');
      fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(solved, null, 2)}\n`);
      console.log(`Wrote ${Object.values(solved).reduce((sum, notes) => sum + Object.keys(notes).length, 0)} note anchors to ${outputPath}`);
    } else {
      console.log(`instrument,anchorsHzByPlayableNote`);
      for (const [id, anchors] of Object.entries(solved)) console.log(`${id},${JSON.stringify(anchors)}`);
    }
  } else await reportCurrent();
}
