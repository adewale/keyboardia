import { expect, test } from './global-setup';
import fs from 'fs';
import path from 'path';
import {
  MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS,
  compensatedSampleStartOffset,
} from '../src/audio/sample-onset';
import { isDrumInstrument } from '../src/shared/instrument-classification';

interface BrowserDecodeSample {
  instrumentId: string;
  file: string;
  url: string;
  startOffset: number;
}

interface BrowserDecodeResult extends BrowserDecodeSample {
  ok: boolean;
  duration?: number;
  sampleRate?: number;
  channels?: number;
  leadingSilenceMs?: number;
  error?: string;
}

function encodeUrlPath(value: string): string {
  return value.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function loadReferencedSamples(): BrowserDecodeSample[] {
  const root = path.join(process.cwd(), 'public/instruments');
  return fs.readdirSync(root)
    .filter(instrumentId => fs.statSync(path.join(root, instrumentId)).isDirectory())
    .flatMap(instrumentId => {
      const manifestPath = path.join(root, instrumentId, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return [];
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        startOffset?: number;
        samples?: Array<{ file?: string; startOffset?: number }>;
      };
      return (manifest.samples ?? [])
        .filter((sample): sample is { file: string } => typeof sample.file === 'string' && sample.file.length > 0)
        .map(sample => ({
          instrumentId,
          file: sample.file,
          url: `/instruments/${encodeURIComponent(instrumentId)}/${encodeUrlPath(sample.file)}`,
          startOffset: sample.startOffset ?? manifest.startOffset ?? 0,
        }));
    })
    .sort((a, b) => `${a.instrumentId}/${a.file}`.localeCompare(`${b.instrumentId}/${b.file}`));
}

test('browser decodeAudioData decodes every referenced sampled-instrument file', async ({ page }) => {
  test.setTimeout(120_000);

  const samples = loadReferencedSamples();
  await page.goto('/');

  // Codec precondition.
  //
  // The catalogue is .mp3 and .m4a (AAC). Chromium builds without proprietary
  // codecs decode the mp3s fine and fail every single AAC file with the same
  // opaque "Unable to decode audio data". That looks identical to the sample
  // pipeline having produced corrupt output, and it is what a Chromium lacking
  // AAC reports — so check the capability first and say so plainly, rather than
  // letting a browser limitation masquerade as hundreds of bad assets.
  //
  // Playwright's bundled Chromium ships the codecs; a system/open-source build
  // may not. If this fails, the environment is wrong, not the samples.
  const codecSupport = await page.evaluate(() => {
    const probe = document.createElement('audio');
    return {
      mp3: probe.canPlayType('audio/mpeg'),
      aac: probe.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
    };
  });

  const referencedExtensions = new Set(
    samples.map(sample => path.extname(sample.file).toLowerCase())
  );

  if (referencedExtensions.has('.mp3')) {
    expect(
      codecSupport.mp3,
      `this browser cannot decode MP3 (canPlayType: "${codecSupport.mp3}"). ` +
        'Run with Playwright\'s bundled Chromium (npx playwright install chromium).'
    ).not.toBe('');
  }

  if (referencedExtensions.has('.m4a')) {
    expect(
      codecSupport.aac,
      `this browser cannot decode AAC/m4a (canPlayType: "${codecSupport.aac}"). ` +
        'Every .m4a sample would fail with "Unable to decode audio data" — a ' +
        'missing codec, not a bad asset. Run with Playwright\'s bundled Chromium ' +
        '(npx playwright install chromium), not a system or open-source build.'
    ).not.toBe('');
  }

  const results = await page.evaluate(async (items: BrowserDecodeSample[]): Promise<BrowserDecodeResult[]> => {
    const context = new OfflineAudioContext(1, 1, 44100);
    const out = new Array<BrowserDecodeResult>(items.length);
    let nextIndex = 0;

    async function decodeOne(index: number): Promise<void> {
      const item = items[index];
      try {
        const response = await fetch(item.url);
        if (!response.ok) {
          out[index] = { ...item, ok: false, error: `HTTP ${response.status}` };
          return;
        }
        const buffer = await response.arrayBuffer();
        const decoded = await context.decodeAudioData(buffer.slice(0));
        let peak = 0;
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          for (const value of decoded.getChannelData(channel)) peak = Math.max(peak, Math.abs(value));
        }
        const threshold = Math.max(10 ** (-70 / 20), peak * 10 ** (-50 / 20));
        let onsetFrame = decoded.length;
        for (let frame = 0; frame < decoded.length; frame++) {
          let active = false;
          for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
            if (Math.abs(decoded.getChannelData(channel)[frame]) > threshold) {
              active = true;
              break;
            }
          }
          if (active) {
            onsetFrame = frame;
            break;
          }
        }
        out[index] = {
          ...item,
          ok: true,
          duration: decoded.duration,
          sampleRate: decoded.sampleRate,
          channels: decoded.numberOfChannels,
          leadingSilenceMs: onsetFrame * 1000 / decoded.sampleRate,
        };
      } catch (error) {
        out[index] = { ...item, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    async function worker(): Promise<void> {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        await decodeOne(index);
      }
    }

    const concurrency = Math.min(8, Math.max(1, items.length));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return out;
  }, samples);

  fs.mkdirSync('test-results/sample-quality', { recursive: true });
  fs.writeFileSync(
    'test-results/sample-quality/browser-decode.json',
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`
  );

  const failures = results.filter(result => !result.ok);
  expect(results).toHaveLength(samples.length);
  expect(failures).toEqual([]);

  const calibration = JSON.parse(
    fs.readFileSync('scripts/sample-onset-calibration.json', 'utf-8'),
  ) as {
    toleranceMs: number;
    effectiveOnsetBudgetMs: number;
    samples: Array<{ instrumentId: string; file: string; nodeLeadingSilenceMs: number }>;
  };
  for (const expected of calibration.samples) {
    const browser = results.find(result =>
      result.instrumentId === expected.instrumentId && result.file === expected.file
    );
    expect(browser, `${expected.instrumentId}/${expected.file} was not decoded`).toBeDefined();
    const adaptive = isDrumInstrument(`sampled:${expected.instrumentId}`);
    const browserStart = compensatedSampleStartOffset(
      browser!.startOffset,
      browser!.leadingSilenceMs! / 1000,
      adaptive,
    ) ?? 0;
    const nodeStart = compensatedSampleStartOffset(
      browser!.startOffset,
      expected.nodeLeadingSilenceMs / 1000,
      adaptive,
    ) ?? 0;
    const browserEffectiveOnset = Math.max(0, browser!.leadingSilenceMs! - browserStart * 1000);
    const nodeEffectiveOnset = Math.max(0, expected.nodeLeadingSilenceMs - nodeStart * 1000);
    expect(
      Math.abs(browserEffectiveOnset - nodeEffectiveOnset),
      `${expected.instrumentId}/${expected.file} effective browser and Node onset disagree`,
    ).toBeLessThanOrEqual(calibration.toleranceMs);
    expect(browserEffectiveOnset)
      .toBeLessThanOrEqual(calibration.effectiveOnsetBudgetMs);
  }

  // Playback adapts every sampled percussion instrument, not just the small
  // cross-decoder calibration subset above. Exercise that complete runtime
  // scope so adding a new drum file cannot silently widen the untested set.
  const sampledPercussion = results.filter(result =>
    result.ok && isDrumInstrument(`sampled:${result.instrumentId}`)
  );
  expect(sampledPercussion.length).toBeGreaterThan(0);
  for (const browser of sampledPercussion) {
    const start = compensatedSampleStartOffset(
      browser.startOffset,
      browser.leadingSilenceMs! / 1000,
      true,
    ) ?? 0;
    const effectiveOnsetMs = Math.max(0, browser.leadingSilenceMs! - start * 1000);
    expect(
      effectiveOnsetMs,
      `${browser.instrumentId}/${browser.file} exceeds the runtime percussion-onset budget`,
    ).toBeLessThanOrEqual(MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS * 1000 + 1e-6);
  }
});
