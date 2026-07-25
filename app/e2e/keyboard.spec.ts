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

    expect(forwardFocus).toBeTruthy();
    expect(backwardFocus).toBeTruthy();
    expect(backwardFocus).not.toBe(forwardFocus);
  });

  // NOTE: "Space/Enter activates focused elements" test was removed.
  // Covered by production-rendered StepCell tests in StepCell.test.tsx.

  // NOTE: Parameter-lock Escape dismissal is covered below through the
  // production keyboard-shortcuts dialog and in plock-editor.spec.ts.

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

  test('Space starts and stops playback', async ({ page }) => {
    const playButton = page.getByTestId('play-button');
    await expect(playButton).toHaveAttribute('aria-label', 'Play');

    await page.keyboard.press('Space');
    await expect(playButton).toHaveAttribute('aria-label', 'Stop');
    await expect(playButton).toHaveClass(/playing/);

    await page.keyboard.press('Space');
    await expect(playButton).toHaveAttribute('aria-label', 'Play');
    await expect(playButton).not.toHaveClass(/playing/);
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

  test('Space activates the focused modal control instead of the global transport', async ({ page }) => {
    await page.keyboard.press('Shift+/');
    const dialog = page.locator('[role="dialog"]');
    const closeButton = page.locator('.shortcuts-close');
    await expect(dialog).toBeVisible({ timeout: 2000 });
    await expect(closeButton).toBeFocused();

    await page.keyboard.press('Space');

    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.play-button')).not.toHaveClass(/playing/);
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

  // Visible focus is asserted through the production keyboard path in
  // accessibility.spec.ts. The former duplicate only logged computed styles
  // and swallowed hidden-element failures, so it provided no oracle.

  test('focus does not get trapped', async ({ page }) => {
    const focusableSelector = [
      'a[href]:not([tabindex="-1"])',
      'button:not([disabled]):not([tabindex="-1"])',
      'input:not([disabled]):not([tabindex="-1"])',
      'select:not([disabled]):not([tabindex="-1"])',
      'textarea:not([disabled]):not([tabindex="-1"])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const focusableCount = await page.evaluate((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element) => {
        const style = getComputedStyle(element);
        return element.getClientRects().length > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden';
      }).length,
    focusableSelector);
    expect(focusableCount).toBeGreaterThan(3);
    expect(focusableCount).toBeLessThan(500);

    const maxTabs = focusableCount + 2;
    const visitedElements = new Set<string>();
    let firstFocused: string | undefined;
    let completedCycle = false;

    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press('Tab');

      const focused = await page.evaluate((selector) => {
        const active = document.activeElement;
        const candidates = Array.from(document.querySelectorAll(selector));
        return `${active?.tagName ?? 'none'}-${candidates.indexOf(active as Element)}`;
      }, focusableSelector);

      firstFocused ??= focused;
      if (visitedElements.has(focused) && visitedElements.size > 3) {
        expect(focused).toBe(firstFocused);
        completedCycle = true;
        break;
      }
      visitedElements.add(focused);
    }

    expect(visitedElements.size).toBeGreaterThan(3);
    expect(completedCycle).toBe(true);
  });

  // NOTE: "focus returns after closing dialogs" test was removed.
  // Covered by unit tests in src/components/focus-management.test.ts:
  // - DC-001 through DC-005: Dialog close focus restoration tests
  // - FT-001 through FT-005: Focus trap containment tests
  // - FS-001 through FS-006: Focus stack management tests
});
