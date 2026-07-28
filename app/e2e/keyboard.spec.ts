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

import { test, expect, waitForAppReady, pressKeyboardTab } from './global-setup';

/**
 * Check if running on a mobile browser project.
 */
function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile-');
}

/**
 * New sessions start empty, so any test that needs a `.step-cell` has to add a
 * track first. Several tests here previously guarded on `.step-cell` visibility
 * and silently did nothing because that guard was always false.
 */
async function addKickTrack(page: import('@playwright/test').Page): Promise<void> {
  const kickButton = page.getByRole('button', { name: /808 Kick/i });
  await expect(kickButton).toBeVisible({ timeout: 10000 });
  await kickButton.click();
  await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });
}

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires physical keyboard');
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('Tab navigates through interactive elements', async ({ page, browserName }) => {
    const focusedElements: string[] = [];

    for (let i = 0; i < 10; i++) {
      await pressKeyboardTab(page, browserName);

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

  test('Shift+Tab navigates backwards', async ({ page, browserName }) => {
    await pressKeyboardTab(page, browserName);
    await pressKeyboardTab(page, browserName);
    await pressKeyboardTab(page, browserName);

    const forwardFocus = page.locator(':focus');
    await expect(forwardFocus).toBeVisible();
    await forwardFocus.evaluate((element) => {
      element.setAttribute('data-e2e-forward-focus', 'true');
    });

    await pressKeyboardTab(page, browserName, true);

    await expect(page.locator('[data-e2e-forward-focus="true"]')).not.toBeFocused();
    await expect(page.locator(':focus')).toBeVisible();
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

  // Space -> Play/Pause is specified in specs/KEYBOARD-SHORTCUTS.md and wired in
  // src/hooks/useKeyboard.ts. It is not conditional, so this test is not either
  // — the previous "(if implemented)" version wrapped a bare console.log in
  // `.toPass().catch(() => {})` and could not fail.
  test('Space starts and stops playback', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Real audio playback is owned by Chromium; headless WebKit can wedge on AudioContext.resume()');
    const playButton = page.getByTestId('play-button');
    await expect(playButton).toHaveAttribute('aria-label', 'Play');

    await page.keyboard.press('Space');
    await expect(playButton).toHaveAttribute('aria-label', 'Stop');
    await expect(playButton).toHaveClass(/playing/);

    await page.keyboard.press('Space');
    await expect(playButton).toHaveAttribute('aria-label', 'Play');
    await expect(playButton).not.toHaveClass(/playing/);
  });

  // "Ctrl+A selects all (if implemented)" was deleted rather than fixed: it is
  // not implemented, not in useKeyboard.ts, and not in the shortcut table in
  // specs/KEYBOARD-SHORTCUTS.md. Selection is Ctrl/Cmd+Click per that spec. The
  // test pressed Ctrl+A, logged a count, and asserted nothing — a passing test
  // for a feature that does not exist.

  test('Delete clears selected steps', async ({ page }) => {
    await addKickTrack(page);

    const stepCell = page.locator('.step-cell').first();
    await expect(stepCell).toBeVisible();

    // Activate the step, then select it (Ctrl+Click per KEYBOARD-SHORTCUTS.md).
    await stepCell.click();
    await expect(stepCell, 'clicking a step should activate it').toHaveClass(/active/);

    await stepCell.click({ modifiers: ['Control'] });
    await page.keyboard.press('Delete');

    await expect(stepCell, 'Delete should clear the selected step').not.toHaveClass(/active/);
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

  test('focus does not get trapped', async ({ page, browserName }) => {
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
      await pressKeyboardTab(page, browserName);

      const focused = await page.evaluate((selector) => {
        const active = document.activeElement;
        const candidates = Array.from(document.querySelectorAll(selector));
        return `${active?.tagName ?? 'none'}-${candidates.indexOf(active as Element)}`;
      }, focusableSelector);

      firstFocused ??= focused;
      if (visitedElements.has(focused) && visitedElements.size >= 3) {
        expect(focused).toBe(firstFocused);
        completedCycle = true;
        break;
      }
      visitedElements.add(focused);
    }

    expect(visitedElements.size).toBeGreaterThanOrEqual(3);
    expect(completedCycle).toBe(true);
  });

  // NOTE: "focus returns after closing dialogs" test was removed.
  // Covered by unit tests in src/components/focus-management.test.ts:
  // - DC-001 through DC-005: Dialog close focus restoration tests
  // - FT-001 through FT-005: Focus trap containment tests
  // - FS-001 through FS-006: Focus stack management tests
});
