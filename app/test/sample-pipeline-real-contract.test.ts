import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { runFullPipeline } from '../scripts/sample-pipeline-cli';

const currentRoot = path.resolve('public/__sample-pipeline-fixtures-real/current');
const temporaryFiles: string[] = [];
const runRealContract = process.env.RUN_REAL_SAMPLE_PIPELINE === '1'
  && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

function prepareRecipe(): string {
  fs.mkdirSync(currentRoot, { recursive: true });
  fs.copyFileSync('test/fixtures/sample-pipeline/current/C4.wav', path.join(currentRoot, 'C4.wav'));
  fs.copyFileSync('test/fixtures/sample-pipeline/current/manifest.json', path.join(currentRoot, 'manifest.json'));
  const recipe = JSON.parse(fs.readFileSync('test/fixtures/sample-pipeline/recipe.json', 'utf8')) as {
    delivery: Record<string, unknown>;
    mapping: { samples: Array<{ output: string }> };
    evidence: { currentInstrumentDir: string; anchors: Array<{ candidateOutput: string }> };
  };
  // MP3 is the browser-portable lossy contract on Playwright's Linux WebKit;
  // 24-bit WAV decodes locally but Linux WebKit returns a zero-length buffer.
  recipe.delivery = {
    codec: 'mp3',
    container: 'mp3',
    bitrateKbps: 128,
    sampleRate: 44100,
    channels: { mode: 'preserve' },
  };
  recipe.mapping.samples[0].output = 'C4.mp3';
  for (const anchor of recipe.evidence.anchors) anchor.candidateOutput = 'C4.mp3';
  recipe.evidence.currentInstrumentDir = 'public/__sample-pipeline-fixtures-real/current';
  const filename = path.join(os.tmpdir(), `keyboardia-real-pipeline-${process.pid}.json`);
  fs.writeFileSync(filename, JSON.stringify(recipe));
  temporaryFiles.push(filename);
  return filename;
}

afterEach(() => {
  fs.rmSync(path.resolve('public/__sample-pipeline/sample-pipeline-fixture-real'), { recursive: true, force: true });
  fs.rmSync(path.resolve('public/__sample-pipeline-fixtures-real'), { recursive: true, force: true });
  for (const filename of temporaryFiles.splice(0)) fs.rmSync(filename, { force: true });
});

describe('real lossless-master delivery and browser contract', () => {
  it.skipIf(!runRealContract)('uses real ffmpeg once and decodes the exact output in Chromium and WebKit', async () => {
    const recipePath = prepareRecipe();
    let result: Awaited<ReturnType<typeof runFullPipeline>>;
    try {
      result = await runFullPipeline({
        command: 'full',
        recipePath,
        sourceRoot: 'test/fixtures/sample-pipeline',
        output: 'public/__sample-pipeline/sample-pipeline-fixture-real/candidate',
        dryRun: false,
        promote: false,
      }, { log: () => undefined });
    } catch (error) {
      const report = path.resolve('public/__sample-pipeline/sample-pipeline-fixture-real/reports/browser-decode.json');
      if (fs.existsSync(report)) console.error('Browser contract report:', fs.readFileSync(report, 'utf8'));
      throw error;
    }

    expect(result.state).toBe('decision-ready');
    expect(result.browser).toMatchObject({ chromium: true, webkit: true });
    expect(result.browser?.entries).toHaveLength(2);
    expect(result.browser?.entries.every(entry => entry.ok && (entry.energy ?? 0) > 0)).toBe(true);
    expect(result.rendered?.report.toolchain.fingerprint).toMatch(/^ffmpeg version/i);
    expect(result.rendered?.report.measurements).toEqual([
      expect.objectContaining({
        file: 'C4.mp3',
        source: expect.objectContaining({ codec: 'pcm_s16le', sampleRate: 44100, channels: 1 }),
        delivery: expect.objectContaining({ codec: 'mp3', sampleRate: 44100, channels: 1 }),
      }),
    ]);
    expect(result.rendered?.outputs).toHaveLength(1);
    expect(result.rendered?.outputs[0].sha256).not.toBe(
      '1ee61b14e152b38506327dc1492f196a78586e7fabf1b677d2576b1c0ac42348',
    );
  }, 120_000);
});
