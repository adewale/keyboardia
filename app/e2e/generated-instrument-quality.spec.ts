import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const HARNESS_FILES = [
  'src/test/audio-measures.ts',
  'src/test/generated-instrument-quality-browser.ts',
  'src/test/generated-instrument-quality-gates.ts',
  'src/test/generated-instrument-quality-profiles.ts',
] as const;

function harnessSha256(): string {
  const hash = createHash('sha256');
  for (const path of HARNESS_FILES) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(resolve(process.cwd(), path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

test('renders and measures every generated picker voice', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'deterministic OfflineAudioContext audit is Chromium-only');
  test.setTimeout(15 * 60_000);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const { report, failures } = await page.evaluate(async () => {
    const { runGeneratedCatalogueAudit } = await import(
      '/src/test/generated-instrument-quality-browser.ts'
    );
    const { generatedQualityGateViolations } = await import(
      '/src/test/generated-instrument-quality-gates.ts'
    );
    const currentReport = await runGeneratedCatalogueAudit();
    return {
      report: currentReport,
      failures: generatedQualityGateViolations(currentReport),
    };
  });

  expect(report.voiceCount).toBe(73);
  expect(Object.keys(report.voices)).toHaveLength(73);
  expect(report.conditionRenderCount).toBe(438);
  expect(failures, failures.join('\n')).toEqual([]);

  if (process.env.GENERATED_QUALITY_OUTPUT) {
    const output = resolve(process.cwd(), process.env.GENERATED_QUALITY_OUTPUT);
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const sourceTreeDirty = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf8' },
    ).trim().length > 0;
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      provenance: {
        revision,
        sourceTreeDirty,
        harnessSha256: harnessSha256(),
        browserName,
        browserVersion: page.context().browser()?.version() ?? 'unknown',
        command: 'npm run audit:generated-quality:receipt',
      },
      ...report,
    }, null, 2)}\n`);
  }
});
