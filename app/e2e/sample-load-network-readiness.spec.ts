import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect, waitForAppReady } from './global-setup';
import { API_BASE, createSessionWithRetry } from './test-utils';
import { THROTTLED_SAMPLE_NETWORK_PROFILE } from '../src/audio/sample-load-policy';

const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../test-results/audio-capture');

test('keeps lossless foreground and background loads ready on the throttled profile', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'network and decode readiness is desktop Chromium-only');
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'readiness evidence requires the deterministic local instrument corpus',
  );
  test.setTimeout(120_000);

  const { id } = await createSessionWithRetry(request, {
    tracks: [{
      id: 'readiness-native-track',
      name: 'readiness-native-track',
      sampleId: 'kick',
      steps: Array(128).fill(false),
      parameterLocks: Array(128).fill(null),
      volume: 1,
      pan: 0,
      muted: false,
      soloed: false,
      transpose: 0,
      stepCount: 16,
    }],
    tempo: 120,
    swing: 0,
    version: 1,
  });
  await page.goto(`${API_BASE}/s/${id}`);
  await waitForAppReady(page);
  await page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first()
    .click();
  await page.waitForFunction(() => Boolean(
    (window as unknown as { __audioEngine__?: { getAudioContext?: () => AudioContext | null } })
      .__audioEngine__?.getAudioContext?.()
  ), undefined, { timeout: 30_000 });

  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: THROTTLED_SAMPLE_NETWORK_PROFILE.roundTripSeconds * 1_000,
    downloadThroughput: THROTTLED_SAMPLE_NETWORK_PROFILE.bitsPerSecond / 8,
    uploadThroughput: THROTTLED_SAMPLE_NETWORK_PROFILE.bitsPerSecond / 8,
  });

  let result: {
    initialStates: Record<string, string>;
    hammond: { prioritySeconds: number; backgroundSeconds: number; state: string };
    acousticGuitar: { prioritySeconds: number; backgroundSeconds: number; state: string };
    scenarioSeconds: number;
    resources: Array<{
      name: string;
      durationSeconds: number;
      encodedBodyBytes: number;
      transferBytes: number;
    }>;
  };
  try {
    result = await page.evaluate(async () => {
      const { sampledInstrumentRegistry } = await import('/src/audio/sampled-instrument.ts');
      const hammond = sampledInstrumentRegistry.get('hammond-organ');
      const acousticGuitar = sampledInstrumentRegistry.get('acoustic-guitar');
      if (!hammond || !acousticGuitar) throw new Error('Readiness instruments are not registered');
      const initialStates = {
        hammond: hammond.getLoadState(),
        acousticGuitar: acousticGuitar.getLoadState(),
      };
      performance.clearResourceTimings();
      const scenarioStart = performance.now();
      if (!await hammond.ensureLoaded()) throw new Error('Hammond priority load failed');
      const hammondPriorityAt = performance.now();
      const hammondBackground = hammond.waitForBackgroundLoad().then(state => ({
        state,
        finishedAt: performance.now(),
      }));

      // Hammond's lossless background files occupy the shared six-slot queue.
      // A newly requested acoustic guitar priority root must still become ready
      // inside the foreground budget while that transfer is in progress.
      const acousticPriorityStart = performance.now();
      if (!await acousticGuitar.ensureLoaded()) throw new Error('Acoustic guitar priority load failed');
      const acousticPriorityAt = performance.now();
      const acousticBackground = acousticGuitar.waitForBackgroundLoad().then(state => ({
        state,
        finishedAt: performance.now(),
      }));
      const [hammondDone, acousticDone] = await Promise.all([
        hammondBackground,
        acousticBackground,
      ]);
      const scenarioFinishedAt = Math.max(hammondDone.finishedAt, acousticDone.finishedAt);
      const resources = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .filter(entry => /\/instruments\/(?:hammond-organ|acoustic-guitar)\//.test(entry.name))
        .map(entry => ({
          name: new URL(entry.name).pathname,
          durationSeconds: entry.duration / 1_000,
          encodedBodyBytes: entry.encodedBodySize,
          transferBytes: entry.transferSize,
        }));
      return {
        initialStates,
        hammond: {
          prioritySeconds: (hammondPriorityAt - scenarioStart) / 1_000,
          backgroundSeconds: (hammondDone.finishedAt - hammondPriorityAt) / 1_000,
          state: hammondDone.state,
        },
        acousticGuitar: {
          prioritySeconds: (acousticPriorityAt - acousticPriorityStart) / 1_000,
          backgroundSeconds: (acousticDone.finishedAt - acousticPriorityAt) / 1_000,
          state: acousticDone.state,
        },
        scenarioSeconds: (scenarioFinishedAt - scenarioStart) / 1_000,
        resources,
      };
    });
  } finally {
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }

  console.log('throttled sample readiness', result);
  expect(result.initialStates).toEqual({ hammond: 'idle', acousticGuitar: 'idle' });
  expect(result.hammond.state).toBe('complete');
  expect(result.acousticGuitar.state).toBe('complete');
  expect(result.hammond.prioritySeconds).toBeLessThanOrEqual(
    THROTTLED_SAMPLE_NETWORK_PROFILE.priorityReadySeconds
  );
  expect(result.acousticGuitar.prioritySeconds).toBeLessThanOrEqual(
    THROTTLED_SAMPLE_NETWORK_PROFILE.priorityReadySeconds
  );
  expect(result.hammond.backgroundSeconds).toBeLessThanOrEqual(
    THROTTLED_SAMPLE_NETWORK_PROFILE.backgroundTransferSeconds
  );
  expect(result.acousticGuitar.backgroundSeconds).toBeLessThanOrEqual(
    THROTTLED_SAMPLE_NETWORK_PROFILE.backgroundTransferSeconds
  );
  expect(result.resources.length).toBeGreaterThanOrEqual(30);

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'sample-load-network-readiness.json'),
    JSON.stringify({
      schemaVersion: 1,
      fixture: 'cold-cache Hammond background plus contending acoustic-guitar foreground',
      networkProfile: THROTTLED_SAMPLE_NETWORK_PROFILE,
      ...result,
    }, null, 2) + '\n',
  );
});
