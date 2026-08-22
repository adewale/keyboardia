import { describe, expect, it } from 'vitest';

import { MAX_TRACKS } from '../src/types';
import {
  LIVE_ACTIVE_STEP,
  LIVE_ACTIVE_STEP_OFFSET_SECONDS,
  LIVE_CAPTURE_ALIGNMENT,
  LIVE_CAPTURE_CHANNEL_COUNT,
  LIVE_CAPTURE_DURATION_SECONDS,
  LIVE_CAPTURE_METHOD,
  LIVE_DISPATCH_METHOD_BY_INSTRUMENT_TYPE,
  LIVE_SCHEDULED_ACTIVE_STEPS_PER_TRACK,
  LIVE_GENERATED_FROM,
  LIVE_ISOLATION_SCOPE,
  LIVE_MAX_ARM_TO_ONSET_SECONDS,
  LIVE_MAX_CONCURRENT_AUDIBLE_TRACKS,
  LIVE_MIN_ARM_TO_ONSET_SECONDS,
  LIVE_ONSET_THRESHOLD,
  LIVE_PATTERN_PERIOD_SECONDS,
  LIVE_PATTERN_STORAGE_STEP_COUNT,
  LIVE_PEAK_METRIC,
  LIVE_PREPARATION_METHOD,
  LIVE_RANDOM_ALGORITHM,
  LIVE_RANDOM_SEED,
  LIVE_RECEIPT_CLAIM,
  LIVE_RECEIPT_SCHEMA_VERSION,
  LIVE_RMS_METRIC,
  LIVE_SCHEDULER_LOOKAHEAD_SECONDS,
  LIVE_SESSION_LIFECYCLE,
  LIVE_SILENCE_PEAK_THRESHOLD,
  LIVE_SILENCE_RMS_THRESHOLD,
  LIVE_STEP_COUNT,
  LIVE_TEMPO,
  LIVE_TRIAL_MODE,
  LIVE_UNMUTE_SETTLE_SECONDS,
  expectedLiveInstrumentSpecs,
  isLiveRoutingSilent,
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
    execution: {
      lifecycle: LIVE_SESSION_LIFECYCLE,
      browser: { name: 'chromium', version: '140.0.0', userAgent: 'fixture chromium' },
      randomReset: { seed: LIVE_RANDOM_SEED, algorithm: LIVE_RANDOM_ALGORITHM, calls: 0 as const },
    },
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
      minArmToOnsetSeconds: LIVE_MIN_ARM_TO_ONSET_SECONDS,
      maxArmToOnsetSeconds: LIVE_MAX_ARM_TO_ONSET_SECONDS,
      trialMode: LIVE_TRIAL_MODE,
      maxConcurrentAudibleTracks: LIVE_MAX_CONCURRENT_AUDIBLE_TRACKS,
      isolationScope: LIVE_ISOLATION_SCOPE,
      peakMetric: LIVE_PEAK_METRIC,
      rmsMetric: LIVE_RMS_METRIC,
    },
    schedule: {
      preparation: LIVE_PREPARATION_METHOD,
      activeStep: LIVE_ACTIVE_STEP,
      activeStepOffsetSeconds: LIVE_ACTIVE_STEP_OFFSET_SECONDS,
      schedulerLookaheadSeconds: LIVE_SCHEDULER_LOOKAHEAD_SECONDS,
      scheduledActiveStepsPerTrack: LIVE_SCHEDULED_ACTIVE_STEPS_PER_TRACK,
      patternPeriodSeconds: LIVE_PATTERN_PERIOD_SECONDS,
      patternStorageStepCount: LIVE_PATTERN_STORAGE_STEP_COUNT,
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
    instruments: specs.map((spec, index) => {
      const trackId = `track-${index}`;
      return {
        ...spec,
        trackId,
        sessionId: sessions[Math.floor(index / MAX_TRACKS)].sessionId,
        peak: 0.1,
        rms: 0.02,
        masterPeak: 0.08,
        masterRms: 0.016,
        capturedFrames,
        channelSampleCount,
        armToOnsetFrames: 24_000,
        randomCalls: 10_000,
        preArmUiUnmutedTrackIds: [trackId],
        preArmCommandedTrackBusOpenIds: [trackId],
        observedEngineDispatches: [{
          method: LIVE_DISPATCH_METHOD_BY_INSTRUMENT_TYPE[spec.type],
          trackId,
        }],
      };
    }),
    diagnostics: { pageErrors: [], consoleErrors: [] },
  };
}

describe('live instrument-quality receipt', () => {
  it('scores either a silent track tap or a silent isolated master tap as routing silence', () => {
    const audible = validReceipt().instruments[0];
    expect(isLiveRoutingSilent(audible)).toBe(false);

    expect(isLiveRoutingSilent({
      ...audible,
      peak: LIVE_SILENCE_PEAK_THRESHOLD,
      rms: LIVE_SILENCE_RMS_THRESHOLD,
    })).toBe(true);

    expect(isLiveRoutingSilent({
      ...audible,
      masterPeak: LIVE_SILENCE_PEAK_THRESHOLD,
      masterRms: LIVE_SILENCE_RMS_THRESHOLD,
    })).toBe(true);
  });

  it('pins one lookahead-safe event outside the 2.5-second capture cycle', () => {
    expect(LIVE_RECEIPT_SCHEMA_VERSION).toBe(6);
    const stepDuration = 60 / LIVE_TEMPO / 4;
    expect(LIVE_ACTIVE_STEP * stepDuration).toBe(LIVE_ACTIVE_STEP_OFFSET_SECONDS);
    expect(LIVE_ACTIVE_STEP_OFFSET_SECONDS).toBeGreaterThan(LIVE_SCHEDULER_LOOKAHEAD_SECONDS);
    expect(LIVE_STEP_COUNT * stepDuration).toBe(LIVE_PATTERN_PERIOD_SECONDS);
    expect(LIVE_PATTERN_PERIOD_SECONDS).toBeGreaterThan(LIVE_CAPTURE_DURATION_SECONDS);
    expect(LIVE_PATTERN_STORAGE_STEP_COUNT).toBe(128);
    expect(LIVE_PATTERN_STORAGE_STEP_COUNT).toBeGreaterThan(LIVE_STEP_COUNT);
    expect(LIVE_SCHEDULED_ACTIVE_STEPS_PER_TRACK).toBe(1);
  });

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

    const forgedTrialMode = validReceipt();
    forgedTrialMode.capture.trialMode = 'polyphonic' as typeof LIVE_TRIAL_MODE;
    expect(() => validateLiveQualityReport(forgedTrialMode, SUBJECT)).toThrow(/capture settings/);

    const forgedConcurrency = validReceipt();
    forgedConcurrency.capture.maxConcurrentAudibleTracks = 2 as typeof LIVE_MAX_CONCURRENT_AUDIBLE_TRACKS;
    expect(() => validateLiveQualityReport(forgedConcurrency, SUBJECT)).toThrow(/capture settings/);

    const impossibleMasterRms = validReceipt();
    impossibleMasterRms.instruments[0].masterRms = 0.2;
    expect(() => validateLiveQualityReport(impossibleMasterRms, SUBJECT)).toThrow(/RMS exceeds peak/);

    const forgedActiveStepCount = validReceipt();
    forgedActiveStepCount.schedule.scheduledActiveStepsPerTrack =
      5 as typeof LIVE_SCHEDULED_ACTIVE_STEPS_PER_TRACK;
    expect(() => validateLiveQualityReport(forgedActiveStepCount, SUBJECT)).toThrow(/capture settings/);

    const lateScheduledStep = validReceipt();
    lateScheduledStep.schedule.activeStepOffsetSeconds = 0 as typeof LIVE_ACTIVE_STEP_OFFSET_SECONDS;
    expect(() => validateLiveQualityReport(lateScheduledStep, SUBJECT)).toThrow(/capture settings/);

    const unseeded = validReceipt();
    unseeded.random.locked = false as true;
    expect(() => validateLiveQualityReport(unseeded, SUBJECT)).toThrow(/capture settings/);

    const forgedOnset = validReceipt();
    forgedOnset.capture.onsetThreshold = 0 as typeof LIVE_ONSET_THRESHOLD;
    expect(() => validateLiveQualityReport(forgedOnset, SUBJECT)).toThrow(/capture settings/);

    const lateOnset = validReceipt();
    lateOnset.instruments[0].armToOnsetFrames = 48_001;
    expect(() => validateLiveQualityReport(lateOnset, SUBJECT)).toThrow(/maximum arm-to-onset/);

    const earlyOnset = validReceipt();
    // Each probe includes masterGain, so a release tail leaking from a prior
    // trial would cross the onset threshold before the scheduled step-four
    // event and must make the receipt unverifiable.
    earlyOnset.instruments[0].armToOnsetFrames = 1;
    expect(() => validateLiveQualityReport(earlyOnset, SUBJECT)).toThrow(/minimum arm-to-onset/);

    const malformedRandomCalls = validReceipt();
    malformedRandomCalls.instruments[0].randomCalls = -1;
    expect(() => validateLiveQualityReport(malformedRandomCalls, SUBJECT)).toThrow(/positive integer/);

    const reversedRandomCalls = validReceipt();
    reversedRandomCalls.instruments[1].randomCalls = 9_999;
    expect(() => validateLiveQualityReport(reversedRandomCalls, SUBJECT)).toThrow(/not nondecreasing/);

    const browser = validReceipt();
    browser.browser.name = 'webkit';
    expect(() => validateLiveQualityReport(browser, SUBJECT)).toThrow(/Chromium browser identity/);

    const reusedSessionPage = validReceipt();
    reusedSessionPage.sessions[0].execution.lifecycle =
      'reused-page' as typeof LIVE_SESSION_LIFECYCLE;
    expect(() => validateLiveQualityReport(reusedSessionPage, SUBJECT))
      .toThrow(/execution identity or RNG reset/);

    const mismatchedSessionBrowser = validReceipt();
    mismatchedSessionBrowser.sessions[0].execution.browser.userAgent = 'different browser context';
    expect(() => validateLiveQualityReport(mismatchedSessionBrowser, SUBJECT))
      .toThrow(/execution identity or RNG reset/);

    const unprovenRandomReset = validReceipt();
    unprovenRandomReset.sessions[0].execution.randomReset.calls = 1 as 0;
    expect(() => validateLiveQualityReport(unprovenRandomReset, SUBJECT))
      .toThrow(/execution identity or RNG reset/);

    const diagnostics = validReceipt();
    diagnostics.diagnostics.consoleErrors.push('sample skipped');
    expect(() => validateLiveQualityReport(diagnostics, SUBJECT)).toThrow(/cannot earn evidence credit/);

    expect(() => validateLiveQualityReport(validReceipt(), 'b'.repeat(40))).toThrow(/subject commit/);
  });

  it('rejects forged isolation snapshots and engine dispatch observations', () => {
    const extraUiTrack = validReceipt();
    extraUiTrack.instruments[0].preArmUiUnmutedTrackIds.push('track-1');
    expect(() => validateLiveQualityReport(extraUiTrack, SUBJECT)).toThrow(/UI-unmuted snapshot/);

    const wrongOpenBus = validReceipt();
    wrongOpenBus.instruments[0].preArmCommandedTrackBusOpenIds = ['track-1'];
    expect(() => validateLiveQualityReport(wrongOpenBus, SUBJECT)).toThrow(/commanded TrackBus snapshot/);

    const duplicateDispatch = validReceipt();
    duplicateDispatch.instruments[0].observedEngineDispatches.push({
      ...duplicateDispatch.instruments[0].observedEngineDispatches[0],
    });
    expect(() => validateLiveQualityReport(duplicateDispatch, SUBJECT)).toThrow(/exactly one expected engine dispatch/);

    const wrongDispatchTrack = validReceipt();
    wrongDispatchTrack.instruments[0].observedEngineDispatches[0].trackId = 'track-1';
    expect(() => validateLiveQualityReport(wrongDispatchTrack, SUBJECT)).toThrow(/exactly one expected engine dispatch/);

    const wrongDispatchMethod = validReceipt();
    wrongDispatchMethod.instruments[0].observedEngineDispatches[0].method = 'playToneSynth';
    expect(() => validateLiveQualityReport(wrongDispatchMethod, SUBJECT)).toThrow(/exactly one expected engine dispatch/);
  });
});
