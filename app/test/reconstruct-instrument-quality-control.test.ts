import { describe, expect, it } from 'vitest';

import {
  CONTROL_EVALUATOR_OVERLAY_PATHS,
  LIVE_ENERGY_SPREAD_ALARM_DB,
  assertAuditDecisionRepeatability,
  assertControlOverlayPaths,
  assertLiveCaptureRepeatability,
  compareQualitySummaries,
  isExpectedControlBaselineBindingStatus,
  summarizeQualityArtifacts,
  type AuditReport,
  type QualitySummary,
} from '../scripts/reconstruct-instrument-quality-control';
import {
  LIVE_RANDOM_ALGORITHM,
  LIVE_RANDOM_SEED,
  LIVE_MIDI_VELOCITY,
  LIVE_NOTE_GAIN,
  LIVE_NOTE_DURATION_SECONDS,
  LIVE_RECEIPT_CLAIM,
  LIVE_RECEIPT_SCHEMA_VERSION,
  LIVE_SESSION_LIFECYCLE,
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
      execution: {
        lifecycle: LIVE_SESSION_LIFECYCLE,
        browser: {
          name: 'chromium',
          version: '140.0.0',
          userAgent: 'repeatability-test-agent',
        },
        randomReset: {
          seed: LIVE_RANDOM_SEED,
          algorithm: LIVE_RANDOM_ALGORITHM,
          calls: 0,
        },
      },
    }],
    instruments: [{
      sampleId: 'one',
      name: 'One',
      type: 'synth',
      presetId: 'one',
      pitch: 0,
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
      preArmUiUnmutedTrackIds: ['track-primary'],
      preArmCommandedTrackBusOpenIds: ['track-primary'],
      observedEngineDispatches: [{
        method: 'playSynthNote',
        trackId: 'track-primary',
        instrumentOrPresetId: 'one',
        pitchUnit: 'semitones-from-c4',
        musicalPitch: 0,
        midiVelocity: LIVE_MIDI_VELOCITY,
        noteGain: LIVE_NOTE_GAIN,
        eventTimeSeconds: 1,
        durationSeconds: LIVE_NOTE_DURATION_SECONDS,
        argumentCount: 8,
        variationKey: null,
      }],
    }],
    diagnostics: { pageErrors: [], consoleErrors: [] },
  } as unknown as LiveQualityReport;
}

function cloneLiveFixture(value: LiveQualityReport): LiveQualityReport {
  return JSON.parse(JSON.stringify(value)) as LiveQualityReport;
}

function auditFixture(): AuditReport {
  return {
    schemaVersion: 2,
    commit: 'a'.repeat(40),
    provenance: {
      evaluatorCommit: 'b'.repeat(40),
      subjectCommit: 'a'.repeat(40),
      evaluatorDirty: false,
    },
    inputs: {
      sampleReport: { sha256: 'c'.repeat(64) },
      liveReport: { sha256: 'd'.repeat(64) },
    },
    totals: { instruments: 1, liveMeasured: 1, liveSilent: 0 },
    instruments: [{
      rank: 1,
      id: 'one',
      score: 2.5,
      band: 'low',
      evidenceGrade: 'B',
      scoreComponents: [{ id: 'component', points: 2.5, detail: 'measured debt' }],
      improvements: ['repair the measured debt'],
      live: {
        measured: true,
        silent: false,
        peakDbfs: -2,
        rmsDbfs: -24,
        categoryRmsDeltaDb: 3,
      },
    }],
  };
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
          rank: 1, id: 'one', score: 12.3, band: 'medium', evidenceGrade: 'B',
          scoreComponents: [], improvements: [],
          live: { measured: true, silent: false, peakDbfs: 1.2 },
        },
        {
          rank: 2, id: 'two', score: 2.2, band: 'low', evidenceGrade: 'B',
          scoreComponents: [], improvements: [],
          live: { measured: true, silent: true, peakDbfs: -80 },
        },
        {
          rank: 3, id: 'three', score: 0, band: 'baseline', evidenceGrade: 'B',
          scoreComponents: [], improvements: [],
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

  it('accepts volatile IDs, bounded arm timing, and raw energy variation within the alarm', () => {
    const primary = liveFixture();
    const confirmation = cloneLiveFixture(primary);
    const withinAlarmRatio = 10 ** ((LIVE_ENERGY_SPREAD_ALARM_DB - 0.1) / 20);
    confirmation.generatedAt = '2026-08-22T12:05:00.000Z';
    confirmation.sessions[0].sessionId = 'session-confirmation';
    confirmation.instruments[0].sessionId = 'session-confirmation';
    confirmation.instruments[0].trackId = 'track-confirmation';
    confirmation.instruments[0].preArmUiUnmutedTrackIds = ['track-confirmation'];
    confirmation.instruments[0].preArmCommandedTrackBusOpenIds = ['track-confirmation'];
    confirmation.instruments[0].observedEngineDispatches[0].trackId = 'track-confirmation';
    confirmation.instruments[0].observedEngineDispatches[0].eventTimeSeconds = 2;
    confirmation.instruments[0].armToOnsetFrames = 31_000;
    confirmation.instruments[0].peak *= withinAlarmRatio;
    confirmation.instruments[0].rms *= withinAlarmRatio;
    confirmation.instruments[0].masterPeak *= withinAlarmRatio;
    confirmation.instruments[0].masterRms *= withinAlarmRatio;

    expect(assertLiveCaptureRepeatability(primary, confirmation)).toMatchObject({
      alarmDb: LIVE_ENERGY_SPREAD_ALARM_DB,
      maximumDb: expect.closeTo(LIVE_ENERGY_SPREAD_ALARM_DB - 0.1, 10),
      byMetricDb: {
        peak: expect.closeTo(LIVE_ENERGY_SPREAD_ALARM_DB - 0.1, 10),
        rms: expect.closeTo(LIVE_ENERGY_SPREAD_ALARM_DB - 0.1, 10),
        masterPeak: expect.closeTo(LIVE_ENERGY_SPREAD_ALARM_DB - 0.1, 10),
        masterRms: expect.closeTo(LIVE_ENERGY_SPREAD_ALARM_DB - 0.1, 10),
      },
    });
  });

  it('refuses raw energy variation above the prospective stability alarm', () => {
    const primary = liveFixture();
    const confirmation = cloneLiveFixture(primary);
    confirmation.instruments[0].rms *= 10 ** ((LIVE_ENERGY_SPREAD_ALARM_DB + 0.01) / 20);

    expect(() => assertLiveCaptureRepeatability(primary, confirmation))
      .toThrow(/exceed the 0\.5 dB evaluator-stability alarm.*\.rms/);
  });

  it('refuses a within-alarm crossing of the above-zero-dBFS classification', () => {
    const primary = liveFixture();
    const confirmation = cloneLiveFixture(primary);
    primary.instruments[0].peak = 0.99;
    confirmation.instruments[0].peak = 1.01;

    expect(() => assertLiveCaptureRepeatability(primary, confirmation))
      .toThrow(/above-zero-dBFS classification/);
  });

  it('refuses a within-alarm crossing of the routing-silence classification', () => {
    const primary = liveFixture();
    const confirmation = cloneLiveFixture(primary);
    primary.instruments[0].peak = 0.000099;
    primary.instruments[0].rms = 0.0000099;
    confirmation.instruments[0].peak = 0.000101;
    confirmation.instruments[0].rms = 0.0000101;

    expect(() => assertLiveCaptureRepeatability(primary, confirmation))
      .toThrow(/silence classification/);
  });

  it.each([
    ['browser version', (report: LiveQualityReport) => { report.browser.version = '141.0.0'; }],
    ['sample rates', (report: LiveQualityReport) => { report.audioSampleRates = [44_100]; }],
    ['capture geometry', (report: LiveQualityReport) => { report.instruments[0].capturedFrames = 110_250; }],
    ['diagnostics', (report: LiveQualityReport) => { report.diagnostics.pageErrors.push('boom'); }],
    ['RNG trace', (report: LiveQualityReport) => { report.instruments[0].randomCalls = 18; }],
    ['session browser identity', (report: LiveQualityReport) => {
      report.sessions[0].execution.browser.userAgent = 'different-agent';
    }],
    ['session RNG reset', (report: LiveQualityReport) => {
      report.sessions[0].execution.randomReset.calls = 1 as 0;
    }],
    ['dispatch method', (report: LiveQualityReport) => {
      report.instruments[0].observedEngineDispatches[0].method = 'playToneSynth';
    }],
    ['dispatch preset', (report: LiveQualityReport) => {
      report.instruments[0].observedEngineDispatches[0].instrumentOrPresetId = 'other';
    }],
    ['dispatch pitch', (report: LiveQualityReport) => {
      report.instruments[0].observedEngineDispatches[0].musicalPitch = 1;
    }],
    ['dispatch velocity', (report: LiveQualityReport) => {
      report.instruments[0].observedEngineDispatches[0].midiVelocity = 90;
    }],
    ['dispatch gain', (report: LiveQualityReport) => {
      report.instruments[0].observedEngineDispatches[0].noteGain = 0.5;
    }],
    ['dispatch duration', (report: LiveQualityReport) => {
      report.instruments[0].observedEngineDispatches[0].durationSeconds = 0.3;
    }],
    ['dispatch argument count', (report: LiveQualityReport) => {
      report.instruments[0].observedEngineDispatches[0].argumentCount = 7;
    }],
    ['dispatch variation key', (report: LiveQualityReport) => {
      report.instruments[0].observedEngineDispatches[0].variationKey = 'other-buffer';
    }],
    ['UI isolation', (report: LiveQualityReport) => {
      report.instruments[0].preArmUiUnmutedTrackIds = [];
    }],
  ])('refuses a repeat whose %s differs', (_label, mutate) => {
    const primary = liveFixture();
    const confirmation = cloneLiveFixture(primary);
    mutate(confirmation);

    expect(() => assertLiveCaptureRepeatability(primary, confirmation))
      .toThrow(/differ in exact structural evidence.*refused/);
  });

  it('ignores display-only live values when derived audit decisions match', () => {
    const primary = auditFixture();
    const confirmation = JSON.parse(JSON.stringify(primary)) as AuditReport;
    confirmation.inputs.liveReport = { sha256: 'e'.repeat(64) };
    confirmation.instruments[0].live.peakDbfs = -3;
    confirmation.instruments[0].live.rmsDbfs = -25;
    confirmation.instruments[0].live.categoryRmsDeltaDb = 4;

    expect(() => assertAuditDecisionRepeatability(primary, confirmation)).not.toThrow();
  });

  it('refuses a score decision mismatch between primary and confirmation rankings', () => {
    const primary = auditFixture();
    const confirmation = JSON.parse(JSON.stringify(primary)) as AuditReport;
    confirmation.instruments[0].score = 2.6;

    expect(() => assertAuditDecisionRepeatability(primary, confirmation))
      .toThrow(/different audit decisions.*refused/);
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
