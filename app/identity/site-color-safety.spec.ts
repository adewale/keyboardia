import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { comparePngs } from '../scripts/png-identity.mjs';

function configuredPort(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

const comparisonPort = configuredPort('STACK_A_COMPARISON_PORT', 4179);
const baseProductPort = configuredPort('STACK_A_BASE_PRODUCT_PORT', 4180);
const headProductPort = configuredPort('STACK_A_HEAD_PRODUCT_PORT', 4181);
const writeEvidence = process.env.SITE_COLOR_WRITE_EVIDENCE === '1';
const evidenceRoot = resolve(
  process.cwd(),
  '..',
  'audit',
  'css-consistency',
  'site-color-safety',
  'evidence',
);

function digest(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function comparisonRevisions(page: Page) {
  const response = await page.request.get(`http://127.0.0.1:${comparisonPort}/__stack-a-ready`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ baseSha: string; headSha: string }>;
}

async function preserveEvidence(
  page: Page,
  id: string,
  viewport: { width: number; height: number },
  before: Buffer,
  after: Buffer,
) {
  if (!writeEvidence) return;
  const revisions = await comparisonRevisions(page);
  const diff = comparePngs(before, after);
  const files = {
    before: resolve(evidenceRoot, 'before', `${id}.png`),
    after: resolve(evidenceRoot, 'after', `${id}.png`),
    diff: resolve(evidenceRoot, 'diff', `${id}.png`),
    receipt: resolve(evidenceRoot, 'receipts', `${id}.json`),
  };
  for (const path of Object.values(files)) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(files.before, before);
  writeFileSync(files.after, after);
  writeFileSync(files.diff, diff.diff);
  writeFileSync(files.receipt, `${JSON.stringify({
    id,
    baseRevision: revisions.baseSha,
    headRevision: revisions.headSha,
    generator: { name: 'app/identity/site-color-safety.spec.ts', version: 1 },
    viewport,
    environment: {
      browser: 'chromium',
      browserVersion: page.context().browser()?.version() ?? 'unknown',
      platform: process.platform,
    },
    beforeSha256: digest(before),
    afterSha256: digest(after),
    diffSha256: digest(diff.diff),
    differentPixels: diff.differentPixels,
    rawDifferentPixels: diff.rawDifferentPixels,
    maxObservedChannelDelta: diff.maxObservedChannelDelta,
    result: 'passed',
  }, null, 2)}\n`);
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      if (Number.isFinite(animation.effect?.getTiming().iterations)) animation.finish();
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function neutralizeLandingPlayhead(page: Page) {
  await page.addStyleTag({ content: `
    .landing-cell {
      transition: none !important;
    }
    .landing-cell.playing {
      border-color: var(--color-border) !important;
      border-width: 1px !important;
      box-shadow: none !important;
    }
    .landing-cell.active.playing {
      border-color: var(--color-accent-light) !important;
      box-shadow: none !important;
    }
  ` });
}

async function effectiveTextContrast(locator: Locator) {
  return locator.evaluate((element) => {
    interface Rgba { r: number; g: number; b: number; a: number }
    const parse = (value: string): Rgba => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) throw new Error(`Unsupported computed colour: ${value}`);
      const [r, g, b, a = 1] = match[1].split(',').map(Number);
      return { r, g, b, a };
    };
    const composite = (foreground: Rgba, background: Rgba): Rgba => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1,
    });
    const luminance = (color: Rgba) => {
      const [r, g, b] = [color.r, color.g, color.b]
        .map((channel) => channel / 255)
        .map((channel) => (
          channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        ));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (left: Rgba, right: Rgba) => {
      const lighter = Math.max(luminance(left), luminance(right));
      const darker = Math.min(luminance(left), luminance(right));
      return (lighter + 0.05) / (darker + 0.05);
    };

    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      ancestors.unshift(current);
    }
    let background: Rgba = { r: 18, g: 18, b: 18, a: 1 };
    let opacity = 1;
    for (const ancestor of ancestors) {
      const style = getComputedStyle(ancestor);
      const layer = parse(style.backgroundColor);
      if (layer.a > 0) background = composite(layer, background);
      opacity *= Number(style.opacity || 1);
    }
    const foreground = parse(getComputedStyle(element).color);
    foreground.a *= opacity;
    return contrast(composite(foreground, background), background);
  });
}

async function expectReadable(locator: Locator) {
  const count = await locator.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const target = locator.nth(index);
    const ratio = await effectiveTextContrast(target);
    const text = (await target.textContent())?.trim().slice(0, 80) || '<no text>';
    expect(ratio, `${text} has ${ratio.toFixed(2)}:1 contrast`).toBeGreaterThanOrEqual(4.5);
  }
}

async function captureLanding(page: Page, port: number, hover = false) {
  await page.goto(`http://127.0.0.1:${port}/`);
  const action = page.getByRole('button', { name: 'Start Session' });
  await expect(action).toBeVisible();
  await neutralizeLandingPlayhead(page);
  await settle(page);
  if (hover) await action.hover();
  return page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
}

async function capturePicker(page: Page, side: 'base' | 'head') {
  await page.goto(
    `http://127.0.0.1:${comparisonPort}/${side}/stack-a.html?story=picker`,
  );
  await expect(page.locator('[data-stack-a-ready]')).toBeVisible();
  await settle(page);
  return page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
}

test.describe('Site colour-role safety', () => {
  test('landing copy and primary action remain readable at rest and hover', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 375, height: 812 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${headProductPort}/`);
      await expect(page.getByRole('button', { name: 'Start Session' })).toBeVisible();
      await neutralizeLandingPlayhead(page);
      await settle(page);

      await expectReadable(page.locator([
        '.landing-header h1',
        '.landing-tagline .c',
        '.landing-tagline .r',
        '.landing-tagline .s',
        '.landing-btn.primary',
        '.landing-feature-desc',
        '.cloudflare-footer',
      ].join(', ')));

      const primaryAction = page.getByRole('button', { name: 'Start Session' });
      const after = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
      await primaryAction.hover();
      await expectReadable(primaryAction);
      if (writeEvidence) {
        const before = await captureLanding(page, baseProductPort);
        await preserveEvidence(
          page,
          `landing-${viewport.width}x${viewport.height}`,
          viewport,
          before,
          after,
        );
        if (viewport.width === 1280) {
          const beforeHover = await captureLanding(page, baseProductPort, true);
          const afterHover = await captureLanding(page, headProductPort, true);
          await preserveEvidence(
            page,
            'landing-primary-hover-1280x800',
            viewport,
            beforeHover,
            afterHover,
          );
        }
      }
    }
  });

  test('picker labels and available instrument choices remain readable', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 375, height: 812 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${comparisonPort}/head/stack-a.html?story=picker`);
      await expect(page.locator('[data-stack-a-ready]')).toBeVisible();
      await settle(page);

      await expectReadable(page.locator('.picker-hint, .category-label, .instrument-btn'));
      if (writeEvidence) {
        const after = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
        const before = await capturePicker(page, 'base');
        await preserveEvidence(
          page,
          `picker-${viewport.width}x${viewport.height}`,
          viewport,
          before,
          after,
        );
      }
    }
  });

  test('classified text and filled-control token pairs pass WCAG AA', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${comparisonPort}/head/stack-a.html?story=picker`);
    await expect(page.locator('[data-stack-a-ready]')).toBeVisible();

    const ratios = await page.evaluate(() => {
      const read = (property: 'color' | 'backgroundColor', value: string) => {
        const probe = document.createElement('span');
        probe.style[property] = value;
        document.body.append(probe);
        const result = getComputedStyle(probe)[property];
        probe.remove();
        return result;
      };
      const parse = (value: string) => {
        const [r, g, b] = value.match(/rgba?\(([^)]+)\)/)![1].split(',').map(Number);
        return [r, g, b] as const;
      };
      const luminance = ([r, g, b]: readonly number[]) => {
        const values = [r, g, b]
          .map((channel) => channel / 255)
          .map((channel) => (
            channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
          ));
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
      };
      const contrast = (foreground: string, background: string) => {
        const left = luminance(parse(foreground));
        const right = luminance(parse(background));
        return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
      };
      const color = (token: string) => read('color', `var(${token})`);
      const background = (token: string) => read('backgroundColor', `var(${token})`);
      const hover = background('--color-surface-hover');
      const textTokens = [
        '--color-accent-text', '--color-blue-text', '--color-purple-text',
        '--color-teal-text', '--color-cyan-text', '--color-pink-text',
        '--color-green-text', '--color-orange-text', '--color-yellow-text',
        '--color-red-text', '--color-success-text', '--color-warning-text',
        '--color-secondary-text',
      ];
      const brightFills = [
        '--color-accent', '--color-accent-hover', '--color-blue', '--color-teal',
        '--color-cyan', '--color-green', '--color-orange', '--color-yellow',
        '--color-red', '--color-success', '--color-warning',
      ];
      return {
        text: textTokens.map((token) => ({ token, ratio: contrast(color(token), hover) })),
        bright: brightFills.map((token) => ({
          token,
          ratio: contrast(color('--color-on-bright'), background(token)),
        })),
        purple: contrast(color('--color-on-purple'), background('--color-purple')),
        pink: contrast(color('--color-on-pink'), background('--color-pink')),
      };
    });

    for (const sample of [...ratios.text, ...ratios.bright]) {
      expect(sample.ratio, `${sample.token} has ${sample.ratio.toFixed(2)}:1 contrast`)
        .toBeGreaterThanOrEqual(4.5);
    }
    expect(ratios.purple).toBeGreaterThanOrEqual(4.5);
    expect(ratios.pink).toBeGreaterThanOrEqual(4.5);
  });
});
