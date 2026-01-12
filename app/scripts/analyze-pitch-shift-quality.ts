#!/usr/bin/env npx tsx
/**
 * Pitch-Shift Quality Analyzer
 *
 * Analyzes pitch-shift quality for all sampled instruments.
 * Reports maximum gaps between samples and identifies problem note ranges.
 *
 * Usage:
 *   npx tsx scripts/analyze-pitch-shift-quality.ts
 *   npx tsx scripts/analyze-pitch-shift-quality.ts --threshold 8
 *   npx tsx scripts/analyze-pitch-shift-quality.ts --instrument french-horn
 *
 * Quality thresholds:
 *   ≤3 semitones:  Excellent - indistinguishable from original
 *   ≤6 semitones:  Good - subtle artifacts, acceptable
 *   ≤9 semitones:  Fair - noticeable pitch-shifting
 *   ≤12 semitones: Poor - obvious artifacts
 *   >12 semitones: Bad - unusable for realistic sounds
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const INSTRUMENTS_DIR = 'public/instruments';
const DEFAULT_THRESHOLD = 6; // Maximum acceptable gap in semitones

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

// ============================================================================
// Types
// ============================================================================

interface Manifest {
  id: string;
  name: string;
  samples: { note: number; file?: string }[];
  baseNote?: number;
  playableRange?: {
    min: number;
    max: number;
  };
}

interface GapAnalysis {
  from: number;
  to: number;
  semitones: number;
  fromNote: string;
  toNote: string;
}

interface InstrumentReport {
  id: string;
  name: string;
  sampleCount: number;
  sampleNotes: number[];
  gaps: GapAnalysis[];
  maxGap: number;
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'bad' | 'single';
  recommendation: string;
}

// ============================================================================
// Utilities
// ============================================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

function getStatus(maxGap: number, sampleCount: number): InstrumentReport['status'] {
  if (sampleCount === 1) return 'single';
  if (maxGap <= 3) return 'excellent';
  if (maxGap <= 6) return 'good';
  if (maxGap <= 9) return 'fair';
  if (maxGap <= 12) return 'poor';
  return 'bad';
}

function getStatusIcon(status: InstrumentReport['status']): string {
  switch (status) {
    case 'excellent': return `${colors.green}✅${colors.reset}`;
    case 'good': return `${colors.green}✅${colors.reset}`;
    case 'fair': return `${colors.yellow}⚠️${colors.reset}`;
    case 'poor': return `${colors.yellow}⚠️${colors.reset}`;
    case 'bad': return `${colors.red}❌${colors.reset}`;
    case 'single': return `${colors.yellow}⚠️${colors.reset}`;
  }
}

function getStatusColor(status: InstrumentReport['status']): string {
  switch (status) {
    case 'excellent':
    case 'good':
      return colors.green;
    case 'fair':
    case 'poor':
      return colors.yellow;
    case 'bad':
    case 'single':
      return colors.red;
  }
}

// ============================================================================
// Analysis
// ============================================================================

function analyzeInstrument(instrumentDir: string): InstrumentReport | null {
  const manifestPath = path.join(instrumentDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const notes = manifest.samples.map(s => s.note).sort((a, b) => a - b);

  // Single sample instruments
  if (notes.length === 1) {
    return {
      id: manifest.id,
      name: manifest.name,
      sampleCount: 1,
      sampleNotes: notes,
      gaps: [],
      maxGap: Infinity,
      status: 'single',
      recommendation: `Single sample at ${midiToNoteName(notes[0])}. Consider adding playableRange to limit pitch-shift artifacts.`,
    };
  }

  // Calculate gaps
  const gaps: GapAnalysis[] = [];
  let maxGap = 0;

  for (let i = 0; i < notes.length - 1; i++) {
    const semitones = notes[i + 1] - notes[i];
    gaps.push({
      from: notes[i],
      to: notes[i + 1],
      semitones,
      fromNote: midiToNoteName(notes[i]),
      toNote: midiToNoteName(notes[i + 1]),
    });
    maxGap = Math.max(maxGap, semitones);
  }

  const status = getStatus(maxGap, notes.length);

  let recommendation = '';
  if (maxGap > DEFAULT_THRESHOLD) {
    const badGaps = gaps.filter(g => g.semitones > DEFAULT_THRESHOLD);
    const suggestedNotes = badGaps.flatMap(g => {
      // Suggest adding sample(s) to split the gap
      const midpoint = Math.floor((g.from + g.to) / 2);
      return [midpoint];
    });
    recommendation = `Add samples at ${suggestedNotes.map(midiToNoteName).join(', ')} to reduce max gap to ≤${DEFAULT_THRESHOLD} semitones.`;
  } else {
    recommendation = 'OK';
  }

  return {
    id: manifest.id,
    name: manifest.name,
    sampleCount: notes.length,
    sampleNotes: notes,
    gaps,
    maxGap,
    status,
    recommendation,
  };
}

// ============================================================================
// Reporting
// ============================================================================

function printReport(reports: InstrumentReport[], threshold: number): void {
  console.log(`\n${colors.bold}🎵 PITCH-SHIFT QUALITY ANALYSIS${colors.reset}\n`);
  console.log(`${colors.dim}Threshold: ≤${threshold} semitones between samples${colors.reset}\n`);
  console.log('─'.repeat(60) + '\n');

  // Sort by status severity then by max gap
  const statusOrder = { bad: 0, single: 1, poor: 2, fair: 3, good: 4, excellent: 5 };
  reports.sort((a, b) => {
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.maxGap - a.maxGap;
  });

  // Group by status
  const problems = reports.filter(r => r.status === 'bad' || r.status === 'single' || r.status === 'poor');
  const warnings = reports.filter(r => r.status === 'fair');
  const ok = reports.filter(r => r.status === 'good' || r.status === 'excellent');

  if (problems.length > 0) {
    console.log(`${colors.red}${colors.bold}PROBLEMS (${problems.length})${colors.reset}\n`);
    for (const report of problems) {
      printInstrumentReport(report, threshold);
    }
  }

  if (warnings.length > 0) {
    console.log(`${colors.yellow}${colors.bold}WARNINGS (${warnings.length})${colors.reset}\n`);
    for (const report of warnings) {
      printInstrumentReport(report, threshold);
    }
  }

  if (ok.length > 0) {
    console.log(`${colors.green}${colors.bold}OK (${ok.length})${colors.reset}\n`);
    for (const report of ok) {
      printInstrumentReportCompact(report);
    }
    console.log();
  }

  // Summary
  console.log('─'.repeat(60));
  console.log(`\n${colors.bold}SUMMARY${colors.reset}`);
  console.log(`  Total instruments: ${reports.length}`);
  console.log(`  ${colors.green}OK:${colors.reset} ${ok.length}`);
  console.log(`  ${colors.yellow}Warnings:${colors.reset} ${warnings.length}`);
  console.log(`  ${colors.red}Problems:${colors.reset} ${problems.length}`);

  if (problems.length > 0) {
    console.log(`\n${colors.bold}ACTION REQUIRED:${colors.reset}`);
    for (const report of problems) {
      console.log(`  • ${report.id}: ${report.recommendation}`);
    }
  }

  console.log();
}

function printInstrumentReport(report: InstrumentReport, threshold: number): void {
  const statusIcon = getStatusIcon(report.status);
  const statusColor = getStatusColor(report.status);

  console.log(`${statusIcon} ${colors.bold}${report.id}${colors.reset} (${report.name})`);
  console.log(`   Samples: ${report.sampleNotes.map(midiToNoteName).join(', ')}`);

  if (report.status === 'single') {
    console.log(`   ${colors.yellow}Single sample - pitch-shift quality varies across range${colors.reset}`);
  } else {
    console.log(`   Max gap: ${statusColor}${report.maxGap} semitones${colors.reset}`);

    // Show problematic gaps
    const badGaps = report.gaps.filter(g => g.semitones > threshold);
    if (badGaps.length > 0) {
      for (const gap of badGaps) {
        console.log(`   ${colors.red}❌ ${gap.fromNote} → ${gap.toNote}: ${gap.semitones} semitones${colors.reset}`);
      }
    }
  }

  if (report.recommendation !== 'OK') {
    console.log(`   ${colors.cyan}💡 ${report.recommendation}${colors.reset}`);
  }
  console.log();
}

function printInstrumentReportCompact(report: InstrumentReport): void {
  const statusIcon = getStatusIcon(report.status);
  console.log(`${statusIcon} ${report.id}: ${report.sampleNotes.map(midiToNoteName).join(', ')} (max gap: ${report.maxGap}st)`);
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  // Parse arguments
  const args = process.argv.slice(2);
  let threshold = DEFAULT_THRESHOLD;
  let filterInstrument: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--threshold' && args[i + 1]) {
      threshold = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--instrument' && args[i + 1]) {
      filterInstrument = args[i + 1];
      i++;
    }
  }

  // Find all instruments
  const instrumentsPath = path.join(process.cwd(), INSTRUMENTS_DIR);
  if (!fs.existsSync(instrumentsPath)) {
    console.error(`${colors.red}Error: Instruments directory not found at ${instrumentsPath}${colors.reset}`);
    process.exit(1);
  }

  const instruments = fs.readdirSync(instrumentsPath)
    .filter(f => {
      const fullPath = path.join(instrumentsPath, f);
      return fs.statSync(fullPath).isDirectory();
    })
    .filter(f => !filterInstrument || f === filterInstrument)
    .sort();

  if (instruments.length === 0) {
    console.error(`${colors.red}Error: No instruments found${colors.reset}`);
    process.exit(1);
  }

  // Analyze each instrument
  const reports: InstrumentReport[] = [];
  for (const instrument of instruments) {
    const report = analyzeInstrument(path.join(instrumentsPath, instrument));
    if (report) {
      reports.push(report);
    }
  }

  // Print report
  printReport(reports, threshold);

  // Exit with error code if there are problems
  const problemCount = reports.filter(r => r.status === 'bad' || r.status === 'poor').length;
  process.exit(problemCount > 0 ? 1 : 0);
}

main();
