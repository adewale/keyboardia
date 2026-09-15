#!/usr/bin/env npx tsx

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { SCHEDULER_BASE_MIDI_NOTE } from '../src/audio/constants';
import {
  estimatedSampleTransferSeconds,
  MAX_CONCURRENT_BACKGROUND_SAMPLE_LOADS,
  THROTTLED_SAMPLE_NETWORK_PROFILE,
} from '../src/audio/sample-load-policy';
import { nearestSampleNote } from '../src/audio/sample-selection';

interface SampleMapping {
  note: number;
  file?: string;
}

interface Manifest {
  id: string;
  sprite?: string;
  priorityNotes?: number[];
  samples: SampleMapping[];
}

interface BudgetResult {
  instrumentId: string;
  priorityFiles: number;
  priorityBytes: number;
  prioritySeconds: number;
  backgroundFiles: number;
  backgroundBytes: number;
  backgroundSeconds: number;
}

const instrumentRoot = path.resolve('public/instruments');

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function fileSize(instrumentId: string, file: string): number {
  const filePath = path.resolve(instrumentRoot, instrumentId, file);
  if (!existsSync(filePath)) throw new Error(`${instrumentId}: missing delivery file ${file}`);
  return statSync(filePath).size;
}

function inspectManifest(manifestPath: string): BudgetResult {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const allFiles = manifest.sprite
    ? [manifest.sprite]
    : unique(manifest.samples.map(mapping => mapping.file));
  const availableNotes = [...new Set(manifest.samples.map(mapping => mapping.note))];
  const defaultPriority = nearestSampleNote(availableNotes, SCHEDULER_BASE_MIDI_NOTE);
  const priorityNotes = new Set(
    manifest.priorityNotes?.length
      ? manifest.priorityNotes
      : defaultPriority === undefined ? [] : [defaultPriority],
  );
  const priorityFiles = manifest.sprite
    ? [manifest.sprite]
    : unique(manifest.samples
      .filter(mapping => priorityNotes.has(mapping.note))
      .map(mapping => mapping.file));
  const priorityFileSet = new Set(priorityFiles);
  const backgroundFiles = allFiles.filter(file => !priorityFileSet.has(file));
  const priorityBytes = priorityFiles.reduce(
    (total, file) => total + fileSize(manifest.id, file),
    0,
  );
  const backgroundBytes = backgroundFiles.reduce(
    (total, file) => total + fileSize(manifest.id, file),
    0,
  );
  return {
    instrumentId: manifest.id,
    priorityFiles: priorityFiles.length,
    priorityBytes,
    prioritySeconds: estimatedSampleTransferSeconds(priorityBytes, priorityFiles.length),
    backgroundFiles: backgroundFiles.length,
    backgroundBytes,
    backgroundSeconds: estimatedSampleTransferSeconds(
      backgroundBytes,
      backgroundFiles.length,
      MAX_CONCURRENT_BACKGROUND_SAMPLE_LOADS,
    ),
  };
}

const results = readdirSync(instrumentRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => path.resolve(instrumentRoot, entry.name, 'manifest.json'))
  .filter(existsSync)
  .map(inspectManifest);

const failures = results.flatMap(result => {
  const messages: string[] = [];
  if (result.prioritySeconds > THROTTLED_SAMPLE_NETWORK_PROFILE.priorityReadySeconds) {
    messages.push(
      `${result.instrumentId}: priority readiness ${result.prioritySeconds.toFixed(2)}s exceeds `
      + `${THROTTLED_SAMPLE_NETWORK_PROFILE.priorityReadySeconds}s`,
    );
  }
  if (result.backgroundSeconds > THROTTLED_SAMPLE_NETWORK_PROFILE.backgroundTransferSeconds) {
    messages.push(
      `${result.instrumentId}: background transfer ${result.backgroundSeconds.toFixed(2)}s exceeds `
      + `${THROTTLED_SAMPLE_NETWORK_PROFILE.backgroundTransferSeconds}s`,
    );
  }
  return messages;
});

const slowestPriority = [...results].sort((left, right) => right.prioritySeconds - left.prioritySeconds)[0];
const slowestBackground = [...results].sort((left, right) => right.backgroundSeconds - left.backgroundSeconds)[0];
console.log(`Sample load budgets (${THROTTLED_SAMPLE_NETWORK_PROFILE.name}, transfer-only)`);
console.log(
  `  slowest priority: ${slowestPriority.instrumentId} ${slowestPriority.prioritySeconds.toFixed(2)}s `
  + `(${slowestPriority.priorityFiles} files, ${slowestPriority.priorityBytes} bytes)`,
);
console.log(
  `  slowest background: ${slowestBackground.instrumentId} ${slowestBackground.backgroundSeconds.toFixed(2)}s `
  + `(${slowestBackground.backgroundFiles} files, ${slowestBackground.backgroundBytes} bytes)`,
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`  ERROR ${failure}`);
  process.exit(1);
}

console.log(`  PASS ${results.length} sampled instruments satisfy both transfer budgets`);
