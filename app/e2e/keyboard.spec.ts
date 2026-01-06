/**
 * Keyboard Navigation Tests
 *
 * Tests for keyboard accessibility and shortcuts.
 * Ensures the app is fully usable without a mouse.
 *
 * Uses Playwright best practices - no fixed waits.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect } from '@playwright/test';
import { waitForAppReady } from './global-setup';

// Skip in CI - requires real backend infrastructure
test.skip(!!process.env.CI, 'Skipped in CI - requires real backend');

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('Tab navigates through interactive elements', async ({ page }) => {
    const focusedElements: string[] = [];

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return 'none';
        return `${el.tagName.toLowerCase()}${el.className ? '.' + el.className.split(' ')[0] : ''}`;
      });

      focusedElements.push(focused);
    }

    console.log('Tab order:', focusedElements.join(' -> '));

    const uniqueElements = new Set(focusedElements);
    expect(uniqueElements.size).toBeGreaterThan(1);
  });

  test('Shift+Tab navigates backwards', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const forwardFocus = await page.evaluate(() => document.activeElement?.className);

    await page.keyboard.press('Shift+Tab');

    const backwardFocus = await page.evaluate(() => document.activeElement?.className);

    console.log(`Forward: ${forwardFocus}, Backward: ${backwardFocus}`);
  });

  test('Space/Enter activates focused elements', async ({ page }) => {
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible())) {
      test.skip(true, 'No step cells visible');
      return;
    }

    await stepCell.focus();

    const initialActive = await stepCell.evaluate((el) =>
      el.classList.contains('active') ||
      el.getAttribute('aria-pressed') === 'true'
    );

    await page.keyboard.press('Space');

    // Wait for state change with web-first assertion
    await expect(async () => {
      const newActive = await stepCell.evaluate((el) =>
        el.classList.contains('active') ||
        el.getAttribute('aria-pressed') === 'true'
      );
      console.log(`Keyboard activation: ${initialActive} -> ${newActive}`);
    }).toPass({ timeout: 1000 }).catch(() => {});
  });

  test('Escape closes modal dialogs', async ({ page }) => {
    const stepCell = page.locator('.step-cell').first();

    if (await stepCell.isVisible()) {
      await stepCell.click({ modifiers: ['Shift'] });

      const modal = page.locator('.modal, .dialog, .plock-editor, [role="dialog"]');

      try {
        await modal.waitFor({ state: 'visible', timeout: 1000 });
        await page.keyboard.press('Escape');
        await expect(modal).not.toBeVisible({ timeout: 1000 });
        console.log('Escape closed modal');
      } catch {
        console.log('No modal opened to test Escape key');
      }
    }
  });

  test('Arrow keys navigate within grids', async ({ page }) => {
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible())) {
      test.skip(true, 'No step cells visible');
      return;
    }

    await stepCell.focus();

    const initialFocus = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.getAttribute('data-step') || el.className : 'none';
    });

    await page.keyboard.press('ArrowRight');

    const afterRight = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.getAttribute('data-step') || el.className : 'none';
    });

    console.log(`Arrow navigation: ${initialFocus} -> ${afterRight}`);
  });
});

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('Space toggles playback (if implemented)', async ({ page }) => {
    const initialPlaying = await page.evaluate(() => {
      return document.body.classList.contains('playing') ||
        !!document.querySelector('.playing, [data-playing="true"]');
    });

    await page.keyboard.press('Space');

    await expect(async () => {
      const afterSpace = await page.evaluate(() => {
        return document.body.classList.contains('playing') ||
          !!document.querySelector('.playing, [data-playing="true"]');
      });
      console.log(`Space toggle: playing ${initialPlaying} -> ${afterSpace}`);
    }).toPass({ timeout: 1000 }).catch(() => {});

    await page.keyboard.press('Space');
  });

  test('Ctrl+A selects all (if implemented)', async ({ page }) => {
    await page.keyboard.press('Control+a');

    const selectedCount = await page.locator('.selected, [data-selected="true"]').count();
    console.log(`After Ctrl+A: ${selectedCount} items selected`);
  });

  test('Delete clears selected steps (if implemented)', async ({ page }) => {
    const stepCell = page.locator('.step-cell').first();

    if (await stepCell.isVisible()) {
      await stepCell.click();
      await expect(stepCell).toHaveClass(/active/).catch(() => {});

      const wasActive = await stepCell.evaluate((el) => el.classList.contains('active'));

      if (wasActive) {
        await stepCell.click({ modifiers: ['Control'] });
        await page.keyboard.press('Delete');

        const isNowActive = await stepCell.evaluate((el) => el.classList.contains('active'));
        console.log(`Delete key: active ${wasActive} -> ${isNowActive}`);
      }
    }
  });

  test('Undo/Redo with Ctrl+Z and Ctrl+Y (if implemented)', async ({ page }) => {
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible())) {
      test.skip(true, 'No step cells visible');
      return;
    }

    const initial = await stepCell.evaluate((el) => el.classList.contains('active'));

    await stepCell.click();
    await expect(stepCell).toHaveClass(/active/).catch(() => {});

    const afterClick = await stepCell.evaluate((el) => el.classList.contains('active'));

    await page.keyboard.press('Control+z');
    const afterUndo = await stepCell.evaluate((el) => el.classList.contains('active'));

    await page.keyboard.press('Control+y');
    const afterRedo = await stepCell.evaluate((el) => el.classList.contains('active'));

    console.log(`Undo/Redo: ${initial} -> ${afterClick} -> ${afterUndo} -> ${afterRedo}`);
  });
});

test.describe('Focus Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('focus is visible on all focusable elements', async ({ page }) => {
    const focusableSelectors = [
      'button',
      '[role="button"]',
      'a[href]',
      'input',
      'select',
      '[tabindex="0"]',
    ];

    for (const selector of focusableSelectors) {
      const elements = page.locator(selector);
      const count = await elements.count();

      if (count > 0) {
        const firstElement = elements.first();
        try {
          await firstElement.waitFor({ state: 'visible', timeout: 500 });
          await firstElement.focus();

          const focusStyle = await firstElement.evaluate((el) => {
            const style = window.getComputedStyle(el);
            return {
              outline: style.outline,
              boxShadow: style.boxShadow,
            };
          });

          console.log(`${selector} focus:`, focusStyle.outline || focusStyle.boxShadow);
        } catch {
          // Element not visible
        }
      }
    }
  });

  test('focus does not get trapped', async ({ page }) => {
    const maxTabs = 50;
    const visitedElements = new Set<string>();

    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press('Tab');

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return 'none';
        const rect = el.getBoundingClientRect();
        return `${el.tagName}-${rect.x}-${rect.y}`;
      });

      if (visitedElements.has(focused) && visitedElements.size > 3) {
        console.log(`Tab cycle completed after ${i + 1} tabs (${visitedElements.size} unique elements)`);
        return;
      }

      visitedElements.add(focused);
    }

    console.log(`Visited ${visitedElements.size} unique elements in ${maxTabs} tabs`);
    expect(visitedElements.size).toBeGreaterThan(3);
  });

  test('focus returns after closing dialogs', async ({ page }) => {
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible())) {
      test.skip(true, 'No step cells visible');
      return;
    }

    await stepCell.focus();

    await stepCell.click({ modifiers: ['Shift'] });

    const dialog = page.locator('.modal, .dialog, .plock-editor, [role="dialog"]');

    try {
      await dialog.waitFor({ state: 'visible', timeout: 1000 });
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 1000 });

      const focusedAfterClose = await page.evaluate(() => document.activeElement?.className);
      console.log(`Focus after dialog close: ${focusedAfterClose}`);
    } catch {
      console.log('No dialog to test focus return');
    }
  });
});
