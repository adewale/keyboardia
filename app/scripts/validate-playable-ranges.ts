#!/usr/bin/env npx tsx
/**
 * Playable Range Validator
 *
 * CRITICAL: Validates that instrument playableRanges include the default playback note.
 *
 * The scheduler plays notes at: midiNote = SCHEDULER_BASE_MIDI_NOTE + pitchSemitones
 * With default transpose of 0, this means notes play at the base note.
 *
 * If an instrument's playableRange excludes SCHEDULER_BASE_MIDI_NOTE, notes will be
 * SILENTLY SKIPPED and the instrument will appear broken (no sound).
 *
 * This script catches that bug class.
 *
 * Usage:
 *   npx tsx scripts/validate-playable-ranges.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Import from single source of truth
import {
  SCHEDULER_BASE_MIDI_NOTE,
  midiToNoteName,
} from '../src/audio/constants';

// ============================================================================
// Configuration
// ============================================================================

const INSTRUMENTS_DIR = 'public/instruments';
// Use the SINGLE SOURCE OF TRUTH - never hardcode this value
const DEFAULT_PLAYBACK_NOTE = SCHEDULER_BASE_MIDI_NOTE;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

// ============================================================================
// Types
// ============================================================================

interface Manifest {
  id: string;
  name: string;
  baseNote: number;
  playableRange?: {
    min: number;
    max: number;
  };
  samples: { note: number }[];
}

interface ValidationResult {
  id: string;
  name: string;
  baseNote: number;
  playableRange?: { min: number; max: number };
  includesDefaultNote: boolean;
  issue?: string;
  recommendation?: string;
}

// ============================================================================
// Validation (midiToNoteName imported from constants.ts)
// ============================================================================

function validateInstrument(instrumentDir: string): ValidationResult | null {
  const manifestPath = path.join(instrumentDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  const result: ValidationResult = {
    id: manifest.id,
    name: manifest.name,
    baseNote: manifest.baseNote,
    playableRange: manifest.playableRange,
    includesDefaultNote: true,
  };

  // Check if playableRange is defined
  if (!manifest.playableRange) {
    // No range = all notes allowed, which is fine but potentially risky for
    // single-sample instruments
    return result;
  }

  const { min, max } = manifest.playableRange;

  // CRITICAL CHECK: Does the range include the default playback note?
  if (DEFAULT_PLAYBACK_NOTE < min || DEFAULT_PLAYBACK_NOTE > max) {
    result.includesDefaultNote = false;
    result.issue = `playableRange [${min}, ${max}] excludes default note ${DEFAULT_PLAYBACK_NOTE} (${midiToNoteName(DEFAULT_PLAYBACK_NOTE)})`;

    // Calculate recommended fix
    const newMin = Math.min(min, DEFAULT_PLAYBACK_NOTE - 12);
    const newMax = Math.max(max, DEFAULT_PLAYBACK_NOTE + 12);
    result.recommendation = `Extend range to [${newMin}, ${newMax}] to include C4`;
  }

  // Also check that baseNote is within playableRange
  if (manifest.baseNote < min || manifest.baseNote > max) {
    const baseIssue = `baseNote ${manifest.baseNote} (${midiToNoteName(manifest.baseNote)}) is outside playableRange [${min}, ${max}]`;
    result.issue = result.issue ? `${result.issue}; ${baseIssue}` : baseIssue;
    result.includesDefaultNote = false;
  }

  return result;
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  console.log(`\n${colors.bold}🎹 PLAYABLE RANGE VALIDATOR${colors.reset}\n`);
  console.log(`${colors.dim}Checking that all instruments can play at default note ${midiToNoteName(DEFAULT_PLAYBACK_NOTE)} (MIDI ${DEFAULT_PLAYBACK_NOTE})${colors.reset}`);
  console.log(`${colors.dim}The scheduler plays: midiNote = 60 + pitchSemitones (default = C4)${colors.reset}\n`);
  console.log('─'.repeat(70) + '\n');

  // Find all instruments
  const instrumentsPath = path.join(process.cwd(), INSTRUMENTS_DIR);
  if (!fs.existsSync(instrumentsPath)) {
    console.error(`${colors.red}Error: Instruments directory not found at ${instrumentsPath}${colors.reset}`);
    process.exit(1);
  }

  const instruments = fs.readdirSync(instrumentsPath)
    .filter(f => fs.statSync(path.join(instrumentsPath, f)).isDirectory())
    .sort();

  // Validate each instrument
  const results: ValidationResult[] = [];
  for (const instrument of instruments) {
    const result = validateInstrument(path.join(instrumentsPath, instrument));
    if (result) {
      results.push(result);
    }
  }

  // Report results
  const failures = results.filter(r => !r.includesDefaultNote);
  const passes = results.filter(r => r.includesDefaultNote);

  if (failures.length > 0) {
    console.log(`${colors.red}${colors.bold}FAILURES (${failures.length})${colors.reset}\n`);
    console.log(`${colors.red}These instruments will be SILENT when played at default settings:${colors.reset}\n`);

    for (const result of failures) {
      console.log(`  ${colors.red}❌${colors.reset} ${colors.bold}${result.id}${colors.reset} (${result.name})`);
      console.log(`     ${colors.dim}baseNote: ${midiToNoteName(result.baseNote)} (${result.baseNote})${colors.reset}`);
      if (result.playableRange) {
        console.log(`     ${colors.dim}playableRange: [${result.playableRange.min}, ${result.playableRange.max}]${colors.reset}`);
      }
      console.log(`     ${colors.red}Issue: ${result.issue}${colors.reset}`);
      if (result.recommendation) {
        console.log(`     ${colors.cyan}Fix: ${result.recommendation}${colors.reset}`);
      }
      console.log();
    }
  }

  if (passes.length > 0) {
    console.log(`${colors.green}${colors.bold}PASSES (${passes.length})${colors.reset}\n`);
    for (const result of passes) {
      const rangeStr = result.playableRange
        ? `[${result.playableRange.min}, ${result.playableRange.max}]`
        : '(unlimited)';
      console.log(`  ${colors.green}✓${colors.reset} ${result.id}: range ${rangeStr}`);
    }
    console.log();
  }

  // Summary
  console.log('─'.repeat(70));
  console.log(`\n${colors.bold}SUMMARY${colors.reset}`);
  console.log(`  Total instruments: ${results.length}`);
  console.log(`  ${colors.green}Passes:${colors.reset} ${passes.length}`);
  console.log(`  ${colors.red}Failures:${colors.reset} ${failures.length}`);

  if (failures.length > 0) {
    console.log(`\n${colors.red}${colors.bold}⚠️  CRITICAL: ${failures.length} instrument(s) will be silent at default settings!${colors.reset}`);
    console.log(`${colors.dim}Fix the playableRange in each manifest to include MIDI note 60 (C4).${colors.reset}\n`);
    process.exit(1);
  }

  console.log(`\n${colors.green}All instruments can play at default settings.${colors.reset}\n`);
  process.exit(0);
}

main();
