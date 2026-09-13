import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('renders and measures every generated picker voice', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'deterministic OfflineAudioContext audit is Chromium-only');
  test.setTimeout(15 * 60_000);
  const implementation = process.env.GENERATED_QUALITY_IMPLEMENTATION === 'before'
    ? 'before'
    : 'after';

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async auditImplementation => {
    const { runGeneratedCatalogueAudit } = await import(
      '/src/test/generated-instrument-quality-browser.ts'
    );
    return runGeneratedCatalogueAudit(auditImplementation);
  }, implementation);

  expect(report.voiceCount).toBe(73);
  expect(Object.keys(report.voices)).toHaveLength(73);
  expect(report.conditionRenderCount).toBe(438);

  const output = resolve(
    process.cwd(),
    process.env.GENERATED_QUALITY_OUTPUT
      ?? `test-results/generated-instrument-quality-${implementation}.json`,
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    ...report,
  }, null, 2)}\n`);
});
