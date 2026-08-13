import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { comparePngs } from '../scripts/png-identity.mjs';
import {
  type StackAAction,
  type StackAExpectation,
  type StackAState,
} from './manifest';
import {
  STACK_B_MIGRATION_BASE_SHA,
  stackBDecorativeProperties,
  stackBFullAppStates,
  stackBStates,
} from './stack-b-manifest';

const evidenceRoot = resolve(process.cwd(), '..', 'audit', 'css-consistency', 'stack-b-evidence');
const writeEvidence = process.env.STACK_B_WRITE_EVIDENCE === '1';
const holby = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/demo-sessions/holby.json'), 'utf8')) as {
  name: string;
  state: unknown;
};
const holbyId = '8444f694-0a9a-41f3-815d-b9c6eb518c50';

const styleProperties = [
  'display', 'position', 'visibility', 'opacity', 'color', 'backgroundColor',
  'backgroundImage', 'borderTopColor', 'borderRightColor', 'borderBottomColor',
  'borderLeftColor', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle',
  'borderLeftStyle', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
  'borderLeftWidth', 'borderRadius', 'boxShadow', 'fontFamily', 'fontSize',
  'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop',
  'marginRight', 'marginBottom', 'marginLeft', 'gap', 'cursor', 'overflowX',
  'overflowY', 'transform', 'transitionProperty', 'transitionDuration',
  'transitionTimingFunction', 'animationName', 'animationDuration',
  'outlineColor', 'outlineOffset', 'outlineStyle', 'outlineWidth',
] as const;

type Side = 'base' | 'head';

interface ElementContract {
  index: number;
  signature: string;
  dropdownTarget: boolean;
  rect: { x: number; y: number; width: number; height: number };
  values: Record<string, string>;
}

interface TargetRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  halo: number;
  kind: 'trigger' | 'menu';
}

interface CapturedContract {
  screenshot: Buffer;
  aria: string;
  elements: ElementContract[];
  regions: TargetRegion[];
}

function stateUrl(side: Side, story: string, variant?: string) {
  const query = new URLSearchParams({ story });
  if (variant) query.set('variant', variant);
  return `/${side}/stack-a.html?${query.toString()}`;
}

async function performAction(page: Page, action: StackAAction) {
  if (action.type === 'press') {
    await page.keyboard.press(action.key);
    return;
  }
  const locator = page.locator(action.selector).nth(action.index ?? 0);
  if (action.type === 'focus') await locator.focus();
  else if (action.type === 'hover') await locator.hover();
  else await locator.click();
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function settleForScreenshot(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    for (const animation of document.getAnimations()) {
      if (!Number.isFinite(animation.effect?.getTiming().iterations)) {
        animation.pause();
        animation.currentTime = 0;
      } else {
        animation.finish();
      }
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function assertExpectation(page: Page, expectation: StackAExpectation) {
  const locator = page.locator(expectation.selector);
  if (expectation.count !== undefined) await expect(locator).toHaveCount(expectation.count);
  const target = locator.first();
  if (expectation.visible) await expect(target).toBeVisible();
  if (expectation.attribute) {
    await expect(target).toHaveAttribute(expectation.attribute.name, expectation.attribute.value);
  }
  if (expectation.focused) await expect(target).toBeFocused();
  if (expectation.text !== undefined) await expect(target).toContainText(expectation.text);
}

async function readPageContract(page: Page): Promise<CapturedContract> {
  const aria = await page.locator('body').ariaSnapshot();
  const elements = await page.locator('body').evaluate((body, properties) => {
    const all = [body, ...body.querySelectorAll<HTMLElement>('*')];
    return all.flatMap((element, index) => {
      const computed = getComputedStyle(element);
      if (computed.display === 'none' || computed.visibility === 'hidden') return [];
      const rect = element.getBoundingClientRect();
      const className = typeof element.className === 'string' ? element.className : '';
      return [{
        index,
        signature: [
          element.tagName.toLowerCase(),
          className,
          element.getAttribute('role') ?? '',
          element.getAttribute('data-testid') ?? '',
        ].join('|'),
        dropdownTarget: element.closest('.dropdown-trigger, .dropdown-menu') !== null,
        rect: {
          x: Math.round(rect.x * 1000) / 1000,
          y: Math.round(rect.y * 1000) / 1000,
          width: Math.round(rect.width * 1000) / 1000,
          height: Math.round(rect.height * 1000) / 1000,
        },
        values: Object.fromEntries(properties.map((property) => [property, computed[property]])),
      }];
    });
  }, styleProperties) as ElementContract[];
  const regions = await page.locator('.dropdown-trigger, .dropdown-menu').evaluateAll((targets) => (
    targets.flatMap((target) => {
      const computed = getComputedStyle(target);
      if (computed.display === 'none' || computed.visibility === 'hidden') return [];
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return [];
      const isMenu = target.classList.contains('dropdown-menu');
      return [{
        x: Math.round(rect.x * 1000) / 1000,
        y: Math.round(rect.y * 1000) / 1000,
        width: Math.round(rect.width * 1000) / 1000,
        height: Math.round(rect.height * 1000) / 1000,
        halo: isMenu ? 40 : 9,
        kind: isMenu ? 'menu' : 'trigger',
      }];
    })
  )) as TargetRegion[];
  const screenshot = await page.screenshot({
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
  return { screenshot, aria, elements, regions };
}

async function captureCatalogue(page: Page, side: Side, state: StackAState) {
  await page.setViewportSize(state.viewport);
  await page.emulateMedia({ reducedMotion: state.reducedMotion ?? 'no-preference' });
  await page.goto(stateUrl(side, state.story, state.variant));
  await expect(page.locator('[data-stack-a-ready]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(0, 0);
  for (const action of state.actions ?? []) {
    await performAction(page, action);
    await settle(page);
  }
  for (const expectation of state.expectations) await assertExpectation(page, expectation);
  if (!state.actions?.some((action) => action.type === 'hover')) await page.mouse.move(0, 0);
  await settleForScreenshot(page);
  return readPageContract(page);
}

async function installProductFixture(page: Page) {
  await page.route('**/api/sessions/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET' && pathname === `/api/sessions/${holbyId}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: holbyId,
          name: holby.name,
          state: holby.state,
          createdAt: 1783638000000,
          updatedAt: 1783638000000,
          lastAccessedAt: 1783638000000,
          remixedFrom: null,
          remixedFromName: null,
          remixCount: 0,
          immutable: false,
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"fixture route"}' });
  });
}

async function captureFullApp(
  page: Page,
  side: Side,
  state: (typeof stackBFullAppStates)[number],
) {
  await page.setViewportSize(state.viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installProductFixture(page);
  const port = side === 'base' ? 4180 : 4181;
  await page.goto(`http://127.0.0.1:${port}/s/${holbyId}`);
  if (state.action === 'hidden-portrait') {
    await expect(page.locator('.portrait-track-row')).toHaveCount(10, { timeout: 15_000 });
    await expect(page.locator('.dropdown-trigger:visible')).toHaveCount(0);
  } else if (state.action === 'hidden-landscape') {
    await expect(page.locator('.track-row')).toHaveCount(10, { timeout: 15_000 });
    await expect(page.locator('.dropdown-trigger:visible')).toHaveCount(0);
  } else {
    await expect(page.locator('.track-row')).toHaveCount(10, { timeout: 15_000 });
    await page.locator('.track-row .step-count-trigger').first().click();
    await expect(page.locator('.step-count-menu')).toBeVisible();
  }
  await page.addStyleTag({
    // The static production-build server intentionally has no WebSocket.
    // Remove only live presence/status from layout so its reconnect timer
    // cannot move stable product pixels between contract capture and screenshot.
    content: '.avatar-stack, .connection-status { display: none !important; }',
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(0, 0);
  await settleForScreenshot(page);
  return readPageContract(page);
}

function styleViolations(base: CapturedContract, head: CapturedContract) {
  const violations: string[] = [];
  if (base.elements.length !== head.elements.length) {
    return [`visible element count changed: ${base.elements.length} → ${head.elements.length}`];
  }
  for (let index = 0; index < base.elements.length; index += 1) {
    const before = base.elements[index];
    const after = head.elements[index];
    if (after.signature !== before.signature) {
      violations.push(`element ${index} changed identity: ${before.signature} → ${after.signature}`);
      continue;
    }
    if (JSON.stringify(after.rect) !== JSON.stringify(before.rect)) {
      violations.push(`element ${index} changed geometry: ${JSON.stringify(before.rect)} → ${JSON.stringify(after.rect)}`);
    }
    for (const property of styleProperties) {
      if (after.values[property] === before.values[property]) continue;
      if (!before.dropdownTarget || !after.dropdownTarget || !stackBDecorativeProperties.has(property)) {
        violations.push(
          `element ${index} changed non-approved ${property}: ${before.values[property]} → ${after.values[property]}`,
        );
      }
    }
  }
  return violations;
}

function unexpectedChangedPixels(beforeBuffer: Buffer, afterBuffer: Buffer, regions: TargetRegion[]) {
  const before = PNG.sync.read(beforeBuffer);
  const after = PNG.sync.read(afterBuffer);
  if (before.width !== after.width || before.height !== after.height) return 1;
  let unexpected = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const offset = (before.width * y + x) << 2;
      let maxDelta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        maxDelta = Math.max(maxDelta, Math.abs(before.data[offset + channel] - after.data[offset + channel]));
      }
      if (maxDelta <= 6) continue;
      const approved = regions.some((region) => (
        x >= region.x - region.halo
        && x <= region.x + region.width + region.halo
        && y >= region.y - region.halo
        && y <= region.y + region.height + region.halo
      ));
      if (!approved) unexpected += 1;
    }
  }
  return unexpected;
}

function digest(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function parseRgb(value: string) {
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Unsupported computed color: ${value}`);
  return [channels[0], channels[1], channels[2], channels[3] ?? 1];
}

function relativeLuminance([red, green, blue]: number[]) {
  const [r, g, b] = [red, green, blue]
    .map((channel) => channel / 255)
    .map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string) {
  const [backgroundRed, backgroundGreen, backgroundBlue] = parseRgb(background);
  const [foregroundRed, foregroundGreen, foregroundBlue, alpha] = parseRgb(foreground);
  const compositedForeground = [
    foregroundRed * alpha + backgroundRed * (1 - alpha),
    foregroundGreen * alpha + backgroundGreen * (1 - alpha),
    foregroundBlue * alpha + backgroundBlue * (1 - alpha),
  ];
  const foregroundLuminance = relativeLuminance(compositedForeground);
  const backgroundLuminance = relativeLuminance([backgroundRed, backgroundGreen, backgroundBlue]);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function cropForReview(buffer: Buffer, regions: TargetRegion[]) {
  if (regions.length === 0) return buffer;
  const source = PNG.sync.read(buffer);
  const left = Math.max(0, Math.floor(Math.min(...regions.map((region) => region.x - region.halo - 16))));
  const top = Math.max(0, Math.floor(Math.min(...regions.map((region) => region.y - region.halo - 28))));
  const right = Math.min(
    source.width,
    Math.ceil(Math.max(...regions.map((region) => region.x + region.width + region.halo + 16))),
  );
  const bottom = Math.min(
    source.height,
    Math.ceil(Math.max(...regions.map((region) => region.y + region.height + region.halo + 16))),
  );
  const target = new PNG({ width: right - left, height: bottom - top });
  PNG.bitblt(source, target, left, top, target.width, target.height, 0, 0);
  return PNG.sync.write(target);
}

async function baseSha(page: Page) {
  const response = await page.request.get('http://127.0.0.1:4179/__stack-a-ready');
  expect(response.ok()).toBe(true);
  return (await response.json() as { baseSha: string }).baseSha;
}

async function preserveEvidence(
  group: 'catalogue' | 'full-app',
  id: string,
  baseRevision: string,
  base: CapturedContract,
  head: CapturedContract,
  diff: ReturnType<typeof comparePngs>,
  testInfo: TestInfo,
) {
  await Promise.all([
    testInfo.attach(`${id}-before`, { body: base.screenshot, contentType: 'image/png' }),
    testInfo.attach(`${id}-after`, { body: head.screenshot, contentType: 'image/png' }),
    testInfo.attach(`${id}-diff`, { body: diff.diff, contentType: 'image/png' }),
  ]);
  if (!writeEvidence) return;
  const filenames = {
    before: resolve(evidenceRoot, 'before', `${group}--${id}.png`),
    after: resolve(evidenceRoot, 'after', `${group}--${id}.png`),
    diff: resolve(evidenceRoot, 'diff', `${group}--${id}.png`),
    receipt: resolve(evidenceRoot, 'receipts', `${group}--${id}.json`),
    reviewBefore: resolve(evidenceRoot, 'review', 'before', `${group}--${id}.png`),
    reviewAfter: resolve(evidenceRoot, 'review', 'after', `${group}--${id}.png`),
  };
  for (const filename of Object.values(filenames)) mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filenames.before, base.screenshot);
  writeFileSync(filenames.after, head.screenshot);
  writeFileSync(filenames.diff, diff.diff);
  writeFileSync(filenames.reviewBefore, cropForReview(base.screenshot, base.regions));
  writeFileSync(filenames.reviewAfter, cropForReview(head.screenshot, head.regions));
  writeFileSync(filenames.receipt, `${JSON.stringify({
    id,
    group,
    baseRevision,
    viewport: diff.beforeSize,
    differentPixels: diff.differentPixels,
    rawDifferentPixels: diff.rawDifferentPixels,
    maxObservedChannelDelta: diff.maxObservedChannelDelta,
    beforeSha256: digest(base.screenshot),
    afterSha256: digest(head.screenshot),
    diffSha256: digest(diff.diff),
  }, null, 2)}\n`);
}

async function assertApprovedDifference(
  page: Page,
  testInfo: TestInfo,
  group: 'catalogue' | 'full-app',
  id: string,
  base: CapturedContract,
  head: CapturedContract,
  expectsVisualDifference: boolean,
) {
  const revision = await baseSha(page);
  const migration = revision === STACK_B_MIGRATION_BASE_SHA;
  const pixels = comparePngs(base.screenshot, head.screenshot);
  await preserveEvidence(group, id, revision, base, head, pixels, testInfo);

  expect(head.aria, 'accessibility-tree identity failed').toBe(base.aria);
  expect(styleViolations(base, head), 'geometry or non-decorative style changed').toEqual([]);
  expect(head.regions, 'dropdown target geometry changed').toEqual(base.regions);
  expect(
    unexpectedChangedPixels(base.screenshot, head.screenshot, base.regions),
    'pixels changed outside dropdown controls and their approved decorative halo',
  ).toBe(0);

  if (!migration || !expectsVisualDifference) {
    expect(pixels.differentPixels, 'this state must remain pixel-identical').toBe(0);
  } else {
    expect(pixels.differentPixels, 'the approved Stack B migration produced no visual change').toBeGreaterThan(0);
  }
}

test.describe('Stack B approved dropdown differences', () => {
  for (const state of stackBStates) {
    test(`${state.id} @stack-b-visual`, async ({ page }, testInfo) => {
      const base = await captureCatalogue(page, 'base', state);
      const head = await captureCatalogue(page, 'head', state);
      await assertApprovedDifference(page, testInfo, 'catalogue', state.id, base, head, true);
    });
  }

  for (const state of stackBFullAppStates) {
    test(`${state.id} @stack-b-full-app`, async ({ page }, testInfo) => {
      const base = await captureFullApp(page, 'base', state);
      const head = await captureFullApp(page, 'head', state);
      await assertApprovedDifference(
        page,
        testInfo,
        'full-app',
        state.id,
        base,
        head,
        state.action === 'desktop-step',
      );
    });
  }

  test('approved palette contrast and minimum target size @stack-b-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(stateUrl('head', 'dropdowns'));
    await expect(page.locator('[data-stack-a-ready]')).toBeVisible();
    const trigger = page.locator('.step-count-trigger');
    await trigger.click();
    await expect(page.locator('.step-count-menu')).toBeVisible();

    const colors = await page.evaluate(() => {
      const read = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      const triggerStyle = read('.step-count-trigger');
      const menuStyle = read('.step-count-menu');
      return {
        openText: triggerStyle.color,
        openBackground: triggerStyle.backgroundColor,
        focusOutline: (() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--color-info)';
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        })(),
        adjacentSurface: getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim(),
        primaryText: read('.step-count-menu .dropdown-option-value').color,
        secondaryText: read('.step-count-menu .dropdown-option-label').color,
        categoryText: read('.step-count-menu .dropdown-category-label').color,
        menuBackground: menuStyle.backgroundColor,
      };
    });

    expect(contrastRatio(colors.openText, colors.openBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.primaryText, colors.menuBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.secondaryText, colors.menuBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.categoryText, colors.menuBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.focusOutline, colors.adjacentSurface)).toBeGreaterThanOrEqual(3);

    const targetSizes = await page.locator('.dropdown-trigger:visible, .dropdown-option:visible')
      .evaluateAll((targets) => targets.map((target) => {
        const rect = target.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }));
    expect(targetSizes.length).toBeGreaterThan(1);
    for (const size of targetSizes) {
      expect(size.width).toBeGreaterThanOrEqual(24);
      expect(size.height).toBeGreaterThanOrEqual(24);
    }
  });
});
