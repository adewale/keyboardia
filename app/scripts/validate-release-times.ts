#!/usr/bin/env npx tsx

/**
 * Release Time Validator
 *
 * Validates release times for all sampled instruments against
 * recommended ranges based on instrument type.
 *
 * Run: npx tsx scripts/validate-release-times.ts
 */

import fs from 'fs';
import path from 'path';

const INSTRUMENTS_DIR = 'public/instruments';

interface Manifest {
  id: string;
  name: string;
  releaseTime: number;
}

interface ReleaseTimeRange {
  min: number;
  max: number;
  rationale: string;
}

// Recommended release times by instrument type
const RECOMMENDED_RELEASE_TIMES: Record<string, ReleaseTimeRange> = {
  // 808 Electronic Drums - tight and punchy
  '808-kick': { min: 0.08, max: 0.15, rationale: 'Electronic kick - tight, punchy' },
  '808-snare': { min: 0.08, max: 0.15, rationale: 'Electronic snare - snappy' },
  '808-hihat-closed': { min: 0.03, max: 0.08, rationale: 'Closed hi-hat - very crisp' },
  '808-hihat-open': { min: 0.15, max: 0.3, rationale: 'Open hi-hat - some sustain' },
  '808-clap': { min: 0.08, max: 0.15, rationale: 'Electronic clap - tight' },

  // Acoustic Drums - room ambience
  'acoustic-kick': { min: 0.15, max: 0.25, rationale: 'Acoustic kick - room tone' },
  'acoustic-snare': { min: 0.2, max: 0.3, rationale: 'Acoustic snare - shell resonance' },
  'acoustic-hihat-closed': { min: 0.1, max: 0.2, rationale: 'Acoustic closed hat - natural ring' },
  'acoustic-hihat-open': { min: 0.25, max: 0.4, rationale: 'Acoustic open hat - sustain' },
  'acoustic-ride': { min: 0.4, max: 0.7, rationale: 'Ride cymbal - long ring' },

  // Keys - varying sustain
  'piano': { min: 0.4, max: 0.6, rationale: 'Piano - damper effect' },
  'rhodes-ep': { min: 0.6, max: 1.0, rationale: 'Rhodes - tine ring' },
  'vibraphone': { min: 0.8, max: 1.2, rationale: 'Vibraphone - bar resonance' },
  'marimba': { min: 0.6, max: 1.0, rationale: 'Marimba - wood resonance' },

  // Strings - bowed/plucked
  'string-section': { min: 0.6, max: 1.0, rationale: 'Strings - bow release' },
  'clean-guitar': { min: 0.25, max: 0.4, rationale: 'Electric guitar - string decay' },
  'acoustic-guitar': { min: 0.3, max: 0.5, rationale: 'Acoustic guitar - body resonance' },

  // Bass
  'finger-bass': { min: 0.2, max: 0.4, rationale: 'Bass - tight low end' },

  // Brass/Wind
  'french-horn': { min: 0.4, max: 0.7, rationale: 'French horn - breath decay' },
  'alto-sax': { min: 0.3, max: 0.5, rationale: 'Saxophone - breath decay' },

  // FX
  'vinyl-crackle': { min: 0.05, max: 0.15, rationale: 'Vinyl - texture loop' },
};

interface ValidationResult {
  instrument: string;
  currentValue: number;
  range: ReleaseTimeRange | null;
  status: 'ok' | 'too-short' | 'too-long' | 'unknown';
  suggestion?: number;
}

function validateReleaseTime(manifest: Manifest): ValidationResult {
  const range = RECOMMENDED_RELEASE_TIMES[manifest.id];

  if (!range) {
    return {
      instrument: manifest.id,
      currentValue: manifest.releaseTime,
      range: null,
      status: 'unknown',
    };
  }

  const current = manifest.releaseTime;

  if (current < range.min) {
    return {
      instrument: manifest.id,
      currentValue: current,
      range,
      status: 'too-short',
      suggestion: range.min,
    };
  }

  if (current > range.max) {
    return {
      instrument: manifest.id,
      currentValue: current,
      range,
      status: 'too-long',
      suggestion: range.max,
    };
  }

  return {
    instrument: manifest.id,
    currentValue: current,
    range,
    status: 'ok',
  };
}

function main(): void {
  console.log('\n🎵 RELEASE TIME VALIDATION\n');
  console.log('─'.repeat(60) + '\n');

  const instruments = fs.readdirSync(INSTRUMENTS_DIR)
    .filter(f => fs.statSync(path.join(INSTRUMENTS_DIR, f)).isDirectory())
    .sort();

  const results: ValidationResult[] = [];

  for (const instrument of instruments) {
    const manifestPath = path.join(INSTRUMENTS_DIR, instrument, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    results.push(validateReleaseTime(manifest));
  }

  // Group by status
  const ok = results.filter(r => r.status === 'ok');
  const issues = results.filter(r => r.status === 'too-short' || r.status === 'too-long');
  const unknown = results.filter(r => r.status === 'unknown');

  // Print OK results
  console.log('✅ WITHIN RANGE:\n');
  for (const result of ok) {
    console.log(`   ${result.instrument}: ${result.currentValue}s`);
    console.log(`      Range: ${result.range!.min}-${result.range!.max}s (${result.range!.rationale})`);
  }

  // Print issues
  if (issues.length > 0) {
    console.log('\n⚠️  OUT OF RANGE:\n');
    for (const result of issues) {
      const arrow = result.status === 'too-short' ? '↑' : '↓';
      console.log(`   ${result.instrument}: ${result.currentValue}s ${arrow} should be ${result.suggestion}s`);
      console.log(`      Range: ${result.range!.min}-${result.range!.max}s (${result.range!.rationale})`);
    }
  }

  // Print unknown
  if (unknown.length > 0) {
    console.log('\n❓ NO RECOMMENDATION:\n');
    for (const result of unknown) {
      console.log(`   ${result.instrument}: ${result.currentValue}s (no recommendation defined)`);
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(60));
  console.log(`\nSUMMARY: ${ok.length} OK, ${issues.length} issues, ${unknown.length} unknown\n`);

  // Exit with error if issues found
  if (issues.length > 0) {
    process.exit(1);
  }
}

main();
