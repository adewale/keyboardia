import { test, expect, getBaseUrl, waitForAppReady } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

test('exports a valid MIDI download through the real browser Worker', async ({ page, request }) => {
  await page.addInitScript(() => {
    // Headless Chromium may expose the File System Access API, whose native
    // picker cannot be driven by Playwright. Exercise the documented download
    // fallback while retaining the real browser Worker path.
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });

    const BrowserWorker = window.Worker;
    const observedWorkerUrls: string[] = [];
    const respondedWorkerUrls: string[] = [];
    class ObservedWorker extends BrowserWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        const url = String(scriptURL);
        observedWorkerUrls.push(url);
        this.addEventListener('message', () => respondedWorkerUrls.push(url), { once: true });
      }
    }
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: ObservedWorker,
    });
    Object.defineProperty(window, '__observedWorkerUrls', {
      configurable: true,
      value: observedWorkerUrls,
    });
    Object.defineProperty(window, '__respondedWorkerUrls', {
      configurable: true,
      value: respondedWorkerUrls,
    });
  });

  const { id } = await createSessionWithRetry(request, {
    tracks: [{
      id: 'midi-export-track',
      name: 'Export Hi-Hat',
      sampleId: 'hihat',
      steps: [true, ...Array(127).fill(false)],
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
      transpose: 0,
      stepCount: 16,
    }],
    tempo: 120,
    swing: 0,
    version: 1,
  });

  await page.goto(`${API_BASE}/s/${id}`);
  await waitForAppReady(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MIDI' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const midi = Buffer.concat(chunks);

  expect(download.suggestedFilename()).toMatch(/\.mid$/);
  expect(midi.length).toBeGreaterThan(20);
  expect(midi.subarray(0, 4).toString('ascii')).toBe('MThd');
  const workerEvidence = await page.evaluate(() => {
    const observedWindow = window as typeof window & {
      __observedWorkerUrls: string[];
      __respondedWorkerUrls: string[];
    };
    return {
      constructed: observedWindow.__observedWorkerUrls,
      responded: observedWindow.__respondedWorkerUrls,
    };
  });
  const observedWorkerUrls = workerEvidence.constructed;
  expect(observedWorkerUrls).toContainEqual(expect.stringContaining('midiExport.worker'));
  expect(workerEvidence.responded).toEqual(observedWorkerUrls);
});
