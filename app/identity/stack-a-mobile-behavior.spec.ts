import { expect, test, type Page } from '@playwright/test';

type Side = 'base' | 'head';

function stateUrl(side: Side, story: string, variant?: string) {
  const query = new URLSearchParams({ story });
  if (variant) query.set('variant', variant);
  return `/${side}/stack-a.html?${query.toString()}`;
}

async function openState(
  page: Page,
  side: Side,
  story: string,
  viewport: { width: number; height: number },
  variant?: string,
) {
  await page.setViewportSize(viewport);
  await page.goto(stateUrl(side, story, variant));
  await expect(page.locator('[data-stack-a-ready]')).toBeVisible();
}

async function eventContract(page: Page) {
  return {
    aria: await page.locator('body').ariaSnapshot(),
    event: await page.locator('[data-event-log]').textContent(),
  };
}

test.describe('Stack A mobile WebKit behavior identity', () => {
  test.beforeEach(({ browserName }, testInfo) => {
    expect(browserName).toBe('webkit');
    expect(testInfo.project.use.hasTouch).toBe(true);
  });

  test('touch selects step count @stack-a-mobile', async ({ page }) => {
    const contracts = [];
    for (const side of ['base', 'head'] as const) {
      await openState(page, side, 'dropdowns', { width: 375, height: 812 });
      const trigger = page.locator('.step-count-trigger');
      await trigger.tap();
      await page.locator('.step-option').first().tap();
      await expect(page.locator('[data-event-log]')).toContainText('step:4');
      await expect(page.locator('.step-count-menu')).toHaveCount(0);
      if (side === 'head') await expect(trigger).toBeFocused();
      contracts.push(await eventContract(page));
    }
    expect(contracts[1]).toEqual(contracts[0]);
  });

  test('touch selects transpose @stack-a-mobile', async ({ page }) => {
    const contracts = [];
    for (const side of ['base', 'head'] as const) {
      await openState(page, side, 'dropdowns', { width: 480, height: 320 });
      const trigger = page.locator('.transpose-trigger');
      await trigger.tap();
      await page.locator('.transpose-option').first().tap();
      await expect(page.locator('[data-event-log]')).toContainText('transpose:');
      await expect(page.locator('.transpose-menu')).toHaveCount(0);
      if (side === 'head') await expect(trigger).toBeFocused();
      contracts.push(await eventContract(page));
    }
    expect(contracts[1]).toEqual(contracts[0]);
  });

  test('touch expands a picker category @stack-a-mobile', async ({ page }) => {
    const contracts = [];
    for (const side of ['base', 'head'] as const) {
      await openState(page, side, 'picker', { width: 375, height: 812 });
      const secondCategory = page.locator('.picker-category').nth(1);
      await secondCategory.locator('.category-header').tap();
      await expect(page.locator('.picker-category.expanded')).toHaveCount(2);
      await expect(secondCategory.locator('.category-header')).toHaveAttribute('aria-expanded', 'true');
      contracts.push(await eventContract(page));
    }
    expect(contracts[1]).toEqual(contracts[0]);
  });

  test('touch invokes the landscape drawer action @stack-a-mobile', async ({ page }) => {
    const contracts = [];
    for (const side of ['base', 'head'] as const) {
      await openState(page, side, 'drawer', { width: 667, height: 375 });
      await page.locator('.drawer-action-btn-compact.destructive').tap();
      await expect(page.locator('[data-event-log]')).toContainText('delete');
      contracts.push(await eventContract(page));
    }
    expect(contracts[1]).toEqual(contracts[0]);
  });
});
