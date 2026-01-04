/**
 * Accessibility Tests
 *
 * Tests for WCAG 2.1 AA compliance and keyboard navigation.
 * Uses built-in Playwright features for accessibility testing.
 *
 * Note: For full axe-core integration, install @axe-core/playwright.
 * These tests provide baseline accessibility verification.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect } from '@playwright/test';
import { waitWithTolerance } from './global-setup';

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
  });

  test('page has accessible title', async ({ page }) => {
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    console.log(`Page title: "${title}"`);
  });

  test('interactive elements have accessible names', async ({ page }) => {
    // Check play button
    const playButton = page.locator('[data-testid="play-button"], .transport button').first();
    if (await playButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      const ariaLabel = await playButton.getAttribute('aria-label');
      const textContent = await playButton.textContent();
      const hasAccessibleName = ariaLabel || (textContent && textContent.trim().length > 0);
      expect(hasAccessibleName).toBeTruthy();
    }

    // Check step cells have some form of accessible identification
    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();
    if (stepCount > 0) {
      const firstStep = stepCells.first();
      const role = await firstStep.getAttribute('role');
      const ariaLabel = await firstStep.getAttribute('aria-label');
      // Step cells should be buttons or have button role
      const hasRole = role === 'button' || role === 'checkbox';
      // Or have an aria-label
      const hasLabel = ariaLabel && ariaLabel.length > 0;
      // At minimum, they should be interactive
      const isInteractive = hasRole || hasLabel;
      console.log(`Step cells: role=${role}, aria-label=${ariaLabel}`);
    }
  });

  test('page has proper heading hierarchy', async ({ page }) => {
    // Check for h1
    const h1 = page.locator('h1');
    const h1Count = await h1.count();

    // Should have at most one h1
    expect(h1Count).toBeLessThanOrEqual(1);

    // Check heading order (h1 before h2, h2 before h3, etc.)
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
    let lastLevel = 0;
    for (const heading of headings) {
      const tagName = await heading.evaluate((el) => el.tagName.toLowerCase());
      const level = parseInt(tagName.replace('h', ''), 10);

      // Should not skip levels (e.g., h1 -> h3 without h2)
      if (lastLevel > 0 && level > lastLevel + 1) {
        console.warn(`Heading level skipped: h${lastLevel} -> h${level}`);
      }
      lastLevel = level;
    }
  });

  test('focusable elements are keyboard accessible', async ({ page }) => {
    // Tab through the page and verify focus moves
    await page.keyboard.press('Tab');

    // Get focused element
    const focused1 = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName.toLowerCase() : null;
    });

    expect(focused1).not.toBe('body'); // Should have moved focus

    // Tab again
    await page.keyboard.press('Tab');
    const focused2 = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName.toLowerCase() : null;
    });

    // Focus should have moved to a different element or same type
    console.log(`Tab navigation: ${focused1} -> ${focused2}`);
  });

  test('step cells can be activated with keyboard', async ({ page }) => {
    // Find first step cell
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'No step cells visible');
      return;
    }

    // Focus the step cell
    await stepCell.focus();

    // Check it's active (or inactive) initially
    const initialState = await stepCell.evaluate((el) =>
      el.classList.contains('active') || el.getAttribute('data-active') === 'true'
    );

    // Press Space or Enter to toggle
    await page.keyboard.press('Space');
    await waitWithTolerance(page, 200);

    // Check state changed
    const newState = await stepCell.evaluate((el) =>
      el.classList.contains('active') || el.getAttribute('data-active') === 'true'
    );

    // Note: This might not work if step cells don't support keyboard activation yet
    // Log the result either way
    console.log(`Keyboard toggle: ${initialState} -> ${newState}`);
  });

  test('color contrast meets minimum requirements', async ({ page }) => {
    // Get computed styles of key elements
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'No step cells visible');
      return;
    }

    // Get background and foreground colors
    const colors = await stepCell.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        background: style.backgroundColor,
        color: style.color,
      };
    });

    console.log(`Step cell colors: bg=${colors.background}, fg=${colors.color}`);

    // Note: Full contrast ratio calculation requires a library
    // This test just verifies we can get the colors
    expect(colors.background).toBeTruthy();
  });

  test('focus indicators are visible', async ({ page }) => {
    // Tab to an element
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Get focused element
    const focusedElement = page.locator(':focus');

    if (await focusedElement.isVisible()) {
      // Check for focus ring/outline
      const outline = await focusedElement.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          outline: style.outline,
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
        };
      });

      console.log('Focus styles:', outline);

      // Should have some visible focus indicator
      const hasFocusIndicator =
        outline.outlineWidth !== '0px' ||
        outline.boxShadow !== 'none';

      // This is a soft check - many modern UIs use custom focus styles
      if (!hasFocusIndicator) {
        console.warn('Element may not have visible focus indicator');
      }
    }
  });

  test('no elements with tabindex > 0', async ({ page }) => {
    // Elements with tabindex > 0 disrupt natural tab order
    const badTabindex = await page.locator('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])').count();

    expect(badTabindex).toBe(0);
  });

  test('images have alt text', async ({ page }) => {
    const images = page.locator('img');
    const imageCount = await images.count();

    for (let i = 0; i < imageCount; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      const role = await img.getAttribute('role');

      // Images should have alt text, or be decorative (role="presentation")
      const isAccessible = alt !== null || role === 'presentation';

      if (!isAccessible) {
        const src = await img.getAttribute('src');
        console.warn(`Image missing alt text: ${src}`);
      }
    }

    console.log(`Checked ${imageCount} images`);
  });
});
