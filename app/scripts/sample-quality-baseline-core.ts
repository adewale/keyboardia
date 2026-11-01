import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type BoundMeasurement = number | string | null;

/**
 * Store compact canonical measurements while retaining enough precision to
 * distinguish every quality decision. An observed issue measurement may differ
 * from that stored value by one unit at this precision because decoder
 * reductions can straddle a rounding boundary. This bounds deviation from the
 * stored canonical value; the original unrounded reference is not retained, so
 * it is not a bound on the true decoder-to-decoder difference.
 */
export const BOUND_MEASUREMENT_DECIMAL_PLACES = 6;
export const BOUND_MEASURED_VALUE_ABSOLUTE_TOLERANCE = 1e-6;

export interface SampleQualityWaiver {
  code: string;
  instrumentId: string;
  file: string;
  /** SHA-256 of the file named by `file`. */
  sha256: string;
  /** SHA-256 of the complete manifest that supplied mapping semantics. */
  manifestSha256: string;
  /** Six-decimal canonical value emitted by the evaluator, or null. */
  measuredValue: BoundMeasurement;
  /** Six-decimal canonical threshold emitted by the evaluator, or null. */
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
  if (typeof value === 'number' && Number.isFinite(value)) {
    const canonical = Number(value.toFixed(BOUND_MEASUREMENT_DECIMAL_PLACES));
    return Object.is(canonical, -0) ? 0 : canonical;
  }
  return value ?? null;
}

/** Exact comparison for thresholds and other non-measurement receipt fields. */
export function measurementsExactlyEqual(
  left: number | string | null | undefined,
  right: BoundMeasurement,
): boolean {
  return Object.is(left ?? null, right);
}

/** Tolerant comparison for decoder-derived values only, never thresholds or metadata. */
export function measurementsEqual(
  left: number | string | null | undefined,
  right: BoundMeasurement,
): boolean {
  if (typeof left === 'number' || typeof right === 'number') {
    return typeof left === 'number'
      && Number.isFinite(left)
      && typeof right === 'number'
      && Number.isFinite(right)
      && Math.abs(left - right) <= BOUND_MEASURED_VALUE_ABSOLUTE_TOLERANCE;
  }
  return Object.is(left ?? null, right);
}
