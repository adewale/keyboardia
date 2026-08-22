import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const INSTRUMENT_QUALITY_APP_ROOT = path.resolve(THIS_DIR, '..');

const EVALUATOR_SOURCE_RELATIVE_PATHS = [
  'scripts/audit-instrument-quality.ts',
  'scripts/instrument-quality-provenance.ts',
  'scripts/instrument-quality-rubric.ts',
  'scripts/instrument-quality-profiles.ts',
  'scripts/instrument-quality-matrix.ts',
  'scripts/instrument-quality-matrix-cli.ts',
  'scripts/capture-instrument-quality-smoke.ts',
  'scripts/instrument-quality-live-receipt.ts',
  'scripts/sample-quality-core.ts',
  'scripts/sample-quality-baseline-core.ts',
  'scripts/sample-velocity-core.ts',
  'scripts/validate-sample-quality.ts',
  'scripts/bind-sample-quality-dispositions.ts',
  'src/audio/instrument-ranges.ts',
  'src/audio/sample-onset.ts',
  'src/audio/constants.ts',
  'src/audio/scheduler-types.ts',
  'src/audio/source-calibration.ts',
  'src/components/sample-constants.ts',
  'src/shared/instrument-catalog.ts',
  'src/types.ts',
  'src/test/audio-measures.ts',
  'e2e/all-instruments-master-output.spec.ts',
  'e2e/dry-pcm-browser-adapter.ts',
  'e2e/global-setup.ts',
  'e2e/test-utils.ts',
  'playwright.config.ts',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'scripts/sample-quality-baseline.json',
] as const;

export const INSTRUMENT_QUALITY_EVALUATOR_SOURCE_PATHS =
  EVALUATOR_SOURCE_RELATIVE_PATHS.map(relativePath =>
    path.resolve(INSTRUMENT_QUALITY_APP_ROOT, relativePath)
  );

export function instrumentQualitySha256File(pathname: string): string {
  return createHash('sha256').update(fs.readFileSync(pathname)).digest('hex');
}

export function instrumentQualityEvaluatorTreeSha256(): string {
  const hash = createHash('sha256');
  for (const pathname of INSTRUMENT_QUALITY_EVALUATOR_SOURCE_PATHS) {
    const relative = path.relative(INSTRUMENT_QUALITY_APP_ROOT, pathname)
      .replaceAll(path.sep, '/');
    hash.update(`${relative}\0`);
    hash.update(fs.readFileSync(pathname));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function resolveInstrumentQualityCommit(value: string, label: string): string {
  if (!FULL_COMMIT_ID.test(value)) {
    throw new Error(`${label} must be a full 40- or 64-character Git commit ID`);
  }
  let resolved: string;
  try {
    resolved = execFileSync('git', ['rev-parse', '--verify', `${value}^{commit}`], {
      cwd: INSTRUMENT_QUALITY_APP_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(`${label} is not a commit available in this repository: ${value}`);
  }
  if (resolved !== value) {
    throw new Error(`${label} must use the repository's full canonical commit ID`);
  }
  return resolved;
}

export function instrumentQualityEvaluatorDiffersFromCommit(
  evaluatorCommit: string,
): boolean {
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: INSTRUMENT_QUALITY_APP_ROOT,
    encoding: 'utf8',
  }).trim();
  for (const pathname of INSTRUMENT_QUALITY_EVALUATOR_SOURCE_PATHS) {
    const repositoryPath = path.relative(gitRoot, pathname).replaceAll(path.sep, '/');
    let committed: Buffer;
    try {
      committed = execFileSync('git', ['show', `${evaluatorCommit}:${repositoryPath}`], {
        cwd: INSTRUMENT_QUALITY_APP_ROOT,
        encoding: null,
      });
    } catch {
      return true;
    }
    if (!fs.readFileSync(pathname).equals(committed)) return true;
  }
  return false;
}

export function instrumentQualitySubjectTreeStatus(): string {
  return execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: INSTRUMENT_QUALITY_APP_ROOT, encoding: 'utf8' },
  ).trim();
}

export function instrumentQualityHeadCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: INSTRUMENT_QUALITY_APP_ROOT,
    encoding: 'utf8',
  }).trim();
}
