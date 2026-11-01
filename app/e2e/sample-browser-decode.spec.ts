import { expect, test } from './global-setup';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'node:child_process';
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
  maxAdaptiveCodecDelay?: number;
}

interface BrowserDecodeResult extends BrowserDecodeSample {
  ok: boolean;
  duration?: number;
  sampleRate?: number;
  channels?: number;
  leadingSilenceMs?: number;
  error?: string;
}

interface SubjectState {
  commit: string;
  treeStatus: string;
}

function requireCleanEvidenceSubject(): boolean {
  const value = process.env.KEYBOARDIA_REQUIRE_CLEAN_AUDIO_EVIDENCE;
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new Error('KEYBOARDIA_REQUIRE_CLEAN_AUDIO_EVIDENCE must be 0 or 1');
}

function subjectState(): SubjectState {
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const subjectCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  const trackedChanges = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  ).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(subjectCommit)) {
    throw new Error('Browser-decode report requires a full Git subject commit');
  }
  return { commit: subjectCommit, treeStatus: trackedChanges };
}

function assertCleanEvidenceSubject(state: SubjectState, phase: 'start' | 'end'): void {
  if (state.treeStatus.length > 0) {
    throw new Error(
      `Browser-decode evidence requires a clean subject tree at ${phase}; found:\n${state.treeStatus}`,
    );
  }
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
        maxAdaptiveCodecDelay?: number;
        samples?: Array<{ file?: string; startOffset?: number }>;
      };
      return (manifest.samples ?? [])
        .filter((sample): sample is { file: string } => typeof sample.file === 'string' && sample.file.length > 0)
        .map(sample => ({
          instrumentId,
          file: sample.file,
          url: `/instruments/${encodeURIComponent(instrumentId)}/${encodeUrlPath(sample.file)}`,
          startOffset: sample.startOffset ?? manifest.startOffset ?? 0,
          maxAdaptiveCodecDelay: manifest.maxAdaptiveCodecDelay,
        }));
    })
    .sort((a, b) => `${a.instrumentId}/${a.file}`.localeCompare(`${b.instrumentId}/${b.file}`));
}

test('browser decodeAudioData decodes every referenced sampled-instrument file', async ({ page, browserName }) => {
  test.setTimeout(120_000);

  const requireCleanSubject = requireCleanEvidenceSubject();
  const startingSubject = subjectState();
  if (requireCleanSubject) assertCleanEvidenceSubject(startingSubject, 'start');
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
    // Match SampledInstrument.loadedSampleFromMapping: percussion and AAC
    // deliveries compensate bounded decoder priming at playback time.
    const adaptive = isDrumInstrument(`sampled:${expected.instrumentId}`)
      || browser!.file.toLowerCase().endsWith('.m4a');
    const browserStart = compensatedSampleStartOffset(
      browser!.startOffset,
      browser!.leadingSilenceMs! / 1000,
      adaptive,
      browser!.maxAdaptiveCodecDelay,
    ) ?? 0;
    const nodeStart = compensatedSampleStartOffset(
      browser!.startOffset,
      expected.nodeLeadingSilenceMs / 1000,
      adaptive,
      browser!.maxAdaptiveCodecDelay,
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
      browser.maxAdaptiveCodecDelay,
    ) ?? 0;
    const effectiveOnsetMs = Math.max(0, browser.leadingSilenceMs! - start * 1000);
    expect(
      effectiveOnsetMs,
      `${browser.instrumentId}/${browser.file} exceeds the runtime percussion-onset budget`,
    ).toBeLessThanOrEqual(MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS * 1000 + 1e-6);
  }

  // A manifest-level codec-delay allowance applies to every mapped file, so
  // prove the whole scope rather than only the representative calibration
  // note. This test is intentionally run in both Chromium and WebKit: their
  // AAC timelines differ, and the adaptive trim must preserve either attack.
  const configuredAdaptiveSamples = results.filter(result =>
    result.ok && result.maxAdaptiveCodecDelay !== undefined
  );
  expect(configuredAdaptiveSamples.length).toBeGreaterThan(0);
  for (const browser of configuredAdaptiveSamples) {
    const adaptive = isDrumInstrument(`sampled:${browser.instrumentId}`)
      || browser.file.toLowerCase().endsWith('.m4a');
    const start = compensatedSampleStartOffset(
      browser.startOffset,
      browser.leadingSilenceMs! / 1000,
      adaptive,
      browser.maxAdaptiveCodecDelay,
    ) ?? 0;
    const effectiveOnsetMs = Math.max(0, browser.leadingSilenceMs! - start * 1000);
    expect(
      effectiveOnsetMs,
      `${browser.instrumentId}/${browser.file} exceeds its configured adaptive-onset budget`,
    ).toBeLessThanOrEqual(MAX_EFFECTIVE_PERCUSSION_ONSET_SECONDS * 1000 + 1e-6);
    expect(
      start * 1000,
      `${browser.instrumentId}/${browser.file} adaptive trim crosses its first audible frame`,
    ).toBeLessThanOrEqual(browser.leadingSilenceMs! + (1_000 / browser.sampleRate!));
  }

  // A fixed trim beyond the first audible browser frame necessarily removes
  // real attack PCM. Codec priming must use the adaptive path above instead,
  // because AAC timelines differ between Node, Chromium, and WebKit.
  for (const browser of results.filter(result => result.ok && result.startOffset > 0)) {
    expect(
      browser.startOffset * 1000,
      `${browser.instrumentId}/${browser.file} fixed startOffset clips the browser attack`,
    ).toBeLessThanOrEqual(browser.leadingSilenceMs! + (1_000 / browser.sampleRate!));
  }

  const browserIdentity = {
    name: browserName,
    version: page.context().browser()?.version() ?? 'unknown',
    userAgent: await page.evaluate(() => navigator.userAgent),
  };
  const endingSubject = subjectState();
  if (requireCleanSubject) assertCleanEvidenceSubject(endingSubject, 'end');
  if (endingSubject.commit !== startingSubject.commit) {
    throw new Error(
      `Browser-decode evidence subject commit changed during capture: `
      + `${startingSubject.commit} -> ${endingSubject.commit}`,
    );
  }
  const subjectTreeClean = startingSubject.treeStatus.length === 0
    && endingSubject.treeStatus.length === 0
    && endingSubject.commit === startingSubject.commit;
  fs.mkdirSync('reports/instrument-quality', { recursive: true });
  fs.writeFileSync(
    `reports/instrument-quality/browser-decode-${browserName}.json`,
    `${JSON.stringify({
      schemaVersion: 2,
      claim: 'cross-decoder-sample-onset-evidence',
      generatedAt: new Date().toISOString(),
      subjectCommit: startingSubject.commit,
      subjectTreeClean,
      browser: browserIdentity,
      results,
    }, null, 2)}\n`,
  );
});
