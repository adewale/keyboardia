import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type BoundMeasurement = number | string | null;

export interface SampleQualityWaiver {
  code: string;
  instrumentId: string;
  file: string;
  /** SHA-256 of the file named by `file`. */
  sha256: string;
  /** SHA-256 of the complete manifest that supplied mapping semantics. */
  manifestSha256: string;
  /** Exact value emitted by the evaluator, or null when the finding has none. */
  measuredValue: BoundMeasurement;
  /** Exact threshold emitted by the evaluator, or null when it has none. */
  threshold: BoundMeasurement;
  reason: string;
}

export interface SampleQualityBaseline {
  version: 3;
  /** Hash of the complete source bundle that emitted and applied dispositions. */
  evaluatorBundleSha256: string;
  waivers: SampleQualityWaiver[];
}

/**
 * Every source that can change sample measurement, grouping, thresholds,
 * mapping interpretation, or disposition matching. Paths are relative to the
 * app root so the identity is checkout-location independent.
 */
export const SAMPLE_QUALITY_EVALUATOR_PATHS = [
  'scripts/bind-sample-quality-dispositions.ts',
  'scripts/sample-quality-baseline-core.ts',
  'scripts/sample-quality-core.ts',
  'scripts/sample-velocity-core.ts',
  'scripts/validate-sample-quality.ts',
  'src/audio/sample-onset.ts',
  'src/test/audio-measures.ts',
] as const;

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ROOT = path.resolve(THIS_DIR, '..');

export function sha256File(pathname: string): string {
  return createHash('sha256').update(fs.readFileSync(pathname)).digest('hex');
}

export function sampleQualityEvaluatorBundleSha256(appRoot = DEFAULT_APP_ROOT): string {
  const hash = createHash('sha256');
  for (const relativePath of SAMPLE_QUALITY_EVALUATOR_PATHS) {
    const pathname = path.resolve(appRoot, relativePath);
    hash.update(`${relativePath}\0`);
    hash.update(fs.readFileSync(pathname));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function boundMeasurement(value: number | string | null | undefined): BoundMeasurement {
  return value ?? null;
}

export function measurementsEqual(
  left: number | string | null | undefined,
  right: BoundMeasurement,
): boolean {
  return Object.is(boundMeasurement(left), right);
}
