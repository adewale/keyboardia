#!/usr/bin/env npx tsx

/**
 * Sustain Ceiling Guard (Phase 44 §4)
 *
 * Only sample mappings carrying a LoopSpec repeat while held, and exactly one
 * manifest declares a loop — so for every other instrument, recorded length
 * is a hard ceiling on note length. This validator pins the measured floor so
 * a future sample swap cannot silently ship a sustaining instrument that dies
 * mid-note: each instrument in SUSTAINING_INSTRUMENT_IDS must keep its
 * MEDIAN usable length (last 20 ms window above -60 dBFS relative to peak)
 * at or above the longest tied note in a 16-step bar at 120 BPM.
 *
 * Baseline at introduction (2026-08): finger-bass 3.90 s ... french-horn
 * 9.70 s — all eight pass with margin. Plucked instruments are deliberately
 * not classified as sustaining; see instrument-classification.ts.
 *
 * Run: npx tsx scripts/validate-sustain-ceiling.ts
 */

import { SUSTAINING_INSTRUMENT_IDS } from '../src/shared/instrument-classification';
import { measureInstrument } from './measure-velocity-timbre';

/** One 16-step bar at 120 BPM fully tied: 16 × (60/120/4) s. */
const MIN_MEDIAN_USABLE_SECONDS = 2;

async function main(): Promise<void> {
  const failures: string[] = [];
  const rows: string[] = [];
  for (const sampleId of [...SUSTAINING_INSTRUMENT_IDS].sort()) {
    const instrumentId = sampleId.replace(/^sampled:/, '');
    const measurement = await measureInstrument(instrumentId);
    if (!measurement) {
      failures.push(`${instrumentId}: no measurable sample files`);
      continue;
    }
    const median = measurement.usableSeconds.median;
    const ok = median >= MIN_MEDIAN_USABLE_SECONDS;
    rows.push(`  ${ok ? '✅' : '❌'} ${instrumentId.padEnd(18)} median ${median.toFixed(2)}s (floor ${MIN_MEDIAN_USABLE_SECONDS}s)`);
    if (!ok) {
      failures.push(`${instrumentId}: median usable ${median.toFixed(2)}s < ${MIN_MEDIAN_USABLE_SECONDS}s`);
    }
  }

  console.log('\nSustain ceiling guard (median usable seconds per sustaining instrument):\n');
  rows.forEach(row => console.log(row));
  if (failures.length) {
    console.error(`\n❌ ${failures.length} sustaining instrument(s) below the tied-note floor:`);
    failures.forEach(failure => console.error(`  - ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ All sustaining instruments hold past the longest 16-step tied note.');
}

await main();
