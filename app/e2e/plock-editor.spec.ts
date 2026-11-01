import { test, expect, getBaseUrl, useMockAPI } from './global-setup';
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
  const steps = Array(128).fill(false);
  steps[4] = true;
  steps[8] = true;

  return createSessionWithRetry(request, {
    tracks: [
      {
        id: 'test-track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps,
        parameterLocks: Array(128).fill(null),
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

    // Real-backend runs verify the WebSocket path. Mock mode still exercises
    // deterministic local grid/focus behavior without claiming multiplayer.
    if (!useMockAPI) {
      await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });
    }

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

    // Wait for the click-outside listener to be added (50ms delay in component)
    await page.waitForTimeout(100);

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

  test('clear action is named and restores focus to the invoking step @blocking', async ({ page }) => {
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();
    await firstStep.click({ modifiers: ['Shift'] });

    const plockEditor = page.locator('.plock-inline');
    await expect(plockEditor).toBeVisible({ timeout: 2000 });

    await plockEditor.locator('.plock-slider.pitch').fill('5');
    const clearButton = page.getByRole('button', { name: 'Clear lock' });
    await expect(clearButton).toBeVisible();
    await clearButton.focus();
    await expect(clearButton).toBeFocused();

    await clearButton.click();
    await expect(plockEditor).not.toBeVisible({ timeout: 2000 });
    await expect(firstStep).toBeFocused();
  });

  test('outside dismissal does not steal focus back to the invoking step @blocking', async ({ page }) => {
    const firstStep = page.locator('.step-cell').first();
    await firstStep.click();
    await firstStep.click({ modifiers: ['Shift'] });

    const plockEditor = page.locator('.plock-inline');
    await expect(plockEditor).toBeVisible({ timeout: 2000 });
    await plockEditor.locator('.plock-slider.pitch').focus();
    // The editor deliberately delays click-outside registration by 50ms so
    // the pointer event that opened it cannot immediately close it.
    await page.waitForTimeout(75);

    const copyButton = page.getByRole('button', { name: 'Copy' }).first();
    await copyButton.click();

    await expect(plockEditor).not.toBeVisible({ timeout: 2000 });
    // Safari intentionally does not focus buttons on pointer click, so the
    // cross-browser invariant is that focus is not stolen back to the step.
    await expect(firstStep).not.toBeFocused();
  });

  // NOTE: "tooltip should show pitch and volume values on hover" test was removed.
  // Covered by unit tests in src/components/StepCell.test.tsx:
  // - SC-T01 through SC-T10: Tooltip content generation tests
  // - Verifies Step number, Pitch, Volume, and edit instructions are in tooltip

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
    // NOTE: The click-outside handler has a 50ms delay before attaching,
    // and it resets on each render (due to onDismiss dependency).
    // Wait for the listener to be attached after the last slider interaction.
    await page.waitForTimeout(100);
    await page.locator('.app-header').click();
    await expect(plockEditor).not.toBeVisible({ timeout: 2000 });

    // Verify tooltip shows the new values
    const title = await firstStep.getAttribute('title');
    expect(title).toContain('+5');
    expect(title).toContain('50%');
  });
});
