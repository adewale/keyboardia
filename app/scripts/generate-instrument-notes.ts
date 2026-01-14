#!/usr/bin/env npx tsx
/**
 * Generate SAMPLED_INSTRUMENT_NOTES from Manifests
 *
 * This script reads all instrument manifests and generates the
 * SAMPLED_INSTRUMENT_NOTES constant for instrument-ranges.ts.
 *
 * This ensures the sample note mappings stay in sync with actual manifests
 * and eliminates the manual maintenance burden that caused sync issues.
 *
 * Usage:
 *   npx tsx scripts/generate-instrument-notes.ts
 *   npm run generate:instrument-notes
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INSTRUMENTS_DIR = path.join(__dirname, '../public/instruments');

interface Manifest {
  id: string;
  samples: Array<{ note: number; file: string }>;
}

function getUniqueNotes(manifest: Manifest): number[] {
  const notes = new Set<number>();
  for (const sample of manifest.samples) {
    notes.add(sample.note);
  }
  return Array.from(notes).sort((a, b) => a - b);
}

function generateInstrumentNotes(): Record<string, number[]> {
  const result: Record<string, number[]> = {};

  if (!fs.existsSync(INSTRUMENTS_DIR)) {
    console.error('Instruments directory not found:', INSTRUMENTS_DIR);
    process.exit(1);
  }

  const dirs = fs.readdirSync(INSTRUMENTS_DIR);

  for (const dir of dirs) {
    const manifestPath = path.join(INSTRUMENTS_DIR, dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest: Manifest = JSON.parse(content);

      const sampleId = `sampled:${manifest.id}`;
      const notes = getUniqueNotes(manifest);

      result[sampleId] = notes;
    } catch (e) {
      console.error(`Error reading ${manifestPath}:`, e);
    }
  }

  return result;
}

function formatOutput(notes: Record<string, number[]>): string {
  const lines: string[] = [];
  lines.push('/**');
  lines.push(' * Sample mappings for instruments to calculate pitch-shift distance');
  lines.push(' * AUTO-GENERATED from manifests - do not edit manually!');
  lines.push(' * Run: npm run generate:instrument-notes');
  lines.push(' */');
  lines.push('const SAMPLED_INSTRUMENT_NOTES: Record<string, number[]> = {');

  // Sort keys for consistent output
  const sortedKeys = Object.keys(notes).sort();

  for (const key of sortedKeys) {
    const noteArray = notes[key].join(', ');
    lines.push(`  '${key}': [${noteArray}],`);
  }

  lines.push('};');

  return lines.join('\n');
}

function main(): void {
  const notes = generateInstrumentNotes();
  const output = formatOutput(notes);

  console.log('Generated SAMPLED_INSTRUMENT_NOTES:\n');
  console.log(output);
  console.log('\n\nCopy the above into src/audio/instrument-ranges.ts');
  console.log('Or run: npm run generate:instrument-notes > /tmp/notes.ts');
}

main();
