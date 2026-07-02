#!/usr/bin/env npx tsx
/**
 * Comprehensive Manifest Validator
 *
 * Validates ALL requirements for sampled instruments to produce sound.
 * This catches the "silent failure" bug family where instruments appear broken
 * but only log warnings (which users never see).
 *
 * SILENT FAILURE BUG FAMILY:
 * 1. playableRange excludes default note (SCHEDULER_BASE_MIDI_NOTE)
 * 2. Sample files don't exist
 * 3. Instrument not registered in SAMPLED_INSTRUMENTS
 * 4. Manifest has no samples
 * 5. baseNote outside playableRange
 * 6. Invalid JSON in manifest
 *
 * Usage:
 *   npx tsx scripts/validate-manifests.ts
 *   npx tsx scripts/validate-manifests.ts --fix  # Auto-fix playableRange issues
 */

import * as fs from 'fs';
import * as path from 'path';

// Import from single source of truth
import {
  SCHEDULER_BASE_MIDI_NOTE,
  midiToNoteName,
} from '../src/audio/constants';
import { nearestSampleNote, selectVelocityLayer } from '../src/audio/sample-selection';

// ============================================================================
// Configuration
// ============================================================================

const INSTRUMENTS_DIR = 'public/instruments';
const SAMPLED_INSTRUMENTS_FILE = 'src/audio/sampled-instrument.ts';
const SAMPLE_CONSTANTS_FILE = 'src/components/sample-constants.ts';
// Use the SINGLE SOURCE OF TRUTH - never hardcode this value
const DEFAULT_PLAYBACK_NOTE = SCHEDULER_BASE_MIDI_NOTE;
const AUDIO_FILE_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aif', '.aiff', '.ogg']);

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
  type: string;
  baseNote: number;
  releaseTime: number;
  playableRange?: { min: number; max: number };
  samples: Array<{
    note: number;
    file: string;
    velocityMin?: number;
    velocityMax?: number;
    loop?: boolean;
    loopStart?: number;
    loopEnd?: number;
  }>;
  credits?: { source: string; url: string; license: string };
  chokeGroup?: string;
  gainDb?: number;
  unpitched?: boolean;
}

/** Loudness trims beyond this are almost certainly data-entry errors. */
const MAX_GAIN_DB = 24;

interface ValidationError {
  type: 'critical' | 'warning';
  code: string;
  message: string;
  fix?: string;
}

interface ValidationResult {
  id: string;
  manifestPath: string;
  valid: boolean;
  errors: ValidationError[];
}

// ============================================================================
// Utilities (midiToNoteName imported from constants.ts)
// ============================================================================

function getRegisteredInstruments(): Set<string> {
  const filePath = path.join(process.cwd(), SAMPLED_INSTRUMENTS_FILE);
  if (!fs.existsSync(filePath)) {
    return new Set();
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/SAMPLED_INSTRUMENTS\s*=\s*\[([\s\S]*?)\]\s*as\s*const/);
  if (!match) return new Set();

  const instruments = match[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
  return new Set(instruments);
}

/**
 * Get sampled instruments from INSTRUMENT_CATEGORIES (UI registry)
 * This is the list of instruments visible to users in the sample picker
 */
function getUIRegisteredInstruments(): Set<string> {
  const filePath = path.join(process.cwd(), SAMPLE_CONSTANTS_FILE);
  if (!fs.existsSync(filePath)) {
    return new Set();
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  // Match all 'sampled:xxx' IDs in the file
  const matches = content.matchAll(/['"]sampled:([^'"]+)['"]/g);
  const instruments = new Set<string>();
  for (const match of matches) {
    instruments.add(match[1]);
  }
  return instruments;
}

// ============================================================================
// Validators
// ============================================================================

type ManifestSample = Manifest['samples'][number];

interface NormalizedVelocityLayer {
  index: number;
  note: number;
  file: string;
  velocityMin: number;
  velocityMax: number;
}

function normalizeVelocityLayer(sample: ManifestSample, index: number): NormalizedVelocityLayer {
  return {
    index,
    note: sample.note,
    file: sample.file,
    velocityMin: sample.velocityMin ?? 0,
    velocityMax: sample.velocityMax ?? 127,
  };
}

function addVelocityLayerReachabilityErrors(manifest: Manifest, errors: ValidationError[]): void {
  const byNote = new Map<number, NormalizedVelocityLayer[]>();
  for (const [index, sample] of manifest.samples.entries()) {
    const layer = normalizeVelocityLayer(sample, index);
    if (!Number.isFinite(layer.velocityMin) || !Number.isFinite(layer.velocityMax) ||
        layer.velocityMin < 0 || layer.velocityMax > 127 || layer.velocityMin > layer.velocityMax) {
      errors.push({
        type: 'critical',
        code: 'INVALID_VELOCITY_RANGE',
        message: `${layer.file}: velocity range must be within 0-127 and min <= max, got ${layer.velocityMin}-${layer.velocityMax}`,
      });
      continue;
    }
    const current = byNote.get(layer.note) ?? [];
    current.push(layer);
    byNote.set(layer.note, current);
  }

  for (const [note, layers] of byNote) {
    if (layers.length < 2) continue;
    const selectedIndexes = new Set<number>();
    for (let velocity = 0; velocity <= 127; velocity++) {
      const selected = selectVelocityLayer(layers, velocity);
      if (selected) selectedIndexes.add(selected.index);
    }

    for (const layer of layers) {
      if (selectedIndexes.has(layer.index)) continue;
      const earlierDuplicate = layers.find(other =>
        other.index < layer.index &&
        other.velocityMin === layer.velocityMin &&
        other.velocityMax === layer.velocityMax
      );
      errors.push({
        type: 'critical',
        code: earlierDuplicate ? 'DUPLICATE_MAPPING' : 'VELOCITY_LAYER_UNREACHABLE',
        message: `${layer.file}: note ${note} velocity range ${layer.velocityMin}-${layer.velocityMax} can never be selected${earlierDuplicate ? ` because ${earlierDuplicate.file} has the same mapping first` : ''}`,
      });
    }
  }
}

function validateManifest(
  manifestPath: string,
  registeredInstruments: Set<string>,
  uiRegisteredInstruments: Set<string>
): ValidationResult {
  const errors: ValidationError[] = [];
  const instrumentDir = path.dirname(manifestPath);
  const instrumentId = path.basename(instrumentDir);

  // 1. Check manifest exists and is valid JSON
  let manifest: Manifest;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(content);
  } catch (e) {
    return {
      id: instrumentId,
      manifestPath,
      valid: false,
      errors: [{
        type: 'critical',
        code: 'INVALID_JSON',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'unknown error'}`,
      }],
    };
  }

  // 2. Check required fields
  if (!manifest.id) {
    errors.push({
      type: 'critical',
      code: 'MISSING_ID',
      message: 'Manifest missing "id" field',
    });
  }

  if (!manifest.samples || !Array.isArray(manifest.samples)) {
    errors.push({
      type: 'critical',
      code: 'MISSING_SAMPLES',
      message: 'Manifest missing "samples" array',
    });
  }

  // 3. Check samples array is not empty
  if (manifest.samples && manifest.samples.length === 0) {
    errors.push({
      type: 'critical',
      code: 'EMPTY_SAMPLES',
      message: 'Manifest has empty "samples" array - instrument will be silent',
    });
  }

  // 4. Check all sample files exist and detect audio files that are no longer referenced.
  const referencedAudioFiles = new Set<string>();
  if (manifest.samples) {
    for (const sample of manifest.samples) {
      if (!sample.file) {
        errors.push({
          type: 'critical',
          code: 'MISSING_SAMPLE_FILE_FIELD',
          message: `Sample at note ${sample.note} is missing a "file" value`,
        });
        continue;
      }
      referencedAudioFiles.add(sample.file);
      const samplePath = path.join(instrumentDir, sample.file);
      if (!fs.existsSync(samplePath)) {
        errors.push({
          type: 'critical',
          code: 'MISSING_SAMPLE_FILE',
          message: `Sample file not found: ${sample.file}`,
        });
      }
    }
  }

  const audioFilesOnDisk = fs.readdirSync(instrumentDir)
    .filter(file => AUDIO_FILE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort();
  for (const file of audioFilesOnDisk) {
    if (!referencedAudioFiles.has(file)) {
      errors.push({
        type: 'warning',
        code: 'UNREFERENCED_AUDIO_FILE',
        message: `${file} exists on disk but is not referenced by manifest.json`,
      });
    }
  }

  // 5. Check instrument is registered in audio engine
  if (!registeredInstruments.has(instrumentId)) {
    errors.push({
      type: 'critical',
      code: 'NOT_REGISTERED',
      message: `Instrument "${instrumentId}" not in SAMPLED_INSTRUMENTS array`,
      fix: `Add '${instrumentId}' to SAMPLED_INSTRUMENTS in ${SAMPLED_INSTRUMENTS_FILE}`,
    });
  }

  // 5b. Check instrument is registered in UI (INSTRUMENT_CATEGORIES)
  // This was the bug that caused Hammond Organ to be invisible!
  if (!uiRegisteredInstruments.has(instrumentId)) {
    errors.push({
      type: 'critical',
      code: 'NOT_IN_UI',
      message: `Instrument "${instrumentId}" not in INSTRUMENT_CATEGORIES - users cannot see it!`,
      fix: `Add { id: 'sampled:${instrumentId}', name: '...', type: 'sampled' } to INSTRUMENT_CATEGORIES in ${SAMPLE_CONSTANTS_FILE}`,
    });
  }

  // 6. Check playableRange includes default note (MIDI 60)
  if (manifest.playableRange) {
    const { min, max } = manifest.playableRange;
    if (DEFAULT_PLAYBACK_NOTE < min || DEFAULT_PLAYBACK_NOTE > max) {
      errors.push({
        type: 'critical',
        code: 'PLAYABLE_RANGE_EXCLUDES_DEFAULT',
        message: `playableRange [${min}, ${max}] excludes default note ${DEFAULT_PLAYBACK_NOTE} (${midiToNoteName(DEFAULT_PLAYBACK_NOTE)}) - instrument will be SILENT`,
        fix: `Extend playableRange to include 60: { "min": ${Math.min(min, 48)}, "max": ${Math.max(max, 72)} }`,
      });
    }
  }

  // 7. Check baseNote is within playableRange (if defined)
  if (manifest.playableRange && manifest.baseNote !== undefined) {
    const { min, max } = manifest.playableRange;
    if (manifest.baseNote < min || manifest.baseNote > max) {
      errors.push({
        type: 'warning',
        code: 'BASENOTE_OUTSIDE_RANGE',
        message: `baseNote ${manifest.baseNote} (${midiToNoteName(manifest.baseNote)}) is outside playableRange [${min}, ${max}]`,
      });
    }
  }

  // 8. Check at least one sample note is within playableRange, and flag samples
  // that cannot be selected by any in-range note.
  if (manifest.playableRange && manifest.samples && manifest.samples.length > 0) {
    const { min, max } = manifest.playableRange;
    const samplesInRange = manifest.samples.filter(s => s.note >= min && s.note <= max);
    if (samplesInRange.length === 0) {
      errors.push({
        type: 'critical',
        code: 'NO_SAMPLES_IN_RANGE',
        message: `No samples within playableRange [${min}, ${max}] - instrument will be silent`,
      });
    }

    const sampleNotes = [...new Set(manifest.samples.map(s => s.note))];
    const reachableNotes = new Set<number>();
    for (let midiNote = min; midiNote <= max; midiNote++) {
      const nearest = nearestSampleNote(sampleNotes, midiNote);
      if (nearest !== undefined) reachableNotes.add(nearest);
    }

    for (const sample of manifest.samples) {
      if (sample.note < min || sample.note > max) {
        errors.push({
          type: 'warning',
          code: 'SAMPLE_NOTE_OUTSIDE_PLAYABLE_RANGE',
          message: `${sample.file}: sample note ${sample.note} (${midiToNoteName(sample.note)}) is outside playableRange [${min}, ${max}]`,
        });
      }
      if (!reachableNotes.has(sample.note)) {
        errors.push({
          type: 'warning',
          code: 'UNREACHABLE_SAMPLE_BY_RANGE',
          message: `${sample.file}: no in-range note selects sample note ${sample.note} (${midiToNoteName(sample.note)})`,
        });
      }
    }
  }

  // 9. Check credits for license compliance
  if (!manifest.credits) {
    errors.push({
      type: 'warning',
      code: 'MISSING_CREDITS',
      message: 'Manifest missing "credits" - license attribution is important',
    });
  }

  // 10. Check chokeGroup is a non-empty string (when present)
  if (manifest.chokeGroup !== undefined &&
      (typeof manifest.chokeGroup !== 'string' || manifest.chokeGroup.length === 0)) {
    errors.push({
      type: 'critical',
      code: 'INVALID_CHOKE_GROUP',
      message: `chokeGroup must be a non-empty string, got: ${JSON.stringify(manifest.chokeGroup)}`,
    });
  }

  // 11. Check gainDb is a sane loudness trim (when present)
  if (manifest.gainDb !== undefined &&
      (typeof manifest.gainDb !== 'number' || !Number.isFinite(manifest.gainDb) ||
       Math.abs(manifest.gainDb) > MAX_GAIN_DB)) {
    errors.push({
      type: 'critical',
      code: 'INVALID_GAIN_DB',
      message: `gainDb must be a finite number within ±${MAX_GAIN_DB}, got: ${JSON.stringify(manifest.gainDb)}`,
    });
  }

  if (manifest.unpitched !== undefined && typeof manifest.unpitched !== 'boolean') {
    errors.push({
      type: 'critical',
      code: 'INVALID_UNPITCHED_FLAG',
      message: `unpitched must be a boolean when present, got: ${JSON.stringify(manifest.unpitched)}`,
    });
  }

  // 12. Check velocity-layer reachability using the engine's selection logic.
  if (manifest.samples) {
    addVelocityLayerReachabilityErrors(manifest, errors);
  }

  // 13. Check loop regions are well-formed (when present).
  // Mirrors validatedLoop() in src/audio/sample-selection.ts: the engine
  // silently ignores malformed regions, so catch them at validation time.
  if (manifest.samples) {
    for (const sample of manifest.samples) {
      if (sample.loop !== true && (sample.loopStart !== undefined || sample.loopEnd !== undefined)) {
        errors.push({
          type: 'warning',
          code: 'LOOP_POINTS_WITHOUT_LOOP',
          message: `${sample.file}: loopStart/loopEnd present but "loop" is not true - loop will not engage`,
        });
      }
      if (sample.loop === true) {
        const start = sample.loopStart ?? 0;
        if (!Number.isFinite(start) || start < 0) {
          errors.push({
            type: 'critical',
            code: 'INVALID_LOOP_START',
            message: `${sample.file}: loopStart must be a finite number >= 0, got: ${JSON.stringify(sample.loopStart)}`,
          });
        }
        if (sample.loopEnd !== undefined &&
            (!Number.isFinite(sample.loopEnd) || sample.loopEnd <= start)) {
          errors.push({
            type: 'critical',
            code: 'INVALID_LOOP_END',
            message: `${sample.file}: loopEnd must be > loopStart (${start}), got: ${JSON.stringify(sample.loopEnd)}`,
          });
        }
      }
    }
  }

  return {
    id: instrumentId,
    manifestPath,
    valid: errors.filter(e => e.type === 'critical').length === 0,
    errors,
  };
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  const _fixMode = args.includes('--fix');

  console.log(`\n${colors.bold}🎵 COMPREHENSIVE MANIFEST VALIDATOR${colors.reset}\n`);
  console.log(`${colors.dim}Checking all requirements for instruments to produce sound${colors.reset}\n`);
  console.log('─'.repeat(70) + '\n');

  // Get registered instruments (audio engine + UI)
  const registeredInstruments = getRegisteredInstruments();
  const uiRegisteredInstruments = getUIRegisteredInstruments();
  console.log(`${colors.dim}Found ${registeredInstruments.size} registered instruments in SAMPLED_INSTRUMENTS${colors.reset}`);
  console.log(`${colors.dim}Found ${uiRegisteredInstruments.size} registered instruments in INSTRUMENT_CATEGORIES (UI)${colors.reset}\n`);

  // Find all manifest files
  const instrumentsPath = path.join(process.cwd(), INSTRUMENTS_DIR);
  if (!fs.existsSync(instrumentsPath)) {
    console.error(`${colors.red}Error: Instruments directory not found at ${instrumentsPath}${colors.reset}`);
    process.exit(1);
  }

  const manifests = fs.readdirSync(instrumentsPath)
    .filter(f => fs.statSync(path.join(instrumentsPath, f)).isDirectory())
    .map(f => path.join(instrumentsPath, f, 'manifest.json'))
    .filter(f => fs.existsSync(f))
    .sort();

  // Validate each manifest
  const results: ValidationResult[] = [];
  for (const manifestPath of manifests) {
    results.push(validateManifest(manifestPath, registeredInstruments, uiRegisteredInstruments));
  }

  // Check for registered instruments without manifests
  const manifestIds = new Set(results.map(r => r.id));
  for (const registered of registeredInstruments) {
    if (!manifestIds.has(registered)) {
      results.push({
        id: registered,
        manifestPath: `${INSTRUMENTS_DIR}/${registered}/manifest.json`,
        valid: false,
        errors: [{
          type: 'critical',
          code: 'REGISTERED_BUT_NO_MANIFEST',
          message: `Instrument "${registered}" is registered but has no manifest`,
        }],
      });
    }
  }

  // Report results
  const criticalFailures = results.filter(r => !r.valid);
  const warnings = results.filter(r => r.valid && r.errors.length > 0);
  const passes = results.filter(r => r.valid && r.errors.length === 0);

  if (criticalFailures.length > 0) {
    console.log(`${colors.red}${colors.bold}CRITICAL FAILURES (${criticalFailures.length})${colors.reset}\n`);
    for (const result of criticalFailures) {
      console.log(`  ${colors.red}❌${colors.reset} ${colors.bold}${result.id}${colors.reset}`);
      for (const error of result.errors) {
        const prefix = error.type === 'critical' ? colors.red : colors.yellow;
        console.log(`     ${prefix}[${error.code}]${colors.reset} ${error.message}`);
        if (error.fix) {
          console.log(`     ${colors.cyan}Fix: ${error.fix}${colors.reset}`);
        }
      }
      console.log();
    }
  }

  if (warnings.length > 0) {
    console.log(`${colors.yellow}${colors.bold}WARNINGS (${warnings.length})${colors.reset}\n`);
    for (const result of warnings) {
      console.log(`  ${colors.yellow}⚠${colors.reset} ${result.id}`);
      for (const error of result.errors) {
        console.log(`     ${colors.yellow}[${error.code}]${colors.reset} ${error.message}`);
      }
    }
    console.log();
  }

  if (passes.length > 0) {
    console.log(`${colors.green}${colors.bold}PASSES (${passes.length})${colors.reset}\n`);
    for (const result of passes) {
      console.log(`  ${colors.green}✓${colors.reset} ${result.id}`);
    }
    console.log();
  }

  // Summary
  console.log('─'.repeat(70));
  console.log(`\n${colors.bold}SUMMARY${colors.reset}`);
  console.log(`  Total instruments: ${results.length}`);
  console.log(`  ${colors.green}Passes:${colors.reset} ${passes.length}`);
  console.log(`  ${colors.yellow}Warnings:${colors.reset} ${warnings.length}`);
  console.log(`  ${colors.red}Critical failures:${colors.reset} ${criticalFailures.length}`);

  if (criticalFailures.length > 0) {
    console.log(`\n${colors.red}${colors.bold}⚠️  ${criticalFailures.length} instrument(s) will be SILENT or broken!${colors.reset}\n`);
    process.exit(1);
  }

  console.log(`\n${colors.green}All instruments validated successfully.${colors.reset}\n`);
  process.exit(0);
}

main();
