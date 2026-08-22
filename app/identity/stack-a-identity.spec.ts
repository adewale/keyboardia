import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { stackAStates, type StackAAction, type StackAExpectation } from './manifest';
import { stackBStateIdSet } from './stack-b-manifest';
import { comparePngs } from '../scripts/png-identity.mjs';
import { PNG } from 'pngjs';
import {
  isApprovedSiteColorStyleDifference,
  SITE_COLOR_MIGRATION_BASE_SHA,
} from './site-color-migration';

const styleProperties = [
  'display',
  'position',
  'visibility',
  'opacity',
  'color',
  'backgroundColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
  'boxShadow',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'gap',
  'cursor',
  'overflowX',
  'overflowY',
  'transform',
  'transitionProperty',
  'transitionDuration',
  'transitionTimingFunction',
  'animationName',
  'animationDuration',
] as const;

interface CapturedContract {
  screenshot: Buffer;
  aria: string;
  styles: ElementContract[];
}

interface ElementContract {
  index: number;
  tag: string;
  className: string;
  role: string | null;
  testId: string | null;
  rect: { x: number; y: number; width: number; height: number };
  values: Record<(typeof styleProperties)[number], string>;
}

interface TargetRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  halo: number;
}

function stateUrl(side: 'base' | 'head', story: string, variant?: string) {
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

async function settleReactEffects(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
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

async function captureContract(
  page: Page,
  side: 'base' | 'head',
  state: (typeof stackAStates)[number],
): Promise<CapturedContract> {
  await page.setViewportSize(state.viewport);
  await page.emulateMedia({ reducedMotion: state.reducedMotion ?? 'no-preference' });
  await page.goto(stateUrl(side, state.story, state.variant));
  await expect(page.locator('[data-stack-a-ready]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(0, 0);

  for (const action of state.actions ?? []) {
    await performAction(page, action);
    // Effects such as dropdown auto-scroll must settle before the next action,
    // otherwise locator scrolling can race the component's own effect.
    await settleReactEffects(page);
  }
  for (const expectation of state.expectations) await assertExpectation(page, expectation);

  const intentionallyHovered = state.actions?.some((action) => action.type === 'hover');
  if (!intentionallyHovered) await page.mouse.move(0, 0);

  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const animations = document.getAnimations();
    for (const animation of animations) {
      if (!Number.isFinite(animation.effect?.getTiming().iterations)) {
        animation.pause();
        animation.currentTime = 0;
      } else {
        animation.finish();
      }
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  const aria = await page.locator('body').ariaSnapshot();
  const styles = await page.locator('body').evaluate((body, properties) => {
    const all = [body, ...body.querySelectorAll<HTMLElement>('*')];
    return all.flatMap((element, index) => {
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (computed.display === 'none' || computed.visibility === 'hidden') return [];
      const values = Object.fromEntries(
        properties.map((property) => [property, computed[property]]),
      );
      return [{
        index,
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        role: element.getAttribute('role'),
        testId: element.getAttribute('data-testid'),
        rect: {
          x: Math.round(rect.x * 1000) / 1000,
          y: Math.round(rect.y * 1000) / 1000,
          width: Math.round(rect.width * 1000) / 1000,
          height: Math.round(rect.height * 1000) / 1000,
        },
        values,
      }];
    });
  }, styleProperties) as ElementContract[];
  const screenshot = await page.screenshot({
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
  return { screenshot, aria, styles };
}

async function comparisonRevisions(page: Page) {
  const response = await page.request.get('/__stack-a-ready');
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ baseSha: string; headSha: string }>;
}

function migrationViolations(base: CapturedContract, head: CapturedContract, migration: boolean) {
  const violations: string[] = [];
  const regions: TargetRegion[] = [];
  if (head.styles.length !== base.styles.length) {
    violations.push(`visible element count changed: ${base.styles.length} → ${head.styles.length}`);
    return { violations, regions };
  }
  for (let index = 0; index < base.styles.length; index += 1) {
    const before = base.styles[index];
    const after = head.styles[index];
    const signature = (element: ElementContract) => (
      `${element.index}|${element.tag}|${element.className}|${element.role}|${element.testId}`
    );
    if (signature(before) !== signature(after)) {
      violations.push(`element ${index} identity changed`);
      continue;
    }
    if (JSON.stringify(before.rect) !== JSON.stringify(after.rect)) {
      violations.push(`element ${index} geometry changed`);
    }
    let approvedVisualChange = false;
    for (const property of styleProperties) {
      if (before.values[property] === after.values[property]) continue;
      const approved = migration && isApprovedSiteColorStyleDifference(before, after, property);
      if (!approved) {
        violations.push(
          `element ${index} changed ${property}: ${before.values[property]} → ${after.values[property]}`,
        );
      } else {
        approvedVisualChange = true;
      }
    }
    if (approvedVisualChange && before.rect.width > 0 && before.rect.height > 0) {
      regions.push({ ...before.rect, halo: 3 });
    }
  }
  return { violations, regions };
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
        maxDelta = Math.max(
          maxDelta,
          Math.abs(before.data[offset + channel] - after.data[offset + channel]),
        );
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

async function attachDifference(
  testInfo: TestInfo,
  id: string,
  base: Buffer,
  head: Buffer,
  diff: Buffer,
) {
  await Promise.all([
    testInfo.attach(`${id}-base`, { body: base, contentType: 'image/png' }),
    testInfo.attach(`${id}-head`, { body: head, contentType: 'image/png' }),
    testInfo.attach(`${id}-diff`, { body: diff, contentType: 'image/png' }),
  ]);
}

test.describe('Stack A base-versus-head identity', () => {
  for (const state of stackAStates.filter((candidate) => !stackBStateIdSet.has(candidate.id))) {
    test(`${state.id} @stack-a-identity`, async ({ page }, testInfo) => {
      const revisions = await comparisonRevisions(page);
      const migration = revisions.baseSha === SITE_COLOR_MIGRATION_BASE_SHA;
      const base = await captureContract(page, 'base', state);
      const head = await captureContract(page, 'head', state);
      const pixels = comparePngs(base.screenshot, head.screenshot);
      const { violations, regions } = migrationViolations(base, head, migration);
      const unexpectedPixels = unexpectedChangedPixels(base.screenshot, head.screenshot, regions);
      if (!pixels.equal) {
        await attachDifference(
          testInfo,
          state.id,
          base.screenshot,
          head.screenshot,
          pixels.diff,
        );
      }

      expect(head.aria, 'accessibility-tree identity failed').toBe(base.aria);
      expect(violations, 'non-approved computed-style or geometry change').toEqual([]);
      expect(unexpectedPixels, 'pixels changed outside approved colour-role targets').toBe(0);
      if (migration && regions.length > 0) {
        expect(
          migrationViolations(base, head, false).violations.length,
          'the one-time colour-role exception must be discriminating and expire after migration',
        ).toBeGreaterThan(0);
      }
      if (!migration || regions.length === 0) {
        expect(
          pixels.differentPixels,
          `pixel identity failed (${JSON.stringify({
            before: pixels.beforeSize,
            after: pixels.afterSize,
            rawDifferentPixels: pixels.rawDifferentPixels,
            maxObservedChannelDelta: pixels.maxObservedChannelDelta,
            allowedChannelDelta: pixels.maxChannelDelta,
          })})`,
        ).toBe(0);
      } else {
        expect(
          pixels.differentPixels,
          `approved colour-role migration produced no visible change (${JSON.stringify({
          before: pixels.beforeSize,
          after: pixels.afterSize,
          rawDifferentPixels: pixels.rawDifferentPixels,
          maxObservedChannelDelta: pixels.maxObservedChannelDelta,
          allowedChannelDelta: pixels.maxChannelDelta,
        })})`,
        ).toBeGreaterThan(0);
      }
    });
  }
});
