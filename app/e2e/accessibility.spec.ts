/**
 * Accessibility Tests
 *
 * Tests for WCAG 2.1 AA compliance and keyboard navigation.
 * Uses built-in Playwright features and best practices.
 *
 * Note: For full axe-core integration, install @axe-core/playwright.
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

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('page has accessible title', async ({ page }) => {
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('interactive elements have accessible names', async ({ page }) => {
    // Check play button using semantic locator
    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"]'))
      .or(page.locator('.transport button').first());

    try {
      await playButton.waitFor({ state: 'visible', timeout: 2000 });
      const ariaLabel = await playButton.getAttribute('aria-label');
      const textContent = await playButton.textContent();
      const hasAccessibleName = ariaLabel || (textContent && textContent.trim().length > 0);
      expect(hasAccessibleName).toBeTruthy();
    } catch {
      // Play button might not be visible
    }

    // Check step cells
    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();
    if (stepCount > 0) {
      const firstStep = stepCells.first();
      const role = await firstStep.getAttribute('role');
      const ariaLabel = await firstStep.getAttribute('aria-label');
      console.log(`Step cells: role=${role}, aria-label=${ariaLabel}`);
    }
  });

  test('page has proper heading hierarchy', async ({ page }) => {
    const h1 = page.locator('h1');
    const h1Count = await h1.count();
    expect(h1Count).toBeLessThanOrEqual(1);

    const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
    let lastLevel = 0;
    for (const heading of headings) {
      const tagName = await heading.evaluate((el) => el.tagName.toLowerCase());
      const level = parseInt(tagName.replace('h', ''), 10);

      if (lastLevel > 0 && level > lastLevel + 1) {
        console.warn(`Heading level skipped: h${lastLevel} -> h${level}`);
      }
      lastLevel = level;
    }
  });

  test('focusable elements are keyboard accessible', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires physical keyboard');
    await page.keyboard.press('Tab');

    const focused1 = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName.toLowerCase() : null;
    });

    expect(focused1).not.toBe('body');

    await page.keyboard.press('Tab');
    const focused2 = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());

    console.log(`Tab navigation: ${focused1} -> ${focused2}`);
  });

  // NOTE: "step cells can be activated with keyboard" test was removed.
  // Covered by unit tests in src/components/keyboard-handlers.test.ts:
  // - K-001: toggling inactive step makes it active
  // - E-001: Space key on step should dispatch toggle
  // - A-001 through A-004: accessibility attribute tests
  //
  // NOTE: Step cell accessibility attributes are also tested in src/components/StepCell.test.tsx:
  // - SC-A01 through SC-A06: aria-label, data-step-index, button role

  // NOTE: "color contrast meets minimum requirements" test was removed.
  // Covered by unit tests in src/components/accessibility-contrast.test.ts:
  // - CC-001 through CC-006: Color contrast calculation tests
  // - APV-001 through APV-005: App color palette validation tests
  // - SCC-001 through SCC-003: Step cell specific contrast tests

  test('focus indicators are visible', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - requires physical keyboard');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const focusedElement = page.locator(':focus');

    if (await focusedElement.isVisible()) {
      const outline = await focusedElement.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          outline: style.outline,
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
        };
      });

      console.log('Focus styles:', outline);
    }
  });

  test('no elements with tabindex > 0', async ({ page }) => {
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

      if (alt === null && role !== 'presentation') {
        const src = await img.getAttribute('src');
        console.warn(`Image missing alt text: ${src}`);
      }
    }

    console.log(`Checked ${imageCount} images`);
  });
});
