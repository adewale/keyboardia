import { describe, expect, it } from 'vitest';

import {
  CONTROL_EVALUATOR_OVERLAY_PATHS,
  assertControlOverlayPaths,
  compareQualitySummaries,
  summarizeQualityArtifacts,
  type QualitySummary,
} from '../scripts/reconstruct-instrument-quality-control';

describe('instrument-quality controlled-comparison reconstruction', () => {
  it('keeps the declared evaluator overlay outside preserved subject paths', () => {
    expect(() => assertControlOverlayPaths(CONTROL_EVALUATOR_OVERLAY_PATHS)).not.toThrow();
    expect(() => assertControlOverlayPaths([
      ...CONTROL_EVALUATOR_OVERLAY_PATHS,
      'app/public/instruments/piano/manifest.json',
    ])).toThrow(/changes preserved subject path app\/public\//);
    expect(() => assertControlOverlayPaths([
      'app/src/audio/advancedSynth.ts',
    ])).toThrow(/changes preserved subject path app\/src\/audio\//);
    expect(() => assertControlOverlayPaths(['app/package.json']))
      .toThrow(/changes preserved subject path app\/package\.json/);
  });

  it('derives every aggregate from the raw bound receipts', () => {
    const summary = summarizeQualityArtifacts({
      schemaVersion: 2,
      commit: 'a'.repeat(40),
      provenance: {
        evaluatorCommit: 'b'.repeat(40),
        subjectCommit: 'a'.repeat(40),
        evaluatorDirty: false,
      },
      inputs: { sampleReport: null, liveReport: null },
      totals: { instruments: 3, liveMeasured: 3, liveSilent: 1 },
      instruments: [
        {
          id: 'one', score: 12.3, band: 'medium',
          live: { measured: true, silent: false, peakDbfs: 1.2 },
        },
        {
          id: 'two', score: 2.2, band: 'low',
          live: { measured: true, silent: true, peakDbfs: -80 },
        },
        {
          id: 'three', score: 0, band: 'baseline',
          live: { measured: true, silent: false, peakDbfs: -3 },
        },
      ],
    }, {
      version: 1,
      subjectCommit: 'a'.repeat(40),
      subjectTreeClean: true,
      evaluatorBundleSha256: 'c'.repeat(64),
      baselineSha256: 'd'.repeat(64),
      totals: {
        instruments: 1, files: 2, errors: 0, reviewFlags: 0, waivedIssues: 2,
      },
      issues: [],
      waivedIssues: [
        { issue: { code: 'PITCH_DEVIATION' } },
        { issue: { code: 'HOT_PEAK' } },
      ],
    }, {
      schemaVersion: 1,
      subjectCommit: 'a'.repeat(40),
      instruments: [
        { sampleId: 'one', peak: 1, rms: 0.5 },
        { sampleId: 'two', peak: 0, rms: 0 },
        { sampleId: 'three', peak: 0.5, rms: 0.2 },
      ],
    });

    expect(summary).toMatchObject({
      catalogueInstruments: 3,
      audibleInstruments: 2,
      repairPriorityPoints: 14.5,
      bands: { critical: 0, high: 0, medium: 1, low: 1, baseline: 1 },
      nonzeroRepairPriorityScores: 2,
      canonicalLivePeaksAboveZeroDbfs: 1,
      decodedFindings: 2,
      decodedIssueCodes: { HOT_PEAK: 1, PITCH_DEVIATION: 1 },
      nonzeroInstruments: { one: 12.3, two: 2.2 },
    });
  });

  it('reports candidate-minus-control deltas without fixed historical numbers', () => {
    const control: QualitySummary = {
      catalogueInstruments: 2,
      audibleInstruments: 2,
      repairPriorityPoints: 20,
      bands: { critical: 0, high: 0, medium: 1, low: 1, baseline: 0 },
      nonzeroRepairPriorityScores: 2,
      canonicalLivePeaksAboveZeroDbfs: 1,
      decodedFindings: 10,
      decodedIssueCodes: { HOT_PEAK: 4, LEADING_SILENCE: 6 },
      nonzeroInstruments: { one: 12, two: 8 },
    };
    const candidate: QualitySummary = {
      ...control,
      repairPriorityPoints: 15,
      bands: { critical: 0, high: 0, medium: 0, low: 1, baseline: 1 },
      nonzeroRepairPriorityScores: 1,
      canonicalLivePeaksAboveZeroDbfs: 0,
      decodedFindings: 4,
      decodedIssueCodes: { HOT_PEAK: 3, PITCH_DEVIATION: 1 },
    };

    expect(compareQualitySummaries(control, candidate)).toEqual({
      repairPriorityPoints: -5,
      repairPriorityPercent: -25,
      decodedFindings: -6,
      decodedFindingsPercent: -60,
      nonzeroRepairPriorityScores: -1,
      bands: { critical: 0, high: 0, medium: -1, low: 0, baseline: 1 },
      canonicalLivePeaksAboveZeroDbfs: -1,
      decodedIssueCodes: { HOT_PEAK: -1, LEADING_SILENCE: -6, PITCH_DEVIATION: 1 },
    });
  });
});
