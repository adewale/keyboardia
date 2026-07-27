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

import { test, expect, getBaseUrl, waitForAppReady } from './global-setup';
import { createPopulatedSessionWithRetry } from './test-utils';

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

  test('visible buttons and links have computed accessible names @blocking', async ({ page }) => {
    const controls = page.locator('button:visible, a[href]:visible, [role="button"]:visible');
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      // Elements inside an inert or aria-hidden subtree are not in the
      // accessibility tree at all, so requiring a name from them is meaningless.
      const excluded = await control.evaluate(
        (element) => element.closest('[inert], [aria-hidden="true"]') !== null,
      );
      if (excluded) continue;
      await expect(control, `control ${index}`).toHaveAccessibleName(/\S/);
    }
  });

  test('visible icon-only controls use explicit aria labels @blocking', async ({ page }) => {
    const violations = await page.locator('button:visible, [role="button"]:visible').evaluateAll((elements) =>
      elements
        .filter((element) => element.closest('[inert], [aria-hidden="true"]') === null)
        .filter((element) => element.querySelector('svg'))
        .filter((element) => !element.textContent?.trim())
        .filter((element) => !element.getAttribute('aria-label')?.trim())
        .map((element) => element.getAttribute('class')),
    );

    expect(violations).toEqual([]);
  });

  test('panel toggles expose disclosure state and controlled regions @blocking', async ({ page }) => {
    const effects = page.getByRole('button', { name: 'Open effects panel' });
    const effectsPanel = page.locator('#effects-panel');
    await expect(effects).toHaveAttribute('aria-expanded', 'false');
    await expect(effects).toHaveAttribute('aria-controls', 'effects-panel');
    await expect(effectsPanel).toHaveAttribute('aria-hidden', 'true');
    await effects.click();
    await expect(page.getByRole('button', { name: 'Close effects panel' })).toHaveAttribute('aria-expanded', 'true');
    await expect(effectsPanel).toHaveAttribute('aria-hidden', 'false');

    const mixer = page.getByRole('button', { name: 'Open mixer' });
    const mixerPanel = page.locator('#mixer-panel');
    await expect(mixer).toHaveAttribute('aria-expanded', 'false');
    await expect(mixer).toHaveAttribute('aria-controls', 'mixer-panel');
    await expect(mixerPanel).toHaveAttribute('aria-hidden', 'true');
    await mixer.click();
    await expect(page.getByRole('button', { name: 'Close mixer' })).toHaveAttribute('aria-expanded', 'true');
    await expect(mixerPanel).toHaveAttribute('aria-hidden', 'false');
  });

  test('sequencer steps support native Enter and Space activation @blocking', async ({ page, request }) => {
    const created = await request.post(`${getBaseUrl()}/api/sessions`, {
      data: { state: {
        tracks: [{
          id: 'keyboard-track', name: 'Keyboard Track', sampleId: 'kick',
          steps: Array(128).fill(false), parameterLocks: Array(128).fill(null),
          volume: 1, muted: false, soloed: false, transpose: 0, stepCount: 16,
        }],
        tempo: 120, swing: 0, version: 1,
      } },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);
    await expect(page.locator('.track-row')).toHaveCount(1);
    const step = page.locator('.track-row').first().locator('.step-cell').nth(1);
    const playButton = page.getByTestId('play-button');

    await step.focus();
    await page.keyboard.press('Enter');
    await expect(step).toHaveClass(/active/);

    await page.keyboard.press('Space');
    await expect(step).not.toHaveClass(/active/);
    await expect(playButton).not.toHaveClass(/playing/);
  });

  test('mixer mute and solo expose their pressed state @blocking', async ({ page, request }) => {
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);
    await page.getByRole('button', { name: 'Open mixer' }).click();

    const firstChannel = page.locator('.mixer-channel').first();
    const mute = firstChannel.getByRole('button', { name: 'Mute' });
    const solo = firstChannel.getByRole('button', { name: 'Solo' });
    await expect(mute).toHaveAttribute('aria-pressed', /^(true|false)$/);
    await expect(solo).toHaveAttribute('aria-pressed', /^(true|false)$/);

    const previousMuteState = await mute.getAttribute('aria-pressed');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', previousMuteState === 'true' ? 'false' : 'true');
  });

  test('page has proper heading hierarchy', async ({ page }) => {
    const h1 = page.locator('h1');
    const h1Count = await h1.count();
    expect(h1Count).toBeLessThanOrEqual(1);

    const levels = await page.locator('h1, h2, h3, h4, h5, h6').evaluateAll((headings) =>
      headings.map(heading => Number(heading.tagName.slice(1))),
    );
    const skippedLevels = levels.flatMap((level, index) =>
      index > 0 && level > levels[index - 1] + 1
        ? [`h${levels[index - 1]} -> h${level}`]
        : [],
    );
    expect(skippedLevels).toEqual([]);
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
    expect(focused2).not.toBe('body');
    expect(focused2).toBeTruthy();
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
    await expect(focusedElement).toBeVisible();
    const indicator = await focusedElement.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        outlineWidth: Number.parseFloat(style.outlineWidth),
        boxShadow: style.boxShadow,
      };
    });
    expect(
      indicator.outlineWidth > 0 || indicator.boxShadow !== 'none',
      'focused control should render an outline or box shadow',
    ).toBe(true);
  });

  test('no elements with tabindex > 0', async ({ page }) => {
    const badTabindex = await page.locator('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])').count();
    expect(badTabindex).toBe(0);
  });

  test('images have alt text', async ({ page }) => {
    const images = page.locator('img');
    const imageCount = await images.count();

    const violations: string[] = [];
    for (let i = 0; i < imageCount; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      const role = await img.getAttribute('role');
      if (alt === null && role !== 'presentation' && role !== 'none') {
        violations.push((await img.getAttribute('src')) ?? '<missing src>');
      }
    }

    expect(violations).toEqual([]);
  });
});
