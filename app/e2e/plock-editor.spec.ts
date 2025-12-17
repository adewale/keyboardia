import { test, expect } from '@playwright/test';

/**
 * P-lock (parameter lock) editor tests
 *
 * The p-lock editor appears when Shift+clicking an active step.
 * It should close when:
 * 1. Clicking outside the editor
 * 2. Clicking the same step again (toggle)
 * 3. Shift+clicking a different step (switches to that step)
 */

test.describe('P-lock editor', () => {
  test.beforeEach(async ({ page }) => {
    // Go to home page - this creates a new empty session
    await page.goto('/');

    // Wait for the grid to load
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Add a track by clicking on an instrument in the picker
    const instrumentButton = page.locator('.instrument-btn').first();
    await instrumentButton.click();

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

    // Wait for the click-outside listener to be added (50ms delay in code + margin)
    await page.waitForTimeout(150);

    // Click outside (on the header area)
    await page.locator('.app-header').click();

    // Wait for state to update
    await page.waitForTimeout(100);

    // Verify p-lock editor is hidden
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
    await page.waitForTimeout(200);

    // Verify tooltip shows the new values
    const title = await firstStep.getAttribute('title');
    expect(title).toContain('+5');
    expect(title).toContain('50%');
  });
});
