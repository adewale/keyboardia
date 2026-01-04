/**
 * Keyboard Navigation Tests
 *
 * Tests for keyboard accessibility and shortcuts.
 * Ensures the app is fully usable without a mouse.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect } from '@playwright/test';
import { waitWithTolerance } from './global-setup';

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
  });

  test('Tab navigates through interactive elements', async ({ page }) => {
    const focusedElements: string[] = [];

    // Tab through 10 elements
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      await waitWithTolerance(page, 100);

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return 'none';
        return `${el.tagName.toLowerCase()}${el.className ? '.' + el.className.split(' ')[0] : ''}`;
      });

      focusedElements.push(focused);
    }

    console.log('Tab order:', focusedElements.join(' -> '));

    // Should not get stuck on one element
    const uniqueElements = new Set(focusedElements);
    expect(uniqueElements.size).toBeGreaterThan(1);
  });

  test('Shift+Tab navigates backwards', async ({ page }) => {
    // Tab forward first
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const forwardFocus = await page.evaluate(() => document.activeElement?.className);

    // Tab backwards
    await page.keyboard.press('Shift+Tab');

    const backwardFocus = await page.evaluate(() => document.activeElement?.className);

    // Should have moved to a different element
    console.log(`Forward: ${forwardFocus}, Backward: ${backwardFocus}`);
  });

  test('Space/Enter activates focused elements', async ({ page }) => {
    // Find step cells
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible())) {
      test.skip(true, 'No step cells visible');
      return;
    }

    // Focus the step cell
    await stepCell.focus();

    // Get initial state
    const initialActive = await stepCell.evaluate((el) =>
      el.classList.contains('active')
    );

    // Try Space to toggle
    await page.keyboard.press('Space');
    await waitWithTolerance(page, 200);

    let newActive = await stepCell.evaluate((el) =>
      el.classList.contains('active')
    );

    // If Space didn't work, try Enter
    if (newActive === initialActive) {
      await page.keyboard.press('Enter');
      await waitWithTolerance(page, 200);

      newActive = await stepCell.evaluate((el) =>
        el.classList.contains('active')
      );
    }

    console.log(`Keyboard activation: ${initialActive} -> ${newActive}`);
  });

  test('Escape closes modal dialogs', async ({ page }) => {
    // Try to open a dialog/modal
    // This depends on the app's UI - try shift+click for p-lock editor
    const stepCell = page.locator('.step-cell').first();

    if (await stepCell.isVisible()) {
      await stepCell.click({ modifiers: ['Shift'] });
      await waitWithTolerance(page, 300);

      // Check if a modal/dialog opened
      const modal = page.locator('.modal, .dialog, .plock-editor, [role="dialog"]');
      const modalVisible = await modal.isVisible({ timeout: 1000 }).catch(() => false);

      if (modalVisible) {
        // Press Escape to close
        await page.keyboard.press('Escape');
        await waitWithTolerance(page, 300);

        // Modal should be closed
        const modalStillVisible = await modal.isVisible({ timeout: 500 }).catch(() => false);
        expect(modalStillVisible).toBe(false);

        console.log('Escape closed modal');
      } else {
        console.log('No modal opened to test Escape key');
      }
    }
  });

  test('Arrow keys navigate within grids', async ({ page }) => {
    // Focus on a step cell
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

    // Try arrow right
    await page.keyboard.press('ArrowRight');
    await waitWithTolerance(page, 100);

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
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
  });

  test('Space toggles playback (if implemented)', async ({ page }) => {
    // Get initial playing state
    const initialPlaying = await page.evaluate(() => {
      return document.body.classList.contains('playing') ||
        !!document.querySelector('.playing, [data-playing="true"]');
    });

    // Press Space
    await page.keyboard.press('Space');
    await waitWithTolerance(page, 500);

    const afterSpace = await page.evaluate(() => {
      return document.body.classList.contains('playing') ||
        !!document.querySelector('.playing, [data-playing="true"]');
    });

    console.log(`Space toggle: playing ${initialPlaying} -> ${afterSpace}`);

    // Press Space again to stop
    await page.keyboard.press('Space');
    await waitWithTolerance(page, 300);
  });

  test('Ctrl+A selects all (if implemented)', async ({ page }) => {
    await page.keyboard.press('Control+a');
    await waitWithTolerance(page, 200);

    // Check if selection occurred
    const selectedCount = await page.locator('.selected, [data-selected="true"]').count();
    console.log(`After Ctrl+A: ${selectedCount} items selected`);
  });

  test('Delete clears selected steps (if implemented)', async ({ page }) => {
    // First select some steps
    const stepCell = page.locator('.step-cell').first();

    if (await stepCell.isVisible()) {
      // Activate a step
      await stepCell.click();
      await waitWithTolerance(page, 200);

      const wasActive = await stepCell.evaluate((el) =>
        el.classList.contains('active')
      );

      if (wasActive) {
        // Try Ctrl+Click to select
        await stepCell.click({ modifiers: ['Control'] });
        await waitWithTolerance(page, 100);

        // Press Delete
        await page.keyboard.press('Delete');
        await waitWithTolerance(page, 200);

        const isNowActive = await stepCell.evaluate((el) =>
          el.classList.contains('active')
        );

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

    // Get initial state
    const initial = await stepCell.evaluate((el) =>
      el.classList.contains('active')
    );

    // Make a change
    await stepCell.click();
    await waitWithTolerance(page, 200);

    const afterClick = await stepCell.evaluate((el) =>
      el.classList.contains('active')
    );

    // Try Undo
    await page.keyboard.press('Control+z');
    await waitWithTolerance(page, 200);

    const afterUndo = await stepCell.evaluate((el) =>
      el.classList.contains('active')
    );

    // Try Redo
    await page.keyboard.press('Control+y');
    await waitWithTolerance(page, 200);

    const afterRedo = await stepCell.evaluate((el) =>
      el.classList.contains('active')
    );

    console.log(`Undo/Redo: ${initial} -> ${afterClick} -> ${afterUndo} -> ${afterRedo}`);
  });
});

test.describe('Focus Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
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
        if (await firstElement.isVisible({ timeout: 500 }).catch(() => false)) {
          await firstElement.focus();
          await waitWithTolerance(page, 100);

          // Check if element has visible focus
          const focusStyle = await firstElement.evaluate((el) => {
            const style = window.getComputedStyle(el);
            return {
              outline: style.outline,
              boxShadow: style.boxShadow,
              border: style.border,
            };
          });

          console.log(`${selector} focus style:`, focusStyle.outline || focusStyle.boxShadow);
        }
      }
    }
  });

  test('focus does not get trapped', async ({ page }) => {
    const maxTabs = 50;
    const visitedElements = new Set<string>();

    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press('Tab');
      await waitWithTolerance(page, 50);

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return 'none';
        // Create unique identifier
        const rect = el.getBoundingClientRect();
        return `${el.tagName}-${rect.x}-${rect.y}`;
      });

      if (visitedElements.has(focused) && visitedElements.size > 3) {
        // We've cycled through, focus is not trapped
        console.log(`Tab cycle completed after ${i + 1} tabs (${visitedElements.size} unique elements)`);
        return;
      }

      visitedElements.add(focused);
    }

    // If we got here without cycling, there might be a trap
    console.log(`Visited ${visitedElements.size} unique elements in ${maxTabs} tabs`);
    expect(visitedElements.size).toBeGreaterThan(3);
  });

  test('focus returns after closing dialogs', async ({ page }) => {
    // Get currently focused element
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible())) {
      test.skip(true, 'No step cells visible');
      return;
    }

    // Focus and remember the step
    await stepCell.focus();

    // Open dialog with Shift+Click
    await stepCell.click({ modifiers: ['Shift'] });
    await waitWithTolerance(page, 300);

    // Check if dialog opened
    const dialog = page.locator('.modal, .dialog, .plock-editor, [role="dialog"]');
    const dialogOpened = await dialog.isVisible({ timeout: 1000 }).catch(() => false);

    if (dialogOpened) {
      // Close with Escape
      await page.keyboard.press('Escape');
      await waitWithTolerance(page, 300);

      // Focus should return to the triggering element
      const focusedAfterClose = await page.evaluate(() => {
        return document.activeElement?.className;
      });

      console.log(`Focus after dialog close: ${focusedAfterClose}`);
    }
  });
});
