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
import {
  instrumentQualityEvaluatorDiffersFromCommit,
  instrumentQualityEvaluatorTreeSha256,
  instrumentQualityHeadCommit,
  instrumentQualitySubjectTreeStatus,
  resolveInstrumentQualityCommit,
} from './instrument-quality-provenance';

const DEFAULT_PLAN = path.resolve('reports/instrument-quality/dry-pcm-matrix-plan.json');
const DEFAULT_REPORT = path.resolve('reports/instrument-quality/dry-pcm-matrix.json');
const DEFAULT_PCM_ROOT = path.resolve('reports/instrument-quality/dry-pcm-matrix-pcm');

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
  console.log('  verify [--report <path>] [--pcm-root <path>]');
  console.log('    Recompute a complete pinned receipt from canonical raw PCM and require zero failures/gaps');
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
    const pcmArtifactRoot = optionValue(argv, '--pcm-root', DEFAULT_PCM_ROOT);
    if (!fs.existsSync(reportPath)) throw new Error(`Dry PCM matrix receipt missing: ${reportPath}`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as DryPcmMatrixReport;
    const evaluatorCommit = resolveInstrumentQualityCommit(
      report.provenance?.evaluatorCommit,
      'Matrix evaluator commit',
    );
    const subjectCommit = resolveInstrumentQualityCommit(
      report.provenance?.subjectCommit,
      'Matrix subject commit',
    );
    const headCommit = instrumentQualityHeadCommit();
    const treeStatus = instrumentQualitySubjectTreeStatus();
    if (headCommit !== subjectCommit || treeStatus.length > 0) {
      throw new Error(
        `Matrix verification requires the subject commit in a clean tree; `
        + `HEAD=${headCommit}, subject=${subjectCommit}${treeStatus ? `, changes:\n${treeStatus}` : ''}`,
      );
    }
    validateDryPcmMatrixReport(report, INSTRUMENT_QUALITY_PROFILES, {
      pcmArtifactRoot,
      expectedBinding: {
        evaluatorCommit,
        subjectCommit,
        evaluatorTreeSha256: instrumentQualityEvaluatorTreeSha256(),
        evaluatorDirty: instrumentQualityEvaluatorDiffersFromCommit(evaluatorCommit),
      },
      requirePass: true,
    });
    console.log(
      `Verified ${report.capturedCaseCount}/${report.expectedCaseCount} dry PCM captures `
      + `from canonical raw sidecars at ${report.sampleRates.join(', ')} Hz `
      + `(${report.provenance.browser?.name ?? 'browser unreported'}).`,
    );
    return;
  }
  printHelp();
  if (command && command !== '--help' && command !== '-h') process.exitCode = 1;
}

main(process.argv.slice(2));
