import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BOUND_MEASURED_VALUE_ABSOLUTE_TOLERANCE,
  boundMeasurement,
  measurementsEqual,
  measurementsExactlyEqual,
  SAMPLE_QUALITY_EVALUATOR_PATHS,
  sampleQualityEvaluatorBundleSha256,
  sha256File,
  type SampleQualityBaseline,
} from '../scripts/sample-quality-baseline-core';

const APP_ROOT = path.resolve(import.meta.dirname, '..');

describe('sample-quality baseline identity', () => {
  it('accepts sub-micro deviation from a stored value without accepting a meaningful change', () => {
    const macOsMeasurement = -43.878102908492345;
    const linuxMeasurement = -43.87810292589301;
    const bound = boundMeasurement(macOsMeasurement);

    expect(bound).toBe(-43.878103);
    expect(Math.abs(macOsMeasurement - linuxMeasurement)).toBeLessThan(1e-6);
    expect(measurementsEqual(linuxMeasurement, bound)).toBe(true);
    expect(measurementsEqual(macOsMeasurement + 1e-4, bound)).toBe(false);

    const boundaryStored = boundMeasurement(1.0000012);
    const boundaryObserved = 1.00000002;
    expect(boundMeasurement(boundaryObserved)).not.toBe(boundaryStored);
    expect(Math.abs(boundaryObserved - (boundaryStored as number)))
      .toBeLessThanOrEqual(BOUND_MEASURED_VALUE_ABSOLUTE_TOLERANCE);
    expect(measurementsEqual(boundaryObserved, boundaryStored)).toBe(true);
    expect(measurementsExactlyEqual(boundaryObserved, boundaryStored)).toBe(false);

    expect(boundMeasurement(-0.0000001)).toBe(0);
    expect(boundMeasurement('mapping-identity')).toBe('mapping-identity');
    expect(boundMeasurement(undefined)).toBeNull();
    expect(measurementsEqual('mapping-identity', 'mapping-identity')).toBe(true);
    expect(measurementsEqual('mapping-identity', 'different')).toBe(false);
    expect(measurementsExactlyEqual('mapping-identity', 'mapping-identity')).toBe(true);
    expect(measurementsEqual(null, null)).toBe(true);
    expect(measurementsEqual(0, null)).toBe(false);
  });

  it('binds every disposition to evaluator, manifest, source, and canonical measurement evidence', () => {
    const baseline = JSON.parse(
      fs.readFileSync(path.resolve(APP_ROOT, 'scripts/sample-quality-baseline.json'), 'utf8'),
    ) as SampleQualityBaseline;

    expect(baseline.version).toBe(3);
    expect(baseline.evaluatorBundleSha256).toBe(sampleQualityEvaluatorBundleSha256(APP_ROOT));
    expect(baseline.waivers).toHaveLength(194);
    for (const waiver of baseline.waivers) {
      const instrumentDir = path.resolve(APP_ROOT, 'public/instruments', waiver.instrumentId);
      expect(waiver.sha256, `${waiver.instrumentId}/${waiver.file}`).toBe(
        sha256File(path.resolve(instrumentDir, waiver.file)),
      );
      expect(waiver.manifestSha256, waiver.instrumentId).toBe(
        sha256File(path.resolve(instrumentDir, 'manifest.json')),
      );
      expect(Object.prototype.hasOwnProperty.call(waiver, 'measuredValue')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(waiver, 'threshold')).toBe(true);
    }

    expect(baseline.waivers).not.toContainEqual(expect.objectContaining({
      instrumentId: 'acoustic-guitar',
      code: 'HOT_PEAK',
      file: expect.stringMatching(/^(E3|G2)\.wav$/),
    }));
    expect(baseline.waivers).toContainEqual(expect.objectContaining({
      instrumentId: 'slap-bass',
      code: 'RANGE_OVEREXTENSION',
      file: 'manifest.json',
      measuredValue: 12,
      threshold: 6,
      reason: expect.stringContaining('remove 26.7% of capability'),
    }));
  });

  it('changes evaluator identity when any bound evaluator source changes', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-evaluator-'));
    try {
      for (const relative of SAMPLE_QUALITY_EVALUATOR_PATHS) {
        const destination = path.resolve(temporaryRoot, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.resolve(APP_ROOT, relative), destination);
      }
      const before = sampleQualityEvaluatorBundleSha256(temporaryRoot);
      const changed = path.resolve(temporaryRoot, SAMPLE_QUALITY_EVALUATOR_PATHS[0]);
      fs.appendFileSync(changed, '\n// evaluator mutation\n');
      expect(sampleQualityEvaluatorBundleSha256(temporaryRoot)).not.toBe(before);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
