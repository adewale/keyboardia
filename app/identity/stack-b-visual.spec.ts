import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform, release } from 'node:os';
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
const evidenceGenerator = {
  name: 'app/identity/stack-b-visual.spec.ts',
  version: 6,
} as const;

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
const approvedDropdownTokens = {
  '--dropdown-control-background': '#2a2a2a',
  '--dropdown-control-border': '#6c6c76',
  '--dropdown-control-shadow': 'none',
  '--dropdown-control-hover-background': '#333333',
  '--dropdown-control-open-background': '#2a201e',
  '--dropdown-menu-background': '#2a2a2a',
  '--dropdown-menu-border': '#74747f',
  '--dropdown-scrollbar-thumb': '#787883',
  '--dropdown-menu-shadow': '0 4px 12px rgba(0, 0, 0, .3)',
  '--dropdown-option-hover-background': '#333333',
  '--dropdown-option-selected-background': '#444444',
  '--dropdown-option-secondary-text': 'rgba(255, 255, 255, .6)',
  '--dropdown-transpose-active-color': '#5eb3ea',
} as const;
const approvedSharedTokenLinks = {
  '--dropdown-control-background': 'var(--color-surface-elevated)',
  '--dropdown-control-hover-background': 'var(--color-surface-hover)',
  '--dropdown-menu-background': 'var(--color-surface-elevated)',
  '--dropdown-option-hover-background': 'var(--color-surface-hover)',
  '--dropdown-option-selected-background': 'var(--color-surface-active)',
  '--dropdown-option-secondary-text': 'var(--color-text-muted)',
} as const;
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
  'animationTimingFunction', 'animationDelay', 'animationIterationCount',
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
  const port = side === 'base' ? baseProductPort : headProductPort;
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

function styleViolations(base: CapturedContract, head: CapturedContract, migration: boolean) {
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
      const approvedMigrationDifference = migration
        && before.dropdownTarget
        && after.dropdownTarget
        && stackBDecorativeProperties.has(property);
      if (!approvedMigrationDifference) {
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

function parseColor(value: string) {
  const color = value.trim();
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3
      ? [...hex].map((channel) => `${channel}${channel}`).join('')
      : hex;
    return [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16),
      expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    ];
  }
  const functional = color.match(/^rgba?\(([^)]+)\)$/i)?.[1];
  const channels = functional?.split(/[,\s/]+/).filter(Boolean).map(Number);
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) {
    throw new Error(`Unsupported computed color: ${value}`);
  }
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
  const [backgroundRed, backgroundGreen, backgroundBlue] = parseColor(background);
  const [foregroundRed, foregroundGreen, foregroundBlue, alpha] = parseColor(foreground);
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

function colorAtOpacity(color: string, opacity: number) {
  const [red, green, blue, alpha] = parseColor(color);
  return `rgba(${red}, ${green}, ${blue}, ${alpha * opacity})`;
}

function backgroundSamples(backgroundColor: string, backgroundImage: string) {
  const gradientColors = backgroundImage.match(/rgba?\([^)]+\)|#[\da-f]{3,8}/gi) ?? [];
  return [...new Set([backgroundColor, ...gradientColors])];
}

function minimumContrast(foreground: string, backgrounds: string[]) {
  return Math.min(...backgrounds.map((background) => contrastRatio(foreground, background)));
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

async function comparisonRevisions(page: Page) {
  const response = await page.request.get(`http://127.0.0.1:${comparisonPort}/__stack-a-ready`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ baseSha: string; headSha: string }>;
}

async function preserveEvidence(
  group: 'catalogue' | 'full-app',
  id: string,
  baseRevision: string,
  headRevision: string,
  inputConfig: unknown,
  base: CapturedContract,
  head: CapturedContract,
  diff: ReturnType<typeof comparePngs>,
  checks: {
    accessibilityTreeIdentity: true;
    geometryAndStyleViolations: 0;
    targetGeometryIdentity: true;
    unexpectedChangedPixels: 0;
    pixelExpectation: 'changed' | 'identical';
    result: 'passed';
  },
  browserVersion: string,
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
    headRevision,
    generator: evidenceGenerator,
    inputConfigSha256: digest(Buffer.from(JSON.stringify(inputConfig))),
    environment: {
      browser: 'chromium',
      browserVersion,
      platform: platform(),
      platformRelease: release(),
    },
    viewport: diff.beforeSize,
    differentPixels: diff.differentPixels,
    rawDifferentPixels: diff.rawDifferentPixels,
    maxObservedChannelDelta: diff.maxObservedChannelDelta,
    beforeSha256: digest(base.screenshot),
    afterSha256: digest(head.screenshot),
    diffSha256: digest(diff.diff),
    checks,
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
  inputConfig: unknown,
) {
  const { baseSha: baseRevision, headSha: headRevision } = await comparisonRevisions(page);
  const migration = baseRevision === STACK_B_MIGRATION_BASE_SHA;
  const pixels = comparePngs(base.screenshot, head.screenshot);
  const violations = styleViolations(base, head, migration);
  const targetGeometryIdentity = JSON.stringify(head.regions) === JSON.stringify(base.regions);
  const changedOutsideTargets = unexpectedChangedPixels(base.screenshot, head.screenshot, base.regions);

  expect(head.aria, 'accessibility-tree identity failed').toBe(base.aria);
  expect(violations, 'geometry or non-decorative style changed').toEqual([]);
  expect(head.regions, 'dropdown target geometry changed').toEqual(base.regions);
  expect(
    changedOutsideTargets,
    'pixels changed outside dropdown controls and their approved decorative halo',
  ).toBe(0);

  const pixelExpectation = migration && expectsVisualDifference ? 'changed' : 'identical';
  if (!migration || !expectsVisualDifference) {
    expect(pixels.differentPixels, 'this state must remain pixel-identical').toBe(0);
  } else {
    expect(pixels.differentPixels, 'the approved Stack B migration produced no visual change').toBeGreaterThan(0);
    expect(
      styleViolations(base, head, false).length,
      'decorative exceptions must expire after the one-time Stack B migration',
    ).toBeGreaterThan(0);
  }

  await preserveEvidence(
    group,
    id,
    baseRevision,
    headRevision,
    inputConfig,
    base,
    head,
    pixels,
    {
      accessibilityTreeIdentity: true,
      geometryAndStyleViolations: 0,
      targetGeometryIdentity: targetGeometryIdentity as true,
      unexpectedChangedPixels: changedOutsideTargets as 0,
      pixelExpectation,
      result: 'passed',
    },
    page.context().browser()?.version() ?? 'unknown',
    testInfo,
  );
}

test.describe('Stack B approved dropdown differences', () => {
  for (const state of stackBStates) {
    test(`${state.id} @stack-b-visual`, async ({ page }, testInfo) => {
      const base = await captureCatalogue(page, 'base', state);
      const head = await captureCatalogue(page, 'head', state);
      await assertApprovedDifference(page, testInfo, 'catalogue', state.id, base, head, true, state);
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
        state,
      );
    });
  }

  test('approved palette contrast and minimum target size @stack-b-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(stateUrl('head', 'dropdowns'));
    await expect(page.locator('[data-stack-a-ready]')).toBeVisible();
    const trigger = page.locator('.step-count-trigger');
    const neutralControlBorder = await trigger.evaluate((element) => getComputedStyle(element).borderTopColor);
    await trigger.click();
    await expect(page.locator('.step-count-menu')).toBeVisible();
    await settleForScreenshot(page);
    const hoveredOption = page.locator('.step-count-menu [role="option"][aria-selected="false"]').first();
    await hoveredOption.hover();
    await settleForScreenshot(page);
    const optionHoverBackgrounds = await hoveredOption.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.backgroundImage];
    });

    const colors = await page.evaluate(() => {
      const read = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      const triggerStyle = read('.step-count-trigger');
      const menuStyle = read('.step-count-menu');
      const selectedStyle = read('.step-count-menu [role="option"][aria-selected="true"]');
      const selectedCheckStyle = read('.step-count-menu [aria-selected="true"] .dropdown-option-check');
      const openChevronStyle = read('.step-count-trigger .dropdown-chevron');
      return {
        openText: triggerStyle.color,
        openBackgrounds: [triggerStyle.backgroundColor, triggerStyle.backgroundImage],
        openChevronColor: openChevronStyle.color,
        openChevronOpacity: Number(openChevronStyle.opacity),
        focusOutline: (() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--color-info)';
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        })(),
        adjacentSurface: (() => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--color-surface)';
          document.body.append(probe);
          const color = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return color;
        })(),
        elevatedSurface: 'rgb(42, 42, 42)',
        primaryText: read('.step-count-menu .dropdown-option-value').color,
        secondaryText: read('.step-count-menu .dropdown-option-label').color,
        categoryText: read('.step-count-menu .dropdown-category-label').color,
        menuBackgrounds: [menuStyle.backgroundColor, menuStyle.backgroundImage],
        menuBorder: menuStyle.borderTopColor,
        scrollbarThumb: (() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--dropdown-scrollbar-thumb)';
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        })(),
        selectedCheck: selectedCheckStyle.color,
        selectedBackgrounds: [selectedStyle.backgroundColor, selectedStyle.backgroundImage],
      };
    });

    const openBackgrounds = backgroundSamples(...colors.openBackgrounds as [string, string]);
    const menuBackgrounds = backgroundSamples(...colors.menuBackgrounds as [string, string]);
    const selectedBackgrounds = backgroundSamples(...colors.selectedBackgrounds as [string, string]);
    const hoveredBackgrounds = backgroundSamples(...optionHoverBackgrounds as [string, string]);
    expect(
      minimumContrast(colors.openText, openBackgrounds),
      `open-trigger contrast samples: ${JSON.stringify({ foreground: colors.openText, openBackgrounds })}`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(minimumContrast(colors.primaryText, menuBackgrounds)).toBeGreaterThanOrEqual(4.5);
    expect(minimumContrast(colors.secondaryText, menuBackgrounds)).toBeGreaterThanOrEqual(4.5);
    expect(minimumContrast(colors.categoryText, menuBackgrounds)).toBeGreaterThanOrEqual(4.5);
    expect(minimumContrast(
      colorAtOpacity(colors.openChevronColor, colors.openChevronOpacity),
      openBackgrounds,
    )).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.focusOutline, colors.adjacentSurface)).toBeGreaterThanOrEqual(3);
    expect(minimumContrast(
      colors.focusOutline,
      [...menuBackgrounds, ...hoveredBackgrounds, ...selectedBackgrounds],
    )).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(neutralControlBorder, colors.adjacentSurface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.menuBorder, colors.adjacentSurface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.menuBorder, colors.elevatedSurface)).toBeGreaterThanOrEqual(3);
    expect(minimumContrast(colors.menuBorder, menuBackgrounds)).toBeGreaterThanOrEqual(3);
    expect(minimumContrast(colors.scrollbarThumb, menuBackgrounds)).toBeGreaterThanOrEqual(3);
    expect(minimumContrast(colors.selectedCheck, selectedBackgrounds)).toBeGreaterThanOrEqual(3);

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

    await page.goto(stateUrl('head', 'dropdowns', 'selected'));
    await expect(page.locator('[data-stack-a-ready]')).toBeVisible();
    const activeTranspose = page.locator('.transpose-trigger.active');
    const readActiveTranspose = () => activeTranspose.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        backgrounds: [style.backgroundColor, style.backgroundImage],
        chevronColor: getComputedStyle(element.querySelector('.dropdown-chevron')!).color,
        chevronOpacity: Number(getComputedStyle(element.querySelector('.dropdown-chevron')!).opacity),
      };
    });
    const activeClosed = await readActiveTranspose();
    expect(minimumContrast(activeClosed.color, backgroundSamples(...activeClosed.backgrounds as [string, string])))
      .toBeGreaterThanOrEqual(4.5);
    expect(minimumContrast(
      colorAtOpacity(activeClosed.chevronColor, activeClosed.chevronOpacity),
      backgroundSamples(...activeClosed.backgrounds as [string, string]),
    )).toBeGreaterThanOrEqual(3);
    await activeTranspose.hover();
    await settleForScreenshot(page);
    const activeHover = await readActiveTranspose();
    expect(minimumContrast(activeHover.color, backgroundSamples(...activeHover.backgrounds as [string, string])))
      .toBeGreaterThanOrEqual(4.5);
    expect(minimumContrast(
      colorAtOpacity(activeHover.chevronColor, activeHover.chevronOpacity),
      backgroundSamples(...activeHover.backgrounds as [string, string]),
    )).toBeGreaterThanOrEqual(3);
  });

  test('single-choice menus share the selected-item grammar @stack-b-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(stateUrl('head', 'dropdowns'));
    await expect(page.locator('[data-stack-a-ready]')).toBeVisible();

    const readSelectedStyle = async (trigger: string, menu: string) => {
      await page.locator(trigger).click();
      const selected = page.locator(`${menu} [role="option"][aria-selected="true"]`);
      const unselected = page.locator(`${menu} [role="option"][aria-selected="false"]`).first();
      await expect(selected).toHaveCount(1);
      await expect(selected.locator('.dropdown-option-check')).toBeVisible();
      const style = await selected.evaluate((element) => {
        const selectedStyle = getComputedStyle(element);
        const checkStyle = getComputedStyle(element.querySelector('.dropdown-option-check')!);
        return {
          backgroundColor: selectedStyle.backgroundColor,
          backgroundImage: selectedStyle.backgroundImage,
          checkColor: checkStyle.color,
        };
      });
      expect(await unselected.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe('rgba(0, 0, 0, 0)');
      await page.keyboard.press('Escape');
      return style;
    };

    const step = await readSelectedStyle('.step-count-trigger', '.step-count-menu');
    const transpose = await readSelectedStyle('.transpose-trigger', '.transpose-menu');

    expect(step).toEqual(transpose);
    expect(step.backgroundColor).toBe('rgb(68, 68, 68)');
    expect(step.backgroundImage).toBe('none');
    expect(step.checkColor).toBe('rgb(240, 112, 72)');
  });

  test('selection, Escape and outside click preserve expected focus ownership @stack-b-accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(stateUrl('head', 'dropdowns'));
    await expect(page.locator('[data-stack-a-ready]')).toBeVisible();

    const stepTrigger = page.locator('.step-count-trigger');
    await stepTrigger.click();
    await page.locator('.step-count-menu [role="option"]').first().click();
    await expect(page.locator('.step-count-menu')).toHaveCount(0);
    await expect(stepTrigger).toBeFocused();

    const transposeTrigger = page.locator('.transpose-trigger');
    await transposeTrigger.click();
    await page.locator('.transpose-menu [role="option"]').first().click();
    await expect(page.locator('.transpose-menu')).toHaveCount(0);
    await expect(transposeTrigger).toBeFocused();

    await transposeTrigger.click();
    const transposeOption = page.locator('.transpose-menu [role="option"]').first();
    await transposeOption.focus();
    await expect(transposeOption).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.transpose-menu')).toHaveCount(0);
    await expect(transposeTrigger).toBeFocused();

    await stepTrigger.click();
    const outsideTarget = page.locator('.sample-picker .category-header').first();
    await outsideTarget.click();
    await expect(page.locator('.step-count-menu')).toHaveCount(0);
    await expect(outsideTarget).toBeFocused();
  });

  test('approved dropdown decorative recipe is exact @stack-b-visual', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(stateUrl('head', 'dropdowns'));
    await expect(page.locator('[data-stack-a-ready]')).toBeVisible();

    const tokens = await page.evaluate((names) => {
      const root = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map((name) => [name, root.getPropertyValue(name).trim()]));
    }, Object.keys(approvedDropdownTokens));
    expect(tokens).toEqual(approvedDropdownTokens);

    const sharedRecipeSources = await page.evaluate((names) => {
      const rootRule = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .find((rule): rule is CSSStyleRule => (
          rule instanceof CSSStyleRule
          && rule.selectorText === ':root'
          && rule.style.getPropertyValue('--dropdown-control-background') !== ''
        ));
      const triggerRule = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .find((rule): rule is CSSStyleRule => (
          rule instanceof CSSStyleRule && rule.selectorText === '.dropdown-trigger'
        ));
      return {
        tokenLinks: Object.fromEntries(names.map((name) => [name, rootRule?.style.getPropertyValue(name).trim()])),
        triggerRadius: triggerRule?.style.borderRadius,
      };
    }, Object.keys(approvedSharedTokenLinks));
    expect(sharedRecipeSources).toEqual({
      tokenLinks: approvedSharedTokenLinks,
      triggerRadius: '6px',
    });

    const trigger = page.locator('.step-count-trigger');
    const closedStyle = await trigger.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderRadius: style.borderRadius,
        borderTopColor: style.borderTopColor,
        boxShadow: style.boxShadow,
      };
    });
    expect(closedStyle).toEqual({
      backgroundColor: 'rgb(42, 42, 42)',
      backgroundImage: 'none',
      borderRadius: '0px 4px 4px 0px',
      borderTopColor: 'rgb(108, 108, 118)',
      boxShadow: 'none',
    });

    await trigger.hover();
    await settleForScreenshot(page);
    const hoverStyle = await trigger.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderTopColor: style.borderTopColor,
      };
    });
    expect(hoverStyle).toEqual({
      backgroundColor: 'rgb(51, 51, 51)',
      backgroundImage: 'none',
      borderTopColor: 'rgb(232, 90, 48)',
    });
    await page.mouse.move(0, 0);

    await trigger.focus();
    const focusStyle = await trigger.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    expect(focusStyle).toEqual({
      outlineColor: 'rgb(52, 152, 219)',
      outlineOffset: '2px',
      outlineStyle: 'solid',
      outlineWidth: '2px',
      boxShadow: 'none',
    });

    await trigger.click();
    await settleForScreenshot(page);
    const openStyle = await trigger.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderTopColor: style.borderTopColor,
        color: style.color,
      };
    });
    expect(openStyle).toEqual({
      backgroundColor: 'rgb(42, 32, 30)',
      backgroundImage: 'none',
      borderTopColor: 'rgb(240, 112, 72)',
      color: 'rgb(240, 112, 72)',
    });
    const menu = page.locator('.step-count-menu');
    await expect(menu).toBeVisible();
    const menuStyle = await menu.evaluate((element) => {
      const style = getComputedStyle(element);
      const scrollbarThumbRule = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .find((rule): rule is CSSStyleRule => (
          rule instanceof CSSStyleRule
          && rule.selectorText === '.dropdown-menu::-webkit-scrollbar-thumb'
        ));
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderRadius: style.borderRadius,
        borderTopColor: style.borderTopColor,
        boxShadow: style.boxShadow,
        scrollbarThumbBackgroundDeclaration: scrollbarThumbRule?.style.background,
      };
    });
    expect(menuStyle).toEqual({
      backgroundColor: 'rgb(42, 42, 42)',
      backgroundImage: 'none',
      borderRadius: '6px',
      borderTopColor: 'rgb(116, 116, 127)',
      boxShadow: 'rgba(0, 0, 0, 0.3) 0px 4px 12px 0px',
      scrollbarThumbBackgroundDeclaration: 'var(--dropdown-scrollbar-thumb)',
    });

    const unselected = menu.locator('[role="option"][aria-selected="false"]').first();
    await unselected.focus();
    const optionFocusStyle = await unselected.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    expect(optionFocusStyle).toEqual({
      outlineColor: 'rgb(52, 152, 219)',
      outlineOffset: '-2px',
      outlineStyle: 'solid',
      outlineWidth: '2px',
      boxShadow: 'none',
    });

    await unselected.hover();
    await settleForScreenshot(page);
    const optionHoverStyle = await unselected.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
      };
    });
    expect(optionHoverStyle).toEqual({
      backgroundColor: 'rgb(51, 51, 51)',
      backgroundImage: 'none',
    });
  });
});
