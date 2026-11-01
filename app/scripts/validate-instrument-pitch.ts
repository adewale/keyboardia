#!/usr/bin/env npx tsx
/**
 * Instrument Pitch Validator
 *
 * VALIDATES: That instruments will sound correct at default playback settings.
 *
 * ROOT CAUSE OF THE BUG:
 * Two different mental models collided:
 * 1. Pitched instruments (piano): Samples at C2, C3, C4, C5 - scheduler plays at MIDI 60
 * 2. Drum instruments: Samples at GM drum map notes (kick=36, snare=38, hihat=42)
 *
 * The scheduler always played at MIDI 60 + pitchSemitones, which works for piano
 * but causes 22-semitone pitch shift for drums (making them sound like chipmunks).
 *
 * THE FIX:
 * Added `playbackNote` field to manifests. When set, the instrument plays at
 * playbackNote + pitchSemitones instead of 60 + pitchSemitones.
 *
 * THIS VALIDATOR CHECKS:
 * 1. Single-sample instruments (drums) MUST have playbackNote set
 * 2. Multi-sample instruments should have a sample near MIDI 60 OR playbackNote set
 * 3. Pitch-shift from scheduler note to nearest sample should be < 12 semitones
 *
 * SINGLE SOURCE OF TRUTH:
 * - SCHEDULER_BASE_MIDI_NOTE (60) in constants.ts - what scheduler uses by default
 * - playbackNote in manifest - override for instruments that shouldn't play at 60
 */

import * as fs from 'fs';
import * as path from 'path';
import { SCHEDULER_BASE_MIDI_NOTE, midiToNoteName } from '../src/audio/constants';

const INSTRUMENTS_DIR = 'public/instruments';
const MAX_ACCEPTABLE_PITCH_SHIFT = 12; // semitones

interface Manifest {
  id: string;
  name: string;
  baseNote: number;
  playbackNote?: number;
  samples: Array<{ note: number }>;
}

interface ValidationResult {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  playbackNote: number;
  nearestSampleNote: number;
  pitchShift: number;
  issues: string[];
}

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function validateInstrument(manifestPath: string): ValidationResult {
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const issues: string[] = [];

  // Determine effective playback note
  const playbackNote = manifest.playbackNote ?? SCHEDULER_BASE_MIDI_NOTE;

  // Find nearest sample to playback note
  const sampleNotes = manifest.samples.map(s => s.note);
  const nearestSampleNote = sampleNotes.reduce((nearest, note) =>
    Math.abs(note - playbackNote) < Math.abs(nearest - playbackNote) ? note : nearest
  );

  const pitchShift = Math.abs(playbackNote - nearestSampleNote);

  // Check 1: Single-sample drums should have playbackNote
  const isSingleSample = manifest.samples.length <= 3 && new Set(sampleNotes).size === 1;
  if (isSingleSample && manifest.playbackNote === undefined) {
    issues.push(
      `Single-sample instrument without playbackNote - will pitch-shift ${pitchShift} semitones`
    );
  }

  // Check 2: Multi-sample instruments should cover playback note reasonably
  if (!isSingleSample && pitchShift > MAX_ACCEPTABLE_PITCH_SHIFT && manifest.playbackNote === undefined) {
    issues.push(
      `No sample within ${MAX_ACCEPTABLE_PITCH_SHIFT} semitones of scheduler note 60`
    );
  }

  // Check 3: Pitch shift sanity check
  if (pitchShift > MAX_ACCEPTABLE_PITCH_SHIFT) {
    issues.push(
      `Pitch shift of ${pitchShift} semitones may cause audible artifacts`
    );
  }

  return {
    id: manifest.id,
    status: issues.length === 0 ? 'pass' : (pitchShift > 12 && manifest.playbackNote === undefined ? 'fail' : 'warn'),
    playbackNote,
    nearestSampleNote,
    pitchShift,
    issues,
  };
}

function main(): void {
  console.log(`\n${colors.bold}🎹 INSTRUMENT PITCH VALIDATOR${colors.reset}\n`);
  console.log(`${colors.dim}Validates that instruments sound correct at default playback settings${colors.reset}`);
  console.log(`${colors.dim}Scheduler plays at: playbackNote + pitchSemitones (default playbackNote = ${SCHEDULER_BASE_MIDI_NOTE})${colors.reset}\n`);
  console.log('─'.repeat(70) + '\n');

  const instrumentsPath = path.join(process.cwd(), INSTRUMENTS_DIR);
  const manifests = fs.readdirSync(instrumentsPath)
    .filter(f => fs.statSync(path.join(instrumentsPath, f)).isDirectory())
    .map(f => path.join(instrumentsPath, f, 'manifest.json'))
    .filter(f => fs.existsSync(f))
    .sort();

  const results: ValidationResult[] = manifests.map(validateInstrument);

  const failures = results.filter(r => r.status === 'fail');
  const warnings = results.filter(r => r.status === 'warn');
  const passes = results.filter(r => r.status === 'pass');

  if (failures.length > 0) {
    console.log(`${colors.red}${colors.bold}FAILURES (${failures.length})${colors.reset}\n`);
    for (const result of failures) {
      console.log(`  ${colors.red}❌${colors.reset} ${colors.bold}${result.id}${colors.reset}`);
      console.log(`     playbackNote: ${result.playbackNote} (${midiToNoteName(result.playbackNote)})`);
      console.log(`     nearestSample: ${result.nearestSampleNote} (${midiToNoteName(result.nearestSampleNote)})`);
      console.log(`     ${colors.red}pitchShift: ${result.pitchShift} semitones${colors.reset}`);
      for (const issue of result.issues) {
        console.log(`     ${colors.red}→ ${issue}${colors.reset}`);
      }
      console.log();
    }
  }

  if (warnings.length > 0) {
    console.log(`${colors.yellow}${colors.bold}WARNINGS (${warnings.length})${colors.reset}\n`);
    for (const result of warnings) {
      console.log(`  ${colors.yellow}⚠${colors.reset} ${result.id}: pitch shift ${result.pitchShift}st`);
    }
    console.log();
  }

  if (passes.length > 0) {
    console.log(`${colors.green}${colors.bold}PASSES (${passes.length})${colors.reset}\n`);
    for (const result of passes) {
      const note = result.playbackNote !== SCHEDULER_BASE_MIDI_NOTE
        ? ` [playbackNote=${result.playbackNote}]`
        : '';
      console.log(`  ${colors.green}✓${colors.reset} ${result.id}: pitch shift ${result.pitchShift}st${note}`);
    }
    console.log();
  }

  // Summary
  console.log('─'.repeat(70));
  console.log(`\n${colors.bold}SUMMARY${colors.reset}`);
  console.log(`  Total instruments: ${results.length}`);
  console.log(`  ${colors.green}Passes:${colors.reset} ${passes.length}`);
  console.log(`  ${colors.yellow}Warnings:${colors.reset} ${warnings.length}`);
  console.log(`  ${colors.red}Failures:${colors.reset} ${failures.length}`);

  if (failures.length > 0) {
    console.log(`\n${colors.red}${colors.bold}⚠️  ${failures.length} instrument(s) will sound wrong!${colors.reset}`);
    console.log(`${colors.dim}Add playbackNote to manifests for single-sample instruments.${colors.reset}\n`);
    process.exit(1);
  }

  console.log(`\n${colors.green}All instruments will play at correct pitch.${colors.reset}\n`);
}

main();
