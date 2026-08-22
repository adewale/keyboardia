import { describe, expect, it } from 'vitest';

import {
  CONTROL_EVALUATOR_OVERLAY_PATHS,
  assertControlOverlayPaths,
  assertLiveCaptureRepeatability,
  compareQualitySummaries,
  isExpectedControlBaselineBindingStatus,
  summarizeQualityArtifacts,
  type QualitySummary,
} from '../scripts/reconstruct-instrument-quality-control';
import {
  LIVE_RECEIPT_CLAIM,
  LIVE_RECEIPT_SCHEMA_VERSION,
  type LiveQualityReport,
} from '../scripts/instrument-quality-live-receipt';

function liveFixture(): LiveQualityReport {
  return {
    schemaVersion: LIVE_RECEIPT_SCHEMA_VERSION,
    claim: LIVE_RECEIPT_CLAIM,
    generatedAt: '2026-08-22T12:00:00.000Z',
    subjectCommit: 'a'.repeat(40),
    browser: {
      name: 'chromium',
      version: '140.0.0',
      userAgent: 'repeatability-test-agent',
    },
    audioSampleRates: [48_000],
    capture: { method: 'capture-method' },
    schedule: { preparation: 'preparation-method' },
    random: { locked: true, seed: 123, algorithm: 'test-prng' },
    sessions: [{
      sessionId: 'session-primary',
      instruments: ['one'],
      sampleRate: 48_000,
    }],
    instruments: [{
      sampleId: 'one',
      trackId: 'track-primary',
      sessionId: 'session-primary',
      peak: 0.75,
      rms: 0.25,
      masterPeak: 0.5,
      masterRms: 0.125,
      capturedFrames: 120_000,
      channelSampleCount: 240_000,
      armToOnsetFrames: 24_000,
      randomCalls: 17,
    }],
    diagnostics: { pageErrors: [], consoleErrors: [] },
  } as unknown as LiveQualityReport;
}

function cloneLiveFixture(value: LiveQualityReport): LiveQualityReport {
  return JSON.parse(JSON.stringify(value)) as LiveQualityReport;
}

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

  it('accepts only the binder\'s one expected unstaged baseline edit', () => {
    expect(isExpectedControlBaselineBindingStatus(
      'M app/scripts/sample-quality-baseline.json',
    )).toBe(true);
    expect(isExpectedControlBaselineBindingStatus(
      'M  app/scripts/sample-quality-baseline.json',
    )).toBe(false);
    expect(isExpectedControlBaselineBindingStatus(
      'M app/scripts/sample-quality-baseline.json\n?? unexpected.json',
    )).toBe(false);
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
    } as unknown as LiveQualityReport);

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

  it('allows only volatile IDs, timestamps, and validator-bounded arm timing to differ', () => {
    const primary = liveFixture();
    const confirmation = cloneLiveFixture(primary);
    confirmation.generatedAt = '2026-08-22T12:05:00.000Z';
    confirmation.sessions[0].sessionId = 'session-confirmation';
    confirmation.instruments[0].sessionId = 'session-confirmation';
    confirmation.instruments[0].trackId = 'track-confirmation';
    confirmation.instruments[0].armToOnsetFrames = 31_000;

    expect(() => assertLiveCaptureRepeatability(primary, confirmation)).not.toThrow();
  });

  it.each([
    ['track peak', (report: LiveQualityReport) => { report.instruments[0].peak = 0.7; }],
    ['track RMS', (report: LiveQualityReport) => { report.instruments[0].rms = 0.2; }],
    ['master peak', (report: LiveQualityReport) => { report.instruments[0].masterPeak = 0.4; }],
    ['master RMS', (report: LiveQualityReport) => { report.instruments[0].masterRms = 0.1; }],
    ['browser version', (report: LiveQualityReport) => { report.browser.version = '141.0.0'; }],
    ['sample rates', (report: LiveQualityReport) => { report.audioSampleRates = [44_100]; }],
    ['capture geometry', (report: LiveQualityReport) => { report.instruments[0].capturedFrames = 110_250; }],
    ['diagnostics', (report: LiveQualityReport) => { report.diagnostics.pageErrors.push('boom'); }],
    ['RNG trace', (report: LiveQualityReport) => { report.instruments[0].randomCalls = 18; }],
  ])('refuses a repeat whose %s differs', (_label, mutate) => {
    const primary = liveFixture();
    const confirmation = cloneLiveFixture(primary);
    mutate(confirmation);

    expect(() => assertLiveCaptureRepeatability(primary, confirmation))
      .toThrow(/not repeatable.*refused/);
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
