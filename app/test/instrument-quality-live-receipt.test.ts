import { describe, expect, it } from 'vitest';

import { MAX_TRACKS } from '../src/types';
import {
  LIVE_GENERATED_FROM,
  LIVE_RECEIPT_CLAIM,
  LIVE_RECEIPT_SCHEMA_VERSION,
  LIVE_SILENCE_PEAK_THRESHOLD,
  LIVE_SILENCE_RMS_THRESHOLD,
  LIVE_STEP_COUNT,
  LIVE_TEMPO,
  expectedLiveInstrumentSpecs,
  validateLiveQualityReport,
  type LiveQualityReport,
} from '../scripts/instrument-quality-live-receipt';

const SUBJECT = 'a'.repeat(40);

function validReceipt(): LiveQualityReport {
  const specs = expectedLiveInstrumentSpecs();
  const sessions = Array.from({ length: Math.ceil(specs.length / MAX_TRACKS) }, (_, index) => ({
    sessionId: `session-${index}`,
    instruments: specs.slice(index * MAX_TRACKS, (index + 1) * MAX_TRACKS).map(spec => spec.sampleId),
    masterPeak: 0.2,
    masterRms: 0.04,
  }));
  return {
    schemaVersion: LIVE_RECEIPT_SCHEMA_VERSION,
    claim: LIVE_RECEIPT_CLAIM,
    generatedAt: '2026-08-22T00:00:00.000Z',
    subjectCommit: SUBJECT,
    browser: { name: 'chromium', version: '140.0.0', userAgent: 'fixture chromium' },
    audioSampleRates: [48_000],
    generatedFrom: LIVE_GENERATED_FROM,
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

    const browser = validReceipt();
    browser.browser.name = 'webkit';
    expect(() => validateLiveQualityReport(browser, SUBJECT)).toThrow(/Chromium browser identity/);

    const diagnostics = validReceipt();
    diagnostics.diagnostics.consoleErrors.push('sample skipped');
    expect(() => validateLiveQualityReport(diagnostics, SUBJECT)).toThrow(/cannot earn evidence credit/);

    expect(() => validateLiveQualityReport(validReceipt(), 'b'.repeat(40))).toThrow(/subject commit/);
  });
});
