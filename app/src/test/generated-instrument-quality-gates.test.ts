import { describe, expect, it } from 'vitest';
import before from '../audio/__fixtures__/generated-instrument-quality-before.json';
import after from '../audio/__fixtures__/generated-instrument-quality-after.json';
import { generatedQualityGateViolations } from './generated-instrument-quality-gates';
import type { GeneratedCatalogueAudit } from './generated-instrument-quality-browser';

describe('generated quality release gates', () => {
  it('rejects the frozen baseline rather than accepting an old implementation by count alone', () => {
    const failures = generatedQualityGateViolations(before as unknown as GeneratedCatalogueAudit);

    expect(failures.length).toBeGreaterThan(0);
    expect(failures).toContain('schemaVersion=1, expected 2');
    expect(failures.some(failure => failure.includes('missing per-condition safety'))).toBe(true);
  });

  it('uses playback speed as the portable live floor', () => {
    const report = structuredClone(after) as unknown as GeneratedCatalogueAudit;
    report.polyphony.tone16.realtimeFactor = 0.99;

    expect(generatedQualityGateViolations(report)).toContain(
      'tone16: 0.99x real-time cannot stay ahead of playback',
    );

    report.polyphony.tone16.realtimeFactor = 1.01;
    expect(generatedQualityGateViolations(report)).toEqual([]);
  });
});
