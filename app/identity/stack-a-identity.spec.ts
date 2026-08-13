import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { stackAStates, type StackAAction, type StackAExpectation } from './manifest';
import { stackBStateIdSet } from './stack-b-manifest';
import { comparePngs } from '../scripts/png-identity.mjs';

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
  styles: unknown[];
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
  }, styleProperties);
  const screenshot = await page.screenshot({
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
  return { screenshot, aria, styles };
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
      const base = await captureContract(page, 'base', state);
      const head = await captureContract(page, 'head', state);
      const pixels = comparePngs(base.screenshot, head.screenshot);
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
      expect(head.styles, 'computed-style or geometry identity failed').toEqual(base.styles);
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
    });
  }
});
