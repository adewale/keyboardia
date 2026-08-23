import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { stableSampleQualityReceiptsEqual } from '../scripts/audit-instrument-quality';
import {
  LIVE_RECEIPT_SCHEMA_VERSION,
  expectedLiveEngineDispatchIdentity,
  type LiveInstrumentSpec,
} from '../scripts/instrument-quality-live-receipt';
import {
  sampleQualityEvaluatorBundleSha256,
  sha256File,
} from '../scripts/sample-quality-baseline-core';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const REPOSITORY_ROOT = path.resolve(APP_ROOT, '..');
const EVIDENCE_ROOT = path.resolve(REPOSITORY_ROOT, 'docs/evidence');

function uniqueCandidateEvidence(prefix: string): string {
  const matches = fs.readdirSync(EVIDENCE_ROOT)
    .filter(filename => filename.startsWith(prefix) && filename.endsWith('.json'))
    .sort();
  if (matches.length !== 1) {
    throw new Error(`Expected one ${prefix}*.json evidence fixture, found ${matches.length}`);
  }
  return path.resolve(EVIDENCE_ROOT, matches[0]);
}

function currentSubjectCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
  }).trim();
}

function currentCandidateSampleReport(): Record<string, unknown> {
  const report = JSON.parse(fs.readFileSync(
    uniqueCandidateEvidence('candidate-sample-quality-'),
    'utf8',
  )) as Record<string, unknown>;
  report.subjectCommit = currentSubjectCommit();
  report.evaluatorBundleSha256 = sampleQualityEvaluatorBundleSha256(APP_ROOT);
  report.baselineSha256 = sha256File(
    path.resolve(APP_ROOT, 'scripts/sample-quality-baseline.json'),
  );
  return report;
}

function currentLiveReportFixture(): Record<string, unknown> {
  const report = JSON.parse(fs.readFileSync(
    uniqueCandidateEvidence('candidate-live-primary-'),
    'utf8',
  )) as Record<string, unknown>;
  report.schemaVersion = LIVE_RECEIPT_SCHEMA_VERSION;
  report.subjectCommit = currentSubjectCommit();

  const positionByInstrument = new Map<string, number>();
  for (const session of report.sessions as Array<{ instruments: string[] }>) {
    session.instruments.forEach((instrumentId, index) => {
      positionByInstrument.set(instrumentId, index);
    });
  }
  for (const item of report.instruments as Array<LiveInstrumentSpec & {
    trackId: string;
    observedEngineDispatches: unknown[];
  }>) {
    const position = positionByInstrument.get(item.sampleId);
    if (position === undefined) throw new Error(`Live fixture session omits ${item.sampleId}`);
    item.observedEngineDispatches = [{
      ...expectedLiveEngineDispatchIdentity(item, item.trackId),
      eventTimeSeconds: position + 1,
    }];
  }
  return report;
}

function filteredSampleReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(APP_ROOT, 'public/instruments/piano/manifest.json'), 'utf8'),
  ) as { id: string; samples: Array<{ file: string; note: number; velocityMin?: number; velocityMax?: number }> };
  const uniqueFiles = new Set(manifest.samples.map(sample => sample.file));
  return {
    version: 1,
    generatedAt: '2026-08-22T00:00:00.000Z',
    subjectCommit: currentSubjectCommit(),
    subjectTreeClean: true,
    evaluatorBundleSha256: sampleQualityEvaluatorBundleSha256(APP_ROOT),
    baselineSha256: sha256File(path.resolve(APP_ROOT, 'scripts/sample-quality-baseline.json')),
    totals: {
      instruments: 1,
      samples: manifest.samples.length,
      files: uniqueFiles.size,
      errors: 0,
      reviewFlags: 0,
      waivedIssues: 0,
    },
    issues: [],
    waivedIssues: [],
    instruments: [{ id: manifest.id, sampleCount: manifest.samples.length, fileCount: uniqueFiles.size }],
    samples: manifest.samples.map(sample => ({ instrumentId: manifest.id, ...sample, sampleRate: 44_100 })),
    ...overrides,
  };
}

function runRequiredAudit(
  report: Record<string, unknown>,
  liveReport: Record<string, unknown> | null = null,
): ReturnType<typeof spawnSync> {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-sample-report-'));
  try {
    const reportPath = path.join(temporaryRoot, 'sample.json');
    const liveReportPath = path.join(temporaryRoot, 'live.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (liveReport !== null) {
      fs.writeFileSync(liveReportPath, `${JSON.stringify(liveReport, null, 2)}\n`);
    }
    return spawnSync(process.execPath, [
      '--import',
      'tsx',
      'scripts/audit-instrument-quality.ts',
      '--sample-report',
      reportPath,
      '--live-report',
      liveReportPath,
      '--matrix-report',
      path.join(temporaryRoot, 'missing-matrix.json'),
      '--json',
      path.join(temporaryRoot, 'audit.json'),
      '--markdown',
      path.join(temporaryRoot, 'audit.md'),
      '--subject-commit',
      currentSubjectCommit(),
      '--require-evidence',
    ], {
      cwd: APP_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

describe('instrument quality audit evidence coverage', () => {
  it.each([
    {
      field: 'spectral centroid Hz',
      reference: 625.8194832834929,
      linux: 625.8185860720217,
      tolerance: 0.001,
      receipt: (value: number) => ({ samples: [{ spectral: { centroidHz: value } }] }),
    },
    {
      field: 'DC offset dB',
      reference: -119.93878298377948,
      linux: -119.93864312458714,
      tolerance: 0.001,
      receipt: (value: number) => ({ samples: [{ dcOffsetDb: value }] }),
    },
    {
      field: 'tail level relative to peak dB',
      reference: -112.68891042503908,
      linux: -112.68888706718243,
      tolerance: 0.001,
      receipt: (value: number) => ({ samples: [{ tailLevelDbRelPeak: value }] }),
    },
    {
      field: 'peak dB',
      reference: -21.247780306784954,
      linux: -21.247781801035668,
      tolerance: 0.00001,
      receipt: (value: number) => ({ samples: [{ peakDb: value }] }),
    },
    {
      field: 'crest factor dB',
      reference: 19.600960177019825,
      linux: 19.600958693254725,
      tolerance: 0.00001,
      receipt: (value: number) => ({ samples: [{ crestFactorDb: value }] }),
    },
  ])('bounds the $field cross-platform receipt tolerance', ({
    reference,
    linux,
    tolerance,
    receipt,
  }) => {
    expect(stableSampleQualityReceiptsEqual(receipt(reference), receipt(linux))).toBe(true);
    expect(stableSampleQualityReceiptsEqual(receipt(0), receipt(tolerance))).toBe(true);
    expect(stableSampleQualityReceiptsEqual(receipt(reference), receipt(reference + 0.01))).toBe(false);
  });

  it('keeps other decoder-derived values at 0.000001 and thresholds exact', () => {
    const rawMeasurement = (value: number) => ({ samples: [{ rmsDb: value }] });
    expect(stableSampleQualityReceiptsEqual(
      rawMeasurement(0),
      rawMeasurement(0.000001),
    )).toBe(true);
    expect(stableSampleQualityReceiptsEqual(
      rawMeasurement(0),
      rawMeasurement(0.00001),
    )).toBe(false);

    const threshold = (value: number) => ({
      waivedIssues: [{ issue: { threshold: value } }],
    });
    expect(stableSampleQualityReceiptsEqual(threshold(1), threshold(1.0000001))).toBe(false);
  });

  it('rejects a filtered sample report in required-evidence mode', () => {
    const result = runRequiredAudit(filteredSampleReport());
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/filtered\/incomplete|coverage differs/);
  });

  it('rejects stale subject, dirty-tree, and evaluator identities before evidence credit', () => {
    const cases = [
      {
        report: filteredSampleReport({ subjectCommit: '0'.repeat(40) }),
        expected: /subject commit does not match/,
      },
      {
        report: filteredSampleReport({ subjectTreeClean: false }),
        expected: /dirty subject tree/,
      },
      {
        report: filteredSampleReport({ evaluatorBundleSha256: '0'.repeat(64) }),
        expected: /evaluator or canonical baseline identity differs/,
      },
    ];
    for (const { report, expected } of cases) {
      const result = runRequiredAudit(report);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(expected);
    }
  });

  it('accepts a complete receipt after independent canonical decoded recomputation', () => {
    const sampleReport = currentCandidateSampleReport();
    const liveReport = currentLiveReportFixture();
    expect(sampleReport.waivedIssues as unknown[]).toHaveLength(203);

    const result = runRequiredAudit(sampleReport, liveReport);
    expect(`${result.stdout}\n${result.stderr}`).toContain('JSON report:');
    expect(result.status).toBe(0);
  }, 120_000);

  it('rejects deleting all 203 decoded findings and rewriting the dependent totals', () => {
    const sampleReport = currentCandidateSampleReport();
    const liveReport = currentLiveReportFixture();
    const waivedIssues = sampleReport.waivedIssues as unknown[];
    expect(waivedIssues).toHaveLength(203);

    sampleReport.waivedIssues = [];
    sampleReport.totals = {
      ...(sampleReport.totals as Record<string, unknown>),
      waivedIssues: 0,
    };
    const result = runRequiredAudit(sampleReport, liveReport);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/does not match canonical decoded recomputation/);
  }, 120_000);
});
