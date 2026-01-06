import { test, expect, getBaseUrl } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

/**
 * P-lock (parameter lock) editor tests
 *
 * The p-lock editor appears when Shift+clicking an active step.
 * Uses Playwright best practices with proper waits.
 *
 * It should close when:
 * 1. Clicking outside the editor
 * 2. Clicking the same step again (toggle)
 * 3. Shift+clicking a different step (switches to that step)
 */

/**
 * Create a test session with one track and some active steps
 */
async function createTestSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  // Don't pre-activate step 0 - tests will activate it via click
  // Only pre-activate steps 4 and 8 for tests that need multiple steps
  const steps = Array(64).fill(false);
  steps[4] = true;
  steps[8] = true;

  return createSessionWithRetry(request, {
    tracks: [
      {
        id: 'test-track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps,
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount: 16,
      },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  });
}

test.describe('P-lock editor', () => {
  test.beforeEach(async ({ page, request }) => {
    // Create a session via API and navigate to it
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');

    // Wait for the grid to load
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Wait for track to appear
    await expect(page.locator('.track-row')).toBeVisible({ timeout: 5000 });
  });

  test('should open p-lock editor on Shift+click of active step', async ({ page }) => {
    // Get the first step cell and activate it
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();

    // Verify step is now active
    await expect(firstStep).toHaveClass(/active/);

    // Shift+click to open p-lock editor
    await firstStep.click({ modifiers: ['Shift'] });

    // Verify p-lock editor is visible
    const plockEditor = page.locator('.plock-inline');
    await expect(plockEditor).toBeVisible({ timeout: 2000 });

    // Verify it shows the step number
    await expect(plockEditor.locator('.plock-step')).toContainText('Step 1');
  });

  test('should close p-lock editor when clicking outside', async ({ page }) => {
    // Activate a step
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();

    // Open p-lock editor
    await firstStep.click({ modifiers: ['Shift'] });
    const plockEditor = page.locator('.plock-inline');
    await expect(plockEditor).toBeVisible({ timeout: 2000 });

    // Wait for the click-outside listener to be added
    await plockEditor.waitFor({ state: 'visible' });

    // Click outside (on the header area)
    await page.locator('.app-header').click();

    // Verify p-lock editor is hidden using web-first assertion
    await expect(plockEditor).not.toBeVisible({ timeout: 2000 });
  });

  test('should close p-lock editor when clicking same step again', async ({ page }) => {
    // Activate a step
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();

    // Open p-lock editor
    await firstStep.click({ modifiers: ['Shift'] });
    const plockEditor = page.locator('.plock-inline');
    await expect(plockEditor).toBeVisible({ timeout: 2000 });

    // Shift+click same step again to toggle closed
    await firstStep.click({ modifiers: ['Shift'] });

    // Verify p-lock editor is hidden
    await expect(plockEditor).not.toBeVisible({ timeout: 2000 });
  });

  test('should switch p-lock editor to different step on Shift+click', async ({ page }) => {
    // Activate first two steps
    const firstStep = page.locator('.step-cell').first();
    const secondStep = page.locator('.step-cell').nth(1);

    await firstStep.click();
    await secondStep.click();

    // Open p-lock editor on first step
    await firstStep.click({ modifiers: ['Shift'] });
    const plockEditor = page.locator('.plock-inline');
    await expect(plockEditor).toBeVisible({ timeout: 2000 });
    await expect(plockEditor.locator('.plock-step')).toContainText('Step 1');

    // Shift+click second step - should switch to it
    await secondStep.click({ modifiers: ['Shift'] });

    // Editor should still be visible but showing step 2
    await expect(plockEditor).toBeVisible();
    await expect(plockEditor.locator('.plock-step')).toContainText('Step 2');
  });

  test('tooltip should show pitch and volume values on hover', async ({ page }) => {
    // Activate a step
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();

    // Check the title attribute contains expected info
    const title = await firstStep.getAttribute('title');
    expect(title).toContain('Step 1');
    expect(title).toContain('Pitch:');
    expect(title).toContain('Vol:');
    expect(title).toContain('Shift+Click to edit');
  });

  test('p-lock changes should persist and show in tooltip', async ({ page }) => {
    // Activate a step
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();

    // Open p-lock editor
    await firstStep.click({ modifiers: ['Shift'] });
    const plockEditor = page.locator('.plock-inline');
    await expect(plockEditor).toBeVisible({ timeout: 2000 });

    // Change pitch to +5
    const pitchSlider = plockEditor.locator('.plock-slider.pitch');
    await pitchSlider.fill('5');

    // Change volume to 50%
    const volumeSlider = plockEditor.locator('.plock-slider.volume');
    await volumeSlider.fill('50');

    // Close editor by clicking outside
    await page.locator('.app-header').click();
    await expect(plockEditor).not.toBeVisible({ timeout: 2000 });

    // Verify tooltip shows the new values
    const title = await firstStep.getAttribute('title');
    expect(title).toContain('+5');
    expect(title).toContain('50%');
  });
});
