#!/usr/bin/env npx tsx
/* eslint-disable @typescript-eslint/no-unused-vars, no-empty */
/**
 * Sample Processing CLI Tool
 *
 * Comprehensive tool for downloading, converting, normalizing, and validating
 * sampled instruments for Keyboardia.
 *
 * Usage:
 *   npx tsx scripts/process-samples.ts download <instrument-id> <source-url> [options]
 *   npx tsx scripts/process-samples.ts convert <input-dir> <output-dir> [options]
 *   npx tsx scripts/process-samples.ts normalize <instrument-dir> [options]
 *   npx tsx scripts/process-samples.ts validate [instrument-dir]
 *   npx tsx scripts/process-samples.ts manifest <instrument-dir> [options]
 *   npx tsx scripts/process-samples.ts register <instrument-id> [options]
 *   npx tsx scripts/process-samples.ts full <instrument-id> <source-url> [options]
 *
 * Examples:
 *   npx tsx scripts/process-samples.ts validate
 *   npx tsx scripts/process-samples.ts normalize public/instruments/rhodes
 *   npx tsx scripts/process-samples.ts manifest public/instruments/rhodes --name "Rhodes EP" --baseNote 60
 *   npx tsx scripts/process-samples.ts register rhodes --name "Rhodes" --category keys
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const INSTRUMENTS_DIR = 'public/instruments';
const REFERENCE_SAMPLE = 'public/instruments/piano/C3.mp3';
const REFERENCE_PEAK = -1.4; // dB
const PEAK_TOLERANCE = 2.0; // dB
const TARGET_SAMPLE_RATE = 44100;
const TARGET_CHANNELS = 1; // Mono
const MP3_BITRATE = '128k';

// Standard note mapping for multi-sampled instruments
const NOTE_NAMES: Record<number, string> = {
  24: 'C1', 36: 'C2', 48: 'C3', 60: 'C4', 72: 'C5', 84: 'C6', 96: 'C7',
  27: 'Eb1', 39: 'Eb2', 51: 'Eb3', 63: 'Eb4', 75: 'Eb5', 87: 'Eb6',
  30: 'Gb1', 42: 'Gb2', 54: 'Gb3', 66: 'Gb4', 78: 'Gb5', 90: 'Gb6',
  33: 'A1', 45: 'A2', 57: 'A3', 69: 'A4', 81: 'A5', 93: 'A6',
};

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// ============================================================================
// Utility Functions
// ============================================================================

function log(message: string, color?: keyof typeof colors): void {
  const prefix = color ? colors[color] : '';
  const suffix = color ? colors.reset : '';
  console.log(`${prefix}${message}${suffix}`);
}

function logStep(step: string): void {
  log(`\n${colors.bold}${colors.cyan}▶ ${step}${colors.reset}`);
}

function logSuccess(message: string): void {
  log(`  ✓ ${message}`, 'green');
}

function logError(message: string): void {
  log(`  ✗ ${message}`, 'red');
}

function logWarning(message: string): void {
  log(`  ⚠ ${message}`, 'yellow');
}

function logInfo(message: string): void {
  log(`  ℹ ${message}`, 'blue');
}

function checkDependency(command: string, name: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'pipe' });
    return true;
  } catch {
    logError(`${name} is required but not installed.`);
    logInfo(`Install with: brew install ${command}`);
    return false;
  }
}

function getPeakVolume(filePath: string): number | null {
  try {
    const output = execSync(
      `ffmpeg -i "${filePath}" -af volumedetect -f null - 2>&1`,
      { encoding: 'utf-8' }
    );
    const match = output.match(/max_volume: ([-\d.]+) dB/);
    return match ? parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}

function getMeanVolume(filePath: string): number | null {
  try {
    const output = execSync(
      `ffmpeg -i "${filePath}" -af volumedetect -f null - 2>&1`,
      { encoding: 'utf-8' }
    );
    const match = output.match(/mean_volume: ([-\d.]+) dB/);
    return match ? parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}

function getDuration(filePath: string): number | null {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8' }
    );
    return parseFloat(output.trim());
  } catch {
    return null;
  }
}

function getAudioInfo(filePath: string): { sampleRate: number; channels: number; codec: string } | null {
  try {
    const output = execSync(
      `ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate,channels,codec_name -of json "${filePath}"`,
      { encoding: 'utf-8' }
    );
    const data = JSON.parse(output);
    const stream = data.streams?.[0];
    if (stream) {
      return {
        sampleRate: parseInt(stream.sample_rate),
        channels: stream.channels,
        codec: stream.codec_name,
      };
    }
  } catch {}
  return null;
}

function noteToMidi(noteName: string): number {
  const noteMap: Record<string, number> = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
  };
  const match = noteName.match(/^([A-G])([#b]?)(\d+)$/i);
  if (!match) return 60;

  let note = noteMap[match[1].toUpperCase()];
  if (match[2] === '#') note += 1;
  if (match[2] === 'b') note -= 1;
  const octave = parseInt(match[3]);

  return (octave + 1) * 12 + note;
}

function midiToNoteName(midi: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const note = notes[midi % 12];
  return `${note}${octave}`;
}

// ============================================================================
// Commands
// ============================================================================

interface ValidateResult {
  passed: boolean;
  samples: Array<{
    file: string;
    peak: number;
    diff: number;
    passed: boolean;
  }>;
}

async function validateCommand(instrumentDir?: string): Promise<void> {
  logStep('Validating sample volumes');

  if (!checkDependency('ffmpeg', 'ffmpeg')) {
    process.exit(1);
  }

  // Get reference peak
  const refPeak = getPeakVolume(REFERENCE_SAMPLE);
  if (refPeak === null) {
    logError(`Could not read reference sample: ${REFERENCE_SAMPLE}`);
    process.exit(1);
  }

  log(`\nReference: Piano C3`);
  log(`  Expected peak: ${REFERENCE_PEAK} dB`);
  log(`  Actual peak:   ${refPeak} dB`);
  log(`  Tolerance:     ±${PEAK_TOLERANCE} dB\n`);

  const baseDir = instrumentDir || INSTRUMENTS_DIR;
  const instrumentDirs = instrumentDir
    ? [instrumentDir]
    : fs.readdirSync(baseDir)
        .filter(d => fs.statSync(path.join(baseDir, d)).isDirectory())
        .filter(d => d !== 'piano') // Skip reference
        .map(d => path.join(baseDir, d));

  let passCount = 0;
  let failCount = 0;
  const failures: string[] = [];

  for (const dir of instrumentDirs) {
    const instName = path.basename(dir);
    const mp3Files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3'));

    if (mp3Files.length === 0) continue;

    log(`\n${instName}/`);

    for (const file of mp3Files) {
      const filePath = path.join(dir, file);
      const peak = getPeakVolume(filePath);

      if (peak === null) {
        logError(`Could not read: ${file}`);
        failCount++;
        continue;
      }

      const diff = peak - REFERENCE_PEAK;
      const passed = Math.abs(diff) <= PEAK_TOLERANCE;

      const status = passed
        ? `${colors.green}PASS${colors.reset}`
        : `${colors.red}FAIL${colors.reset}`;

      const diffStr = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
      console.log(`  ${file.padEnd(20)} Peak: ${peak.toFixed(1).padStart(6)} dB  Diff: ${diffStr.padStart(6)} dB  [${status}]`);

      if (passed) {
        passCount++;
      } else {
        failCount++;
        const adjustment = (REFERENCE_PEAK - peak).toFixed(1);
        failures.push(`  ${instName}/${file}: needs ${adjustment} dB adjustment`);
      }
    }
  }

  log(`\n${'='.repeat(60)}`);
  log(`Results: ${colors.green}${passCount} passed${colors.reset}, ${colors.red}${failCount} failed${colors.reset}`);

  if (failCount > 0) {
    log(`\n${colors.red}Failed samples:${colors.reset}`);
    failures.forEach(f => log(f));
    log(`\nTo fix, run: npx tsx scripts/process-samples.ts normalize <instrument-dir>`);
    process.exit(1);
  }

  logSuccess('All samples validated successfully!');
}

async function normalizeCommand(instrumentDir: string, options: { dryRun?: boolean } = {}): Promise<void> {
  logStep(`Normalizing volumes in ${instrumentDir}`);

  if (!checkDependency('ffmpeg', 'ffmpeg')) {
    process.exit(1);
  }

  if (!fs.existsSync(instrumentDir)) {
    logError(`Directory not found: ${instrumentDir}`);
    process.exit(1);
  }

  const mp3Files = fs.readdirSync(instrumentDir).filter(f => f.endsWith('.mp3'));

  for (const file of mp3Files) {
    const filePath = path.join(instrumentDir, file);
    const peak = getPeakVolume(filePath);

    if (peak === null) {
      logWarning(`Could not read: ${file}`);
      continue;
    }

    const adjustment = REFERENCE_PEAK - peak;

    if (Math.abs(adjustment) <= 0.5) {
      logInfo(`${file}: already normalized (peak: ${peak.toFixed(1)} dB)`);
      continue;
    }

    const tempFile = filePath.replace('.mp3', '.tmp.mp3');
    const adjustmentStr = adjustment >= 0 ? `+${adjustment.toFixed(1)}` : adjustment.toFixed(1);

    if (options.dryRun) {
      logInfo(`${file}: would adjust by ${adjustmentStr} dB (current: ${peak.toFixed(1)} dB)`);
      continue;
    }

    try {
      execSync(
        `ffmpeg -y -i "${filePath}" -af "volume=${adjustment}dB" -ar ${TARGET_SAMPLE_RATE} -ac ${TARGET_CHANNELS} -b:a ${MP3_BITRATE} "${tempFile}" 2>/dev/null`,
        { stdio: 'pipe' }
      );
      fs.renameSync(tempFile, filePath);
      logSuccess(`${file}: adjusted by ${adjustmentStr} dB`);
    } catch (err) {
      logError(`Failed to normalize ${file}`);
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  }

  logSuccess('Normalization complete');
}

async function convertCommand(
  inputDir: string,
  outputDir: string,
  options: {
    normalize?: boolean;
    notePattern?: string;
  } = {}
): Promise<void> {
  logStep(`Converting samples from ${inputDir} to ${outputDir}`);

  if (!checkDependency('ffmpeg', 'ffmpeg')) {
    process.exit(1);
  }

  if (!fs.existsSync(inputDir)) {
    logError(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    logInfo(`Created output directory: ${outputDir}`);
  }

  // Find audio files
  const audioExtensions = ['.wav', '.flac', '.aiff', '.aif', '.ogg', '.mp3'];
  const audioFiles = fs.readdirSync(inputDir)
    .filter(f => audioExtensions.some(ext => f.toLowerCase().endsWith(ext)));

  if (audioFiles.length === 0) {
    logWarning('No audio files found');
    return;
  }

  logInfo(`Found ${audioFiles.length} audio files`);

  for (const file of audioFiles) {
    const inputPath = path.join(inputDir, file);

    // Extract note name from filename
    let noteName = file.replace(/\.[^.]+$/, ''); // Remove extension

    // Try to extract note from filename patterns like "Piano_C4.wav" or "C4_sustain.wav"
    const noteMatch = noteName.match(/([A-G][#b]?\d)/i);
    if (noteMatch) {
      noteName = noteMatch[1].toUpperCase();
    }

    const outputPath = path.join(outputDir, `${noteName}.mp3`);

    try {
      const volumeFilter = options.normalize ? ',volumedetect' : '';
      execSync(
        `ffmpeg -y -i "${inputPath}" -ar ${TARGET_SAMPLE_RATE} -ac ${TARGET_CHANNELS} -b:a ${MP3_BITRATE} "${outputPath}" 2>/dev/null`,
        { stdio: 'pipe' }
      );
      logSuccess(`${file} → ${path.basename(outputPath)}`);
    } catch (err) {
      logError(`Failed to convert: ${file}`);
    }
  }

  if (options.normalize) {
    await normalizeCommand(outputDir);
  }

  logSuccess('Conversion complete');
}

interface ManifestOptions {
  name: string;
  baseNote?: number;
  releaseTime?: number;
  source?: string;
  url?: string;
  license?: string;
}

async function manifestCommand(instrumentDir: string, options: ManifestOptions): Promise<void> {
  logStep(`Generating manifest for ${instrumentDir}`);

  if (!fs.existsSync(instrumentDir)) {
    logError(`Directory not found: ${instrumentDir}`);
    process.exit(1);
  }

  const instrumentId = path.basename(instrumentDir);
  const mp3Files = fs.readdirSync(instrumentDir)
    .filter(f => f.endsWith('.mp3'))
    .sort((a, b) => {
      // Sort by MIDI note number
      const noteA = noteToMidi(a.replace('.mp3', ''));
      const noteB = noteToMidi(b.replace('.mp3', ''));
      return noteA - noteB;
    });

  if (mp3Files.length === 0) {
    logError('No MP3 files found');
    process.exit(1);
  }

  const samples = mp3Files.map(file => {
    const noteName = file.replace('.mp3', '');
    const midiNote = noteToMidi(noteName);
    return { note: midiNote, file };
  });

  // Determine base note (middle sample)
  const baseNote = options.baseNote ?? samples[Math.floor(samples.length / 2)].note;

  const manifest = {
    id: instrumentId,
    name: options.name,
    type: 'sampled',
    baseNote,
    releaseTime: options.releaseTime ?? 0.5,
    credits: {
      source: options.source ?? 'Unknown',
      url: options.url ?? '',
      license: options.license ?? 'Unknown',
    },
    samples,
  };

  const manifestPath = path.join(instrumentDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  logSuccess(`Created ${manifestPath}`);
  log(`\nManifest contents:`);
  log(JSON.stringify(manifest, null, 2));
}

interface RegisterOptions {
  name: string;
  category: 'drums' | 'bass' | 'keys' | 'leads' | 'pads' | 'fx';
  displayName?: string;
}

async function registerCommand(instrumentId: string, options: RegisterOptions): Promise<void> {
  logStep(`Generating registration code for ${instrumentId}`);

  const sampledId = `sampled:${instrumentId}`;
  const displayName = options.displayName || options.name;

  log('\n1. Add to SAMPLED_INSTRUMENTS in src/audio/sampled-instrument.ts:');
  log(colors.cyan);
  log(`  '${instrumentId}',`);
  log(colors.reset);

  log('\n2. Add to INSTRUMENT_CATEGORIES in src/components/sample-constants.ts:');
  log(colors.cyan);
  log(`  // In ${options.category} category instruments array:`);
  log(`  { id: '${sampledId}', name: '${displayName}', type: 'sampled' },`);
  log(colors.reset);

  log('\n3. Add to SAMPLED_NAMES in src/components/sample-constants.ts:');
  log(colors.cyan);
  log(`  '${sampledId}': '${displayName}',`);
  log(colors.reset);

  log('\n4. Add to SAMPLED_CATEGORIES in src/components/sample-constants.ts:');
  log(colors.cyan);
  log(`  // In ${options.category} array:`);
  log(`  '${sampledId}',`);
  log(colors.reset);

  log('\n5. Add to VALID_SAMPLE_IDS in scripts/session-api.ts:');
  log(colors.cyan);
  log(`  '${sampledId}',`);
  log(colors.reset);

  logSuccess('Registration code generated');
}

async function downloadCommand(
  instrumentId: string,
  sourceUrl: string,
  options: { output?: string }
): Promise<void> {
  logStep(`Downloading samples for ${instrumentId}`);

  const outputDir = options.output || path.join(INSTRUMENTS_DIR, instrumentId);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Detect URL type and download accordingly
  if (sourceUrl.includes('github.com')) {
    // GitHub URL - try to download raw files or clone
    logInfo(`Detected GitHub URL`);

    if (sourceUrl.includes('/raw/') || sourceUrl.includes('/blob/')) {
      // Single file
      const rawUrl = sourceUrl.replace('/blob/', '/raw/');
      const fileName = path.basename(sourceUrl);
      const outputPath = path.join(outputDir, fileName);

      try {
        execSync(`curl -L -o "${outputPath}" "${rawUrl}"`, { stdio: 'pipe' });
        logSuccess(`Downloaded ${fileName}`);
      } catch {
        logError(`Failed to download ${rawUrl}`);
      }
    } else {
      logInfo('For full repos, clone manually and use the convert command');
    }
  } else {
    // Direct URL
    const fileName = path.basename(sourceUrl);
    const outputPath = path.join(outputDir, fileName);

    try {
      execSync(`curl -L -o "${outputPath}" "${sourceUrl}"`, { stdio: 'pipe' });
      logSuccess(`Downloaded ${fileName}`);
    } catch {
      logError(`Failed to download ${sourceUrl}`);
    }
  }
}

async function fullCommand(
  instrumentId: string,
  options: {
    inputDir: string;
    name: string;
    category: 'drums' | 'bass' | 'keys' | 'leads' | 'pads' | 'fx';
    source?: string;
    url?: string;
    license?: string;
    baseNote?: number;
    releaseTime?: number;
  }
): Promise<void> {
  logStep(`Full processing pipeline for ${instrumentId}`);

  const outputDir = path.join(INSTRUMENTS_DIR, instrumentId);

  // 1. Convert
  await convertCommand(options.inputDir, outputDir, { normalize: true });

  // 2. Generate manifest
  await manifestCommand(outputDir, {
    name: options.name,
    baseNote: options.baseNote,
    releaseTime: options.releaseTime,
    source: options.source,
    url: options.url,
    license: options.license,
  });

  // 3. Validate
  await validateCommand(outputDir);

  // 4. Show registration code
  await registerCommand(instrumentId, {
    name: options.name,
    category: options.category,
  });

  logSuccess(`\nFull processing complete for ${instrumentId}`);
  log(`\nNext steps:`);
  log(`  1. Add the registration code above to the source files`);
  log(`  2. Update LICENSE.md with attribution`);
  log(`  3. Run tests: npm test`);
  log(`  4. Deploy: npx wrangler deploy`);
}

// ============================================================================
// CLI Parser
// ============================================================================

function parseArgs(args: string[]): { command: string; positional: string[]; options: Record<string, string | boolean> } {
  const command = args[0] || 'help';
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (value !== undefined) {
        options[key] = value;
      } else if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options[key] = args[++i];
      } else {
        options[key] = true;
      }
    } else if (arg.startsWith('-')) {
      options[arg.slice(1)] = true;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, options };
}

function printUsage(): void {
  console.log(`
${colors.bold}Sample Processing CLI Tool${colors.reset}

${colors.cyan}Usage:${colors.reset}
  npx tsx scripts/process-samples.ts <command> [options]

${colors.cyan}Commands:${colors.reset}
  validate [dir]              Validate sample volumes against piano reference
  normalize <dir>             Normalize sample volumes to match piano
  convert <input> <output>    Convert audio files to MP3
  manifest <dir> --name NAME  Generate manifest.json for instrument
  register <id> --name NAME   Generate registration code snippets
  full <id> --input DIR       Full pipeline: convert, normalize, manifest, register

${colors.cyan}Options:${colors.reset}
  --dry-run                   Show what would be done without doing it
  --name NAME                 Display name for the instrument
  --category CAT              Category: drums, bass, keys, leads, pads, fx
  --source SOURCE             Credit source name
  --url URL                   Credit source URL
  --license LICENSE           License type (e.g., "CC0", "CC-BY 4.0")
  --baseNote NOTE             Base MIDI note (default: middle sample)
  --releaseTime SECONDS       Release time in seconds (default: 0.5)

${colors.cyan}Examples:${colors.reset}
  # Validate all instruments
  npx tsx scripts/process-samples.ts validate

  # Normalize a specific instrument
  npx tsx scripts/process-samples.ts normalize public/instruments/rhodes

  # Convert and process new samples
  npx tsx scripts/process-samples.ts full rhodes \\
    --input /tmp/rhodes-samples \\
    --name "Rhodes EP" \\
    --category keys \\
    --source "VSCO 2 CE" \\
    --license "CC0 1.0"

${colors.cyan}Volume Reference:${colors.reset}
  Piano C3 peak: ${REFERENCE_PEAK} dB
  Tolerance: ±${PEAK_TOLERANCE} dB
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { command, positional, options } = parseArgs(process.argv.slice(2));

  try {
    switch (command) {
      case 'validate':
        await validateCommand(positional[0]);
        break;

      case 'normalize':
        if (!positional[0]) {
          logError('Usage: normalize <instrument-dir>');
          process.exit(1);
        }
        await normalizeCommand(positional[0], { dryRun: !!options['dry-run'] });
        break;

      case 'convert':
        if (!positional[0] || !positional[1]) {
          logError('Usage: convert <input-dir> <output-dir>');
          process.exit(1);
        }
        await convertCommand(positional[0], positional[1], {
          normalize: !!options.normalize,
        });
        break;

      case 'manifest':
        if (!positional[0] || !options.name) {
          logError('Usage: manifest <instrument-dir> --name NAME');
          process.exit(1);
        }
        await manifestCommand(positional[0], {
          name: options.name as string,
          baseNote: options.baseNote ? parseInt(options.baseNote as string) : undefined,
          releaseTime: options.releaseTime ? parseFloat(options.releaseTime as string) : undefined,
          source: options.source as string,
          url: options.url as string,
          license: options.license as string,
        });
        break;

      case 'register':
        if (!positional[0] || !options.name || !options.category) {
          logError('Usage: register <instrument-id> --name NAME --category CAT');
          process.exit(1);
        }
        await registerCommand(positional[0], {
          name: options.name as string,
          category: options.category as RegisterOptions['category'],
          displayName: options.displayName as string,
        });
        break;

      case 'download':
        if (!positional[0] || !positional[1]) {
          logError('Usage: download <instrument-id> <source-url>');
          process.exit(1);
        }
        await downloadCommand(positional[0], positional[1], {
          output: options.output as string,
        });
        break;

      case 'full':
        if (!positional[0] || !options.input || !options.name || !options.category) {
          logError('Usage: full <instrument-id> --input DIR --name NAME --category CAT');
          process.exit(1);
        }
        await fullCommand(positional[0], {
          inputDir: options.input as string,
          name: options.name as string,
          category: options.category as RegisterOptions['category'],
          source: options.source as string,
          url: options.url as string,
          license: options.license as string,
          baseNote: options.baseNote ? parseInt(options.baseNote as string) : undefined,
          releaseTime: options.releaseTime ? parseFloat(options.releaseTime as string) : undefined,
        });
        break;

      case 'help':
      case '-h':
      case '--help':
        printUsage();
        break;

      default:
        logError(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    logError(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
