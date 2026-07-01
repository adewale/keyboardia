#!/usr/bin/env npx tsx
/**
 * Velocity Layer Volume Validator
 *
 * Detects when velocity layers are incorrectly ordered by checking actual
 * audio RMS levels against velocity assignments.
 *
 * ROOT CAUSE OF THIS BUG CLASS:
 * - Manifests were created based on filename semantics (e.g., "tap" = soft)
 * - But actual audio levels weren't verified
 * - File names can be misleading (e.g., brush-tap.mp3 was actually the LOUDEST)
 *
 * WHAT THIS VALIDATES:
 * - For each note with multiple velocity layers:
 *   - Lower velocity ranges should have quieter samples (higher negative dB)
 *   - Higher velocity ranges should have louder samples (lower negative dB)
 * - Reports inversions where soft velocity triggers loud samples
 *
 * Usage:
 *   npx tsx scripts/validate-velocity-layers.ts
 *   npx tsx scripts/validate-velocity-layers.ts --fix  # Suggest fixes
 *   npm run validate:velocity
 */

import * as fs from 'fs';
import * as path from 'path';

const INSTRUMENTS_DIR = 'public/instruments';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

interface Sample {
  note: number;
  file: string;
  velocityMin?: number;
  velocityMax?: number;
}

interface Manifest {
  id: string;
  name: string;
  samples: Sample[];
}

interface SampleWithVolume extends Sample {
  meanVolume: number;
  maxVolume: number;
  instrumentId: string;
  instrumentDir: string;
}

interface DecodeAudioContext {
  decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer>;
  close?: () => Promise<void>;
}

interface VelocityGroup {
  note: number;
  samples: SampleWithVolume[];
  isInverted: boolean;
  suggestedOrder?: SampleWithVolume[];
}

interface InstrumentResult {
  id: string;
  hasVelocityLayers: boolean;
  groups: VelocityGroup[];
  allSamples: SampleWithVolume[];
}

/**
 * Get decoded RMS/peak levels without shelling out to ffmpeg.
 *
 * The old validator used ffmpeg's volumedetect and returned -100 dB on any
 * error. On machines without ffmpeg that made every layer appear equally
 * quiet, so the validator passed while measuring nothing. Decode through the
 * same Web Audio API shape used by the app/tests and fail closed on errors.
 */
async function getVolumeLevel(
  audioContext: DecodeAudioContext,
  filePath: string
): Promise<{ mean: number; max: number }> {
  const bytes = fs.readFileSync(filePath);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  let sumSquares = 0;
  let count = 0;
  let peak = 0;

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const data = audioBuffer.getChannelData(channel);
    count += data.length;
    for (const sample of data) {
      const abs = Math.abs(sample);
      peak = Math.max(peak, abs);
      sumSquares += sample * sample;
    }
  }

  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  const toDb = (value: number): number => value > 0 ? 20 * Math.log10(value) : -Infinity;

  return { mean: toDb(rms), max: toDb(peak) };
}

/**
 * Check if velocity layers are inverted for a group of samples at the same note
 */
function checkVelocityInversion(samples: SampleWithVolume[]): {
  isInverted: boolean;
  suggestedOrder: SampleWithVolume[];
} {
  if (samples.length < 2) {
    return { isInverted: false, suggestedOrder: samples };
  }

  // Sort by velocity range (ascending by velocityMin)
  const byVelocity = [...samples].sort(
    (a, b) => (a.velocityMin ?? 0) - (b.velocityMin ?? 0)
  );

  // Sort by volume (ascending - quietest first, i.e., most negative dB first)
  const byVolume = [...samples].sort((a, b) => a.meanVolume - b.meanVolume);

  // Check if the order matches
  // For correct ordering: sample at velocity 0-50 should be quietest (most negative dB)
  // Sample at velocity 101-127 should be loudest (least negative dB)
  let isInverted = false;
  for (let i = 0; i < byVelocity.length; i++) {
    if (byVelocity[i].file !== byVolume[i].file) {
      isInverted = true;
      break;
    }
  }

  return { isInverted, suggestedOrder: byVolume };
}

/**
 * Analyze a single instrument
 */
async function analyzeInstrument(
  audioContext: DecodeAudioContext,
  instrumentDir: string
): Promise<InstrumentResult | null> {
  const manifestPath = path.join(instrumentDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const instrumentId = manifest.id;

  // Check if this instrument has velocity layers
  const hasVelocityLayers = manifest.samples.some(
    (s) => s.velocityMin !== undefined || s.velocityMax !== undefined
  );

  // Get volume levels for all samples
  const samplesWithVolume: SampleWithVolume[] = [];
  for (const sample of manifest.samples) {
    const samplePath = path.join(instrumentDir, sample.file);
    const volume = await getVolumeLevel(audioContext, samplePath);
    samplesWithVolume.push({
      ...sample,
      meanVolume: volume.mean,
      maxVolume: volume.max,
      instrumentId,
      instrumentDir,
    });
  }

  // Group samples by note
  const noteGroups = new Map<number, SampleWithVolume[]>();
  for (const sample of samplesWithVolume) {
    const existing = noteGroups.get(sample.note) || [];
    existing.push(sample);
    noteGroups.set(sample.note, existing);
  }

  // Check each group for inversions
  const groups: VelocityGroup[] = [];
  for (const [note, samples] of noteGroups) {
    // Only check groups with velocity layers
    if (samples.some((s) => s.velocityMin !== undefined)) {
      const { isInverted, suggestedOrder } = checkVelocityInversion(samples);
      groups.push({
        note,
        samples,
        isInverted,
        suggestedOrder,
      });
    }
  }

  return {
    id: instrumentId,
    hasVelocityLayers,
    groups,
    allSamples: samplesWithVolume,
  };
}

/**
 * Format volume for display
 */
function formatVolume(db: number): string {
  return db.toFixed(1) + ' dB';
}

/**
 * Main
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showFixes = args.includes('--fix');
  const showAll = args.includes('--all');

  console.log(`\n${colors.bold}🔊 VELOCITY LAYER VOLUME VALIDATOR${colors.reset}\n`);
  console.log(
    `${colors.dim}Verifies velocity layers are ordered by actual volume levels${colors.reset}\n`
  );
  console.log('─'.repeat(70) + '\n');

  const instrumentsPath = path.join(process.cwd(), INSTRUMENTS_DIR);
  const instrumentDirs = fs
    .readdirSync(instrumentsPath)
    .filter((f) => fs.statSync(path.join(instrumentsPath, f)).isDirectory())
    .map((f) => path.join(instrumentsPath, f))
    .sort();

  const results: InstrumentResult[] = [];
  const inversions: { instrument: string; group: VelocityGroup }[] = [];

  console.log(`${colors.dim}Analyzing ${instrumentDirs.length} instruments...${colors.reset}\n`);

  const webAudio = await import('node-web-audio-api').catch((error: unknown) => {
    throw new Error(
      `node-web-audio-api is required to decode samples for velocity validation: ${String(error)}`
    );
  });
  // Use OfflineAudioContext so CI/headless Linux does not need an ALSA/CoreAudio
  // output device just to decode files for measurement.
  const audioContext = new webAudio.OfflineAudioContext(1, 1, 44100) as unknown as DecodeAudioContext;

  try {
    for (const dir of instrumentDirs) {
      const result = await analyzeInstrument(audioContext, dir);
      if (result) {
        results.push(result);
        for (const group of result.groups) {
          if (group.isInverted) {
            inversions.push({ instrument: result.id, group });
          }
        }
      }
    }
  } finally {
    await audioContext.close?.();
  }

  const invalidMeasurements = results.flatMap(result =>
    result.allSamples.filter(sample =>
      !Number.isFinite(sample.meanVolume) || !Number.isFinite(sample.maxVolume)
    )
  );
  if (invalidMeasurements.length > 0) {
    console.log(`${colors.red}${colors.bold}AUDIO DECODE/MEASUREMENT FAILED${colors.reset}\n`);
    for (const sample of invalidMeasurements.slice(0, 20)) {
      console.log(
        `  ${colors.red}✗${colors.reset} ${sample.instrumentId}/${sample.file}: non-finite volume`
      );
    }
    if (invalidMeasurements.length > 20) {
      console.log(`  ${colors.dim}...and ${invalidMeasurements.length - 20} more${colors.reset}`);
    }
    process.exit(1);
  }

  // Report inversions
  if (inversions.length > 0) {
    console.log(
      `${colors.red}${colors.bold}VELOCITY LAYER INVERSIONS DETECTED (${inversions.length})${colors.reset}\n`
    );

    for (const { instrument, group } of inversions) {
      console.log(`  ${colors.red}❌${colors.reset} ${colors.bold}${instrument}${colors.reset} (note ${group.note})`);
      console.log(`     ${colors.dim}Current order (by velocity):${colors.reset}`);

      const byVelocity = [...group.samples].sort(
        (a, b) => (a.velocityMin ?? 0) - (b.velocityMin ?? 0)
      );
      for (const sample of byVelocity) {
        const velRange = `${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}`;
        console.log(
          `       vel ${velRange.padEnd(7)}: ${sample.file.padEnd(25)} ${formatVolume(sample.meanVolume).padStart(10)}`
        );
      }

      if (showFixes && group.suggestedOrder) {
        console.log(`     ${colors.cyan}Suggested order (by actual volume):${colors.reset}`);
        const velocityRanges = byVelocity.map((s) => ({
          min: s.velocityMin ?? 0,
          max: s.velocityMax ?? 127,
        }));
        for (let i = 0; i < group.suggestedOrder.length; i++) {
          const sample = group.suggestedOrder[i];
          const velRange = `${velocityRanges[i].min}-${velocityRanges[i].max}`;
          console.log(
            `       vel ${velRange.padEnd(7)}: ${sample.file.padEnd(25)} ${formatVolume(sample.meanVolume).padStart(10)}`
          );
        }
      }
      console.log();
    }
  }

  // Summary of all velocity-layered instruments
  const withVelocity = results.filter((r) => r.hasVelocityLayers);
  const correct = withVelocity.filter((r) => r.groups.every((g) => !g.isInverted));

  if (showAll || inversions.length === 0) {
    console.log(`${colors.green}${colors.bold}CORRECTLY ORDERED VELOCITY LAYERS${colors.reset}\n`);
    for (const result of correct) {
      console.log(`  ${colors.green}✓${colors.reset} ${result.id}`);
      for (const group of result.groups) {
        const byVelocity = [...group.samples].sort(
          (a, b) => (a.velocityMin ?? 0) - (b.velocityMin ?? 0)
        );
        for (const sample of byVelocity) {
          const velRange = `${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}`;
          console.log(
            `      vel ${velRange.padEnd(7)}: ${sample.file.padEnd(25)} ${formatVolume(sample.meanVolume).padStart(10)}`
          );
        }
      }
    }
    console.log();
  }

  // Print full table if requested
  if (showAll) {
    console.log('─'.repeat(70));
    console.log(`\n${colors.bold}ALL VELOCITY LAYER MAPPINGS${colors.reset}\n`);
    console.log(
      `${'Instrument'.padEnd(25)} ${'File'.padEnd(25)} ${'Velocity'.padEnd(10)} ${'Mean Vol'.padStart(10)}`
    );
    console.log('─'.repeat(70));

    for (const result of withVelocity) {
      for (const group of result.groups) {
        const byVelocity = [...group.samples].sort(
          (a, b) => (a.velocityMin ?? 0) - (b.velocityMin ?? 0)
        );
        for (const sample of byVelocity) {
          const velRange = `${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}`;
          console.log(
            `${result.id.padEnd(25)} ${sample.file.padEnd(25)} ${velRange.padEnd(10)} ${formatVolume(sample.meanVolume).padStart(10)}`
          );
        }
      }
    }
    console.log();
  }

  // Summary
  console.log('─'.repeat(70));
  console.log(`\n${colors.bold}SUMMARY${colors.reset}`);
  console.log(`  Total instruments: ${results.length}`);
  console.log(`  With velocity layers: ${withVelocity.length}`);
  console.log(`  ${colors.green}Correctly ordered:${colors.reset} ${correct.length}`);
  console.log(`  ${colors.red}Inversions found:${colors.reset} ${inversions.length}`);

  if (inversions.length > 0) {
    console.log(
      `\n${colors.red}${colors.bold}⚠️  ${inversions.length} velocity layer inversion(s) detected!${colors.reset}`
    );
    console.log(`${colors.dim}Run with --fix to see suggested corrections${colors.reset}\n`);
    process.exit(1);
  }

  console.log(
    `\n${colors.green}All velocity layers correctly ordered by volume.${colors.reset}\n`
  );
  process.exit(0);
}

main().catch(error => {
  console.error(`${colors.red}${colors.bold}Velocity validation failed:${colors.reset} ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
