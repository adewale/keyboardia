#!/usr/bin/env npx tsx

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  buildDryPcmMatrixPlan,
  matrixPlanSha256,
  qualityProfileSha256,
  validateDryPcmMatrixReport,
  type DryPcmMatrixReport,
} from './instrument-quality-matrix';
import { INSTRUMENT_QUALITY_PROFILES } from './instrument-quality-profiles';

const DEFAULT_PLAN = path.resolve('reports/instrument-quality/dry-pcm-matrix-plan.json');
const DEFAULT_REPORT = path.resolve('reports/instrument-quality/dry-pcm-matrix.json');

function optionValue(argv: readonly string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

function writeJson(filename: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  console.log('Usage: tsx scripts/instrument-quality-matrix-cli.ts <plan|verify> [options]');
  console.log('  plan [--output <path>]  Emit all dry capture instructions; this is not audio evidence');
  console.log('  verify [--report <path>] Fail unless a capture adapter produced a complete pinned receipt');
}

function main(argv: readonly string[]): void {
  const command = argv[0];
  if (command === 'plan') {
    const output = optionValue(argv, '--output', DEFAULT_PLAN);
    const cases = buildDryPcmMatrixPlan();
    writeJson(output, {
      schemaVersion: 1,
      claim: 'capture-instructions-not-a-measurement',
      profileCount: INSTRUMENT_QUALITY_PROFILES.length,
      expectedCaseCount: cases.length,
      profileSha256: qualityProfileSha256(),
      planSha256: matrixPlanSha256(cases),
      cases,
    });
    console.log(`Wrote ${cases.length} dry capture instructions to ${output}`);
    console.log('No PCM was captured; use runDryPcmMatrix with a real post-track capture adapter.');
    return;
  }
  if (command === 'verify') {
    const reportPath = optionValue(argv, '--report', DEFAULT_REPORT);
    if (!fs.existsSync(reportPath)) throw new Error(`Dry PCM matrix receipt missing: ${reportPath}`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as DryPcmMatrixReport;
    validateDryPcmMatrixReport(report);
    console.log(
      `Verified ${report.capturedCaseCount}/${report.expectedCaseCount} dry PCM captures `
      + `at ${report.sampleRates.join(', ')} Hz (${report.provenance.browser?.name ?? 'browser unreported'}).`,
    );
    return;
  }
  printHelp();
  if (command && command !== '--help' && command !== '-h') process.exitCode = 1;
}

main(process.argv.slice(2));
