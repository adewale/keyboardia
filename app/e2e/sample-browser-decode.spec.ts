import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

interface BrowserDecodeSample {
  instrumentId: string;
  file: string;
  url: string;
}

interface BrowserDecodeResult extends BrowserDecodeSample {
  ok: boolean;
  duration?: number;
  sampleRate?: number;
  channels?: number;
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
        samples?: Array<{ file?: string }>;
      };
      return (manifest.samples ?? [])
        .filter((sample): sample is { file: string } => typeof sample.file === 'string' && sample.file.length > 0)
        .map(sample => ({
          instrumentId,
          file: sample.file,
          url: `/instruments/${encodeURIComponent(instrumentId)}/${encodeUrlPath(sample.file)}`,
        }));
    })
    .sort((a, b) => `${a.instrumentId}/${a.file}`.localeCompare(`${b.instrumentId}/${b.file}`));
}

test('browser decodeAudioData decodes every referenced sampled-instrument file', async ({ page }) => {
  test.setTimeout(120_000);

  const samples = loadReferencedSamples();
  await page.goto('/');

  const results = await page.evaluate(async (items: BrowserDecodeSample[]): Promise<BrowserDecodeResult[]> => {
    const context = new OfflineAudioContext(1, 1, 44100);
    const out: BrowserDecodeResult[] = [];
    for (const item of items) {
      try {
        const response = await fetch(item.url);
        if (!response.ok) {
          out.push({ ...item, ok: false, error: `HTTP ${response.status}` });
          continue;
        }
        const buffer = await response.arrayBuffer();
        const decoded = await context.decodeAudioData(buffer.slice(0));
        out.push({
          ...item,
          ok: true,
          duration: decoded.duration,
          sampleRate: decoded.sampleRate,
          channels: decoded.numberOfChannels,
        });
      } catch (error) {
        out.push({ ...item, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
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
});
