import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  sampleQualityEvaluatorBundleSha256,
  sha256File,
} from '../scripts/sample-quality-baseline-core';

const APP_ROOT = path.resolve(import.meta.dirname, '..');

function currentSubjectCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
  }).trim();
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

function runRequiredAudit(report: Record<string, unknown>): ReturnType<typeof spawnSync> {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-sample-report-'));
  try {
    const reportPath = path.join(temporaryRoot, 'sample.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return spawnSync(process.execPath, [
      '--import',
      'tsx',
      'scripts/audit-instrument-quality.ts',
      '--sample-report',
      reportPath,
      '--live-report',
      path.join(temporaryRoot, 'missing-live.json'),
      '--subject-commit',
      currentSubjectCommit(),
      '--require-evidence',
    ], { cwd: APP_ROOT, encoding: 'utf8' });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

describe('instrument quality audit evidence coverage', () => {
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
});
