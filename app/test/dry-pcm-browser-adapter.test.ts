import { describe, expect, it, vi } from 'vitest';

import {
  BrowserLifecycleCleanupError,
  runIsolatedBrowserCaptureAttempts,
  type BrowserCaptureDiagnostics,
  type BrowserCaptureRejectedAttempt,
  type IsolatedBrowserCaptureAttempt,
} from '../e2e/dry-pcm-browser-adapter';
import type { DryPcmCapture } from '../scripts/instrument-quality-matrix';

function capture(captureAttemptId: string): DryPcmCapture {
  return {
    captureAttemptId,
    sampleRate: 44_100,
    channels: [Float32Array.of(0.25), Float32Array.of(0.25)],
    frameCount: 1,
    capturedFrameCount: 1,
    maxRenderFrameDrift: 0,
  };
}

function diagnostic(captureAttemptId: string): BrowserCaptureDiagnostics {
  return {
    captureAttemptId,
    caseId: 'snare/repeat-seed-a-replay/16-hits',
    sessionId: `session-${captureAttemptId}`,
    trackId: `track-${captureAttemptId}`,
    randomSeed: 17,
    randomAlgorithm: 'mulberry32',
    randomCalls: 16,
    scheduleLeadFrames: 15_435,
    maxRenderFrameDrift: 0,
    tap: 'track-bus-output-post-pan-pre-master',
    effectsEnabled: false,
    pan: 0,
    audioContextSampleRate: 44_100,
    latencyHint: 'playback',
    browserVersion: '143.0.0.0',
    userAgent: 'unit-test',
  };
}

function successfulAttempt(captureAttemptId: string): IsolatedBrowserCaptureAttempt {
  return {
    browserVersion: '143.0.0.0',
    capture: vi.fn(async () => ({
      capture: capture(captureAttemptId),
      diagnostics: [diagnostic(captureAttemptId)],
    })),
    isConnected: vi.fn(() => true),
    close: vi.fn(async () => undefined),
  };
}

describe('isolated dry PCM browser capture retries', () => {
  it('retries a typed context-cleanup rejection in a fresh process', async () => {
    const rejected: BrowserCaptureRejectedAttempt[] = [];
    const first = successfulAttempt('discarded-context-cleanup');
    first.capture = vi.fn(async () => {
      throw new BrowserLifecycleCleanupError(
        'snare/repeat-seed-a-replay/16-hits',
        'discarded-context-cleanup',
        'context-close',
        first.browserVersion,
        new Error('Target page, context or browser has been closed'),
      );
    });
    const second = successfulAttempt('accepted-second-process');
    const launchAttempt = vi.fn(async (processAttempt: number) =>
      processAttempt === 1 ? first : second
    );

    const result = await runIsolatedBrowserCaptureAttempts({
      caseId: 'snare/repeat-seed-a-replay/16-hits',
      launchAttempt,
      onRejected: attempt => rejected.push(attempt),
    });

    expect(launchAttempt).toHaveBeenCalledTimes(2);
    expect(result.capture.captureAttemptId).toBe('accepted-second-process');
    expect(result.diagnostics.map(item => item.captureAttemptId)).toEqual(['accepted-second-process']);
    expect(rejected).toEqual([
      expect.objectContaining({
        captureAttemptId: 'discarded-context-cleanup',
        processAttempt: 1,
        reason: 'browser-cleanup-failure',
        cleanupStage: 'context-close',
      }),
    ]);
  });

  it('rejects provisional PCM when browser close fails, then accepts only the retry', async () => {
    const rejected: BrowserCaptureRejectedAttempt[] = [];
    const first = successfulAttempt('discarded-browser-close');
    first.close = vi.fn(async () => {
      throw new Error('browser process closed during teardown');
    });
    const second = successfulAttempt('accepted-after-clean-close');

    const result = await runIsolatedBrowserCaptureAttempts({
      caseId: 'snare/repeat-seed-a-replay/16-hits',
      launchAttempt: async processAttempt => processAttempt === 1 ? first : second,
      onRejected: attempt => rejected.push(attempt),
    });

    expect(result.capture.captureAttemptId).toBe('accepted-after-clean-close');
    expect(result.diagnostics.map(item => item.captureAttemptId)).toEqual(['accepted-after-clean-close']);
    expect(rejected).toEqual([
      expect.objectContaining({
        captureAttemptId: 'discarded-browser-close',
        reason: 'browser-cleanup-failure',
        cleanupStage: 'browser-close',
      }),
    ]);
  });

  it('fails closed after three cleanup failures', async () => {
    const rejected: BrowserCaptureRejectedAttempt[] = [];
    const launchAttempt = vi.fn(async (processAttempt: number): Promise<IsolatedBrowserCaptureAttempt> => ({
      browserVersion: '143.0.0.0',
      capture: async () => {
        throw new BrowserLifecycleCleanupError(
          'snare/repeat-seed-a-replay/16-hits',
          `cleanup-failure-${processAttempt}`,
          'context-close',
          '143.0.0.0',
          new Error('browser already closed'),
        );
      },
      isConnected: () => false,
      close: vi.fn(async () => undefined),
    }));

    await expect(runIsolatedBrowserCaptureAttempts({
      caseId: 'snare/repeat-seed-a-replay/16-hits',
      launchAttempt,
      onRejected: attempt => rejected.push(attempt),
    })).rejects.toMatchObject({
      name: 'BrowserLifecycleCleanupError',
      captureAttemptId: 'cleanup-failure-3',
    });

    expect(launchAttempt).toHaveBeenCalledTimes(3);
    expect(rejected.map(item => item.processAttempt)).toEqual([1, 2, 3]);
  });

  it('does not retry a generic capture failure or let teardown mask it', async () => {
    const primary = new Error('production capture failed');
    const close = vi.fn(async () => {
      throw new Error('cleanup also failed');
    });
    const launchAttempt = vi.fn(async (): Promise<IsolatedBrowserCaptureAttempt> => ({
      browserVersion: '143.0.0.0',
      capture: async () => { throw primary; },
      isConnected: () => true,
      close,
    }));

    await expect(runIsolatedBrowserCaptureAttempts({
      caseId: 'snare/repeat-seed-a-replay/16-hits',
      launchAttempt,
    })).rejects.toBe(primary);

    expect(launchAttempt).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('treats a post-capture browser disconnect as a cleanup rejection', async () => {
    const rejected: BrowserCaptureRejectedAttempt[] = [];
    const first = successfulAttempt('discarded-disconnected-process');
    first.isConnected = vi.fn(() => false);
    const second = successfulAttempt('accepted-connected-process');

    const result = await runIsolatedBrowserCaptureAttempts({
      caseId: 'snare/repeat-seed-a-replay/16-hits',
      launchAttempt: async processAttempt => processAttempt === 1 ? first : second,
      onRejected: attempt => rejected.push(attempt),
    });

    expect(result.capture.captureAttemptId).toBe('accepted-connected-process');
    expect(first.close).not.toHaveBeenCalled();
    expect(rejected[0]).toEqual(expect.objectContaining({
      reason: 'browser-cleanup-failure',
      cleanupStage: 'browser-disconnected-before-close',
    }));
  });
});
