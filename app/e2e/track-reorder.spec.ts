import {
  test,
  expect,
  waitForAppReady,
  waitForCollaborationReady,
  useMockAPI,
} from './global-setup';
import type { Page } from './global-setup';

/**
 * Browser-only track reorder contracts.
 *
 * Reducer position matrices, track-count boundaries, repeated reorder stress,
 * and no-loss invariants live in grid.test.ts and
 * sync-convergence.property.test.ts. The deleted comprehensive, bug-fix, and
 * single-track-visual specs repeated those pure state contracts through 37
 * slow drag gestures. This suite keeps only behavior that requires a browser:
 * the drag affordance, exact DOM-to-action targeting, single dispatch, visual
 * ownership/cleanup, cancellation, handle-only initiation, and persistence.
 */

function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile-');
}

function isWebkit(browserName: string): boolean {
  return browserName === 'webkit';
}

async function getTrackNames(page: Page): Promise<string[]> {
  return page.locator('.track-row').evaluateAll((rows) => rows.map((row) => {
    const name = row.querySelector('.track-name, .track-label')?.textContent?.trim();
    if (!name) throw new Error('Rendered track is missing its name');
    return name;
  }));
}

async function expectTrackOrder(page: Page, expected: string[]): Promise<void> {
  await expect.poll(() => getTrackNames(page)).toEqual(expected);
}

test.describe('Track reorder browser contract', () => {
  test.beforeEach(async ({ page, browserName }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires mouse drag');
    test.skip(isWebkit(browserName), 'WebKit drag-and-drop is not supported by Playwright');

    await page.goto('/');
    await page.getByRole('button', { name: /start session/i }).click();
    await expect(page.getByRole('button', { name: /808 Kick/ })).toBeVisible();
    await waitForCollaborationReady(page);

    const instruments: Array<[RegExp, number]> = [
      [/808 Hat/, 1],
      [/808 Kick/, 2],
      [/808 Snare/, 3],
    ];
    for (const [instrument, expectedCount] of instruments) {
      await page.getByRole('button', { name: instrument }).first().click();
      await expect(page.locator('.track-row')).toHaveCount(expectedCount);
    }
  });

  test('exposes one accessible drag handle per track', async ({ page }) => {
    const handles = page.locator('.track-drag-handle');
    await expect(handles).toHaveCount(3);

    for (const handle of await handles.all()) {
      await expect(handle).toBeVisible();
      await expect(handle).toHaveAttribute('title', 'Drag to reorder');
      await expect(handle).toHaveAttribute('aria-label', 'Drag to reorder track');
    }
  });

  test('lands on the exact target once without losing or duplicating tracks', async ({ page }) => {
    const initial = await getTrackNames(page);
    const expected = [initial[1], initial[2], initial[0]];

    await page.locator('.track-drag-handle').first().dragTo(
      page.locator('.track-row-wrapper').nth(2),
    );

    await expectTrackOrder(page, expected);
    await expect(page.locator('.track-row-wrapper.dragging, .track-row-wrapper.drag-target'))
      .toHaveCount(0);

    // A historical double-dragend bug dispatched a second reorder after the
    // first render. Wait through that event window and pin the exact order.
    await page.waitForTimeout(300);
    const stableOrder = await getTrackNames(page);
    expect(stableOrder).toEqual(expected);
    expect(new Set(stableOrder)).toEqual(new Set(initial));
  });

  test('marks only the active track as dragging and clears it on release', async ({ page }) => {
    const handle = page.locator('.track-drag-handle').first();
    const box = await handle.boundingBox();
    if (!box) throw new Error('Drag handle has no layout box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100);

    await expect(page.locator('.track-row-wrapper.dragging')).toHaveCount(1);
    await expect(page.locator('.track-row-wrapper').first()).toHaveClass(/dragging/);

    await page.mouse.up();
    await expect(page.locator('.track-row-wrapper.dragging, .track-row-wrapper.drag-target'))
      .toHaveCount(0);
  });

  test('cancels outside the track list without reordering or leaking visual state', async ({ page }) => {
    const initial = await getTrackNames(page);
    const handle = page.locator('.track-drag-handle').first();
    const target = page.locator('.track-row-wrapper').nth(2);
    const handleBox = await handle.boundingBox();
    const targetBox = await target.boundingBox();
    if (!handleBox || !targetBox) throw new Error('Drag source or target has no layout box');

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
    await page.mouse.move(0, 0);
    await page.mouse.up();

    await expectTrackOrder(page, initial);
    await expect(page.locator('.track-row-wrapper.dragging, .track-row-wrapper.drag-target'))
      .toHaveCount(0);
  });

  test('does not initiate a drag from the track name', async ({ page }) => {
    const initial = await getTrackNames(page);
    const name = page.locator('.track-name, .track-label').first();
    const target = page.locator('.track-row-wrapper').nth(2);
    const nameBox = await name.boundingBox();
    const targetBox = await target.boundingBox();
    if (!nameBox || !targetBox) throw new Error('Track name or target has no layout box');

    await page.mouse.move(nameBox.x + nameBox.width / 2, nameBox.y + nameBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);

    await expect(page.locator('.track-row-wrapper.dragging')).toHaveCount(0);
    await page.mouse.up();
    await expectTrackOrder(page, initial);
  });

  test('persists the exact order after reload', async ({ page }) => {
    test.skip(useMockAPI, 'Persistence requires real Worker storage');
    const initial = await getTrackNames(page);
    const expected = [initial[1], initial[0], initial[2]];

    await page.locator('.track-drag-handle').nth(1).dragTo(
      page.locator('.track-row-wrapper').first(),
    );
    await expectTrackOrder(page, expected);

    await page.reload();
    await waitForAppReady(page);
    await expectTrackOrder(page, expected);
  });
});
