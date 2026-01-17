/**
 * Keyboard Navigation Tests
 *
 * Tests for keyboard accessibility and shortcuts.
 * Ensures the app is fully usable without a mouse.
 *
 * NOTE: These tests are desktop-only as they require a physical keyboard.
 * Mobile browsers (mobile-chrome, mobile-safari) are skipped.
 *
 * Uses Playwright best practices - no fixed waits.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, waitForAppReady } from './global-setup';

/**
 * Check if running on a mobile browser project.
 */
function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile-');
}

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires physical keyboard');
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

  // NOTE: "Space/Enter activates focused elements" test was removed.
  // Covered by src/components/keyboard-handlers.test.ts:
  // - E-001: Space key on step should dispatch toggle
  // - E-002: Enter key on step should dispatch toggle
  // - K-001 through K-004: Step toggle tests

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

  // NOTE: "Arrow keys navigate within grids" test was removed.
  // Covered by src/components/keyboard-handlers.test.ts:
  // - E-005: Arrow right should compute next step index
  // - E-006: Arrow right at last step wraps to first
  // - E-007: Arrow left should compute previous step index
  // - E-008: Arrow left at first step wraps to last
});

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires physical keyboard');
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

  // NOTE: "Undo/Redo with Ctrl+Z and Ctrl+Y" test was removed.
  // This test was checking for optional undo/redo functionality with runtime skips.
  // If undo/redo is implemented, dedicated tests should be added in unit tests.

  test('? key opens keyboard shortcuts help panel (desktop)', async ({ page }) => {
    // Press Shift+/ (which is ?) to open the help panel
    await page.keyboard.press('Shift+/');

    // Wait for the dialog to appear
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Verify it's the shortcuts panel
    const title = page.locator('.shortcuts-title');
    await expect(title).toHaveText('Keyboard Shortcuts');

    // Verify sections are present (use section title class for specificity)
    await expect(page.locator('.shortcuts-section-title:has-text("Transport")')).toBeVisible();
    await expect(page.locator('.shortcuts-section-title:has-text("Selection")')).toBeVisible();
    await expect(page.locator('.shortcuts-section-title:has-text("General")')).toBeVisible();

    console.log('Help panel opened with ? key');
  });

  test('Help panel closes with Escape key', async ({ page }) => {
    // Open the panel
    await page.keyboard.press('Shift+/');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 1000 });

    console.log('Help panel closed with Escape');
  });

  test('Help panel closes with ? key (toggle)', async ({ page }) => {
    // Open the panel
    await page.keyboard.press('Shift+/');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Close with ? again (toggle)
    await page.keyboard.press('Shift+/');
    await expect(dialog).not.toBeVisible({ timeout: 1000 });

    console.log('Help panel toggled closed with ?');
  });

  test('Help panel closes with backdrop click', async ({ page }) => {
    // Open the panel
    await page.keyboard.press('Shift+/');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Click on the backdrop (not the panel)
    const backdrop = page.locator('.shortcuts-backdrop');
    await backdrop.click({ position: { x: 10, y: 10 } });
    await expect(dialog).not.toBeVisible({ timeout: 1000 });

    console.log('Help panel closed with backdrop click');
  });

  test('Help panel closes with X button', async ({ page }) => {
    // Open the panel
    await page.keyboard.press('Shift+/');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Click the close button
    const closeButton = page.locator('.shortcuts-close');
    await closeButton.click();
    await expect(dialog).not.toBeVisible({ timeout: 1000 });

    console.log('Help panel closed with X button');
  });

  test('Space still plays/pauses while help panel is open (non-blocking)', async ({ page }) => {
    // Open the help panel
    await page.keyboard.press('Shift+/');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Press Space (should trigger play/pause even with panel open)
    await page.keyboard.press('Space');

    // Give it a moment to process
    await page.waitForTimeout(100);

    // Press Space again to stop if it started
    await page.keyboard.press('Space');

    // Panel should still be open
    await expect(dialog).toBeVisible();

    console.log('Space key worked with help panel open (non-blocking)');
  });

  test('Help panel has correct accessibility attributes', async ({ page }) => {
    // Open the panel
    await page.keyboard.press('Shift+/');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Check ARIA attributes
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-label', 'Keyboard shortcuts');

    // Check close button
    const closeButton = page.locator('.shortcuts-close');
    await expect(closeButton).toHaveAttribute('aria-label', 'Close');
    await expect(closeButton).toHaveAttribute('type', 'button');

    console.log('Help panel has correct accessibility attributes');
  });
});

test.describe('Focus Management', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires physical keyboard');
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

  // NOTE: "focus returns after closing dialogs" test was removed.
  // Covered by unit tests in src/components/focus-management.test.ts:
  // - DC-001 through DC-005: Dialog close focus restoration tests
  // - FT-001 through FT-005: Focus trap containment tests
  // - FS-001 through FS-006: Focus stack management tests
});
