import { describe, expect, it } from 'vitest';

import { MAX_TRACKS } from '../src/types';
import {
  LIVE_ACTIVE_STEP,
  LIVE_CAPTURE_ALIGNMENT,
  LIVE_CAPTURE_CHANNEL_COUNT,
  LIVE_CAPTURE_DURATION_SECONDS,
  LIVE_CAPTURE_METHOD,
  LIVE_EXPECTED_EVENTS_PER_TRACK,
  LIVE_GENERATED_FROM,
  LIVE_MAX_ARM_TO_ONSET_SECONDS,
  LIVE_ONSET_THRESHOLD,
  LIVE_PATTERN_PERIOD_SECONDS,
  LIVE_PEAK_METRIC,
  LIVE_PREPARATION_METHOD,
  LIVE_RANDOM_ALGORITHM,
  LIVE_RANDOM_SEED,
  LIVE_RECEIPT_CLAIM,
  LIVE_RECEIPT_SCHEMA_VERSION,
  LIVE_RMS_METRIC,
  LIVE_SILENCE_PEAK_THRESHOLD,
  LIVE_SILENCE_RMS_THRESHOLD,
  LIVE_STEP_COUNT,
  LIVE_TEMPO,
  LIVE_UNMUTE_SETTLE_SECONDS,
  expectedLiveInstrumentSpecs,
  validateLiveQualityReport,
  type LiveQualityReport,
} from '../scripts/instrument-quality-live-receipt';

const SUBJECT = 'a'.repeat(40);

function validReceipt(): LiveQualityReport {
  const specs = expectedLiveInstrumentSpecs();
  const capturedFrames = LIVE_CAPTURE_DURATION_SECONDS * 48_000;
  const channelSampleCount = capturedFrames * LIVE_CAPTURE_CHANNEL_COUNT;
  const sessions = Array.from({ length: Math.ceil(specs.length / MAX_TRACKS) }, (_, index) => ({
    sessionId: `session-${index}`,
    instruments: specs.slice(index * MAX_TRACKS, (index + 1) * MAX_TRACKS).map(spec => spec.sampleId),
    sampleRate: 48_000,
    masterPeak: 0.2,
    masterRms: 0.04,
    capturedFrames,
    channelSampleCount,
    armToOnsetFrames: 256,
    randomCalls: 10_000,
  }));
  return {
    schemaVersion: LIVE_RECEIPT_SCHEMA_VERSION,
    claim: LIVE_RECEIPT_CLAIM,
    generatedAt: '2026-08-22T00:00:00.000Z',
    subjectCommit: SUBJECT,
    browser: { name: 'chromium', version: '140.0.0', userAgent: 'fixture chromium' },
    audioSampleRates: [48_000],
    generatedFrom: LIVE_GENERATED_FROM,
    capture: {
      method: LIVE_CAPTURE_METHOD,
      alignment: LIVE_CAPTURE_ALIGNMENT,
      durationSeconds: LIVE_CAPTURE_DURATION_SECONDS,
      channelCount: LIVE_CAPTURE_CHANNEL_COUNT,
      onsetThreshold: LIVE_ONSET_THRESHOLD,
      maxArmToOnsetSeconds: LIVE_MAX_ARM_TO_ONSET_SECONDS,
      peakMetric: LIVE_PEAK_METRIC,
      rmsMetric: LIVE_RMS_METRIC,
    },
    schedule: {
      preparation: LIVE_PREPARATION_METHOD,
      activeStep: LIVE_ACTIVE_STEP,
      expectedEventsPerTrack: LIVE_EXPECTED_EVENTS_PER_TRACK,
      patternPeriodSeconds: LIVE_PATTERN_PERIOD_SECONDS,
      unmuteSettleSeconds: LIVE_UNMUTE_SETTLE_SECONDS,
    },
    random: {
      locked: true,
      seed: LIVE_RANDOM_SEED,
      algorithm: LIVE_RANDOM_ALGORITHM,
    },
    silencePeakThreshold: LIVE_SILENCE_PEAK_THRESHOLD,
    silenceRmsThreshold: LIVE_SILENCE_RMS_THRESHOLD,
    tempo: LIVE_TEMPO,
    stepCount: LIVE_STEP_COUNT,
    sessions,
    instruments: specs.map((spec, index) => ({
      ...spec,
      trackId: `track-${index}`,
      sessionId: sessions[Math.floor(index / MAX_TRACKS)].sessionId,
      peak: 0.1,
      rms: 0.02,
      capturedFrames,
      channelSampleCount,
    })),
    diagnostics: { pageErrors: [], consoleErrors: [] },
  };
}

describe('live instrument-quality receipt', () => {
  it('validates exact 99-instrument coverage and permits measured silence as a quality result', () => {
    const receipt = validReceipt();
    receipt.instruments[0].peak = 0;
    receipt.instruments[0].rms = 0;
    expect(expectedLiveInstrumentSpecs()).toHaveLength(99);
    expect(validateLiveQualityReport(receipt, SUBJECT)).toBe(receipt);
  });

  it('rejects missing, duplicate, unexpected, or session-mismatched catalogue coverage', () => {
    const missing = validReceipt();
    missing.instruments.pop();
    expect(() => validateLiveQualityReport(missing, SUBJECT)).toThrow(/exactly 99/);

    const duplicate = validReceipt();
    duplicate.instruments[1].sampleId = duplicate.instruments[0].sampleId;
    expect(() => validateLiveQualityReport(duplicate, SUBJECT)).toThrow(/duplicates instrument/);

    const sessionMismatch = validReceipt();
    sessionMismatch.instruments[0].sessionId = 'not-the-session';
    expect(() => validateLiveQualityReport(sessionMismatch, SUBJECT)).toThrow(/disagrees with its declared session/);
  });

  it('rejects forged thresholds, malformed metrics, sample rates, browser, diagnostics, and provenance', () => {
    const forgedThreshold = validReceipt();
    forgedThreshold.silencePeakThreshold = 1 as typeof LIVE_SILENCE_PEAK_THRESHOLD;
    expect(() => validateLiveQualityReport(forgedThreshold, SUBJECT)).toThrow(/settings or thresholds/);

    const nonfinite = validReceipt();
    nonfinite.instruments[0].peak = Number.NaN;
    expect(() => validateLiveQualityReport(nonfinite, SUBJECT)).toThrow(/finite nonnegative/);

    const impossibleRms = validReceipt();
    impossibleRms.instruments[0].rms = 0.2;
    expect(() => validateLiveQualityReport(impossibleRms, SUBJECT)).toThrow(/RMS exceeds peak/);

    const rates = validReceipt();
    rates.audioSampleRates = [48_000, 44_100];
    expect(() => validateLiveQualityReport(rates, SUBJECT)).toThrow(/unique, sorted, and supported/);

    const incompleteCapture = validReceipt();
    incompleteCapture.instruments[0].channelSampleCount -= 1;
    expect(() => validateLiveQualityReport(incompleteCapture, SUBJECT)).toThrow(/every channel sample/);

    const maxBlockRms = validReceipt();
    maxBlockRms.capture.rmsMetric = 'maximum-block-rms' as typeof LIVE_RMS_METRIC;
    expect(() => validateLiveQualityReport(maxBlockRms, SUBJECT)).toThrow(/capture settings/);

    const repeatedEvents = validReceipt();
    repeatedEvents.schedule.expectedEventsPerTrack = 5 as typeof LIVE_EXPECTED_EVENTS_PER_TRACK;
    expect(() => validateLiveQualityReport(repeatedEvents, SUBJECT)).toThrow(/capture settings/);

    const unseeded = validReceipt();
    unseeded.random.locked = false as true;
    expect(() => validateLiveQualityReport(unseeded, SUBJECT)).toThrow(/capture settings/);

    const forgedOnset = validReceipt();
    forgedOnset.capture.onsetThreshold = 0 as typeof LIVE_ONSET_THRESHOLD;
    expect(() => validateLiveQualityReport(forgedOnset, SUBJECT)).toThrow(/capture settings/);

    const lateOnset = validReceipt();
    lateOnset.sessions[0].armToOnsetFrames = 48_001;
    expect(() => validateLiveQualityReport(lateOnset, SUBJECT)).toThrow(/maximum arm-to-onset/);

    const malformedRandomCalls = validReceipt();
    malformedRandomCalls.sessions[0].randomCalls = -1;
    expect(() => validateLiveQualityReport(malformedRandomCalls, SUBJECT)).toThrow(/nonnegative integer/);

    const browser = validReceipt();
    browser.browser.name = 'webkit';
    expect(() => validateLiveQualityReport(browser, SUBJECT)).toThrow(/Chromium browser identity/);

    const diagnostics = validReceipt();
    diagnostics.diagnostics.consoleErrors.push('sample skipped');
    expect(() => validateLiveQualityReport(diagnostics, SUBJECT)).toThrow(/cannot earn evidence credit/);

    expect(() => validateLiveQualityReport(validReceipt(), 'b'.repeat(40))).toThrow(/subject commit/);
  });
});
