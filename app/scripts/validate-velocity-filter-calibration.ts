#!/usr/bin/env npx tsx

import fs from 'node:fs';
import path from 'node:path';

const INSTRUMENTS_DIR = 'public/instruments';
const calibrations = [
  ['44100', 'src/audio/velocity-filter-anchors.json'],
  ['48000', 'src/audio/velocity-filter-anchors-48000.json'],
] as const;
const calibrationTables = calibrations.map(([sampleRate, calibrationPath]) => ([
  sampleRate,
  calibrationPath,
  JSON.parse(fs.readFileSync(calibrationPath, 'utf8')) as Record<string, Record<string, number>>,
] as const));

const failures: string[] = [];

for (const id of fs.readdirSync(INSTRUMENTS_DIR).sort()) {
  const manifestPath = path.join(INSTRUMENTS_DIR, id, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    velocityFilterAnchorHz?: unknown;
    velocityFilterAnchorsHz?: unknown;
    playableRange?: { min: number; max: number };
    samples: Array<{ note: number; velocityMin?: number; velocityMax?: number }>;
  };
  if (manifest.velocityFilterAnchorHz !== undefined || manifest.velocityFilterAnchorsHz !== undefined) {
    failures.push(`${id}: velocity-filter calibration belongs in velocity-filter-anchors.json, not the provenance manifest`);
  }
}

const expectedInstrumentIds = Object.keys(calibrationTables[0][2]).sort();
for (const [sampleRate, , anchors] of calibrationTables) {
  const actualInstrumentIds = Object.keys(anchors).sort();
  if (actualInstrumentIds.join(',') !== expectedInstrumentIds.join(',')) {
    failures.push(`${sampleRate}: calibrated instrument set differs from ${calibrationTables[0][0]} Hz`);
  }
  for (const [id, byNote] of Object.entries(anchors)) {
    const manifestPath = path.join(INSTRUMENTS_DIR, id, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      failures.push(`${id}@${sampleRate}: calibration has no production manifest`);
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      playableRange?: { min: number; max: number };
      samples: Array<{ note: number; velocityMin?: number; velocityMax?: number }>;
    };
    const zones = new Set(manifest.samples.map(sample => (
      `${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}`
    )));
    if (zones.size > 1) failures.push(`${id}@${sampleRate}: calibrated despite ${zones.size} recorded velocity zones`);

    const sampledNotes = manifest.samples.map(sample => sample.note);
    const min = manifest.playableRange?.min ?? Math.min(...sampledNotes);
    const max = manifest.playableRange?.max ?? Math.max(...sampledNotes);
    const expectedNotes = Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
    const actualNotes = Object.keys(byNote).sort((left, right) => Number(left) - Number(right));
    if (actualNotes.join(',') !== expectedNotes.join(',')) {
      failures.push(`${id}@${sampleRate}: calibration keys must cover every playable note ${min}-${max} exactly`);
    }
    for (const [note, anchor] of Object.entries(byNote)) {
      if (!Number.isFinite(anchor) || anchor < 100 || anchor > 42_000) {
        failures.push(`${id}@${note}/${sampleRate}: anchor ${JSON.stringify(anchor)} is outside 100-42000 Hz`);
      }
    }
  }
}

if (failures.length) {
  failures.forEach(failure => console.error(`❌ ${failure}`));
  process.exit(1);
}
console.log('✅ Velocity-filter calibration covers every playable note at 44.1/48 kHz and no layered instruments.');
